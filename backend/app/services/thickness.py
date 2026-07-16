"""Wall-thickness estimation by inward ray casting.

For each sampled face we cast a ray from just inside the surface along the
inward normal and take the distance to the first hit as the local thickness.
This is an estimate: it is exact for parallel walls and approximate elsewhere,
which is stated wherever the numbers are shown.
"""
from __future__ import annotations

import numpy as np
import trimesh

from ..config import get_settings


def estimate_thickness(mesh: trimesh.Trimesh, sample_cap: int | None = None) -> dict:
    n_faces = len(mesh.faces)
    if n_faces == 0:
        return {"ok": False, "note": "empty mesh"}
    cap = sample_cap or get_settings().thickness_sample_faces
    rng = np.random.default_rng(seed=42)  # deterministic sampling
    if n_faces > cap:
        idx = rng.choice(n_faces, size=cap, replace=False)
    else:
        idx = np.arange(n_faces)

    origins = mesh.triangles_center[idx]
    normals = mesh.face_normals[idx]
    eps = 1e-4 * float(mesh.scale)
    ray_origins = origins - normals * eps
    ray_dirs = -normals

    intersector = trimesh.ray.ray_triangle.RayMeshIntersector(mesh)
    locations, index_ray, _index_tri = intersector.intersects_location(
        ray_origins, ray_dirs, multiple_hits=False
    )

    thickness = np.full(len(idx), np.nan)
    if len(index_ray):
        d = np.linalg.norm(locations - ray_origins[index_ray], axis=1)
        thickness[index_ray] = d + eps

    valid = np.isfinite(thickness)
    # Discard hits longer than the bbox diagonal (numerical misses)
    diag = float(np.linalg.norm(mesh.extents))
    valid &= thickness <= diag

    per_face = np.full(n_faces, np.nan)
    per_face[idx] = np.where(valid, thickness, np.nan)

    # per-vertex field for the heat map (average of adjacent sampled faces)
    v_sum = np.zeros(len(mesh.vertices))
    v_cnt = np.zeros(len(mesh.vertices))
    good_faces = idx[valid]
    good_thk = thickness[valid]
    for k in range(3):
        np.add.at(v_sum, mesh.faces[good_faces, k], good_thk)
        np.add.at(v_cnt, mesh.faces[good_faces, k], 1.0)
    with np.errstate(invalid="ignore"):
        per_vertex = np.where(v_cnt > 0, v_sum / np.maximum(v_cnt, 1), np.nan)

    if valid.sum() == 0:
        return {"ok": False, "note": "no valid thickness rays (open or degenerate mesh?)"}

    t = thickness[valid]
    # area-weighted percentiles so a few huge triangles don't drown thin walls
    w = mesh.area_faces[idx][valid]
    order = np.argsort(t)
    t_sorted, w_sorted = t[order], w[order]
    cum = np.cumsum(w_sorted) / w_sorted.sum()

    def wpct(p: float) -> float:
        return float(t_sorted[np.searchsorted(cum, p / 100.0, side="left").clip(0, len(t_sorted) - 1)])

    return {
        "ok": True,
        "sampled_faces": int(len(idx)),
        "valid_rays": int(valid.sum()),
        "min_wall_estimate": wpct(1),   # robust, area-weighted minimum
        "absolute_min": float(t.min()),
        "max_wall_estimate": wpct(99),
        "median_wall": wpct(50),
        "method": "inward ray casting from face centroids (deterministic sample, seed=42)",
        "note": "Estimate; exact for parallel walls, approximate for curved/tapered geometry.",
        "per_vertex": per_vertex,  # np array, stripped before JSON storage
        "per_face": per_face,
    }
