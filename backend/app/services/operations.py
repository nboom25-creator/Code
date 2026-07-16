"""Validated design-operation system.

Operations are JSON documents validated against Pydantic schemas, then applied
by deterministic geometry code (manifold3d booleans / constrained smoothing).
An LLM (or any client) may PROPOSE operation documents but can never emit
vertices directly — everything passes through schema validation, protected-
region checks and post-operation geometry validation.

All lengths are in MESH UNITS of the target mesh (the project's confirmed unit).
"""
from __future__ import annotations

from typing import Literal

import numpy as np
import trimesh
from pydantic import BaseModel, Field, ValidationError

# --------------------------------------------------------------------------- schemas


class OpValidation(BaseModel):
    must_be_watertight: bool = True
    max_bbox_growth_fraction: float = 0.25
    max_volume_change_fraction: float = 0.6


class BaseOp(BaseModel):
    op_type: str
    units: str = "mesh_units"
    coordinate_system: Literal["mesh"] = "mesh"
    reason: str = ""
    recommendation_id: str | None = None
    protected_triangle_indices: list[int] = Field(default_factory=list)
    validation: OpValidation = Field(default_factory=OpValidation)


class ThickenRegionOp(BaseOp):
    op_type: Literal["thicken_region"] = "thicken_region"
    triangle_indices: list[int]
    offset: float = Field(gt=0)
    expand_rings: int = Field(default=1, ge=0, le=5)


class ThickenHotspotOp(BaseOp):
    op_type: Literal["thicken_hotspot"] = "thicken_hotspot"
    hotspot_points: list[list[float]]
    offset_fraction_of_diag: float = Field(default=0.01, gt=0, le=0.05)


class AddRibOp(BaseOp):
    op_type: Literal["add_rib"] = "add_rib"
    start: list[float]
    end: list[float]
    height_dir: list[float]
    height: float = Field(gt=0)
    thickness: float = Field(gt=0)


class AddGussetOp(BaseOp):
    op_type: Literal["add_gusset"] = "add_gusset"
    corner_point: list[float]
    normal_a: list[float]
    normal_b: list[float]
    patch_centroid_a: list[float]
    patch_centroid_b: list[float]
    junction_dir: list[float]
    leg: float = Field(gt=0)
    width: float = Field(gt=0)
    mirror_plane: dict | None = None  # {point, normal}


class AddBossOp(BaseOp):
    op_type: Literal["add_boss"] = "add_boss"
    center: list[float]
    axis: list[float]
    hole_diameter: float = Field(gt=0)
    outer_diameter: float = Field(gt=0)
    height: float = Field(gt=0)


class AddPadOp(BaseOp):
    op_type: Literal["add_pad"] = "add_pad"
    center: list[float]
    normal: list[float]
    size: list[float]  # [x, y] footprint
    height: float = Field(gt=0)


class AddDrainHoleOp(BaseOp):
    op_type: Literal["add_drain_hole"] = "add_drain_hole"
    cavity_centroid: list[float]
    direction: list[float] = Field(default_factory=lambda: [0.0, 0.0, -1.0])
    diameter_mm: float = Field(default=4.0, gt=0)
    unit_scale_to_m: float | None = None  # to convert mm to mesh units


class EnlargeHoleOp(BaseOp):
    op_type: Literal["enlarge_hole"] = "enlarge_hole"
    center: list[float]
    axis: list[float]
    new_diameter: float = Field(gt=0)
    depth: float = Field(gt=0)


class RemovePocketOp(BaseOp):
    op_type: Literal["remove_pocket"] = "remove_pocket"
    center: list[float]
    size: list[float]  # box extents
    rotation_axis: list[float] | None = None
    rotation_deg: float = 0.0


class SmoothRegionOp(BaseOp):
    op_type: Literal["smooth_region"] = "smooth_region"
    triangle_indices: list[int]
    iterations: int = Field(default=15, ge=1, le=100)
    expand_rings: int = Field(default=2, ge=0, le=6)


OP_SCHEMAS: dict[str, type[BaseOp]] = {
    "thicken_region": ThickenRegionOp,
    "thicken_hotspot": ThickenHotspotOp,
    "add_rib": AddRibOp,
    "add_gusset": AddGussetOp,
    "add_boss": AddBossOp,
    "add_pad": AddPadOp,
    "add_drain_hole": AddDrainHoleOp,
    "enlarge_hole": EnlargeHoleOp,
    "remove_pocket": RemovePocketOp,
    "smooth_region": SmoothRegionOp,
}


class OperationError(ValueError):
    pass


