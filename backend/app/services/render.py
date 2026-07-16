"""Minimal deterministic software renderer (numpy z-buffer, flat shading).

Used for report images so PDF generation works headlessly without OpenGL.
"""
from __future__ import annotations

import numpy as np
import trimesh
from PIL import Image


def render_mesh_png(mesh: trimesh.Trimesh, path, size: int = 640,
                    view: str = "iso", face_colors: np.ndarray | None = None) -> None:
    v = mesh.vertices.copy()
    center = (mesh.bounds[0] + mesh.bounds[1]) / 2.0
    v -= center

    if view == "iso":
        rx = trimesh.transformations.rotation_matrix(np.radians(-60), [1, 0, 0])[:3, :3]
        rz = trimesh.transformations.rotation_matrix(np.radians(-135), [0, 0, 1])[:3, :3]
        R = rx @ rz
    elif view == "front":
        R = trimesh.transformations.rotation_matrix(np.radians(-90), [1, 0, 0])[:3, :3]
    elif view == "top":
        R = np.eye(3)
    else:
        R = np.eye(3)
    v = v @ R.T

    span = float(np.abs(v[:, :2]).max()) * 2.2 or 1.0
    scale = size / span
    px = (v[:, 0] * scale + size / 2)
    py = (size / 2 - v[:, 1] * scale)
    pz = v[:, 2]

    tris = mesh.faces
    p0, p1, p2 = (np.stack([px[tris[:, k]], py[tris[:, k]], pz[tris[:, k]]], axis=1) for k in range(3))
    # backface-friendly flat shading with a fixed light
    n = np.cross((mesh.vertices[tris[:, 1]] - mesh.vertices[tris[:, 0]]) @ R.T,
                 (mesh.vertices[tris[:, 2]] - mesh.vertices[tris[:, 0]]) @ R.T)
    nn = np.linalg.norm(n, axis=1, keepdims=True)
    n = n / np.maximum(nn, 1e-30)
    light = np.array([0.3, 0.4, 0.87])
    shade = np.clip(np.abs(n @ light), 0.15, 1.0)

    img = np.full((size, size, 3), 248, dtype=np.uint8)
    zbuf = np.full((size, size), -np.inf)

    order = np.argsort(p0[:, 2] + p1[:, 2] + p2[:, 2])
    base_rgb = np.array([90, 140, 190], dtype=float)
    for ti in order:
        a, b, c = p0[ti], p1[ti], p2[ti]
        minx = max(int(min(a[0], b[0], c[0])), 0)
        maxx = min(int(max(a[0], b[0], c[0])) + 1, size)
        miny = max(int(min(a[1], b[1], c[1])), 0)
        maxy = min(int(max(a[1], b[1], c[1])) + 1, size)
        if minx >= maxx or miny >= maxy:
            continue
        xs, ys = np.meshgrid(np.arange(minx, maxx), np.arange(miny, maxy))
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        w1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        w2 = 1.0 - w0 - w1
        inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
        if not inside.any():
            continue
        z = w0 * a[2] + w1 * b[2] + w2 * c[2]
        yy, xx = ys[inside], xs[inside]
        zi = z[inside]
        better = zi > zbuf[yy, xx]
        yy, xx, zi = yy[better], xx[better], zi[better]
        zbuf[yy, xx] = zi
        if face_colors is not None:
            col = np.clip(face_colors[ti].astype(float) * shade[ti], 0, 255).astype(np.uint8)
        else:
            col = np.clip(base_rgb * shade[ti], 0, 255).astype(np.uint8)
        img[yy, xx] = col

    Image.fromarray(img).save(path)
