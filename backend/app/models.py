"""SQLAlchemy ORM models.

Provenance rule: every derived artifact records its parent, creation time,
software version, processing parameters, input/output checksums, status and
error information. `ArtifactMixin` implements that contract.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .version import APP_VERSION


def _uuid() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(UTC)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ArtifactMixin(TimestampMixin):
    """Reproducibility metadata shared by all derived artifacts."""
    software_version: Mapped[str] = mapped_column(String(32), default=APP_VERSION)
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)   # processing parameters
    input_checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    output_checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="pending")  # pending|running|succeeded|failed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(255), unique=True, default="local@partforge.dev")
    display_name: Mapped[str] = mapped_column(String(255), default="Local User")


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    # Units are NEVER guessed silently: unit stays NULL until the user confirms.
    unit: Mapped[str | None] = mapped_column(String(8), nullable=True)  # mm|cm|m|in
    unit_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    settings_json: Mapped[dict] = mapped_column(JSON, default=dict)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)

    assets: Mapped[list[UploadedAsset]] = relationship(back_populates="project", cascade="all, delete-orphan")
    meshes: Mapped[list[MeshVersion]] = relationship(back_populates="project", cascade="all, delete-orphan")


class UploadedAsset(Base, ArtifactMixin):
    __tablename__ = "uploaded_assets"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    original_filename: Mapped[str] = mapped_column(String(512))
    stored_filename: Mapped[str] = mapped_column(String(512))
    path: Mapped[str] = mapped_column(String(1024))
    size_bytes: Mapped[int] = mapped_column(Integer)
    file_format: Mapped[str] = mapped_column(String(16))  # stl_binary|stl_ascii|obj|3mf
    sha256: Mapped[str] = mapped_column(String(64))

    project: Mapped[Project] = relationship(back_populates="assets")


class MeshVersion(Base, ArtifactMixin):
    __tablename__ = "mesh_versions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    parent_mesh_id: Mapped[str | None] = mapped_column(ForeignKey("mesh_versions.id"), nullable=True)
    asset_id: Mapped[str | None] = mapped_column(ForeignKey("uploaded_assets.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), default="original")  # original|repaired|variant
    label: Mapped[str] = mapped_column(String(255), default="")
    path: Mapped[str] = mapped_column(String(1024))
    triangle_count: Mapped[int] = mapped_column(Integer, default=0)
    vertex_count: Mapped[int] = mapped_column(Integer, default=0)
    watertight: Mapped[bool] = mapped_column(Boolean, default=False)

    project: Mapped[Project] = relationship(back_populates="meshes")


class GeometryAnalysis(Base, ArtifactMixin):
    __tablename__ = "geometry_analyses"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    mesh_version_id: Mapped[str] = mapped_column(ForeignKey("mesh_versions.id"))
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    health_json: Mapped[dict] = mapped_column(JSON, default=dict)
    features_json: Mapped[dict] = mapped_column(JSON, default=dict)
    manufacturing_json: Mapped[dict] = mapped_column(JSON, default=dict)
    warnings_json: Mapped[list] = mapped_column(JSON, default=list)
    fields_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)  # per-vertex scalar fields


class Material(Base, TimestampMixin):
    __tablename__ = "materials"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    key: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(32))  # polymer|metal|composite|user
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=True)
    isotropic: Mapped[bool] = mapped_column(Boolean, default=True)
    # SI units throughout: kg/m3, Pa, 1/K, degC
    properties_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(Text, default="")
    notes: Mapped[str] = mapped_column(Text, default="")


class MaterialOverride(Base, TimestampMixin):
    __tablename__ = "material_overrides"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    material_id: Mapped[str] = mapped_column(ForeignKey("materials.id"))
    overrides_json: Mapped[dict] = mapped_column(JSON, default=dict)  # property -> user value (SI)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)   # user confirmed critical properties


class UseCase(Base, TimestampMixin):
    __tablename__ = "use_cases"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), unique=True)
    preset: Mapped[str | None] = mapped_column(String(64), nullable=True)
    free_text: Mapped[str] = mapped_column(Text, default="")
    answers_json: Mapped[dict] = mapped_column(JSON, default=dict)  # structured questionnaire answers


class ManufacturingProfile(Base, TimestampMixin):
    __tablename__ = "manufacturing_profiles"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"), unique=True)
    method: Mapped[str] = mapped_column(String(32), default="unspecified")  # fdm|sla|sls|cnc|casting|sheet|unspecified
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)  # layer height, infill, orientation, anisotropy factor...


class SelectedRegion(Base, TimestampMixin):
    __tablename__ = "selected_regions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    mesh_version_id: Mapped[str] = mapped_column(ForeignKey("mesh_versions.id"))
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(32), default="faces")  # faces|detected_patch
    triangle_indices: Mapped[list] = mapped_column(JSON, default=list)
    meta_json: Mapped[dict] = mapped_column(JSON, default=dict)  # patch type, fitted geometry, area, centroid
    color: Mapped[str] = mapped_column(String(16), default="#38bdf8")


class ProtectedRegion(Base, TimestampMixin):
    __tablename__ = "protected_regions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    region_id: Mapped[str] = mapped_column(ForeignKey("selected_regions.id"))
    reason: Mapped[str] = mapped_column(Text, default="")


class LoadCase(Base, TimestampMixin):
    __tablename__ = "load_cases"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    name: Mapped[str] = mapped_column(String(255), default="Load case 1")
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    boundary_conditions: Mapped[list[BoundaryCondition]] = relationship(
        back_populates="load_case", cascade="all, delete-orphan"
    )


class BoundaryCondition(Base, TimestampMixin):
    __tablename__ = "boundary_conditions"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    load_case_id: Mapped[str] = mapped_column(ForeignKey("load_cases.id"))
    region_id: Mapped[str | None] = mapped_column(ForeignKey("selected_regions.id"), nullable=True)
    bc_type: Mapped[str] = mapped_column(String(32))  # fixed|pinned|roller|force|pressure|bearing|torque|gravity|rotation|temperature|symmetry
    # magnitude/direction/units/distribution/description; SI stored, entered units recorded
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)
    description: Mapped[str] = mapped_column(Text, default="")

    load_case: Mapped[LoadCase] = relationship(back_populates="boundary_conditions")


class SimulationJob(Base, ArtifactMixin):
    """Background job record. kind: geometry_analysis | fea | variant_generation | report."""
    __tablename__ = "simulation_jobs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    kind: Mapped[str] = mapped_column(String(32))
    progress: Mapped[float] = mapped_column(Float, default=0.0)  # 0..1, real stages only
    message: Mapped[str] = mapped_column(Text, default="")
    log_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    result_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)  # id of produced entity


class SimulationMesh(Base, ArtifactMixin):
    __tablename__ = "simulation_meshes"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("simulation_jobs.id"))
    mesh_version_id: Mapped[str] = mapped_column(ForeignKey("mesh_versions.id"))
    path: Mapped[str] = mapped_column(String(1024))
    node_count: Mapped[int] = mapped_column(Integer, default=0)
    element_count: Mapped[int] = mapped_column(Integer, default=0)
    element_type: Mapped[str] = mapped_column(String(16), default="C3D10")
    quality_json: Mapped[dict] = mapped_column(JSON, default=dict)


class SimulationResult(Base, ArtifactMixin):
    __tablename__ = "simulation_results"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    job_id: Mapped[str] = mapped_column(ForeignKey("simulation_jobs.id"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    mesh_version_id: Mapped[str] = mapped_column(ForeignKey("mesh_versions.id"))
    load_case_id: Mapped[str] = mapped_column(ForeignKey("load_cases.id"))
    summary_json: Mapped[dict] = mapped_column(JSON, default=dict)   # maxima, percentiles, FoS, validity gates
    assumptions_json: Mapped[list] = mapped_column(JSON, default=list)
    fields_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)  # viz surface + nodal fields
    deck_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    solver_log_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)  # demo-mode mock, clearly labeled


class Recommendation(Base, TimestampMixin):
    __tablename__ = "recommendations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    mesh_version_id: Mapped[str] = mapped_column(ForeignKey("mesh_versions.id"))
    rule_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(64))
    severity: Mapped[str] = mapped_column(String(16))     # info|low|medium|high|critical
    confidence: Mapped[str] = mapped_column(String(16))   # low|medium|high
    problem: Mapped[str] = mapped_column(Text)
    evidence_json: Mapped[dict] = mapped_column(JSON, default=dict)
    location_json: Mapped[dict] = mapped_column(JSON, default=dict)  # position, triangle indices
    rationale: Mapped[str] = mapped_column(Text, default="")
    proposed_change: Mapped[str] = mapped_column(Text, default="")
    expected_benefit: Mapped[str] = mapped_column(Text, default="")
    possible_downside: Mapped[str] = mapped_column(Text, default="")
    manufacturing_impact: Mapped[str] = mapped_column(Text, default="")
    validation_required: Mapped[str] = mapped_column(Text, default="")
    auto_generatable: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_op_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # operation template if generatable
    assumptions_json: Mapped[list] = mapped_column(JSON, default=list)
    state: Mapped[str] = mapped_column(String(16), default="open")  # open|accepted|dismissed


class DesignVariant(Base, ArtifactMixin):
    __tablename__ = "design_variants"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    base_mesh_id: Mapped[str] = mapped_column(ForeignKey("mesh_versions.id"))
    result_mesh_id: Mapped[str | None] = mapped_column(ForeignKey("mesh_versions.id"), nullable=True)
    strategy: Mapped[str] = mapped_column(String(32))  # conservative|balanced|performance
    name: Mapped[str] = mapped_column(String(255), default="")
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)
    comparison_json: Mapped[dict] = mapped_column(JSON, default=dict)
    approval: Mapped[str] = mapped_column(String(16), default="pending")  # pending|approved|rejected


class DesignOperation(Base, ArtifactMixin):
    __tablename__ = "design_operations"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    variant_id: Mapped[str] = mapped_column(ForeignKey("design_variants.id"))
    seq: Mapped[int] = mapped_column(Integer, default=0)
    op_type: Mapped[str] = mapped_column(String(48))
    op_json: Mapped[dict] = mapped_column(JSON, default=dict)  # full validated operation document
    recommendation_id: Mapped[str | None] = mapped_column(ForeignKey("recommendations.id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")


class Comparison(Base, TimestampMixin):
    __tablename__ = "comparisons"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    baseline_mesh_id: Mapped[str] = mapped_column(ForeignKey("mesh_versions.id"))
    variant_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    metrics_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Report(Base, ArtifactMixin):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    path: Mapped[str | None] = mapped_column(String(1024), nullable=True)


class Snapshot(Base, TimestampMixin):
    """PNG viewport screenshots uploaded by the client for reports."""
    __tablename__ = "snapshots"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    label: Mapped[str] = mapped_column(String(255), default="")
    path: Mapped[str] = mapped_column(String(1024))


class AuditEvent(Base, TimestampMixin):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    project_id: Mapped[str | None] = mapped_column(ForeignKey("projects.id"), nullable=True)
    actor: Mapped[str] = mapped_column(String(64), default="local")
    action: Mapped[str] = mapped_column(String(128))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
