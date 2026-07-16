"""Background job implementations. Each function runs in a worker thread with
its own DB session and updates the job row transactionally."""
from __future__ import annotations

import json
import threading
from pathlib import Path

import numpy as np

from ..config import get_settings
from ..db import SessionLocal
from ..models import (
    DesignOperation,
    DesignVariant,
    GeometryAnalysis,
    LoadCase,
    ManufacturingProfile,
    Material,
    MaterialOverride,
    MeshVersion,
    Project,
    ProtectedRegion,
    Recommendation,
    Report,
    SelectedRegion,
    SimulationJob,
    SimulationMesh,
    SimulationResult,
    Snapshot,
    UseCase,
)
from ..services import storage
from ..services.analysis_service import run_geometry_analysis
from ..services.fea.pipeline import FeaError, run_fea
from ..services.materials_seed import effective_properties
from ..services.rules import RuleContext, generate_recommendations
from ..services.stl_io import load_mesh_file, save_stl
from ..services.units import length_scale_to_m
from ..services.variants import STRATEGIES, build_ops_from_recommendations, comparison_table, generate_variant
from .queue import progress_updater


def _get(db, model, oid, what: str):
    obj = db.get(model, oid)
    if obj is None:
        raise ValueError(f"{what} {oid} not found")
    return obj


def get_project_material(db, project_id: str) -> dict | None:
    ov = db.query(MaterialOverride).filter_by(project_id=project_id).order_by(
        MaterialOverride.created_at.desc()).first()
    if not ov:
        return None
    mat = db.get(Material, ov.material_id)
    if not mat:
        return None
    mfg = db.query(ManufacturingProfile).filter_by(project_id=project_id).first()
    mfg_dict = {"method": mfg.method, **(mfg.params_json or {})} if mfg else None
    props = effective_properties(mat, ov.overrides_json, mfg_dict)
    return {"material": mat, "override": ov, "confirmed": ov.confirmed,
            "properties": props, "key": mat.key, "name": mat.name,
            "category": mat.category, "isotropic": mat.isotropic}


def _unit_scale(project: Project) -> float | None:
    if project.unit_confirmed and project.unit:
        return length_scale_to_m(project.unit)
    return None


# --------------------------------------------------------------------------- geometry analysis

def geometry_analysis_task(job_id: str, cancel: threading.Event) -> None:
    progress = progress_updater(job_id, cancel)
    db = SessionLocal()
    try:
        job = _get(db, SimulationJob, job_id, "job")
        mesh_version_id = job.params_json["mesh_version_id"]
        mv = _get(db, MeshVersion, mesh_version_id, "mesh version")
        project = _get(db, Project, job.project_id, "project")
        matinfo = get_project_material(db, project.id)
        density = matinfo["properties"].get("density") if matinfo else None
        mfg = db.query(ManufacturingProfile).filter_by(project_id=project.id).first()
        build_dir = (mfg.params_json or {}).get("build_direction") if mfg else None

        mesh = load_mesh_file(mv.path)
        fields_out = storage.subdir(project.id, "analysis") / f"{mv.id}_fields.npz"
        result = run_geometry_analysis(
            mesh, project.unit if project.unit_confirmed else None,
            density, build_dir, fields_out, progress)

        analysis = GeometryAnalysis(
            mesh_version_id=mv.id,
            metrics_json=result["metrics"],
            health_json=result["health"],
            features_json={**result["features"], "thickness": result["thickness"],
                           "overhang": {k: v for k, v in result["overhang"].items()
                                        if k != "per_vertex"}},
            warnings_json=result["warnings"],
            fields_path=result["fields_path"],
            status="succeeded",
            input_checksum=mv.output_checksum,
            params_json={"build_direction": build_dir},
        )
        db.add(analysis)
        db.flush()
        job.result_ref = analysis.id
        db.commit()
    finally:
        db.close()


# --------------------------------------------------------------------------- FEA

def _collect_bcs(db, load_case: LoadCase) -> list[dict]:
    out = []
    for bc in load_case.boundary_conditions:
        tri = []
        if bc.region_id:
            region = db.get(SelectedRegion, bc.region_id)
            if region:
                tri = region.triangle_indices or []
        out.append({"bc_type": bc.bc_type, "params": bc.params_json or {},
                    "description": bc.description, "triangle_indices": tri})
    return out


