"""Additive-manufacturing geometry checks: overhangs, unsupported islands,
trapped volumes. Results depend on the chosen build direction and are labeled
with it."""
from __future__ import annotations

import numpy as np
import trimesh


def analyze_overhangs(mesh: trimesh.Trimesh, build_dir: list[float] | None = None,
                      threshold_deg: float = 45.0) -> dict:
    if len(mesh.faces) == 0:
        return {"ok": False}
    d = np.asarray(build_dir if build_dir else [0, 0, 1], dtype=float)
    n = np.linalg.norm(d)
    if n == 0:
        d = np.array([0.0, 0.0, 1.0])
    else:
        d = d / n

    cos_down = mesh.face_normals @ (-d)  # 1 when facing straight down
    # overhang: downward-facing beyond threshold from vertical walls
    limit = np.cos(np.radians(90.0 - threshold_deg))
    overhang_mask = cos_down > limit

    areas = mesh.area_faces
    total_area = float(areas.sum())
    overhang_area = float(areas[overhang_mask].sum())

    # bottom faces near the build plate are supported by the bed, exclude them
    heights = mesh.triangles_center @ d
    zmin = float((mesh.vertices @ d).min())
    near_plate = heights < zmin + 0.01 * float(mesh.scale)
    unsupported_mask = overhang_mask & ~near_plate

    # group unsupported faces into islands via face adjacency
    islands = []
    if unsupported_mask.any():
        import networkx as nx
        g = nx.Graph()
        sel = np.nonzero(unsupported_mask)[0]
        selset = set(sel.tolist())
        g.add_nodes_from(sel.tolist())
        for a, b in mesh.face_adjacency:
            if a in selset and b in selset:
                g.add_edge(int(a), int(b))
        for comp in nx.connected_components(g):
            comp = list(comp)
            islands.append({
                "face_count": len(comp),
                "area": float(areas[comp].sum()),
                "centroid": mesh.triangles_center[comp].mean(axis=0).tolist(),
            })
        islands.sort(key=lambda x: -x["area"])

    per_face_flag = overhang_mask.astype(float)
    per_vertex = np.zeros(len(mesh.vertices))
    cnt = np.zeros(len(mesh.vertices))
    for k in range(3):
        np.add.at(per_vertex, mesh.faces[:, k], per_face_flag)
        np.add.at(cnt, mesh.faces[:, k], 1.0)
    per_vertex = per_vertex / np.maximum(cnt, 1)

    # trapped volumes: fully enclosed inner shells (relevant to SLA resin / SLS powder)
    trapped = []
    try:
        bodies = mesh.split(only_watertight=False)
        if 1 < len(bodies) <= 25:
            for i, b in enumerate(bodies):
                for j, other in enumerate(bodies):
                    if i == j or not other.is_watertight:
                        continue
                    if other.contains([b.centroid])[0]:
                        trapped.append({
                            "component_index": i,
                            "approx_volume": float(abs(b.volume)) if b.is_watertight else None,
                            "centroid": b.centroid.tolist(),
                        })
                        break
    except Exception:
        pass

    return {
        "ok": True,
        "build_direction": d.tolist(),
        "threshold_deg": threshold_deg,
        "overhang_area": overhang_area,
        "overhang_fraction": overhang_area / total_area if total_area else 0.0,
        "overhang_face_count": int(overhang_mask.sum()),
        "unsupported_islands": islands[:25],
        "trapped_volumes": trapped,
        "per_vertex": per_vertex,
        "note": "Overhang classification uses face normals versus the selected build direction; "
                "slicer support generation may differ.",
    }
