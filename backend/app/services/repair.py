"""Non-destructive mesh repair.

The original upload is never modified. `preview` runs the requested operations
on an in-memory copy and reports what changed; `apply` does the same and the
caller persists the result as a NEW MeshVersion with full provenance.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import trimesh

from .geometry import compute_health

SUPPORTED_OPS = [
    "remove_duplicate_faces",
    "remove_degenerate_faces",
    "merge_vertices",
    "fix_winding",
    "fix_normals",
    "fill_holes",
    "remove_small_components",
    "watertight_reconstruction",
]


@dataclass
class RepairOutcome:
    mesh: trimesh.Trimesh
    applied: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)


def _remove_small_components(mesh: trimesh.Trimesh, min_faces_fraction: float = 0.01) -> tuple[trimesh.Trimesh, str]:
    comps = mesh.split(only_watertight=False)
    if len(comps) <= 1:
        return mesh, "single component, nothing removed"
    total = len(mesh.faces)
    keep = [c for c in comps if len(c.faces) >= max(4, min_faces_fraction * total)]
    if not keep:
        keep = [max(comps, key=lambda c: len(c.faces))]
    removed = len(comps) - len(keep)
    merged = trimesh.util.concatenate(keep) if len(keep) > 1 else keep[0]
    return merged, f"removed {removed} tiny components ({total - len(merged.faces)} faces)"


def _watertight_reconstruction(mesh: trimesh.Trimesh) -> tuple[trimesh.Trimesh, str]:
    """Attempt a manifold reconstruction via voxel-free manifold3d union of the
    largest solid shell; falls back to convex-hull-free 'as is' on failure."""
    try:
        import manifold3d
        mf = manifold3d.Manifold(
            manifold3d.Mesh(
                vert_properties=np.asarray(mesh.vertices, dtype=np.float32),
                tri_verts=np.asarray(mesh.faces, dtype=np.uint32),
            )
        )
        if mf.status() == manifold3d.Error.NoError and not mf.is_empty():
            m2 = mf.to_mesh()
            rebuilt = trimesh.Trimesh(
                vertices=np.asarray(m2.vert_properties, dtype=float)[:, :3],
                faces=np.asarray(m2.tri_verts, dtype=np.int64),
                process=True,
            )
            if rebuilt.is_watertight:
                return rebuilt, "manifold3d reconstruction succeeded"
        return mesh, f"manifold3d could not build a solid (status {mf.status()}); mesh unchanged"
    except Exception as exc:
        return mesh, f"watertight reconstruction failed: {exc}; mesh unchanged"


def run_repair(mesh: trimesh.Trimesh, ops: list[str]) -> RepairOutcome:
    unknown = [o for o in ops if o not in SUPPORTED_OPS]
    if unknown:
        raise ValueError(f"unsupported repair operations: {unknown}")
    m = mesh.copy()
    out = RepairOutcome(mesh=m)

    for op in ops:
        before_faces, before_verts = len(m.faces), len(m.vertices)
        if op == "remove_duplicate_faces":
            m.update_faces(m.unique_faces())
            out.log.append(f"remove_duplicate_faces: {before_faces - len(m.faces)} faces removed")
        elif op == "remove_degenerate_faces":
            m.update_faces(m.nondegenerate_faces())
            out.log.append(f"remove_degenerate_faces: {before_faces - len(m.faces)} faces removed")
        elif op == "merge_vertices":
            m.merge_vertices()
            out.log.append(f"merge_vertices: {before_verts - len(m.vertices)} vertices merged")
        elif op == "fix_winding":
            trimesh.repair.fix_winding(m)
            out.log.append("fix_winding: winding made consistent where possible")
        elif op == "fix_normals":
            trimesh.repair.fix_normals(m)
            out.log.append("fix_normals: normals recalculated/oriented outward where possible")
        elif op == "fill_holes":
            ok = m.fill_holes()
            out.log.append(f"fill_holes: {'now watertight' if ok else 'holes remain (only small planar holes fillable)'}")
        elif op == "remove_small_components":
            m, msg = _remove_small_components(m)
            out.mesh = m
            out.log.append(f"remove_small_components: {msg}")
        elif op == "watertight_reconstruction":
            m, msg = _watertight_reconstruction(m)
            out.mesh = m
            out.log.append(f"watertight_reconstruction: {msg}")
        out.applied.append(op)
        out.mesh = m
    return out


def repair_preview(mesh: trimesh.Trimesh, ops: list[str]) -> dict:
    before = compute_health(mesh)
    outcome = run_repair(mesh, ops)
    after = compute_health(outcome.mesh)
    return {
        "operations": outcome.applied,
        "log": outcome.log,
        "before": {k: before[k] for k in
                   ("watertight", "boundary_edge_count", "non_manifold_edge_count",
                    "duplicate_face_count", "degenerate_face_count", "connected_components")},
        "after": {k: after[k] for k in
                  ("watertight", "boundary_edge_count", "non_manifold_edge_count",
                   "duplicate_face_count", "degenerate_face_count", "connected_components")},
        "triangle_count_before": int(len(mesh.faces)),
        "triangle_count_after": int(len(outcome.mesh.faces)),
        "note": "Preview only. Committing creates a new mesh version; the original file is preserved.",
    }