def fea_task(job_id: str, cancel: threading.Event) -> None:
    progress = progress_updater(job_id, cancel)
    db = SessionLocal()
    try:
        job = _get(db, SimulationJob, job_id, "job")
        p = job.params_json
        project = _get(db, Project, job.project_id, "project")
        mv = _get(db, MeshVersion, p["mesh_version_id"], "mesh version")
        lc = _get(db, LoadCase, p["load_case_id"], "load case")
        display_mesh_id = p.get("display_mesh_id") or mv.id
        display_mv = _get(db, MeshVersion, display_mesh_id, "display mesh version")

        scale = _unit_scale(project)
        if scale is None:
            raise FeaError("Units are not confirmed for this project; confirm them before running FEA.")
        matinfo = get_project_material(db, project.id)
        if not matinfo:
            raise FeaError("No material selected for this project.")
        if not matinfo["confirmed"]:
            raise FeaError("Material properties have not been confirmed; confirm or override the "
                           "critical properties (E, ν, density, yield) first.")
        if not mv.watertight:
            raise FeaError("The selected mesh version is not watertight; repair it first.")

        bcs = _collect_bcs(db, lc)
        display = load_mesh_file(display_mv.path)
        workdir = storage.subdir(project.id, "sim") / job.id
        result = run_fea(
            stl_path=Path(mv.path), unit_scale_to_m=scale,
            material_props=matinfo["properties"], bcs=bcs,
            display_vertices=np.asarray(display.vertices, float),
            display_faces=np.asarray(display.faces),
            workdir=workdir, progress=progress,
            settings_override=p.get("settings"),
        )
        s = result["summary"]
        sim_mesh = SimulationMesh(
            job_id=job.id, mesh_version_id=mv.id, path=result["deck_path"],
            node_count=s["node_count"], element_count=s["element_count"],
            element_type=s["element_type"], quality_json=s["mesh_quality"],
            status="succeeded", input_checksum=mv.output_checksum,
        )
        db.add(sim_mesh)
        res = SimulationResult(
            job_id=job.id, project_id=project.id, mesh_version_id=mv.id, load_case_id=lc.id,
            summary_json=s, assumptions_json=result["assumptions"],
            fields_path=result["fields_path"], deck_path=result["deck_path"],
            solver_log_path=str(workdir / "solver_stdout.log"),
            status="succeeded", input_checksum=mv.output_checksum,
            params_json={"load_case_id": lc.id, "material_key": matinfo["key"],
                         "unit_scale_to_m": scale},
        )
        db.add(res)
        db.flush()
        job.result_ref = res.id
        db.commit()
    finally:
        db.close()


# --------------------------------------------------------------------------- recommendations

def _rule_context(db, project: Project, mv: MeshVersion, analysis: GeometryAnalysis,
                  fea_result: SimulationResult | None) -> RuleContext:
    mesh = load_mesh_file(mv.path)
    matinfo = get_project_material(db, project.id)
    uc = db.query(UseCase).filter_by(project_id=project.id).first()
    mfg = db.query(ManufacturingProfile).filter_by(project_id=project.id).first()
    feats = analysis.features_json or {}
    fea_fields = None
    fea_summary = None
    if fea_result is not None:
        fea_summary = dict(fea_result.summary_json)
        fea_summary["_assumptions"] = fea_result.assumptions_json
        if fea_result.fields_path and Path(fea_result.fields_path).exists():
            npz = np.load(fea_result.fields_path)
            fea_fields = {"positions": npz["positions"], "von_mises_pa": npz["von_mises_pa"]}
    material_ctx = {}
    if matinfo:
        material_ctx = {**matinfo["properties"], "key": matinfo["key"], "name": matinfo["name"],
                        "category": matinfo["category"]}
    return RuleContext(
        mesh=mesh, unit=project.unit if project.unit_confirmed else None,
        unit_scale_to_m=_unit_scale(project),
        metrics=analysis.metrics_json or {}, health=analysis.health_json or {},
        thickness=_thickness_with_fields(analysis),
        overhang=(feats.get("overhang") or {}),
        features=feats,
        use_case=(uc.answers_json if uc else {}) or {},
        manufacturing={"method": mfg.method, "params": mfg.params_json or {}} if mfg else {},
        material=material_ctx,
        fea_summary=fea_summary, fea_fields=fea_fields,
    )


