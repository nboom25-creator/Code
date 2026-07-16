"""Feature candidates detected from tessellated geometry.

Everything here is a *candidate*: an STL has no feature history, so holes,
planes, cylinders and symmetry planes are inferred geometrically and labeled
with fit error.
"""
from __future__ import annotations

import numpy as np
import trimesh


def planar_patches(mesh: trimesh.Trimesh, min_area_fraction: float = 0.005) -> list[dict]:
    out = []
    try:
        facets = mesh.facets  # coplanar connected face groups
        facet_areas = mesh.facets_area
    except Exception:
        return out
    total = float(mesh.area) or 1.0
    order = np.argsort(facet_areas)[::-1]
    for fi in order[:40]:
        if facet_areas[fi] / total < min_area_fraction:
            break
        faces = facets[fi]
        normal = mesh.face_normals[faces[0]]
        centroid = mesh.triangles_center[faces].mean(axis=0)
        out.append({
            "type": "planar_face",
            "face_indices": np.asarray(faces).tolist(),
            "area": float(facet_areas[fi]),
            "normal": normal.tolist(),
            "centroid": centroid.tolist(),
        })
    return out


def _fit_circle_3d(points: np.ndarray) -> dict | None:
    """Least-squares circle fit to a roughly-planar 3D point loop."""
    if len(points) < 6:
        return None
    c0 = points.mean(axis=0)
    p = points - c0
    _u, _s, vt = np.linalg.svd(p, full_matrices=False)
    normal = vt[2]
    e1, e2 = vt[0], vt[1]
    x, y = p @ e1, p @ e2
    A = np.column_stack([2 * x, 2 * y, np.ones(len(x))])
    b = x * x + y * y
    try:
        sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    except np.linalg.LinAlgError:
        return None
    cx, cy, c = sol
    r = float(np.sqrt(max(c + cx * cx + cy * cy, 0.0)))
    if r <= 0:
        return None
    residual = float(np.abs(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r).mean())
    center = c0 + cx * e1 + cy * e2
    return {"center": center.tolist(), "axis": normal.tolist(), "radius": r,
            "fit_error": residual, "fit_error_ratio": residual / r}


def hole_candidates(mesh: trimesh.Trimesh) -> list[dict]:
    """Detect circular through/blind hole candidates: cylindrical bands of faces
    whose normals are radial around a common axis. Practical approach: cluster
    edges into loops from planar facet inner boundaries + fit circles."""
    holes: list[dict] = []
    try:
        facets = mesh.facets
    except Exception:
        return holes

    for faces in facets[:200]:
        faces = np.asarray(faces)
        if len(faces) < 4:
            continue
        # boundary edges of the facet (edges used once within the facet)
        edges = mesh.faces[faces][:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2)
        edges_sorted = np.sort(edges, axis=1)
        uniq, counts = np.unique(edges_sorted, axis=0, return_counts=True)
        boundary = uniq[counts == 1]
        if len(boundary) < 6:
            continue
        # split boundary into loops
        import networkx as nx
        g = nx.Graph()
        g.add_edges_from(boundary.tolist())
        loops = [list(c) for c in nx.connected_components(g)]
        if len(loops) < 2:
            continue  # a facet with holes has >1 boundary loop
        # the outer boundary is the loop with the largest spatial extent (NOT
        # most vertices — a coarse rectangle can have fewer points than a hole)
        facet_pts = mesh.vertices[np.unique(mesh.faces[faces].reshape(-1))]
        facet_diag = float(np.linalg.norm(facet_pts.max(axis=0) - facet_pts.min(axis=0)))
        extents = []
        for loop in loops:
            lp = mesh.vertices[list(loop)]
            extents.append(float(np.linalg.norm(lp.max(axis=0) - lp.min(axis=0))))
        outer = int(np.argmax(extents))
        for li, loop in enumerate(loops[:8]):
            if li == outer:
                continue
            pts = mesh.vertices[list(loop)]
            fit = _fit_circle_3d(pts)
            if fit and fit["fit_error_ratio"] < 0.08 and 2 * fit["radius"] < 0.7 * facet_diag:
                holes.append({
                    "type": "hole_candidate",
                    "diameter": 2 * fit["radius"],
                    **fit,
                    "in_planar_face": True,
                    "note": "Circle fitted to an inner boundary loop of a planar face.",
                })
    # dedupe near-identical fits
    deduped: list[dict] = []
    for h in holes:
        c = np.array(h["center"])
        if all(np.linalg.norm(c - np.array(d["center"])) > 0.25 * h["diameter"] for d in deduped):
            deduped.append(h)
    # merge coaxial pairs (two ends of one through hole) into a single entry
    merged: list[dict] = []
    used = set()
    for i, h in enumerate(deduped):
        if i in used:
            continue
        ci, ai = np.array(h["center"]), np.array(h["axis"])
        best = None
        for j in range(i + 1, len(deduped)):
            if j in used:
                continue
            other = deduped[j]
            cj, aj = np.array(other["center"]), np.array(other["axis"])
            if abs(float(ai @ aj)) < 0.95:
                continue
            dvec = cj - ci
            dist = float(np.linalg.norm(dvec))
            if dist < 1e-9:
                continue
            if abs(float((dvec / dist) @ ai)) > 0.95 and \
                    abs(other["diameter"] - h["diameter"]) < 0.2 * h["diameter"]:
                best = (j, dist)
                break
        if best:
            j, depth = best
            used.add(j)
            merged.append({**h,
                           "center": (0.5 * (ci + np.array(deduped[j]["center"]))).tolist(),
                           "depth": depth, "through": True,
                           "note": "Through-hole candidate (two coaxial circular loops)."})
        else:
            merged.append({**h, "depth": None, "through": False})
    return merged[:50]


def symmetry_planes(mesh: trimesh.Trimesh, samples: int = 800, rel_tol: float = 0.005) -> list[dict]:
    """Test mirror symmetry across the three principal planes through the
    center of mass, measuring mirrored-point distance to the actual surface."""
    if len(mesh.vertices) < 10:
        return []
    pts, _ = trimesh.sample.sample_surface(mesh, min(samples, 4 * len(mesh.faces)), seed=7)
    origin = mesh.center_mass if mesh.is_watertight else mesh.centroid
    axes = np.asarray(_principal_axes_np(mesh))
    scale = float(mesh.scale)
    out = []
    from trimesh.proximity import closest_point
    for i in range(3):
        n = axes[i]
        d = (pts - origin) @ n
        mirrored = pts - 2 * np.outer(d, n)
        _cp, dist, _tid = closest_point(mesh, mirrored)
        err = float(np.percentile(dist, 90)) / scale
        if err < rel_tol:
            out.append({"type": "symmetry_plane", "point": np.asarray(origin, float).tolist(),
                        "normal": n.tolist(), "p90_error_ratio": err})
    return out


def _principal_axes_np(mesh: trimesh.Trimesh) -> np.ndarray:
    if mesh.is_watertight and abs(mesh.volume) > 1e-12:
        try:
            return np.asarray(mesh.principal_inertia_vectors, dtype=float)
        except Exception:
            pass
    p = mesh.vertices - mesh.vertices.mean(axis=0)
    _w, v = np.linalg.eigh(np.cov(p.T))
    return v.T[::-1]


def detect_features(mesh: trimesh.Trimesh) -> dict:
    return {
        "planar_faces": planar_patches(mesh),
        "hole_candidates": hole_candidates(mesh),
        "symmetry_planes": symmetry_planes(mesh),
        "note": "Feature candidates are geometric inferences from the tessellation, not CAD features.",
    }
