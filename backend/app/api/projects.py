"""Projects, uploads, mesh versions, repair, regions, snapshots, archive."""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    AuditEvent,
    GeometryAnalysis,
    MeshVersion,
    Project,
    ProtectedRegion,
    Report,
    SelectedRegion,
    Snapshot,
    UploadedAsset,
)
from ..services import storage
from ..services.repair import SUPPORTED_OPS, repair_preview, run_repair
from ..services.stl_io import MeshFileError, load_mesh_file, save_stl, validate_and_load
from ..services.units import LENGTH_TO_M, suggest_unit_from_bbox

router = APIRouter()


def _project(db: Session, project_id: str) -> Project:
    p = db.get(Project, project_id)
    if p is None or p.deleted:
        raise HTTPException(404, "Project not found")
    return p


def _mesh(db: Session, mesh_id: str) -> MeshVersion:
    m = db.get(MeshVersion, mesh_id)
    if m is None:
        raise HTTPException(404, "Mesh version not found")
    return m


def project_out(p: Project) -> dict:
    return {"id": p.id, "name": p.name, "description": p.description, "unit": p.unit,
            "unit_confirmed": p.unit_confirmed, "is_demo": p.is_demo,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None}


def mesh_out(m: MeshVersion) -> dict:
    return {"id": m.id, "project_id": m.project_id, "parent_mesh_id": m.parent_mesh_id,
            "kind": m.kind, "label": m.label, "triangle_count": m.triangle_count,
            "vertex_count": m.vertex_count, "watertight": m.watertight,
            "sha256": m.output_checksum, "status": m.status,
            "params": m.params_json,
            "created_at": m.created_at.isoformat() if m.created_at else None}


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""


@router.post("/projects")
def create_project(body: ProjectIn, db: Session = Depends(get_db)):
    p = Project(name=body.name, description=body.description)
    db.add(p)
    db.add(AuditEvent(action="project.create", payload_json={"name": body.name}))
    db.commit()
    return project_out(p)


@router.get("/projects")
def list_projects(db: Session = Depends(get_db)):
    rows = db.query(Project).filter_by(deleted=False).order_by(Project.updated_at.desc()).all()
    return [project_out(p) for p in rows]


@router.get("/projects/{project_id}")
def get_project(project_id: str, db: Session = Depends(get_db)):
    return project_out(_project(db, project_id))


class ProjectPatch(BaseModel):
    name: str | None = None
    description: str | None = None