def validate_operation(doc: dict) -> BaseOp:
    op_type = doc.get("op_type")
    schema = OP_SCHEMAS.get(op_type or "")
    if schema is None:
        raise OperationError(f"Unknown operation type '{op_type}'. Supported: {sorted(OP_SCHEMAS)}")
    try:
        return schema.model_validate(doc)
    except ValidationError as exc:
        raise OperationError(f"Operation '{op_type}' failed schema validation: {exc}") from exc


# --------------------------------------------------------------------------- helpers

def _unit(v) -> np.ndarray:
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    if n < 1e-12:
        raise OperationError("zero-length direction vector")
    return v / n


def _boolean(mesh: trimesh.Trimesh, tool: trimesh.Trimesh, mode: str) -> trimesh.Trimesh:
    try:
        if mode == "union":
            out = trimesh.boolean.union([mesh, tool], engine="manifold")
        else:
            out = trimesh.boolean.difference([mesh, tool], engine="manifold")
    except Exception as exc:
        raise OperationError(f"Boolean {mode} failed: {exc}") from exc
    if not isinstance(out, trimesh.Trimesh) or len(out.faces) == 0:
        raise OperationError(f"Boolean {mode} produced empty geometry.")
    return out


def _expand_selection(mesh: trimesh.Trimesh, tri_idx: np.ndarray, rings: int) -> np.ndarray:
    sel = set(int(t) for t in tri_idx if 0 <= int(t) < len(mesh.faces))
    adj = mesh.face_adjacency
    for _ in range(rings):
        grow = set()
        for a, b in adj:
            if a in sel and b not in sel:
                grow.add(int(b))
            elif b in sel and a not in sel:
                grow.add(int(a))
        sel |= grow
    return np.array(sorted(sel), dtype=np.int64)


def _patch_prism(mesh: trimesh.Trimesh, tri_idx: np.ndarray, offset: float) -> trimesh.Trimesh:
    """Closed solid between a surface patch and its outward-offset copy."""
    faces = mesh.faces[tri_idx]
    used = np.unique(faces.reshape(-1))
    remap = -np.ones(len(mesh.vertices), dtype=np.int64)
    remap[used] = np.arange(len(used))
    v_in = mesh.vertices[used]
    f_local = remap[faces]

    # per-vertex outward normal from the patch's own faces
    tri_pts = v_in[f_local]
    fn = np.cross(tri_pts[:, 1] - tri_pts[:, 0], tri_pts[:, 2] - tri_pts[:, 0])
    vn = np.zeros_like(v_in)
    for k in range(3):
        np.add.at(vn, f_local[:, k], fn)
    norms = np.linalg.norm(vn, axis=1, keepdims=True)
    vn = np.divide(vn, np.maximum(norms, 1e-30))
    v_out = v_in + vn * offset

    n = len(v_in)
    verts = np.vstack([v_in, v_out])
    inner = f_local[:, ::-1]                # original patch, flipped inward
    outer = f_local + n                      # offset copy, original orientation
    # boundary edges (used once in the patch) -> side wall quads
    edges = f_local[:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2)
    es = np.sort(edges, axis=1)
    _u, inv, cnt = np.unique(es, axis=0, return_inverse=True, return_counts=True)
    boundary = edges[cnt[inv] == 1]
    sides = []
    for a, b in boundary:
        sides.append([a, b, b + n])
        sides.append([a, b + n, a + n])
    all_faces = np.vstack([inner, outer, np.array(sides, dtype=np.int64)]) if sides else np.vstack([inner, outer])
    solid = trimesh.Trimesh(vertices=verts, faces=all_faces, process=True)
    trimesh.repair.fix_normals(solid)
    if not solid.is_watertight:
        raise OperationError("Offset patch did not form a closed solid (patch too irregular).")
    return solid


def _points_to_faces(mesh: trimesh.Trimesh, points: np.ndarray, radius: float) -> np.ndarray:
    from scipy.spatial import cKDTree
    tree = cKDTree(points)
    d, _ = tree.query(mesh.triangles_center, k=1, distance_upper_bound=radius)
    return np.nonzero(np.isfinite(d))[0]


# --------------------------------------------------------------------------- apply

