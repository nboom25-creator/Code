"""Geometry observations derived directly from the mesh (confidence level 1).

All quantities here are measured from triangles. Anything that depends on
units (mass, SI dimensions) is only computed after the user confirms units;
anything that depends on material is labeled with the material assumption.
"""
from __future__ import annotations

from typing import Any

import numpy as np
import trimesh

from .units import length_scale_to_m


def _principal_axes(mesh: trimesh.Trimesh) -> list[list[float]]:
    if mesh.is_watertight and mesh.volume > 1e-12:
        try:
            return np.asarray(mesh.principal_inertia_vectors, dtype=float).tolist()
        except Exception:
            pass
    pts = mesh.vertices - mesh.vertices.mean(axis=0)
    cov = np.cov(pts.T)
    _w, v = np.linalg.eigh(cov)
    return v.T[::-1].tolist()


def compute_metrics(mesh: trimesh.Trimesh, unit: str | None = None,
                    density_kg_m3: float | None = None) -> dict[str, Any]:
    """Core measurements in mesh units, plus SI conversions when unit confirmed."""
    watertight = bool(mesh.is_watertight)
    extents = mesh.extents.tolist() if len(mesh.vertices) else [0, 0, 0]
    volume_mu = float(abs(mesh.volume)) if watertight else None
    center = (mesh.center_mass if watertight else mesh.centroid)

    metrics: dict[str, Any] = {
        "triangle_count": int(len(mesh.faces)),
        "vertex_count": int(len(mesh.vertices)),
        "bounding_box_mesh_units": {
            "min": mesh.bounds[0].tolist() if len(mesh.vertices) else [0, 0, 0],
            "max": mesh.bounds[1].tolist() if len(mesh.vertices) else [0, 0, 0],
            "extents": extents,
        },
        "surface_area_mesh_units2": float(mesh.area),
        "watertight": watertight,
        "volume_mesh_units3": volume_mu,
        "volume_note": None if watertight else "Volume requires a watertight mesh; repair first.",
        "center_of_mass_mesh_units": np.asarray(center, dtype=float).tolist(),
        "center_of_mass_note": None if watertight else
            "Mesh is not watertight; value shown is the surface centroid, not a true center of mass.",
        "principal_axes": _principal_axes(mesh),
        "unit": unit,
    }

    if unit:
        s = length_scale_to_m(unit)
        metrics["bounding_box_m"] = [e * s for e in extents]
        metrics["surface_area_m2"] = float(mesh.area) * s * s
        if volume_mu is not None:
            vol_m3 = volume_mu * s**3
            metrics["volume_m3"] = vol_m3
            if density_kg_m3:
                metrics["estimated_mass_kg"] = vol_m3 * density_kg_m3
                metrics["mass_note"] = (
                    "Mass estimated from enclosed mesh volume x nominal material density. "
                    "Infill, voids and manufacturing tolerances are not modeled."
                )
    return metrics