def _thickness_with_fields(analysis: GeometryAnalysis) -> dict:
    thick = dict((analysis.features_json or {}).get("thickness") or {})
    if analysis.fields_path and Path(analysis.fields_path).exists():
        npz = np.load(analysis.fields_path)
        t = npz.get("thickness")
        if t is not None and t.size:
            per_vertex = np.where(t < 0, np.nan, t)
            thick["per_vertex"] = per_vertex
    return thick


def recommendations_for_project(db, project_id: str, mesh_version_id: str) -> list[Recommendation]:
    project = _get(db, Project, project_id, "project")
    mv = _get(db, MeshVersion, mesh_version_id, "mesh version")
    analysis = db.query(GeometryAnalysis).filter_by(
        mesh_version_id=mv.id, status="succeeded").order_by(
        GeometryAnalysis.created_at.desc()).first()
    if analysis is None:
        raise ValueError("Run geometry analysis before generating recommendations.")
    fea_result = db.query(SimulationResult).filter_by(
        mesh_version_id=mv.id, status="succeeded", is_mock=False).order_by(
        SimulationResult.created_at.desc()).first()

    # thickness per-face needed by thin-wall rule: recompute cheaply from stored fields
    ctx = _rule_context(db, project, mv, analysis, fea_result)
    # the thin-wall rule needs per-face values; rebuild from per-vertex if present
    if "per_vertex" in ctx.thickness and "per_face" not in ctx.thickness:
        pv = ctx.thickness["per_vertex"]
        faces = ctx.mesh.faces
        if len(pv) == len(ctx.mesh.vertices):
            ctx.thickness["per_face"] = np.nanmean(pv[faces], axis=1)

    drafts = generate_recommendations(ctx)
    # replace existing open recommendations for this mesh version
    db.query(Recommendation).filter_by(project_id=project.id, mesh_version_id=mv.id,
                                       state="open").delete()
    rows = []
    for d in drafts:
        row = Recommendation(
            project_id=project.id, mesh_version_id=mv.id, rule_id=d.rule_id, title=d.title,
            category=d.category, severity=d.severity, confidence=d.confidence, problem=d.problem,
            evidence_json=_jsonable(d.evidence), location_json=_jsonable(d.location),
            rationale=d.rationale, proposed_change=d.proposed_change,
            expected_benefit=d.expected_benefit, possible_downside=d.possible_downside,
            manufacturing_impact=d.manufacturing_impact, validation_required=d.validation_required,
            auto_generatable=d.auto_generatable, auto_op_json=_jsonable(d.auto_op) if d.auto_op else None,
            assumptions_json=d.assumptions,
        )
        db.add(row)
        rows.append(row)
    db.commit()
    return rows


def _jsonable(obj):
    return json.loads(json.dumps(obj, default=lambda o: o.tolist() if isinstance(o, np.ndarray) else str(o)))


# --------------------------------------------------------------------------- variants

