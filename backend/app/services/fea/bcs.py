"""Mapping user-selected surface regions onto volume-mesh node sets, and
validation of load cases before any solve is attempted."""
from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

SUPPORT_TYPES = {"fixed", "pinned", "roller", "symmetry"}
LOAD_TYPES = {"force", "pressure", "bearing", "torque", "gravity"}


class LoadCaseError(ValueError):
    """User-actionable load-case problem."""


def region_sample_points(surface_vertices: np.ndarray, surface_faces: np.ndarray,
                         triangle_indices: list[int]) -> np.ndarray:
    """Sample points describing a selected region on the DISPLAY mesh:
    triangle vertices + centroids."""
    tri = np.asarray(triangle_indices, dtype=np.int64)
    tri = tri[(tri >= 0) & (tri < len(surface_faces))]
    if len(tri) == 0:
        return np.zeros((0, 3))
    f = surface_faces[tri]
    pts = surface_vertices[f.reshape(-1)]
    centroids = surface_vertices[f].mean(axis=1)
    return np.vstack([pts, centroids])


def map_region_to_nodes(region_points: np.ndarray, vol_nodes: np.ndarray,
                        vol_surface_tris: np.ndarray, tolerance: float) -> dict:
    """Select volume-mesh surface nodes lying within `tolerance` of the region.

    Returns node indices plus per-node area weights computed from the volume
    mesh's own surface triangles (only triangles with all corners selected
    contribute), so distributed loads are area-consistent.
    """
    if len(region_points) == 0:
        return {"nodes": np.zeros(0, dtype=np.int64), "weights": np.zeros(0), "area": 0.0}
    surf_node_idx = np.unique(vol_surface_tris.reshape(-1))
    tree = cKDTree(region_points)
    d, _ = tree.query(vol_nodes[surf_node_idx], k=1, distance_upper_bound=tolerance)
    selected = surf_node_idx[np.isfinite(d)]
    if len(selected) == 0:
        return {"nodes": selected, "weights": np.zeros(0), "area": 0.0}

    sel_set = np.zeros(len(vol_nodes), dtype=bool)
    sel_set[selected] = True
    tri_mask = sel_set[vol_surface_tris].all(axis=1)
    tris = vol_surface_tris[tri_mask]
    weights = np.zeros(len(vol_nodes))
    if len(tris):
        p = vol_nodes[tris]
        areas = 0.5 * np.linalg.norm(np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=1)
        for k in range(3):
            np.add.at(weights, tris[:, k], areas / 3.0)
    total_area = float(weights.sum())
    w = weights[selected]
    if w.sum() <= 0:  # isolated nodes only: fall back to uniform
        w = np.ones(len(selected))
    return {"nodes": selected, "weights": w / w.sum(), "area": total_area}


def validate_load_case(bcs: list[dict]) -> dict:
    """Static pre-checks. Returns {'ok': bool, 'errors': [...], 'warnings': [...]}."""
    errors: list[str] = []
    warnings: list[str] = []
    supports = [b for b in bcs if b["bc_type"] in SUPPORT_TYPES]
    loads = [b for b in bcs if b["bc_type"] in LOAD_TYPES]

    if not supports:
        errors.append("No support (fixed/pinned/roller) is defined. The part would undergo rigid-body "
                      "motion and the solve cannot run.")
    if not loads:
        errors.append("No load is defined. Add a force, pressure, torque or gravity load.")

    fully_fixed = [b for b in supports if b["bc_type"] in ("fixed", "pinned")]
    rollers = [b for b in supports if b["bc_type"] == "roller"]
    if not fully_fixed and rollers:
        # rollers restrain one direction each; need at least 3 independent directions
        dirs = []
        for b in rollers:
            d = b.get("params", {}).get("direction")
            if d:
                v = np.asarray(d, dtype=float)
                n = np.linalg.norm(v)
                if n > 0:
                    dirs.append(v / n)
        if len(dirs) < 3 or np.linalg.matrix_rank(np.array(dirs)) < 3:
            errors.append("Rollers alone do not restrain all rigid-body motions "
                          "(need constraints spanning 3 independent directions). Add a fixed or pinned support.")

    def _mag(p: dict) -> float | None:
        return p.get("magnitude_si", p.get("magnitude"))

    for b in loads:
        p = b.get("params", {})
        if b["bc_type"] in ("force", "bearing"):
            if not _mag(p):
                errors.append(f"Load '{b.get('description') or b['bc_type']}' has no magnitude.")
            d = p.get("direction")
            if not d or np.linalg.norm(np.asarray(d, dtype=float)) == 0:
                errors.append(f"Load '{b.get('description') or b['bc_type']}' has no direction.")
        if b["bc_type"] == "pressure" and not _mag(p):
            errors.append("Pressure load has no magnitude.")
        if b["bc_type"] == "torque":
            if not _mag(p):
                errors.append("Torque load has no magnitude.")
            if not p.get("axis_point") or not p.get("axis_direction"):
                errors.append("Torque load needs an axis (point + direction).")
        if b["bc_type"] == "gravity" and not p.get("direction"):
            warnings.append("Gravity load without direction; assuming -Z is NOT automatic — please set it.")

    if len(fully_fixed) == len(supports) and len(supports) >= 4:
        warnings.append("Many fully fixed regions: the model may be overconstrained, which can "
                        "artificially stiffen the part and hide real deflection.")
    return {"ok": not errors, "errors": errors, "warnings": warnings}
