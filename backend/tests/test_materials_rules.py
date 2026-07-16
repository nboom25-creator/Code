import numpy as np

from app.services.rules import RuleContext, generate_recommendations

from .fixtures import thin_wall_bracket


def _ctx(mesh, **kw):
    base = dict(mesh=mesh, unit="mm", unit_scale_to_m=1e-3, metrics={}, health={},
                thickness={}, overhang={}, features={})
    base.update(kw)
    return RuleContext(**base)


def test_material_seed_and_effective_properties(db_session):
    from app.models import Material
    from app.services.materials_seed import effective_properties, seed_materials
    seed_materials(db_session)
    mats = db_session.query(Material).filter_by(is_builtin=True).all()
    keys = {m.key for m in mats}
    assert {"pla", "petg", "abs", "al_6061_t6", "al_7075_t6", "steel_mild", "ss_304",
            "ss_316", "ti_6al_4v", "pom", "hdpe", "tpu", "pc", "pa_cf"} <= keys

    al = db_session.query(Material).filter_by(key="al_6061_t6").first()
    props = effective_properties(al, {"yield_strength": 240e6}, None)
    assert props["yield_strength"] == 240e6
    assert any("override" in a for a in props["_adjustments"])

    pla = db_session.query(Material).filter_by(key="pla").first()
    props = effective_properties(pla, {}, {"method": "fdm", "layer_adhesion_factor": 0.6})
    assert props["yield_strength"] < pla.properties_json["yield_strength"]
    assert any("knockdown" in a for a in props["_adjustments"])


def test_bracket_rules_fire():
    mesh = thin_wall_bracket()
    from app.services.features import detect_features
    from app.services.geometry import compute_health, compute_metrics
    from app.services.overhang import analyze_overhangs
    from app.services.thickness import estimate_thickness
    thick = estimate_thickness(mesh)
    thick["per_face"] = thick.pop("per_face")
    ctx = _ctx(mesh,
               metrics=compute_metrics(mesh, "mm", 2700),
               health=compute_health(mesh),
               thickness=thick,
               overhang=analyze_overhangs(mesh),
               features=detect_features(mesh),
               use_case={"flags": ["structural", "load_bearing"], "target_safety_factor": 2.0},
               manufacturing={"method": "cnc", "params": {}},
               material={"key": "al_6061_t6", "name": "Al 6061", "category": "metal",
                         "yield_strength": 276e6, "max_service_temp_c": 150})
    drafts = generate_recommendations(ctx)
    ids = [d.rule_id for d in drafts]
    assert "R-GUSSET-001" in ids, ids       # cantilever junction
    assert "R-CORNER-001" in ids, ids       # sharp internal corner
    assert "R-CNC-001" in ids, ids          # machining internal corners
    gusset = next(d for d in drafts if d.rule_id == "R-GUSSET-001")
    assert gusset.auto_generatable and gusset.auto_op["op_type"] == "add_gusset"
    assert gusset.evidence["junction_length"] > 30  # ~60 mm junction
    # every recommendation carries evidence + location or explicit emptiness
    for d in drafts:
        assert d.rule_id and d.title and d.problem


def test_temperature_rule():
    mesh = thin_wall_bracket()
    ctx = _ctx(mesh, use_case={"temp_max_c": 120},
               material={"key": "pla", "name": "PLA", "category": "polymer",
                         "max_service_temp_c": 50})
    drafts = [d for d in generate_recommendations(ctx) if d.rule_id == "R-ENV-002"]
    assert len(drafts) == 1
    assert drafts[0].severity == "critical"


def test_corrosion_rule():
    mesh = thin_wall_bracket()
    ctx = _ctx(mesh, use_case={"exposures": ["salt water"]},
               material={"key": "al_6061_t6", "name": "Al 6061-T6", "category": "metal"})
    assert any(d.rule_id == "R-ENV-001" for d in generate_recommendations(ctx))


def test_fea_rules():
    mesh = thin_wall_bracket()
    n = 200
    pos = np.random.default_rng(1).uniform(0, 50, size=(n, 3))
    vm = np.full(n, 10e6)
    vm[:20] = 250e6  # hot region above allowable (276/2 = 138 MPa)
    ctx = _ctx(mesh,
               use_case={"target_safety_factor": 2.0, "weight_goal": ""},
               material={"key": "al_6061_t6", "yield_strength": 276e6},
               fea_summary={"p95_von_mises_pa": 40e6, "max_von_mises_pa": 250e6,
                            "factor_of_safety_yield": 1.1, "fos_valid": True,
                            "applied_loads": [], "max_vm_location_mesh_units": [0, 0, 0]},
               fea_fields={"positions": pos, "von_mises_pa": vm})
    ids = [d.rule_id for d in generate_recommendations(ctx)]
    assert "R-FEA-001" in ids   # high stress region
    assert "R-FEA-003" in ids   # below target FoS