def variant_task(job_id: str, cancel: threading.Event) -> None:
    progress = progress_updater(job_id, cancel)
    db = SessionLocal()
    try:
        job = _get(db, SimulationJob, job_id, "job")
        p = {**job.params_json, "_job_id": job.id}
        project = _get(db, Project, job.project_id, "project")
        base_mv = _get(db, MeshVersion, p["base_mesh_id"], "base mesh version")
        strategies = [s for s in p.get("strategies", ["conservative"]) if s in STRATEGIES]
        rec_query = db.query(Recommendation).filter_by(
            project_id=project.id, mesh_version_id=base_mv.id).filter(
            Recommendation.state != "dismissed")
        if p.get("recommendation_ids"):
            rec_query = rec_query.filter(Recommendation.id.in_(p["recommendation_ids"]))
        recs = rec_query.all()
        rec_dicts = [{
            "id": r.id, "severity": r.severity, "auto_generatable": r.auto_generatable,
            "auto_op": r.auto_op_json, "title": r.title, "proposed_change": r.proposed_change,
        } for r in recs]

        protected_tri: list[int] = []
        for pr in db.query(ProtectedRegion).filter_by(project_id=project.id).all():
            region = db.get(SelectedRegion, pr.region_id)
            if region and region.mesh_version_id == base_mv.id:
                protected_tri.extend(region.triangle_indices or [])

        base_mesh = load_mesh_file(base_mv.path)
        scale = _unit_scale(project)
        matinfo = get_project_material(db, project.id)
        density = matinfo["properties"].get("density") if matinfo else None

        variant_ids = []
        for si, strategy in enumerate(strategies):
            def sub_progress(f, m, si=si, strategy=strategy):
                progress((si + f) / max(len(strategies), 1) * 0.95, f"[{strategy}] {m}")
            docs = build_ops_from_recommendations(rec_dicts, strategy, protected_tri)
            result = generate_variant(base_mesh, docs, strategy,
                                      project.unit if project.unit_confirmed else None,
                                      scale, density, sub_progress)
            dv = DesignVariant(project_id=project.id, base_mesh_id=base_mv.id, strategy=strategy,
                               name=f"{strategy.capitalize()} variant",
                               params_json={"strategy": strategy,
                                            "recommendation_ids": [r["id"] for r in rec_dicts]},
                               input_checksum=base_mv.output_checksum)
            db.add(dv)
            db.flush()
            for seq, op in enumerate(result.ops):
                db.add(DesignOperation(
                    variant_id=dv.id, seq=seq, op_type=op.doc.get("op_type", "?"),
                    op_json=op.doc, recommendation_id=op.recommendation_id,
                    reason=op.reason, status=op.status, error=op.error))
            if result.mesh is None:
                dv.status = "failed"
                dv.error = result.error
            else:
                out_path = storage.subdir(project.id, "variants") / f"{dv.id}.stl"
                save_stl(result.mesh, out_path)
                new_mv = MeshVersion(
                    project_id=project.id, parent_mesh_id=base_mv.id, kind="variant",
                    label=dv.name, path=str(out_path),
                    triangle_count=len(result.mesh.faces), vertex_count=len(result.mesh.vertices),
                    watertight=bool(result.mesh.is_watertight),
                    params_json={"strategy": strategy, "operations": [o.doc for o in result.ops
                                                                      if o.status == "applied"]},
                    input_checksum=base_mv.output_checksum,
                    output_checksum=storage.sha256_file(out_path),
                    status="succeeded",
                )
                db.add(new_mv)
                db.flush()
                dv.result_mesh_id = new_mv.id
                dv.metrics_json = result.metrics
                dv.status = "succeeded"
                variant_ids.append(dv.id)
                db.commit()
                # re-run the same checks on the variant so comparison has real data
                _reanalyze_variant(db, project, new_mv, p, sub_progress)
            db.commit()

        job.result_ref = json.dumps(variant_ids)
        db.commit()
    finally:
        db.close()


