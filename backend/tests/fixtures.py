"""Geometry regression fixtures, generated deterministically in-memory."""
from __future__ import annotations

import io
import struct

import numpy as np
import trimesh


def cube(size: float = 10.0) -> trimesh.Trimesh:
    m = trimesh.creation.box(extents=[size, size, size])
    m.apply_translation([size / 2, size / 2, size / 2])
    return m


def open_cube(size: float = 10.0) -> trimesh.Trimesh:
    m = cube(size)
    # remove the two top faces -> open box
    top = np.nonzero(m.face_normals[:, 2] > 0.9)[0]
    keep = np.setdiff1d(np.arange(len(m.faces)), top)
    return trimesh.Trimesh(vertices=m.vertices, faces=m.faces[keep], process=False)


def thin_wall_bracket() -> trimesh.Trimesh:
    from app.demo.bracket import build_demo_bracket
    return build_demo_bracket()


def plate_with_hole(w=40.0, h=40.0, t=2.0, d=8.0) -> trimesh.Trimesh:
    plate = trimesh.creation.box(extents=[w, h, t])
    drill = trimesh.creation.cylinder(radius=d / 2, height=t * 4, sections=48)
    out = trimesh.boolean.difference([plate, drill], engine="manifold")
    out.process(validate=True)
    for _ in range(2):
        out = out.subdivide()
    return trimesh.Trimesh(vertices=out.vertices, faces=out.faces, process=True)


def non_manifold_mesh() -> trimesh.Trimesh:
    """Three faces sharing one edge."""
    v = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0]], dtype=float)
    f = np.array([[0, 1, 2], [0, 1, 3], [0, 1, 4]])
    return trimesh.Trimesh(vertices=v, faces=f, process=False)


def inverted_normals_cube() -> trimesh.Trimesh:
    m = cube()
    faces = m.faces.copy()
    faces[::2] = faces[::2, ::-1]  # flip half the faces
    return trimesh.Trimesh(vertices=m.vertices, faces=faces, process=False)


def multi_body() -> trimesh.Trimesh:
    a = cube(5.0)
    b = cube(5.0)
    b.apply_translation([20, 0, 0])
    return trimesh.util.concatenate([a, b])


def corrupted_stl_bytes() -> bytes:
    """Binary STL header claiming 1000 triangles but truncated body."""
    return b"\0" * 80 + struct.pack("<I", 1000) + b"\x01" * 120


def ascii_stl_bytes(mesh: trimesh.Trimesh) -> bytes:
    out = io.BytesIO()
    mesh.export(out, file_type="stl_ascii")
    return out.getvalue()


def binary_stl_bytes(mesh: trimesh.Trimesh) -> bytes:
    out = io.BytesIO()
    mesh.export(out, file_type="stl")
    return out.getvalue()
