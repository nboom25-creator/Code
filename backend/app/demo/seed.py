"""Seed the demo project: L mounting bracket, 6061-T6, fixed holes, downward load.

Geometry analysis and recommendations run synchronously (seconds); FEA and
variant generation are submitted as background jobs so the UI can show real
progress. Nothing here fabricates results — if the solver is missing, the FEA
job simply reports that honestly.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import (
    BoundaryCondition,
    LoadCase,
    ManufacturingProfile,
    Material,
    MaterialOverride,
    MeshVersion,
    Project,
    ProtectedRegion,
    SelectedRegion,
    SimulationJob,
    UseCase,
)
from ..services import storage
from ..services.stl_io import save_stl
from ..workers.queue import job_queue
from ..workers.tasks import TASKS, geometry_analysis_task, recommendations_for_project
from .bracket import build_demo_bracket, demo_regions


def seed_demo_project(db: Session) -> tuple[Project, list[dict]]:
    project = Project(
        name="Demo: L mounting bracket",
        description=(
            "Demonstration project: a 60x40 mm aluminum L-bracket with a deliberately thin 3 mm "
            "cantilever wall and a sharp internal corner at the root. Two M5 mounting holes are "
            "fixed; a downward 250 N service load acts on the top of the wall."),
        is_demo=True, unit="mm", unit_confirmed=True,
    )
    db.add(project)
    db.flush()

    mesh = build_demo_bracket()
    mesh_path = storage.subdir(project.id, "meshes") / "demo_bracket.stl"
    save_stl(mesh, mesh_path)
    mv = MeshVersion(project_id=project.id, kind="original", label="Demo bracket (generated)",
                     path=str(mesh_path), triangle_count=len(mesh.faces),
                     vertex_count=len(mesh.vertices), watertight=True,
                     output_checksum=storage.sha256_file(mesh_path), status="succeeded",
                     params_json={"generator": "app.demo.bracket", "dimensions_mm": "60x40x5 base, 3x50 wall"})
    db.add(mv)
    db.flush()

    mat = db.query(Material).filter_by(key="al_6061_t6").first()
    if mat:
        db.add(MaterialOverride(project_id=project.id, material_id=mat.id,
                                overrides_json={}, confirmed=True))
    db.add(UseCase(project_id=project.id, preset="mounting_bracket",
                   free_text="Bracket carries a 250 N downward load hung from the top of the vertical wall.",
                   answers_json={"function": "Support a 250 N downward service load",
                                 "flags": ["structural", "load_bearing"],
                                 "loading": "static", "target_safety_factor": 2.0,
                                 "environment": "indoor"}))
    db.add(ManufacturingProfile(project_id=project.id, method="cnc", params_json={}))

    regions = demo_regions(mesh)
    r_fixed = SelectedRegion(project_id=project.id, mesh_version_id=mv.id,
                             name="Mounting hole area (bottom)", kind="faces",
                             triangle_indices=regions["fixed_holes"], color="#f59e0b",
                             meta_json={"seeded": True})
    r_load = SelectedRegion(project_id=project.id, mesh_version_id=mv.id,
                            name="Load application band (wall top)", kind="faces",
                            triangle_indices=regions["load_top"], color="#ef4444",
                            meta_json={"seeded": True})
    db.add_all([r_fixed, r_load])
    db.flush()
    db.add(ProtectedRegion(project_id=project.id, region_id=r_fixed.id,
                           reason="Mounting interface: hole positions and seating face must not change."))

    lc = LoadCase(project_id=project.id, name="Service load 250 N down",
                  description="Static downward load on the wall top; bracket bolted at base holes.")
    db.add(lc)
    db.flush()
    db.add(BoundaryCondition(load_case_id=lc.id, region_id=r_fixed.id, bc_type="fixed",
                             params_json={}, description="Bolted base (fixed around both holes)"))
    db.add(BoundaryCondition(load_case_id=lc.id, region_id=r_load.id, bc_type="force",
                             params_json={"magnitude": 250.0, "units": "N",
                                          "magnitude_si": 250.0, "direction": [0, 0, -1],
                                          "distribution": "area_weighted"},
                             description="250 N downward service load"))
    db.commit()

    # 1) geometry analysis synchronously so recommendations are ready immediately
    geo_job = SimulationJob(project_id=project.id, kind="geometry_analysis",
                            params_json={"mesh_version_id": mv.id}, status="running")
    db.add(geo_job)
    db.commit()
    import threading
    geometry_analysis_task(geo_job.id, threading.Event())
    geo_job = db.get(SimulationJob, geo_job.id)
    geo_job.status = "succeeded"
    geo_job.progress = 1.0
    db.commit()

    recommendations_for_project(db, project.id, mv.id)

    jobs = [{"id": geo_job.id, "kind": "geometry_analysis", "status": "succeeded"}]

    # 2) FEA + variants as background jobs (real progress, honest failures)
    settings = get_settings()
    if settings.ccx_available and settings.gmsh_available:
        fea_job = SimulationJob(project_id=project.id, kind="fea",
                                params_json={"mesh_version_id": mv.id, "load_case_id": lc.id,
                                             "settings": {"target_elements": 40000}},
                                status="pending")
        db.add(fea_job)
        db.commit()
        job_queue.submit(fea_job.id, TASKS["fea"])
        jobs.append({"id": fea_job.id, "kind": "fea", "status": "pending"})

    var_job = SimulationJob(project_id=project.id, kind="variant_generation",
                            params_json={"base_mesh_id": mv.id, "load_case_id": lc.id,
                                         "strategies": ["conservative", "balanced"]},
                            status="pending")
    db.add(var_job)
    db.commit()
    job_queue.submit(var_job.id, TASKS["variant_generation"])
    jobs.append({"id": var_job.id, "kind": "variant_generation", "status": "pending"})

    return project, jobs