def _reanalyze_variant(db, project: Project, mv: MeshVersion, job_params: dict, progress) -> None:
    """Geometry analysis (always) + FEA with the baseline load case (when possible)
    for a freshly generated variant. Failures are recorded, never fatal."""
    settings = get_settings()
    try:
        mesh = load_mesh_file(mv.path)
        matinfo = get_project_material(db, project.id)
        density = matinfo["properties"].get("density") if matinfo else None
        fields_out = storage.subdir(project.id, "analysis") / f"{mv.id}_fields.npz"
        result = run_geometry_analysis(
            mesh, project.unit if project.unit_confirmed else None, density, None, fields_out,
            progress=lambda f, m: progress(0.8, f"variant re-check: {m}"))
        db.add(GeometryAnalysis(
            mesh_version_id=mv.id, metrics_json=result["metrics"], health_json=result["health"],
            features_json={**result["features"], "thickness": result["thickness"],
                           "overhang": {k: v for k, v in result["overhang"].items() if k != "per_vertex"}},
            warnings_json=result["warnings"], fields_path=result["fields_path"],
            status="succeeded", input_checksum=mv.output_checksum))
        db.commit()
    except Exception as exc:
        db.rollback()
        db.add(GeometryAnalysis(mesh_version_id=mv.id, status="failed", error=str(exc)))
        db.commit()
        return

    lc_id = job_params.get("load_case_id")
    if not lc_id:
        lc = db.query(LoadCase).filter_by(project_id=project.id, active=True).order_by(
            LoadCase.created_at).first()
        lc_id = lc.id if lc else None
    if not lc_id or not (settings.ccx_available and settings.gmsh_available):
        return
    if not (project.unit_confirmed and mv.watertight):
        return
    matinfo = get_project_material(db, project.id)
    if not matinfo or not matinfo["confirmed"]:
        return
    try:
        lc = db.get(LoadCase, lc_id)
        base_mv = db.get(MeshVersion, job_params["base_mesh_id"])
        display = load_mesh_file(base_mv.path)  # regions were selected on the base mesh
        bcs = _collect_bcs(db, lc)
        workdir = storage.subdir(project.id, "sim") / f"variant_{mv.id[:8]}"
        fea = run_fea(
            stl_path=Path(mv.path), unit_scale_to_m=length_scale_to_m(project.unit),
            material_props=matinfo["properties"], bcs=bcs,
            display_vertices=np.asarray(display.vertices, float),
            display_faces=np.asarray(display.faces),
            workdir=workdir,
            progress=lambda f, m: progress(0.9, f"variant FEA: {m}"))
        db.add(SimulationResult(
            job_id=job_params.get("_job_id", ""), project_id=project.id, mesh_version_id=mv.id,
            load_case_id=lc.id, summary_json=fea["summary"], assumptions_json=fea["assumptions"],
            fields_path=fea["fields_path"], deck_path=fea["deck_path"],
            solver_log_path=str(workdir / "solver_stdout.log"), status="succeeded",
            input_checksum=mv.output_checksum,
            params_json={"load_case_id": lc.id, "variant_rerun": True}))
        db.commit()
    except (FeaError, Exception) as exc:  # noqa: BLE001 - recorded, not fatal
        db.rollback()
        db.add(SimulationResult(
            job_id=job_params.get("_job_id", ""), project_id=project.id, mesh_version_id=mv.id,
            load_case_id=lc_id, status="failed", error=str(exc)))
        db.commit()


# --------------------------------------------------------------------------- report

