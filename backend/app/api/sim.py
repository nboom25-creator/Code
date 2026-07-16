"""Load cases, boundary conditions, analysis jobs, job progress (SSE), results."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SessionLocal, get_db
from ..models import (
    AuditEvent,
    BoundaryCondition,
    GeometryAnalysis,
    LoadCase,
    Project,
    SimulationJob,
    SimulationResult,
)
from ..services.fea.bcs import validate_load_case
from ..services.units import convert_force, convert_pressure, convert_torque
from ..workers.queue import job_queue
from ..workers.tasks import TASKS, get_project_material
from .projects import _mesh, _project

router = APIRouter()

BC_TYPES = ["fixed", "pinned", "roller", "force", "pressure", "bearing", "torque",
            "gravity", "rotation", "temperature", "symmetry"]


def job_out(j: SimulationJob) -> dict:
    return {"id": j.id, "project_id": j.project_id, "kind": j.kind, "status": j.status,
            "progress": j.progress, "message": j.message, "error": j.error,
            "result_ref": j.result_ref, "cancelled": j.cancelled,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "started_at": j.started_at.isoformat() if j.started_at else None,
            "finished_at": j.finished_at.isoformat() if j.finished_at else None}


def _submit_job(db: Session, project: Project, kind: str, params: dict) -> SimulationJob:
    settings = get_settings()
    open_jobs = db.query(SimulationJob).filter_by(project_id=project.id).count()
    if open_jobs >= settings.job_quota_per_project:
        raise HTTPException(429, f"Job quota reached for this project ({settings.job_quota_per_project}).")
    job = SimulationJob(project_id=project.id, kind=kind, params_json=params, status="pending")
    db.add(job)
    db.commit()
    job_queue.submit(job.id, TASKS[kind])
    return job


# ------------------------------------------------------------------ load cases

class LoadCaseIn(BaseModel):
    name: str = "Load case 1"
    description: str = ""


@router.post("/projects/{project_id}/loadcases")
def create_loadcase(project_id: str, body: LoadCaseIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    lc = LoadCase(project_id=p.id, name=body.name, description=body.description)
    db.add(lc)
    db.commit()
    return loadcase_out(lc)


def bc_out(bc: BoundaryCondition) -> dict:
    return {"id": bc.id, "load_case_id": bc.load_case_id, "region_id": bc.region_id,
            "bc_type": bc.bc_type, "params": bc.params_json, "description": bc.description}


def loadcase_out(lc: LoadCase) -> dict:
    return {"id": lc.id, "project_id": lc.project_id, "name": lc.name,
            "description": lc.description, "active": lc.active,
            "boundary_conditions": [bc_out(b) for b in lc.boundary_conditions]}


@router.get("/projects/{project_id}/loadcases")
def list_loadcases(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    rows = db.query(LoadCase).filter_by(project_id=p.id).order_by(LoadCase.created_at).all()
    return [loadcase_out(lc) for lc in rows]


@router.delete("/loadcases/{loadcase_id}")
def delete_loadcase(loadcase_id: str, db: Session = Depends(get_db)):
    lc = db.get(LoadCase, loadcase_id)
    if lc is None:
        raise HTTPException(404, "Load case not found")
    db.delete(lc)
    db.commit()
    return {"deleted": True}


class BCIn(BaseModel):
    bc_type: str
    region_id: str | None = None
    description: str = ""
    magnitude: float | None = None
    units: str | None = None
    direction: list[float] | None = None
    distribution: str = "area_weighted"
    axis_point: list[float] | None = None
    axis_direction: list[float] | None = None
    rpm: float | None = None
    g: float | None = None  # gravity magnitude override, m/s^2


def _bc_params_si(body: BCIn) -> dict:
    """Convert user-entered values to SI, preserving the original entry for display."""
    p: dict = {"distribution": body.distribution}
    if body.direction is not None:
        d = np.asarray(body.direction, dtype=float)
        if not np.isfinite(d).all() or np.linalg.norm(d) == 0:
            raise HTTPException(422, "direction must be a non-zero finite vector")
        p["direction"] = body.direction
    if body.axis_point is not None:
        p["axis_point"] = body.axis_point
    if body.axis_direction is not None:
        p["axis_direction"] = body.axis_direction

    t = body.bc_type
    if t in ("force", "bearing"):
        if body.magnitude is None or body.units is None:
            raise HTTPException(422, "force loads require magnitude and units (N, kN, lbf, kgf)")
        try:
            p["magnitude_si"] = convert_force(body.magnitude, body.units)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        p["magnitude"], p["units"] = body.magnitude, body.units
        if body.direction is None:
            raise HTTPException(422, "force loads require a direction vector")
    elif t == "pressure":
        if body.magnitude is None or body.units is None:
            raise HTTPException(422, "pressure loads require magnitude and units (Pa, kPa, MPa, psi, bar)")
        try:
            p["magnitude_si"] = convert_pressure(body.magnitude, body.units)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        p["magnitude"], p["units"] = body.magnitude, body.units
    elif t == "torque":
        if body.magnitude is None or body.units is None:
            raise HTTPException(422, "torque loads require magnitude and units (Nm, Nmm, lbf·ft, lbf·in)")
        try:
            p["magnitude_si"] = convert_torque(body.magnitude, body.units)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        p["magnitude"], p["units"] = body.magnitude, body.units
        if body.axis_point is None or body.axis_direction is None:
            raise HTTPException(422, "torque loads require axis_point and axis_direction")
    elif t == "gravity":
        p["magnitude_si"] = float(body.g) if body.g else 9.80665
        p["units"] = "m/s²"
        if body.direction is None:
            raise HTTPException(422, "gravity requires a direction (e.g. [0,0,-1])")
    elif t == "rotation":
        if body.rpm is None or body.axis_point is None or body.axis_direction is None:
            raise HTTPException(422, "rotation requires rpm, axis_point and axis_direction")
        p["omega_rad_s"] = float(body.rpm) * 2.0 * np.pi / 60.0
        p["rpm"] = body.rpm
    elif t in ("fixed", "pinned", "roller", "symmetry"):
        if t in ("roller", "symmetry") and body.direction is None:
            raise HTTPException(422, f"{t} supports require a direction/normal (global X, Y or Z)")
    elif t == "temperature":
        raise HTTPException(422, "Thermal boundary conditions are recorded in the use case but thermal "
                                 "FEA is not supported in this version (structural linear statics only).")
    else:
        raise HTTPException(422, f"bc_type must be one of {BC_TYPES}")
    return p


@router.post("/loadcases/{loadcase_id}/bcs")
def add_bc(loadcase_id: str, body: BCIn, db: Session = Depends(get_db)):
    lc = db.get(LoadCase, loadcase_id)
    if lc is None:
        raise HTTPException(404, "Load case not found")
    if body.bc_type not in BC_TYPES:
        raise HTTPException(422, f"bc_type must be one of {BC_TYPES}")
    needs_region = body.bc_type not in ("gravity", "rotation")
    if needs_region and not body.region_id:
        raise HTTPException(422, f"{body.bc_type} requires a selected region")
    params = _bc_params_si(body)
    bc = BoundaryCondition(load_case_id=lc.id, region_id=body.region_id, bc_type=body.bc_type,
                           params_json=params, description=body.description)
    db.add(bc)
    db.commit()
    return bc_out(bc)


@router.delete("/bcs/{bc_id}")
def delete_bc(bc_id: str, db: Session = Depends(get_db)):
    bc = db.get(BoundaryCondition, bc_id)
    if bc is None:
        raise HTTPException(404, "Boundary condition not found")
    db.delete(bc)
    db.commit()
    return {"deleted": True}


@router.post("/loadcases/{loadcase_id}/validate")
def validate_loadcase_ep(loadcase_id: str, db: Session = Depends(get_db)):
    lc = db.get(LoadCase, loadcase_id)
    if lc is None:
        raise HTTPException(404, "Load case not found")
    bcs = [{"bc_type": b.bc_type, "params": b.params_json, "description": b.description}
           for b in lc.boundary_conditions]
    return validate_load_case(bcs)


# ------------------------------------------------------------------ analysis jobs

class GeoAnalyzeIn(BaseModel):
    mesh_version_id: str


@router.post("/projects/{project_id}/analyze/geometry")
def start_geometry_analysis(project_id: str, body: GeoAnalyzeIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    mv = _mesh(db, body.mesh_version_id)
    if mv.project_id != p.id:
        raise HTTPException(422, "Mesh belongs to a different project")
    job = _submit_job(db, p, "geometry_analysis", {"mesh_version_id": mv.id})
    return job_out(job)


class FeaIn(BaseModel):
    mesh_version_id: str
    load_case_id: str
    display_mesh_id: str | None = None  # mesh the regions were selected on (defaults to mesh_version_id)
    settings: dict = Field(default_factory=dict)


@router.post("/projects/{project_id}/analyze/fea")
def start_fea(project_id: str, body: FeaIn, db: Session = Depends(get_db)):
    settings = get_settings()
    p = _project(db, project_id)
    mv = _mesh(db, body.mesh_version_id)
    if mv.project_id != p.id:
        raise HTTPException(422, "Mesh belongs to a different project")
    lc = db.get(LoadCase, body.load_case_id)
    if lc is None or lc.project_id != p.id:
        raise HTTPException(404, "Load case not found in this project")

    # hard preconditions with actionable messages
    if not p.unit_confirmed:
        raise HTTPException(409, "Confirm the model units before running FEA.")
    matinfo = get_project_material(db, p.id)
    if not matinfo:
        raise HTTPException(409, "Select a material before running FEA.")
    if not matinfo["confirmed"]:
        raise HTTPException(409, "Confirm (or override) the material's critical properties before FEA.")
    if not mv.watertight:
        raise HTTPException(409, "The selected mesh version is not watertight; repair it first.")
    check = validate_load_case([
        {"bc_type": b.bc_type, "params": b.params_json, "description": b.description}
        for b in lc.boundary_conditions])
    if not check["ok"]:
        raise HTTPException(409, "Load case invalid: " + " ".join(check["errors"]))
    if not settings.gmsh_available:
        raise HTTPException(503, "Gmsh is not available on the server; volumetric meshing is disabled.")
    if not settings.ccx_available:
        raise HTTPException(503, "CalculiX (ccx) is not installed on the server. Install it to enable "
                                 "FEA; no mock results are returned outside demo mode.")

    fea_settings = {}
    if "target_elements" in body.settings:
        fea_settings["target_elements"] = int(np.clip(body.settings["target_elements"], 1000, 500_000))
    if "second_order" in body.settings:
        fea_settings["second_order"] = bool(body.settings["second_order"])
    params = {"mesh_version_id": mv.id, "load_case_id": lc.id, "settings": fea_settings}
    if body.display_mesh_id:
        params["display_mesh_id"] = body.display_mesh_id
    job = _submit_job(db, p, "fea", params)
    db.add(AuditEvent(project_id=p.id, action="fea.start", payload_json=params))
    db.commit()
    return job_out(job)


@router.get("/meshes/{mesh_id}/analysis")
def latest_geometry_analysis(mesh_id: str, db: Session = Depends(get_db)):
    m = _mesh(db, mesh_id)
    a = db.query(GeometryAnalysis).filter_by(mesh_version_id=m.id, status="succeeded") \
        .order_by(GeometryAnalysis.created_at.desc()).first()
    if a is None:
        raise HTTPException(404, "No geometry analysis for this mesh version yet")
    return {"id": a.id, "mesh_version_id": a.mesh_version_id, "metrics": a.metrics_json,
            "health": a.health_json, "features": a.features_json,
            "warnings": a.warnings_json,
            "created_at": a.created_at.isoformat() if a.created_at else None}


# ------------------------------------------------------------------ jobs

@router.get("/projects/{project_id}/jobs")
def list_jobs(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    rows = db.query(SimulationJob).filter_by(project_id=p.id) \
        .order_by(SimulationJob.created_at.desc()).limit(100).all()
    return [job_out(j) for j in rows]


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    j = db.get(SimulationJob, job_id)
    if j is None:
        raise HTTPException(404, "Job not found")
    return job_out(j)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str, db: Session = Depends(get_db)):
    j = db.get(SimulationJob, job_id)
    if j is None:
        raise HTTPException(404, "Job not found")
    j.cancelled = True
    if j.status in ("pending",):
        j.status = "cancelled"
    db.commit()
    job_queue.cancel(job_id)
    return job_out(j)


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str):
    """Server-sent events: emits job state every 0.5 s until terminal."""
    async def gen():
        last_payload = None
        for _ in range(2400):  # max 20 minutes
            db = SessionLocal()
            try:
                j = db.get(SimulationJob, job_id)
                if j is None:
                    yield f"event: error\ndata: {json.dumps({'error': 'job not found'})}\n\n"
                    return
                payload = json.dumps(job_out(j))
            finally:
                db.close()
            if payload != last_payload:
                yield f"data: {payload}\n\n"
                last_payload = payload
            if json.loads(payload)["status"] in ("succeeded", "failed", "cancelled"):
                return
            await asyncio.sleep(0.5)
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ------------------------------------------------------------------ results

def result_out(r: SimulationResult) -> dict:
    return {"id": r.id, "job_id": r.job_id, "project_id": r.project_id,
            "mesh_version_id": r.mesh_version_id, "load_case_id": r.load_case_id,
            "summary": r.summary_json, "assumptions": r.assumptions_json,
            "is_mock": r.is_mock,
            "created_at": r.created_at.isoformat() if r.created_at else None}


@router.get("/projects/{project_id}/results")
def list_results(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    rows = db.query(SimulationResult).filter_by(project_id=p.id, status="succeeded") \
        .order_by(SimulationResult.created_at.desc()).all()
    return [result_out(r) for r in rows]


@router.get("/results/{result_id}")
def get_result(result_id: str, db: Session = Depends(get_db)):
    r = db.get(SimulationResult, result_id)
    if r is None:
        raise HTTPException(404, "Result not found")
    return result_out(r)


@router.get("/results/{result_id}/fields")
def result_fields(result_id: str, db: Session = Depends(get_db)):
    r = db.get(SimulationResult, result_id)
    if r is None:
        raise HTTPException(404, "Result not found")
    if not r.fields_path or not Path(r.fields_path).exists():
        raise HTTPException(410, "Result field data missing on disk")
    npz = np.load(r.fields_path)
    return {
        "positions": np.round(npz["positions"], 5).reshape(-1).tolist(),
        "triangles": npz["triangles"].reshape(-1).tolist(),
        "displacement_m": np.round(npz["displacement_m"], 9).reshape(-1).tolist(),
        "von_mises_pa": np.round(npz["von_mises_pa"], 1).reshape(-1).tolist(),
        "s1_pa": np.round(npz["s1_pa"], 1).reshape(-1).tolist(),
        "s3_pa": np.round(npz["s3_pa"], 1).reshape(-1).tolist(),
        "unit_scale_to_m": float(npz["unit_scale_to_m"][0]),
        "note": "positions are in mesh units; displacement in metres",
    }


@router.get("/results/{result_id}/deck")
def result_deck(result_id: str, db: Session = Depends(get_db)):
    r = db.get(SimulationResult, result_id)
    if r is None or not r.deck_path or not Path(r.deck_path).exists():
        raise HTTPException(404, "Deck not found")
    return FileResponse(r.deck_path, media_type="text/plain", filename="calculix_job.inp")


@router.get("/results/{result_id}/log")
def result_log(result_id: str, db: Session = Depends(get_db)):
    r = db.get(SimulationResult, result_id)
    if r is None or not r.solver_log_path or not Path(r.solver_log_path).exists():
        raise HTTPException(404, "Log not found")
    return FileResponse(r.solver_log_path, media_type="text/plain", filename="solver.log")