def apply_operation(mesh: trimesh.Trimesh, op: BaseOp) -> trimesh.Trimesh:
    m = mesh
    if isinstance(op, ThickenRegionOp):
        tri = _expand_selection(m, np.asarray(op.triangle_indices), op.expand_rings)
        if len(tri) < 3:
            raise OperationError("thicken_region: selection too small.")
        solid = _patch_prism(m, tri, op.offset)
        return _boolean(m, solid, "union")

    if isinstance(op, ThickenHotspotOp):
        diag = float(np.linalg.norm(m.extents))
        pts = np.asarray(op.hotspot_points, dtype=float)
        tri = _points_to_faces(m, pts, radius=0.03 * diag)
        if len(tri) < 3:
            raise OperationError("thicken_hotspot: no faces near hotspot points.")
        tri = _expand_selection(m, tri, 1)
        solid = _patch_prism(m, tri, op.offset_fraction_of_diag * diag)
        return _boolean(m, solid, "union")

    if isinstance(op, AddRibOp):
        start, end = np.asarray(op.start, float), np.asarray(op.end, float)
        length = float(np.linalg.norm(end - start))
        if length < 1e-9:
            raise OperationError("add_rib: zero length.")
        x = (end - start) / length
        h = _unit(op.height_dir)
        y = np.cross(h, x)
        if np.linalg.norm(y) < 1e-6:
            raise OperationError("add_rib: height_dir parallel to rib axis.")
        y = _unit(y)
        z = np.cross(x, y)
        box = trimesh.creation.box(extents=[length, op.thickness, op.height])
        T = np.eye(4)
        T[:3, 0], T[:3, 1], T[:3, 2] = x, y, z
        T[:3, 3] = 0.5 * (start + end) + z * (op.height / 2 - 0.05 * op.height)
        box.apply_transform(T)
        return _boolean(m, box, "union")

    if isinstance(op, AddGussetOp):
        p0 = np.asarray(op.corner_point, float)
        j = _unit(op.junction_dir)
        # in-plane directions from the junction toward each patch interior
        def leg_dir(centroid):
            d = np.asarray(centroid, float) - p0
            d = d - (d @ j) * j
            return _unit(d)
        da, db = leg_dir(op.patch_centroid_a), leg_dir(op.patch_centroid_b)
        tri_pts = [p0, p0 + da * op.leg, p0 + db * op.leg]
        # slight embed into both walls so the union fuses cleanly
        embed = 0.05 * op.leg
        tri_pts = [p - (da + db) * embed * 0.5 for p in tri_pts]
        w2 = op.width / 2.0
        v = np.array([p + j * w2 for p in tri_pts] + [p - j * w2 for p in tri_pts])
        f = np.array([
            [0, 1, 2], [5, 4, 3],
            [0, 3, 4], [0, 4, 1],
            [1, 4, 5], [1, 5, 2],
            [2, 5, 3], [2, 3, 0],
        ])
        gusset = trimesh.Trimesh(vertices=v, faces=f, process=True)
        trimesh.repair.fix_normals(gusset)
        if not gusset.is_watertight:
            raise OperationError("add_gusset: prism construction failed.")
        out = _boolean(m, gusset, "union")
        if op.mirror_plane:
            pt = np.asarray(op.mirror_plane["point"], float)
            nrm = _unit(op.mirror_plane["normal"])
            R = np.eye(4)
            R[:3, :3] = np.eye(3) - 2.0 * np.outer(nrm, nrm)
            R[:3, 3] = 2.0 * (pt @ nrm) * nrm
            g2 = gusset.copy()
            g2.apply_transform(R)
            g2.invert()
            out = _boolean(out, g2, "union")
        return out

    if isinstance(op, AddBossOp):
        if op.outer_diameter <= op.hole_diameter:
            raise OperationError("add_boss: outer diameter must exceed hole diameter.")
        axis = _unit(op.axis)
        c = np.asarray(op.center, float)
        T = trimesh.geometry.align_vectors([0, 0, 1], axis)
        boss = trimesh.creation.cylinder(radius=op.outer_diameter / 2, height=op.height, sections=48)
        boss.apply_transform(T)
        boss.apply_translation(c)
        out = _boolean(m, boss, "union")
        drill = trimesh.creation.cylinder(radius=op.hole_diameter / 2, height=op.height * 4, sections=48)
        drill.apply_transform(T)
        drill.apply_translation(c)
        return _boolean(out, drill, "difference")

    if isinstance(op, AddPadOp):
        nrm = _unit(op.normal)
        T = trimesh.geometry.align_vectors([0, 0, 1], nrm)
        pad = trimesh.creation.box(extents=[op.size[0], op.size[1], op.height])
        pad.apply_transform(T)
        pad.apply_translation(np.asarray(op.center, float) + nrm * (op.height / 2 * 0.9))
        return _boolean(m, pad, "union")

    if isinstance(op, AddDrainHoleOp):
        d = _unit(op.direction)
        c = np.asarray(op.cavity_centroid, float)
        diag = float(np.linalg.norm(m.extents))
        radius_mu = (op.diameter_mm * 1e-3 / op.unit_scale_to_m / 2.0) if op.unit_scale_to_m else \
            max(0.008 * diag, 1e-6)
        drill = trimesh.creation.cylinder(radius=radius_mu, height=2.0 * diag, sections=32)
        T = trimesh.geometry.align_vectors([0, 0, 1], d)
        drill.apply_transform(T)
        drill.apply_translation(c + d * diag)
        return _boolean(m, drill, "difference")

    if isinstance(op, EnlargeHoleOp):
        axis = _unit(op.axis)
        drill = trimesh.creation.cylinder(radius=op.new_diameter / 2, height=op.depth, sections=48)
        T = trimesh.geometry.align_vectors([0, 0, 1], axis)
        drill.apply_transform(T)
        drill.apply_translation(np.asarray(op.center, float))
        return _boolean(m, drill, "difference")

    if isinstance(op, RemovePocketOp):
        box = trimesh.creation.box(extents=op.size)
        if op.rotation_axis and op.rotation_deg:
            box.apply_transform(trimesh.transformations.rotation_matrix(
                np.radians(op.rotation_deg), _unit(op.rotation_axis)))
        box.apply_translation(np.asarray(op.center, float))
        return _boolean(m, box, "difference")

    if isinstance(op, SmoothRegionOp):
        tri = _expand_selection(m, np.asarray(op.triangle_indices), op.expand_rings)
        if len(tri) == 0:
            raise OperationError("smooth_region: empty selection.")
        out = m.copy()
        movable = np.zeros(len(out.vertices), dtype=bool)
        movable[np.unique(out.faces[tri].reshape(-1))] = True
        if op.protected_triangle_indices:
            prot = np.unique(out.faces[np.asarray(op.protected_triangle_indices)].reshape(-1))
            movable[prot] = False
        # Taubin smoothing restricted to movable vertices (lambda/mu to limit shrink)
        import networkx as nx
        g = nx.Graph()
        g.add_edges_from(out.edges_unique.tolist())
        neighbors = {int(v): [int(x) for x in g.neighbors(int(v))] for v in np.nonzero(movable)[0] if g.has_node(int(v))}
        orig = out.vertices.copy()
        verts = out.vertices.copy()
        # cap total displacement to a fraction of the local edge length so the
        # blend cannot push vertices through thin walls (self-intersection)
        edge_vecs = orig[out.edges_unique[:, 0]] - orig[out.edges_unique[:, 1]]
        cap = 0.45 * float(np.median(np.linalg.norm(edge_vecs, axis=1)))
        for it in range(op.iterations):
            lam = 0.5 if it % 2 == 0 else -0.53
            delta = np.zeros_like(verts)
            for v, nbrs in neighbors.items():
                if nbrs:
                    delta[v] = verts[nbrs].mean(axis=0) - verts[v]
            verts += lam * delta
            total = verts - orig
            norms = np.linalg.norm(total, axis=1)
            over = norms > cap
            if over.any():
                total[over] *= (cap / norms[over])[:, None]
                verts = orig + total
        out.vertices = verts
        return out

    raise OperationError(f"Unhandled operation type {op.op_type}")