def compute_health(mesh: trimesh.Trimesh) -> dict[str, Any]:
    """Mesh integrity report. Counts are exact; self-intersection is flagged
    only where detectable and otherwise reported as 'not checked'."""
    edges_sorted = np.sort(mesh.edges.reshape(-1, 2), axis=1)
    unique_edges, counts = np.unique(edges_sorted, axis=0, return_counts=True)
    boundary_edges = int((counts == 1).sum())
    nonmanifold_edges = int((counts > 2).sum())

    faces_sorted = np.sort(mesh.faces, axis=1)
    _uniq, face_counts = np.unique(faces_sorted, axis=0, return_counts=True)
    duplicate_faces = int((face_counts > 1).sum())

    areas = mesh.area_faces
    scale = float(mesh.scale) if len(mesh.vertices) else 1.0
    degenerate_faces = int((areas < (1e-10 * scale * scale)).sum())

    # Triangle quality: ratio of longest edge to (2 * area / longest edge) ~ aspect
    tri = mesh.triangles
    e = np.linalg.norm(np.roll(tri, -1, axis=1) - tri, axis=2)  # 3 edge lengths per face
    longest = e.max(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        aspect = np.where(areas > 0, longest * longest / (2.0 * np.maximum(areas, 1e-30)), np.inf)
    skewed_faces = int((aspect > 50.0).sum())

    winding_consistent = bool(mesh.is_winding_consistent)
    try:
        broken = int(len(trimesh.repair.broken_faces(mesh)))
    except Exception:
        broken = 0

    components = mesh.split(only_watertight=False)
    comp_sizes = sorted((len(c.faces) for c in components), reverse=True)

    self_intersection: dict[str, Any] = {"checked": False, "note": "Exact self-intersection testing is not run by default (cost); manifold conversion during variant generation will surface intersection problems."}
    if mesh.is_watertight and len(mesh.faces) <= 200_000:
        try:
            import manifold3d
            mf = manifold3d.Manifold(
                manifold3d.Mesh(
                    vert_properties=np.asarray(mesh.vertices, dtype=np.float32),
                    tri_verts=np.asarray(mesh.faces, dtype=np.uint32),
                )
            )
            self_intersection = {"checked": True, "suspected": bool(mf.status() != manifold3d.Error.NoError),
                                 "status": str(mf.status())}
        except Exception as exc:
            self_intersection = {"checked": False, "note": f"manifold check unavailable: {exc}"}

    issues = []
    if not mesh.is_watertight:
        issues.append({"code": "not_watertight", "severity": "high",
                       "message": f"Mesh is not watertight ({boundary_edges} boundary edges). Volume, mass and FEA meshing require a closed surface."})
    if nonmanifold_edges:
        issues.append({"code": "non_manifold", "severity": "high",
                       "message": f"{nonmanifold_edges} non-manifold edges (more than two faces share an edge)."})
    if duplicate_faces:
        issues.append({"code": "duplicate_faces", "severity": "medium",
                       "message": f"{duplicate_faces} duplicated faces."})
    if degenerate_faces:
        issues.append({"code": "degenerate_faces", "severity": "medium",
                       "message": f"{degenerate_faces} zero-area (degenerate) faces."})
    if not winding_consistent:
        issues.append({"code": "inconsistent_winding", "severity": "medium",
                       "message": f"Face winding is inconsistent ({broken} faces flagged); normals may point the wrong way."})
    if len(components) > 1:
        issues.append({"code": "multiple_components", "severity": "medium",
                       "message": f"Mesh contains {len(components)} disconnected components (largest {comp_sizes[0]} faces)."})
    if skewed_faces:
        issues.append({"code": "skewed_triangles", "severity": "low",
                       "message": f"{skewed_faces} extremely thin/skewed triangles (aspect > 50); these degrade FEA mesh quality."})

    return {
        "watertight": bool(mesh.is_watertight),
        "winding_consistent": winding_consistent,
        "broken_face_count": broken,
        "boundary_edge_count": boundary_edges,
        "non_manifold_edge_count": nonmanifold_edges,
        "duplicate_face_count": duplicate_faces,
        "degenerate_face_count": degenerate_faces,
        "skewed_triangle_count": skewed_faces,
        "connected_components": len(components),
        "component_face_counts": comp_sizes[:20],
        "self_intersection": self_intersection,
        "issues": issues,
    }


def sharp_edge_field(mesh: trimesh.Trimesh, angle_deg: float = 60.0) -> np.ndarray:
    """Per-vertex sharpness score in [0,1]: fraction-weighted concentration of
    adjacent dihedral angles above threshold. Used for the curvature/sharp-edge map."""
    score = np.zeros(len(mesh.vertices))
    if len(mesh.face_adjacency) == 0:
        return score
    angles = mesh.face_adjacency_angles  # radians between adjacent face normals
    sharp = angles > np.radians(angle_deg)
    if not sharp.any():
        return score
    sharp_edges = mesh.face_adjacency_edges[sharp]
    sharp_angles = angles[sharp]
    np.add.at(score, sharp_edges[:, 0], sharp_angles)
    np.add.at(score, sharp_edges[:, 1], sharp_angles)
    m = score.max()
    return score / m if m > 0 else score
