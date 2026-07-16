"""Material catalog, project material selection, manufacturing profile, use case."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import ManufacturingProfile, Material, MaterialOverride, UseCase
from ..services.materials_seed import CRITICAL_PROPERTIES, effective_properties
from ..services.presets import QUESTIONNAIRE_FIELDS, USE_CASE_PRESETS
from .projects import _project

router = APIRouter()


def material_out(m: Material) -> dict:
    return {"id": m.id, "key": m.key, "name": m.name, "category": m.category,
            "isotropic": m.isotropic, "is_builtin": m.is_builtin,
            "properties": m.properties_json, "source": m.source, "notes": m.notes,
            "critical_properties": CRITICAL_PROPERTIES,
            "values_are_estimates": True}


@router.get("/materials")
def list_materials(db: Session = Depends(get_db)):
    rows = db.query(Material).order_by(Material.category, Material.name).all()
    return [material_out(m) for m in rows]


class MaterialIn(BaseModel):
    key: str = Field(min_length=2, max_length=64, pattern=r"^[a-z0-9_]+$")
    name: str
    category: str = "user"
    isotropic: bool = True
    properties: dict = Field(default_factory=dict)
    source: str = "user-defined"
    notes: str = ""


@router.post("/materials")
def create_material(body: MaterialIn, db: Session = Depends(get_db)):
    if db.query(Material).filter_by(key=body.key).first():
        raise HTTPException(409, f"material key '{body.key}' already exists")
    for prop in ("density", "elastic_modulus", "poisson_ratio"):
        v = body.properties.get(prop)
        if v is not None and (not isinstance(v, (int, float)) or v <= 0) and prop != "poisson_ratio":
            raise HTTPException(422, f"{prop} must be a positive number (SI units)")
    nu = body.properties.get("poisson_ratio")
    if nu is not None and not (-0.99 < float(nu) < 0.5):
        raise HTTPException(422, "poisson_ratio must be between -0.99 and 0.5")
    m = Material(key=body.key, name=body.name, category=body.category, isotropic=body.isotropic,
                 properties_json=body.properties, source=body.source, notes=body.notes,
                 is_builtin=False)
    db.add(m)
    db.commit()
    return material_out(m)


class ProjectMaterialIn(BaseModel):
    material_id: str
    overrides: dict = Field(default_factory=dict)
    confirmed: bool = False


@router.put("/projects/{project_id}/material")
def set_project_material(project_id: str, body: ProjectMaterialIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    mat = db.get(Material, body.material_id)
    if mat is None:
        raise HTTPException(404, "Material not found")
    for k, v in body.overrides.items():
        if not isinstance(v, (int, float)):
            raise HTTPException(422, f"override '{k}' must be numeric (SI units)")
        if k != "poisson_ratio" and v <= 0:
            raise HTTPException(422, f"override '{k}' must be positive")
    db.query(MaterialOverride).filter_by(project_id=p.id).delete()
    ov = MaterialOverride(project_id=p.id, material_id=mat.id, overrides_json=body.overrides,
                          confirmed=body.confirmed)
    db.add(ov)
    db.commit()
    return get_project_material_ep(project_id, db)


@router.get("/projects/{project_id}/material")
def get_project_material_ep(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    ov = db.query(MaterialOverride).filter_by(project_id=p.id).first()
    if ov is None:
        return None
    mat = db.get(Material, ov.material_id)
    mfg = db.query(ManufacturingProfile).filter_by(project_id=p.id).first()
    mfg_dict = {"method": mfg.method, **(mfg.params_json or {})} if mfg else None
    eff = effective_properties(mat, ov.overrides_json, mfg_dict)
    return {"material": material_out(mat), "overrides": ov.overrides_json,
            "confirmed": ov.confirmed, "effective_properties": eff}


class ManufacturingIn(BaseModel):
    method: str = Field(pattern="^(fdm|sla|sls|cnc|casting|sheet|unspecified)$")
    params: dict = Field(default_factory=dict)


@router.put("/projects/{project_id}/manufacturing")
def set_manufacturing(project_id: str, body: ManufacturingIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    factor = body.params.get("layer_adhesion_factor")
    if factor is not None and not (0 < float(factor) <= 1):
        raise HTTPException(422, "layer_adhesion_factor must be in (0, 1]")
    mfg = db.query(ManufacturingProfile).filter_by(project_id=p.id).first()
    if mfg is None:
        mfg = ManufacturingProfile(project_id=p.id)
        db.add(mfg)
    mfg.method = body.method
    mfg.params_json = body.params
    db.commit()
    return {"method": mfg.method, "params": mfg.params_json}


@router.get("/projects/{project_id}/manufacturing")
def get_manufacturing(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    mfg = db.query(ManufacturingProfile).filter_by(project_id=p.id).first()
    return {"method": mfg.method, "params": mfg.params_json} if mfg else None


@router.get("/presets")
def list_presets():
    return {"presets": USE_CASE_PRESETS, "questionnaire": [
        {"key": k, "label": lbl, "type": t} for k, lbl, t in QUESTIONNAIRE_FIELDS]}


class UseCaseIn(BaseModel):
    preset: str | None = None
    free_text: str = ""
    answers: dict = Field(default_factory=dict)


@router.put("/projects/{project_id}/usecase")
def set_usecase(project_id: str, body: UseCaseIn, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    if body.preset and body.preset not in USE_CASE_PRESETS:
        raise HTTPException(422, f"unknown preset '{body.preset}'")
    uc = db.query(UseCase).filter_by(project_id=p.id).first()
    if uc is None:
        uc = UseCase(project_id=p.id)
        db.add(uc)
    uc.preset = body.preset
    uc.free_text = body.free_text[:20000]
    uc.answers_json = body.answers
    db.commit()
    return {"preset": uc.preset, "free_text": uc.free_text, "answers": uc.answers_json,
            "note": "Presets suggest questions only; loads are never auto-populated."}


@router.get("/projects/{project_id}/usecase")
def get_usecase(project_id: str, db: Session = Depends(get_db)):
    p = _project(db, project_id)
    uc = db.query(UseCase).filter_by(project_id=p.id).first()
    if uc is None:
        return None
    return {"preset": uc.preset, "free_text": uc.free_text, "answers": uc.answers_json}
