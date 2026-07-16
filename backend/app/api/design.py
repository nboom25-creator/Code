"""Recommendations, variants, comparison, reports, AI endpoints, demo, capabilities."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import (
    Comparison,
    DesignOperation,
    DesignVariant,
    MeshVersion,
    Recommendation,
    Report,
)
from ..services.ai.base import get_provider
from ..services.variants import STRATEGIES, comparison_table
from ..version import APP_NAME, APP_VERSION
from ..workers.tasks import _compare_entry, recommendations_for_project
from .projects import _mesh, _project, mesh_out
from .sim import _submit_job, job_out

router = APIRouter()


def rec_out(r: Recommendation) -> dict:
    return {"id": r.id, "project_id": r.project_id, "mesh_version_id": r.mesh_version_id,
            "rule_id": r.rule_id, "title": r.title, "category": r.category,
            "severity": r.severity, "confidence": r.confidence, "problem": r.problem,
            "evidence": r.evidence_json, "location": r.location_json,
            "rationale": r.rationale, "proposed_change": r.proposed_change,
            "expected_benefit": r.expected_benefit, "possible_downside": r.possible_downside,
            "manufacturing_impact": r.manufacturing_impact,
            "validation_required": r.validation_required,
            "auto_generatable": r.auto_generatable, "assumptions": r.assumptions_json,
            "state": r.state}


class RecGenIn(BaseModel):
    mesh_version_id: str


@router.post("/projects/{project_id}/recommendations/generate")
def generate_recs(project_id: str, body: RecGenIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    mv = _mesh(db, body.mesh_version_id)
    if mv.project_id != p.id:
        raise HTTPException(422, "Mesh belongs to a different project")
    try:
        rows = recommendations_for_project(db, p.id, mv.id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return [rec_out(r) for r in rows]


@router.get("/projects/{project_id}/recommendations")
def list_recs(project_id: str, mesh_version_id: str | None = None, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    q = db.query(Recommendation).filter_by(project_id=p.id)
    if mesh_version_id:
        q = q.filter_by(mesh_version_id=mesh_version_id)
    return [rec_out(r) for r in q.order_by(Recommendation.created_at.desc()).all()]


class RecPatch(BaseModel):
    state: str = Field(pattern="^(open|accepted|dismissed)$")


@router.patch("/recommendations/{rec_id}")
def patch_rec(rec_id: str, body: RecPatch, db: Session = Depends(get_db)):
    r = db.get(Recommendation, rec_id)
    if r is None:
        raise HTTPException(404, "Recommendation not found")
    r.state = body.state
    db.commit()
    return rec_out(r)


# ------------------------------------------------------------------ variants

class VariantGenIn(BaseModel):
    base_mesh_id: str
    strategies: list[str] = Field(default_factory=lambda: ["conservative", "balanced", "performance"])
    recommendation_ids: list[str] | None = None


@router.post("/projects/{project_id}/variants/generate")
def generate_variants(project_id: str, body: VariantGenIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    mv = _mesh(db, body.base_mesh_id)
    if mv.project_id != p.id:
        raise HTTPException(422, "Mesh belongs to a different project")
    bad = [s for s in body.strategies if s not in STRATEGIES]
    if bad:
        raise HTTPException(422, f"Unknown strategies {bad}; valid: {sorted(STRATEGIES)}")
    n_auto = db.query(Recommendation).filter_by(
        project_id=p.id, mesh_version_id=mv.id, auto_generatable=True).count()
    if n_auto == 0:
        raise HTTPException(409, "No auto-generatable recommendations exist for this mesh. Generate "
                                 "recommendations first; manual-only findings cannot be automated.")
    params = {"base_mesh_id": mv.id, "strategies": body.strategies}
    if body.recommendation_ids:
        params["recommendation_ids"] = body.recommendation_ids
    job = _submit_job(db, p, "variant_generation", params)
    return job_out(job)


def variant_out(v: DesignVariant, db: Session) -> dict:
    ops = db.query(DesignOperation).filter_by(variant_id=v.id).order_by(DesignOperation.seq).all()
    return {"id": v.id, "project_id": v.project_id, "base_mesh_id": v.base_mesh_id,
            "result_mesh_id": v.result_mesh_id, "strategy": v.strategy, "name": v.name,
            "status": v.status, "error": v.error, "score": v.score,
            "metrics": v.metrics_json, "approval": v.approval,
            "strategy_description": STRATEGIES.get(v.strategy, {}).get("description", ""),
            "operations": [{
                "seq": o.seq, "op_type": o.op_type, "status": o.status, "error": o.error,
                "reason": o.reason, "recommendation_id": o.recommendation_id,
                "params": {k: val for k, val in (o.op_json or {}).items()
                           if k not in ("protected_triangle_indices", "triangle_indices",
                                        "hotspot_points")},
            } for o in ops],
            "created_at": v.created_at.isoformat() if v.created_at else None}


@router.get("/projects/{project_id}/variants")
def list_variants(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    rows = db.query(DesignVariant).filter_by(project_id=p.id) \
        .order_by(DesignVariant.created_at.desc()).all()
    return [variant_out(v, db) for v in rows]


@router.get("/variants/{variant_id}")
def get_variant(variant_id: str, db: Session = Depends(get_db)):
    v = db.get(DesignVariant, variant_id)
    if v is None:
        raise HTTPException(404, "Variant not found")
    return variant_out(v, db)


class ApprovalIn(BaseModel):
    approval: str = Field(pattern="^(pending|approved|rejected)$")


@router.post("/variants/{variant_id}/approval")
def set_approval(variant_id: str, body: ApprovalIn, db: Session = Depends(get_db)):
    v = db.get(DesignVariant, variant_id)
    if v is None:
        raise HTTPException(404, "Variant not found")
    v.approval = body.approval
    db.commit()
    return variant_out(v, db)


# ------------------------------------------------------------------ comparison

@router.get("/projects/{project_id}/comparison")
def get_comparison(project_id: str, baseline_mesh_id: str | None = None,
                   db: Session = Depends(get_db)):
    p = _project(db, project_id)
    if baseline_mesh_id:
        base_mv = _mesh(db, baseline_mesh_id)
    else:
        base_mv = db.query(MeshVersion).filter_by(project_id=p.id) \
            .filter(MeshVersion.kind != "variant") \
            .order_by(MeshVersion.created_at.desc()).first()
    if base_mv is None:
        raise HTTPException(404, "No baseline mesh found")
    variants = db.query(DesignVariant).filter_by(project_id=p.id, status="succeeded").all()
    baseline_entry = _compare_entry(db, p, base_mv, f"Original ({base_mv.label or base_mv.kind})")
    entries = []
    variant_meta = []
    for v in variants:
        if not v.result_mesh_id:
            continue
        vmv = db.get(MeshVersion, v.result_mesh_id)
        entries.append(_compare_entry(db, p, vmv, v.name))
        variant_meta.append({"variant_id": v.id, "result_mesh_id": v.result_mesh_id,
                             "strategy": v.strategy, "approval": v.approval})
    table = comparison_table(baseline_entry, entries)
    comp = Comparison(project_id=p.id, baseline_mesh_id=base_mv.id,
                      variant_ids_json=[v["variant_id"] for v in variant_meta],
                      metrics_json=table)
    db.add(comp)
    # persist scores onto variants
    for meta, row in zip(variant_meta, table["rows"][1:], strict=False):
        dv = db.get(DesignVariant, meta["variant_id"])
        if dv is not None and row.get("score") is not None:
            dv.score = row["score"]
            dv.comparison_json = row
    db.commit()
    return {"baseline_mesh": mesh_out(base_mv), "variants": variant_meta, **table}


# ------------------------------------------------------------------ reports

class ReportIn(BaseModel):
    mesh_version_id: str | None = None


@router.post("/projects/{project_id}/report")
def create_report(project_id: str, body: ReportIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    job = _submit_job(db, p, "report", {"mesh_version_id": body.mesh_version_id})
    return job_out(job)


@router.get("/projects/{project_id}/reports")
def list_reports(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    rows = db.query(Report).filter_by(project_id=p.id, status="succeeded") \
        .order_by(Report.created_at.desc()).all()
    return [{"id": r.id, "created_at": r.created_at.isoformat() if r.created_at else None,
             "sha256": r.output_checksum} for r in rows]


@router.get("/reports/{report_id}/file")
def report_file(report_id: str, db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if r is None or not r.path or not Path(r.path).exists():
        raise HTTPException(404, "Report not found")
    return FileResponse(r.path, media_type="application/pdf",
                        filename=f"partforge_report_{r.id[:8]}.pdf")


# ------------------------------------------------------------------ AI

class ExplainIn(BaseModel):
    mesh_version_id: str


@router.post("/projects/{project_id}/ai/explain")
def ai_explain(project_id: str, body: ExplainIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    recs = db.query(Recommendation).filter_by(project_id=p.id,
                                              mesh_version_id=body.mesh_version_id).all()
    provider = get_provider(get_settings())
    text = provider.explain_recommendations([rec_out(r) for r in recs],
                                            {"project_name": p.name, "unit": p.unit})
    return {"provider": provider.name, "text": text,
            "note": "Explanation only; every number originates from deterministic analysis code."}


class ProposeIn(BaseModel):
    text: str = Field(min_length=3, max_length=8000)


@router.post("/projects/{project_id}/ai/propose-loadcase")
def ai_propose(project_id: str, body: ProposeIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    provider = get_provider(get_settings())
    try:
        proposal = provider.propose_load_case(body.text, {"project_name": p.name, "unit": p.unit})
    except Exception as exc:
        raise HTTPException(502, f"AI provider failed: {exc}") from exc
    return {"provider": provider.name, "proposal": json.loads(proposal.model_dump_json()),
            "note": "DRAFT only. Review magnitudes/directions and map each entry to a selected "
                    "region, then save it as a real load case. Nothing has been applied."}


# ------------------------------------------------------------------ capabilities & demo

@router.get("/capabilities")
def capabilities():
    s = get_settings()
    return {
        "app": APP_NAME, "version": APP_VERSION, "environment": s.environment,
        "fea_available": s.ccx_available and s.gmsh_available,
        "ccx_available": s.ccx_available,
        "gmsh_available": s.gmsh_available,
        "boolean_engine": "manifold3d",
        "ai_provider": s.ai_provider,
        "max_upload_bytes": s.max_upload_bytes,
        "max_triangles": s.max_triangles,
        "step_export": False,
        "step_export_note": "STEP export is only offered when a true solid B-rep exists; this "
                            "version modifies tessellated geometry, so exports are STL plus a JSON "
                            "modification recipe.",
    }


@router.post("/demo")
def create_demo(db: Session = Depends(get_db)):
    from ..demo.seed import seed_demo_project
    project, jobs = seed_demo_project(db)
    return {"project": {"id": project.id, "name": project.name}, "jobs": jobs,
            "note": "Background jobs (geometry analysis / FEA) may still be running; watch the job list."}


@router.get("/variants/{variant_id}/recipe")
def variant_recipe(variant_id: str, db: Session = Depends(get_db)):
    """JSON modification recipe: the exact validated operations that produced the variant."""
    v = db.get(DesignVariant, variant_id)
    if v is None:
        raise HTTPException(404, "Variant not found")
    ops = db.query(DesignOperation).filter_by(variant_id=v.id).order_by(DesignOperation.seq).all()
    return {
        "variant_id": v.id, "strategy": v.strategy, "base_mesh_id": v.base_mesh_id,
        "software": {"app": APP_NAME, "version": APP_VERSION},
        "coordinate_system": "mesh units of the base mesh",
        "operations": [{"seq": o.seq, "op_type": o.op_type, "status": o.status,
                        "reason": o.reason, "recommendation_id": o.recommendation_id,
                        "document": o.op_json} for o in ops],
    }
