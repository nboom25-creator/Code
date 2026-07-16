"""Strict mesh-file validation and loading.

Uploads are validated by content, not just extension:
- binary STL: header + declared triangle count must match file size
- ASCII STL: must begin with 'solid' and parse into >= 1 facet
- OBJ / 3MF: parsed by trimesh with process=False (no silent mutation)

Nothing here executes uploaded content.
"""
from __future__ import annotations

import io
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh

from ..config import get_settings


class MeshFileError(ValueError):
    """Raised when an uploaded file fails validation. Message is user-safe."""


@dataclass
class LoadedMesh:
    mesh: trimesh.Trimesh
    file_format: str  # stl_binary | stl_ascii | obj | 3mf


def detect_stl_format(data: bytes) -> str | None:
    """Return 'stl_binary', 'stl_ascii' or None, by content inspection."""
    if len(data) < 15:
        return None
    head = data[:512].lstrip()
    # ASCII STL starts with "solid"; some binary files also start with "solid",
    # so verify the binary size equation as the authority.
    if len(data) >= 84:
        (tri_count,) = struct.unpack("<I", data[80:84])
        if 84 + tri_count * 50 == len(data) and tri_count > 0:
            return "stl_binary"
    if head[:5].lower() == b"solid" and b"facet" in data[:65536].lower():
        return "stl_ascii"
    return None


def validate_and_load(data: bytes, filename: str) -> LoadedMesh:
    settings = get_settings()
    if len(data) == 0:
        raise MeshFileError("The uploaded file is empty.")
    if len(data) > settings.max_upload_bytes:
        raise MeshFileError(
            f"File is {len(data) / 1e6:.1f} MB; the limit is {settings.max_upload_bytes / 1e6:.0f} MB."
        )

    ext = Path(filename).suffix.lower()
    if ext not in settings.allowed_upload_extensions:
        raise MeshFileError(f"Unsupported file type '{ext}'. Allowed: {', '.join(settings.allowed_upload_extensions)}.")

    if ext == ".stl":
        fmt = detect_stl_format(data)
        if fmt is None:
            raise MeshFileError(
                "This file does not parse as a valid STL: the binary triangle count does not "
                "match the file size and it is not readable as ASCII STL."
            )
        try:
            mesh = trimesh.load(io.BytesIO(data), file_type="stl", process=False)
        except Exception as exc:  # trimesh raises varied exceptions on corrupt files
            raise MeshFileError(f"STL parsing failed: {exc}") from exc
    elif ext == ".obj":
        fmt = "obj"
        try:
            mesh = trimesh.load(io.BytesIO(data), file_type="obj", process=False)
        except Exception as exc:
            raise MeshFileError(f"OBJ parsing failed: {exc}") from exc
    elif ext == ".3mf":
        fmt = "3mf"
        try:
            mesh = trimesh.load(io.BytesIO(data), file_type="3mf", process=False)
        except Exception as exc:
            raise MeshFileError(f"3MF parsing failed: {exc}") from exc
    else:  # pragma: no cover - guarded above
        raise MeshFileError("Unsupported file type.")

    if isinstance(mesh, trimesh.Scene):
        geoms = [g for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not geoms:
            raise MeshFileError("The file contains no triangle geometry.")
        mesh = trimesh.util.concatenate(geoms)

    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise MeshFileError("The file contains no triangles.")
    if len(mesh.faces) > settings.max_triangles:
        raise MeshFileError(
            f"Mesh has {len(mesh.faces):,} triangles; the limit is {settings.max_triangles:,}. "
            "Decimate the model and re-upload."
        )
    if not np.isfinite(mesh.vertices).all():
        raise MeshFileError("Mesh contains non-finite (NaN/Inf) vertex coordinates.")

    # merge coincident vertices to recover connectivity (STL is a triangle soup);
    # the uploaded bytes themselves are stored verbatim by the caller
    mesh.merge_vertices()
    return LoadedMesh(mesh=mesh, file_format=fmt)


def save_stl(mesh: trimesh.Trimesh, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(path, file_type="stl")  # binary STL


def load_mesh_file(path: Path | str, merge: bool = True) -> trimesh.Trimesh:
    """Load a stored mesh version for analysis.

    STL stores each triangle with its own three vertices, so `merge=True`
    (default) merges coincident vertices to recover surface connectivity —
    without this every edge looks like a boundary edge and adjacency-based
    analysis is meaningless. The file on disk is never modified.
    """
    mesh = trimesh.load(str(path), process=False)
    if isinstance(mesh, trimesh.Scene):
        mesh = trimesh.util.concatenate(
            [g for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)]
        )
    if merge and isinstance(mesh, trimesh.Trimesh):
        mesh.merge_vertices()
    return mesh