def report_task(job_id: str, cancel: threading.Event) -> None:
    from ..services.render import render_mesh_png
    from ..services.report import build_report_pdf

    progress = progress_updater(job_id, cancel)
    db = SessionLocal()
    try:
        job = _get(db, SimulationJob, job_id, "job")
        project = _get(db, Project, job.project_id, "project")
        p = job.params_json
        mv_id = p.get("mesh_version_id")
        mv = db.get(MeshVersion, mv_id) if mv_id else None
        if mv is None:
            mv = db.query(MeshVersion).filter_by(project_id=project.id).order_by(
                MeshVersion.created_at.desc()).first()
        if mv is None:
            raise ValueError("Project has no mesh to report on.")

        progress(0.1, "Collecting analysis data")
        analysis = db.query(GeometryAnalysis).filter_by(mesh_version_id=mv.id, status="succeeded") \
            .order_by(GeometryAnalysis.created_at.desc()).first()
        matinfo = get_project_material(db, project.id)
        uc = db.query(UseCase).filter_by(project_id=project.id).first()
        lcs = db.query(LoadCase).filter_by(project_id=project.id).all()
        recs = db.query(Recommendation).filter_by(project_id=project.id, mesh_version_id=mv.id).all()
        fea_results = db.query(SimulationResult).filter_by(project_id=project.id, status="succeeded") \
            .order_by(SimulationResult.created_at.desc()).limit(4).all()
        variants = db.query(DesignVariant).filter_by(project_id=project.id, status="succeeded").all()

        progress(0.35, "Rendering geometry images")
        report_dir = storage.subdir(project.id, "reports")
        images = {}
        try:
            mesh = load_mesh_file(mv.path)
            img_path = report_dir / f"{mv.id}_iso.png"
            render_mesh_png(mesh, img_path, view="iso")
            images["Original geometry (isometric software render)"] = str(img_path)
        except Exception:
            pass
        snaps = db.query(Snapshot).filter_by(project_id=project.id).order_by(
            Snapshot.created_at.desc()).limit(2).all()
        for s in snaps:
            if Path(s.path).exists():
                images[s.label or "Viewport snapshot"] = s.path

        fea_ctx = []
        for r in fea_results:
            label_mv = db.get(MeshVersion, r.mesh_version_id)
            fea_ctx.append({"label": (label_mv.label or label_mv.kind) if label_mv else "",
                            "summary": r.summary_json, "assumptions": r.assumptions_json,
                            "is_mock": r.is_mock})

        comparison = None
        if variants:
            baseline_entry = _compare_entry(db, project, mv, "Original")
            variant_entries = []
            for v in variants:
                if v.result_mesh_id:
                    vmv = db.get(MeshVersion, v.result_mesh_id)
                    variant_entries.append(_compare_entry(db, project, vmv, v.name))
            comparison = comparison_table(baseline_entry, variant_entries)

        warnings = [w.get("message") if isinstance(w, dict) else str(w)
                    for w in (analysis.warnings_json if analysis else [])]
        if not project.unit_confirmed:
            warnings.insert(0, "Units were never confirmed; all dimensional values are raw mesh units.")

        ctx = {
            "project": {"name": project.name, "description": project.description,
                        "unit": project.unit if project.unit_confirmed else None},
            "metrics": analysis.metrics_json if analysis else {},
            "health": analysis.health_json if analysis else {},
            "thickness": (analysis.features_json or {}).get("thickness") if analysis else {},
            "material": ({"name": matinfo["name"], "confirmed": matinfo["confirmed"],
                          "properties": matinfo["properties"],
                          "source": matinfo["material"].source} if matinfo else None),
            "use_case": {"answers": uc.answers_json, "free_text": uc.free_text} if uc else None,
            "load_cases": [{"name": lc.name, "boundary_conditions": [
                {"bc_type": bc.bc_type, "params": bc.params_json, "description": bc.description}
                for bc in lc.boundary_conditions]} for lc in lcs],
            "fea": fea_ctx,
            "recommendations": [{
                "severity": r.severity, "title": r.title, "rule_id": r.rule_id,
                "confidence": r.confidence, "problem": r.problem, "rationale": r.rationale,
                "proposed_change": r.proposed_change, "expected_benefit": r.expected_benefit,
                "validation_required": r.validation_required} for r in recs],
            "comparison": comparison,
            "images": images,
            "warnings": warnings,
            "repro": {
                "project_id": project.id, "mesh_version_id": mv.id,
                "mesh_sha256": mv.output_checksum,
                "app_version": job.software_version,
            },
        }
        progress(0.7, "Building PDF")
        pdf_path = report_dir / f"report_{job.id}.pdf"
        build_report_pdf(pdf_path, ctx)
        report = Report(project_id=project.id, path=str(pdf_path), status="succeeded",
                        params_json={"mesh_version_id": mv.id},
                        output_checksum=storage.sha256_file(pdf_path))
        db.add(report)
        db.flush()
        job.result_ref = report.id
        db.commit()
    finally:
        db.close()


def _compare_entry(db, project: Project, mv: MeshVersion, name: str) -> dict:
    analysis = db.query(GeometryAnalysis).filter_by(mesh_version_id=mv.id, status="succeeded") \
        .order_by(GeometryAnalysis.created_at.desc()).first()
    fea = db.query(SimulationResult).filter_by(mesh_version_id=mv.id, status="succeeded",
                                               is_mock=False) \
        .order_by(SimulationResult.created_at.desc()).first()
    feats = (analysis.features_json or {}) if analysis else {}
    thick = feats.get("thickness") or {}
    over = feats.get("overhang") or {}
    return {
        "name": name,
        "metrics": analysis.metrics_json if analysis else {},
        "fea_summary": fea.summary_json if fea else None,
        "min_wall_estimate": thick.get("min_wall_estimate"),
        "warning_count": len(analysis.warnings_json or []) if analysis else None,
        "overhang_fraction": over.get("overhang_fraction"),
    }


TASKS = {
    "geometry_analysis": geometry_analysis_task,
    "fea": fea_task,
    "variant_generation": variant_task,
    "report": report_task,
}