# --------------------------------------------------------------------------- validation

def validate_result(original: trimesh.Trimesh, result: trimesh.Trimesh, op: BaseOp) -> list[str]:
    """Post-operation checks. Returns list of violation strings (empty = OK)."""
    problems: list[str] = []
    v = op.validation
    if v.must_be_watertight and not result.is_watertight:
        problems.append("result is not watertight")
    if original.is_watertight and result.is_watertight:
        vol0, vol1 = abs(original.volume), abs(result.volume)
        if vol1 <= 0:
            problems.append("result volume is zero")
        elif vol0 > 0 and abs(vol1 - vol0) / vol0 > v.max_volume_change_fraction:
            problems.append(
                f"volume changed {abs(vol1 - vol0) / vol0 * 100:.0f}% "
                f"(limit {v.max_volume_change_fraction * 100:.0f}%)")
    ext0, ext1 = original.extents, result.extents
    growth = float(np.max((ext1 - ext0) / np.maximum(ext0, 1e-30)))
    if growth > v.max_bbox_growth_fraction:
        problems.append(f"bounding box grew {growth * 100:.0f}% (limit {v.max_bbox_growth_fraction * 100:.0f}%)")
    if op.protected_triangle_indices:
        tri = np.asarray(op.protected_triangle_indices)
        tri = tri[(tri >= 0) & (tri < len(original.faces))]
        if len(tri):
            probe = original.triangles_center[tri]
            from trimesh.proximity import closest_point
            _pts, dist, _tid = closest_point(result, probe)
            tol = 1e-3 * float(original.scale)
            worst = float(dist.max())
            if worst > tol:
                problems.append(
                    f"protected region moved {worst:.4g} mesh units (tolerance {tol:.4g})")
    return problems