@router.patch("/projects/{project_id}")
def patch_project(project_id: str, body: ProjectPatch, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    if body.name is not None:
        p.name = body.name
    if body.description is not None:
        p.description = body.description
    db.commit()
    return project_out(p)


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    p.deleted = True
    db.add(AuditEvent(project_id=p.id, action="project.delete", payload_json={}))
    db.commit()
    storage.delete_project_data(p.id)
    return {"deleted": True}


class UnitIn(BaseModel):
    unit: str


@router.post("/projects/{project_id}/unit")
def confirm_unit(project_id: str, body: UnitIn, db: Session = Depends(get_db)):
    if body.unit not in LENGTH_TO_M:
        raise HTTPException(422, f"unit must be one of {sorted(LENGTH_TO_M)}")
    p = _project(db, project_id)
    p.unit = body.unit
    p.unit_confirmed = True
    db.add(AuditEvent(project_id=p.id, action="unit.confirm", payload_json={"unit": body.unit}))
    db.commit()
    return project_out(p)


@router.get("/projects/{project_id}/unit/suggestion")
def unit_suggestion(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    mv = db.query(MeshVersion).filter_by(project_id=p.id).order_by(MeshVersion.created_at).first()
    if mv is None:
        raise HTTPException(404, "No mesh uploaded yet")
    mesh = load_mesh_file(mv.path)
    return suggest_unit_from_bbox(mesh.extents.tolist())


@router.post("/projects/{project_id}/upload")
async def upload_mesh(project_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    p = _project(db, project_id)
    data = await file.read()
    try:
        loaded = validate_and_load(data, file.filename or "upload.stl")
    except MeshFileError as exc:
        raise HTTPException(422, str(exc)) from exc

    safe = storage.sanitize_filename(file.filename or "upload.stl")
    asset_path = storage.subdir(p.id, "uploads") / safe
    # keep original bytes exactly as uploaded (never modified)
    counter = 1
    while asset_path.exists():
        asset_path = asset_path.with_name(f"{asset_path.stem}_{counter}{asset_path.suffix}")
        counter += 1
    asset_path.write_bytes(data)
    sha = storage.sha256_bytes(data)
    asset = UploadedAsset(project_id=p.id, original_filename=file.filename or safe,
                          stored_filename=asset_path.name, path=str(asset_path),
                          size_bytes=len(data), file_format=loaded.file_format, sha256=sha,
                          status="succeeded", output_checksum=sha)
    db.add(asset)
    db.flush()

    # normalized working copy as binary STL (the original stays untouched)
    mesh_path = storage.subdir(p.id, "meshes") / f"original_{asset.id}.stl"
    save_stl(loaded.mesh, mesh_path)
    mv = MeshVersion(project_id=p.id, asset_id=asset.id, kind="original",
                     label=f"Original ({asset.original_filename})", path=str(mesh_path),
                     triangle_count=len(loaded.mesh.faces), vertex_count=len(loaded.mesh.vertices),
                     watertight=bool(loaded.mesh.is_watertight),
                     input_checksum=sha, output_checksum=storage.sha256_file(mesh_path),
                     status="succeeded",
                     params_json={"source_format": loaded.file_format})
    db.add(mv)
    db.add(AuditEvent(project_id=p.id, action="mesh.upload",
                      payload_json={"filename": asset.original_filename, "sha256": sha,
                                    "triangles": mv.triangle_count}))
    db.commit()
    return {"asset": {"id": asset.id, "filename": asset.original_filename,
                      "size_bytes": asset.size_bytes, "format": asset.file_format,
                      "sha256": asset.sha256},
            "mesh_version": mesh_out(mv),
            "unit_suggestion": suggest_unit_from_bbox(loaded.mesh.extents.tolist())}


@router.get("/projects/{project_id}/meshes")
def list_meshes(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    rows = db.query(MeshVersion).filter_by(project_id=p.id).order_by(MeshVersion.created_at).all()
    return [mesh_out(m) for m in rows]


@router.get("/meshes/{mesh_id}")
def get_mesh(mesh_id: str, db: Session = Depends(get_db)):
    return mesh_out(_mesh(db, mesh_id))


@router.get("/meshes/{mesh_id}/file")
def mesh_file(mesh_id: str, db: Session = Depends(get_db)):
    m = _mesh(db, mesh_id)
    if not Path(m.path).exists():
        raise HTTPException(410, "Mesh file missing on disk")
    return FileResponse(m.path, media_type="model/stl",
                        filename=f"{m.kind}_{m.id[:8]}.stl")


@router.get("/meshes/{mesh_id}/scalars")
def mesh_scalars(mesh_id: str, field: str, db: Session = Depends(get_db)):
    m = _mesh(db, mesh_id)
    analysis = db.query(GeometryAnalysis).filter_by(mesh_version_id=m.id, status="succeeded") \
        .order_by(GeometryAnalysis.created_at.desc()).first()
    if analysis is None or not analysis.fields_path or not Path(analysis.fields_path).exists():
        raise HTTPException(404, "No geometry analysis fields available; run geometry analysis first")
    npz = np.load(analysis.fields_path)
    if field not in npz:
        raise HTTPException(422, f"Unknown field '{field}'. Available: {sorted(npz.files)}")
    arr = np.asarray(npz[field], dtype=float)
    return {"field": field, "values": [round(float(x), 5) for x in arr],
            "note": "per-vertex scalars; thickness of -1 means no valid ray sample"}


class RepairIn(BaseModel):
    operations: list[str]


@router.post("/meshes/{mesh_id}/repair/preview")
def repair_preview_ep(mesh_id: str, body: RepairIn, db: Session = Depends(get_db)):
    m = _mesh(db, mesh_id)
    bad = [o for o in body.operations if o not in SUPPORTED_OPS]
    if bad:
        raise HTTPException(422, f"Unsupported operations {bad}; supported: {SUPPORTED_OPS}")
    mesh = load_mesh_file(m.path)
    return repair_preview(mesh, body.operations)


@router.post("/meshes/{mesh_id}/repair/commit")
def repair_commit(mesh_id: str, body: RepairIn, db: Session = Depends(get_db)):
    m = _mesh(db, mesh_id)
    bad = [o for o in body.operations if o not in SUPPORTED_OPS]
    if bad:
        raise HTTPException(422, f"Unsupported operations {bad}; supported: {SUPPORTED_OPS}")
    mesh = load_mesh_file(m.path)
    outcome = run_repair(mesh, body.operations)
    out_path = storage.subdir(m.project_id, "meshes") / f"repaired_{m.id[:8]}_{len(body.operations)}ops.stl"
    counter = 1
    while out_path.exists():
        out_path = out_path.with_name(f"{out_path.stem}_{counter}.stl")
        counter += 1
    save_stl(outcome.mesh, out_path)
    mv = MeshVersion(project_id=m.project_id, parent_mesh_id=m.id, kind="repaired",
                     label=f"Repaired ({', '.join(body.operations[:3])}{'…' if len(body.operations) > 3 else ''})",
                     path=str(out_path),
                     triangle_count=len(outcome.mesh.faces), vertex_count=len(outcome.mesh.vertices),
                     watertight=bool(outcome.mesh.is_watertight),
                     params_json={"operations": body.operations, "log": outcome.log},
                     input_checksum=m.output_checksum, output_checksum=storage.sha256_file(out_path),
                     status="succeeded")
    db.add(mv)
    db.add(AuditEvent(project_id=m.project_id, action="mesh.repair",
                      payload_json={"parent": m.id, "operations": body.operations}))
    db.commit()
    return {"mesh_version": mesh_out(mv), "log": outcome.log}


class RegionIn(BaseModel):
    mesh_version_id: str
    name: str = "Region"
    kind: str = "faces"
    triangle_indices: list[int] = Field(default_factory=list, max_length=200_000)
    meta: dict = Field(default_factory=dict)
    color: str = "#38bdf8"


@router.post("/projects/{project_id}/regions")
def create_region(project_id: str, body: RegionIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    mv = _mesh(db, body.mesh_version_id)
    if mv.project_id != p.id:
        raise HTTPException(422, "Mesh version belongs to a different project")
    bad = [i for i in body.triangle_indices[:10] if i < 0 or i >= mv.triangle_count]
    if bad:
        raise HTTPException(422, "triangle indices out of range for this mesh version")
    r = SelectedRegion(project_id=p.id, mesh_version_id=mv.id, name=body.name, kind=body.kind,
                       triangle_indices=body.triangle_indices, meta_json=body.meta, color=body.color)
    db.add(r)
    db.commit()
    return region_out(r, db)


def region_out(r: SelectedRegion, db: Session) -> dict:
    protected = db.query(ProtectedRegion).filter_by(region_id=r.id).first()
    return {"id": r.id, "project_id": r.project_id, "mesh_version_id": r.mesh_version_id,
            "name": r.name, "kind": r.kind, "triangle_indices": r.triangle_indices,
            "meta": r.meta_json, "color": r.color,
            "protected": bool(protected), "protect_reason": protected.reason if protected else None}


@router.get("/projects/{project_id}/regions")
def list_regions(project_id: str, mesh_version_id: str | None = None, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    q = db.query(SelectedRegion).filter_by(project_id=p.id)
    if mesh_version_id:
        q = q.filter_by(mesh_version_id=mesh_version_id)
    return [region_out(r, db) for r in q.order_by(SelectedRegion.created_at).all()]


@router.delete("/regions/{region_id}")
def delete_region(region_id: str, db: Session = Depends(get_db)):
    r = db.get(SelectedRegion, region_id)
    if r is None:
        raise HTTPException(404, "Region not found")
    db.query(ProtectedRegion).filter_by(region_id=r.id).delete()
    db.delete(r)
    db.commit()
    return {"deleted": True}


class ProtectIn(BaseModel):
    reason: str = ""


@router.post("/regions/{region_id}/protect")
def protect_region(region_id: str, body: ProtectIn, db: Session = Depends(get_db)):
    r = db.get(SelectedRegion, region_id)
    if r is None:
        raise HTTPException(404, "Region not found")
    existing = db.query(ProtectedRegion).filter_by(region_id=r.id).first()
    if existing:
        existing.reason = body.reason
    else:
        db.add(ProtectedRegion(project_id=r.project_id, region_id=r.id, reason=body.reason))
    db.commit()
    return region_out(r, db)


@router.delete("/regions/{region_id}/protect")
def unprotect_region(region_id: str, db: Session = Depends(get_db)):
    r = db.get(SelectedRegion, region_id)
    if r is None:
        raise HTTPException(404, "Region not found")
    db.query(ProtectedRegion).filter_by(region_id=r.id).delete()
    db.commit()
    return region_out(r, db)


@router.post("/projects/{project_id}/snapshots")
async def upload_snapshot(project_id: str, file: UploadFile = File(...), label: str = Form(""),
                          db: Session = Depends(get_db)):
    p = _project(db, project_id)
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(422, "Snapshot too large (10 MB limit)")
    if not data.startswith(b"\x89PNG"):
        raise HTTPException(422, "Snapshot must be a PNG image")
    path = storage.subdir(p.id, "snapshots") / f"snap_{storage.sha256_bytes(data)[:12]}.png"
    path.write_bytes(data)
    s = Snapshot(project_id=p.id, label=label[:200], path=str(path))
    db.add(s)
    db.commit()
    return {"id": s.id, "label": s.label}


@router.get("/projects/{project_id}/archive")
def project_archive(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    meshes = db.query(MeshVersion).filter_by(project_id=p.id).all()
    reports = db.query(Report).filter_by(project_id=p.id, status="succeeded").all()

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        manifest = {"project": project_out(p), "meshes": [mesh_out(m) for m in meshes]}
        z.writestr("manifest.json", json.dumps(manifest, indent=2))
        for m in meshes:
            if Path(m.path).exists():
                z.write(m.path, f"meshes/{m.kind}_{m.id[:8]}.stl")
        for r in reports:
            if r.path and Path(r.path).exists():
                z.write(r.path, f"reports/report_{r.id[:8]}.pdf")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip", headers={
        "Content-Disposition": f'attachment; filename="partforge_{p.name[:32] or p.id[:8]}.zip"'})
