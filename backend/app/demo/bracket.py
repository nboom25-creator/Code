"""Parametric demo part: an L mounting bracket with known dimensions (mm),
a deliberately thin cantilever wall and a sharp internal corner.

Geometry (mm):
  base plate 60 x 40 x 5 (z in [0, 5])
  vertical wall 60 x 3 x 50 on the back edge (y in [37, 40], z in [5, 55])
  two mounting holes D5.5 through the base at (15, 14) and (45, 14)
  sharp 90-degree internal corner where wall meets base (no fillet, no gusset)
"""
from __future__ import annotations

import numpy as np
import trimesh

BASE = (60.0, 40.0, 5.0)
WALL_T = 3.0
WALL_H = 50.0
HOLE_D = 5.5
HOLE_XY = [(15.0, 14.0), (45.0, 14.0)]


def build_demo_bracket() -> trimesh.Trimesh:
    base = trimesh.creation.box(extents=BASE)
    base.apply_translation([BASE[0] / 2, BASE[1] / 2, BASE[2] / 2])

    wall = trimesh.creation.box(extents=[BASE[0], WALL_T, WALL_H])
    wall.apply_translation([BASE[0] / 2, BASE[1] - WALL_T / 2, BASE[2] + WALL_H / 2])

    bracket = trimesh.boolean.union([base, wall], engine="manifold")

    for (hx, hy) in HOLE_XY:
        drill = trimesh.creation.cylinder(radius=HOLE_D / 2, height=BASE[2] * 4, sections=48)
        drill.apply_translation([hx, hy, BASE[2] / 2])
        bracket = trimesh.boolean.difference([bracket, drill], engine="manifold")

    bracket.process(validate=True)
    trimesh.repair.fix_normals(bracket)

    # refine so faces are pickable and thickness sampling is representative;
    # uniform subdivision keeps the mesh watertight (no T-vertices)
    for _ in range(3):
        bracket = bracket.subdivide()
    bracket = trimesh.Trimesh(vertices=bracket.vertices, faces=bracket.faces, process=True)
    trimesh.repair.fix_normals(bracket)
    assert bracket.is_watertight
    return bracket


def demo_regions(mesh: trimesh.Trimesh) -> dict[str, list[int]]:
    """Deterministic region selections on the demo bracket for seeding:
    - 'fixed_holes': bottom faces of the base within 2 diameters of each hole center
    - 'load_top': front face of the wall, top 10 mm band
    """
    centers = mesh.triangles_center
    normals = mesh.face_normals

    bottom = (np.abs(centers[:, 2]) < 1e-3) & (normals[:, 2] < -0.9)
    near_hole = np.zeros(len(centers), dtype=bool)
    for (hx, hy) in HOLE_XY:
        d = np.linalg.norm(centers[:, :2] - np.array([hx, hy]), axis=1)
        near_hole |= d < 2.0 * HOLE_D
    fixed_holes = np.nonzero(bottom & near_hole)[0]

    front_wall = (np.abs(centers[:, 1] - (BASE[1] - WALL_T)) < 1e-2) & (normals[:, 1] < -0.9)
    top_band = centers[:, 2] > (BASE[2] + WALL_H - 10.0)
    load_top = np.nonzero(front_wall & top_band)[0]

    return {"fixed_holes": fixed_holes.tolist(), "load_top": load_top.tolist()}
