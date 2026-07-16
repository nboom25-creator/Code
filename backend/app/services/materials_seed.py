"""Built-in material catalog.

Values are REPRESENTATIVE, room-temperature figures compiled from public
datasheets and engineering handbooks. They vary by supplier, grade, process
and (for printed polymers) print parameters — every UI surface labels them as
estimates, and critical properties must be confirmed or overridden by the
user before FEA safety factors are reported.

Units (SI): density kg/m^3, moduli/strengths Pa, CTE 1/K, temperature degC.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import Material

MPa = 1e6
GPa = 1e9

BUILTIN_MATERIALS: list[dict] = [
    dict(key="pla", name="PLA (generic FDM)", category="polymer", isotropic=False,
         properties=dict(density=1240, elastic_modulus=3.5 * GPa, poisson_ratio=0.36,
                         yield_strength=50 * MPa, ultimate_tensile_strength=60 * MPa,
                         compressive_strength=80 * MPa, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=50,
                         thermal_expansion=6.8e-5),
         source="Representative generic-filament datasheet range",
         notes="Printed PLA is anisotropic; Z (layer) strength is often 50-80% of XY. Creeps under sustained load; low heat resistance."),
    dict(key="petg", name="PETG (generic FDM)", category="polymer", isotropic=False,
         properties=dict(density=1270, elastic_modulus=2.1 * GPa, poisson_ratio=0.37,
                         yield_strength=47 * MPa, ultimate_tensile_strength=53 * MPa,
                         compressive_strength=55 * MPa, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=70,
                         thermal_expansion=6.0e-5),
         source="Representative generic-filament datasheet range",
         notes="Tougher than PLA, better temperature resistance, more layer-adhesion dependent."),
    dict(key="abs", name="ABS (generic FDM)", category="polymer", isotropic=False,
         properties=dict(density=1040, elastic_modulus=2.2 * GPa, poisson_ratio=0.35,
                         yield_strength=40 * MPa, ultimate_tensile_strength=44 * MPa,
                         compressive_strength=65 * MPa, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=85,
                         thermal_expansion=9.0e-5),
         source="Representative generic-filament datasheet range",
         notes="Good impact resistance; UV-sensitive; strong print-parameter dependence."),
    dict(key="nylon_pa12", name="Nylon PA12", category="polymer", isotropic=False,
         properties=dict(density=1010, elastic_modulus=1.7 * GPa, poisson_ratio=0.39,
                         yield_strength=43 * MPa, ultimate_tensile_strength=48 * MPa,
                         compressive_strength=None, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=100,
                         thermal_expansion=1.0e-4),
         source="Representative PA12 datasheet range (SLS/FDM)",
         notes="Tough, wear-resistant, absorbs moisture (properties drop when wet)."),
    dict(key="pc", name="Polycarbonate", category="polymer", isotropic=False,
         properties=dict(density=1200, elastic_modulus=2.3 * GPa, poisson_ratio=0.37,
                         yield_strength=60 * MPa, ultimate_tensile_strength=66 * MPa,
                         compressive_strength=80 * MPa, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=115,
                         thermal_expansion=6.9e-5),
         source="Representative datasheet range",
         notes="High strength/heat for a printable polymer; prone to warping in FDM."),
    dict(key="tpu", name="TPU 95A", category="polymer", isotropic=False,
         properties=dict(density=1210, elastic_modulus=0.026 * GPa, poisson_ratio=0.48,
                         yield_strength=8.6 * MPa, ultimate_tensile_strength=26 * MPa,
                         compressive_strength=None, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=60,
                         thermal_expansion=1.5e-4),
         source="Representative TPU-95A datasheet range",
         notes="Flexible elastomer. Linear-elastic FEA is a poor model for large strains — treat results as rough."),
    dict(key="pa_cf", name="Carbon-fiber-filled nylon (PA-CF)", category="composite", isotropic=False,
         properties=dict(density=1170, elastic_modulus=6.0 * GPa, poisson_ratio=0.38,
                         yield_strength=60 * MPa, ultimate_tensile_strength=85 * MPa,
                         compressive_strength=None, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=120,
                         thermal_expansion=3.0e-5),
         source="Representative chopped-CF nylon datasheet range",
         notes="Strongly anisotropic: fiber alignment follows extrusion direction; Z strength much lower."),
    dict(key="al_6061_t6", name="Aluminum 6061-T6", category="metal", isotropic=True,
         properties=dict(density=2700, elastic_modulus=68.9 * GPa, poisson_ratio=0.33,
                         yield_strength=276 * MPa, ultimate_tensile_strength=310 * MPa,
                         compressive_strength=276 * MPa, shear_strength=207 * MPa,
                         fatigue_data="~96.5 MPa at 5e8 cycles (typical handbook value)",
                         max_service_temp_c=150, thermal_expansion=2.36e-5),
         source="MMPDS/handbook typical values",
         notes="Common structural aluminum. Weld zones are weaker (typ. ~165 MPa yield)."),
    dict(key="al_7075_t6", name="Aluminum 7075-T6", category="metal", isotropic=True,
         properties=dict(density=2810, elastic_modulus=71.7 * GPa, poisson_ratio=0.33,
                         yield_strength=503 * MPa, ultimate_tensile_strength=572 * MPa,
                         compressive_strength=503 * MPa, shear_strength=331 * MPa,
                         fatigue_data="~159 MPa at 5e8 cycles (typical handbook value)",
                         max_service_temp_c=120, thermal_expansion=2.36e-5),
         source="MMPDS/handbook typical values",
         notes="High strength; poorer corrosion resistance and weldability than 6061."),
    dict(key="steel_mild", name="Mild steel (A36 / S235)", category="metal", isotropic=True,
         properties=dict(density=7850, elastic_modulus=200 * GPa, poisson_ratio=0.29,
                         yield_strength=250 * MPa, ultimate_tensile_strength=400 * MPa,
                         compressive_strength=250 * MPa, shear_strength=145 * MPa,
                         fatigue_data="endurance limit ~ 0.4-0.5 UTS for polished specimens",
                         max_service_temp_c=350, thermal_expansion=1.2e-5),
         source="Handbook typical values (A36)",
         notes="Rusts without coating."),
    dict(key="ss_304", name="Stainless steel 304", category="metal", isotropic=True,
         properties=dict(density=8000, elastic_modulus=193 * GPa, poisson_ratio=0.29,
                         yield_strength=215 * MPa, ultimate_tensile_strength=505 * MPa,
                         compressive_strength=215 * MPa, shear_strength=None,
                         fatigue_data="~240 MPa at 1e6 cycles (typical)",
                         max_service_temp_c=425, thermal_expansion=1.73e-5),
         source="Handbook typical values (annealed)",
         notes="General-purpose stainless; susceptible to chloride pitting (prefer 316 in salt water)."),
    dict(key="ss_316", name="Stainless steel 316", category="metal", isotropic=True,
         properties=dict(density=8000, elastic_modulus=193 * GPa, poisson_ratio=0.27,
                         yield_strength=205 * MPa, ultimate_tensile_strength=515 * MPa,
                         compressive_strength=205 * MPa, shear_strength=None,
                         fatigue_data="~230 MPa at 1e6 cycles (typical)",
                         max_service_temp_c=425, thermal_expansion=1.6e-5),
         source="Handbook typical values (annealed)",
         notes="Marine-grade stainless; better chloride resistance than 304."),
    dict(key="ti_6al_4v", name="Titanium Ti-6Al-4V", category="metal", isotropic=True,
         properties=dict(density=4430, elastic_modulus=113.8 * GPa, poisson_ratio=0.342,
                         yield_strength=880 * MPa, ultimate_tensile_strength=950 * MPa,
                         compressive_strength=970 * MPa, shear_strength=550 * MPa,
                         fatigue_data="~510 MPa at 1e7 cycles (typical, polished)",
                         max_service_temp_c=350, thermal_expansion=8.6e-6),
         source="Handbook typical values (annealed)",
         notes="Excellent strength-to-weight and corrosion resistance; expensive to machine."),
    dict(key="pom", name="Acetal / Delrin (POM)", category="polymer", isotropic=True,
         properties=dict(density=1410, elastic_modulus=3.1 * GPa, poisson_ratio=0.35,
                         yield_strength=71 * MPa, ultimate_tensile_strength=75 * MPa,
                         compressive_strength=110 * MPa, shear_strength=66 * MPa,
                         fatigue_data="~31 MPa at 1e7 cycles (typical homopolymer)",
                         max_service_temp_c=90, thermal_expansion=1.1e-4),
         source="Representative homopolymer datasheet",
         notes="Low friction, good fatigue for a polymer; machined POM is near-isotropic."),
    dict(key="hdpe", name="HDPE", category="polymer", isotropic=True,
         properties=dict(density=960, elastic_modulus=1.0 * GPa, poisson_ratio=0.42,
                         yield_strength=26 * MPa, ultimate_tensile_strength=31 * MPa,
                         compressive_strength=None, shear_strength=None,
                         fatigue_data="not available", max_service_temp_c=80,
                         thermal_expansion=1.3e-4),
         source="Representative datasheet range",
         notes="Chemically resistant, tough, creeps significantly under sustained load."),
]

CRITICAL_PROPERTIES = ["density", "elastic_modulus", "poisson_ratio", "yield_strength"]


def seed_materials(db: Session) -> int:
    added = 0
    for m in BUILTIN_MATERIALS:
        if db.query(Material).filter_by(key=m["key"]).first():
            continue
        db.add(Material(
            key=m["key"], name=m["name"], category=m["category"], isotropic=m["isotropic"],
            properties_json=m["properties"], source=m["source"], notes=m["notes"], is_builtin=True,
        ))
        added += 1
    db.commit()
    return added


def effective_properties(material: Material, overrides: dict | None,
                         manufacturing: dict | None) -> dict:
    """Merge base properties with user overrides, then apply printed-part
    knockdowns when the user provided a manufacturing profile that asks for it.

    Returns the merged dict plus an `adjustments` list describing every change
    so the assumptions can be reported verbatim.
    """
    props = dict(material.properties_json)
    adjustments: list[str] = []
    for k, v in (overrides or {}).items():
        if k in props or k in CRITICAL_PROPERTIES:
            props[k] = v
            adjustments.append(f"user override: {k} = {v}")

    mfg = manufacturing or {}
    if mfg.get("method") in ("fdm", "sla", "sls") and not material.isotropic:
        factor = mfg.get("layer_adhesion_factor")
        if factor is not None and 0 < float(factor) <= 1.0 and not mfg.get("treat_isotropic", False):
            f = float(factor)
            for k in ("yield_strength", "ultimate_tensile_strength"):
                if props.get(k):
                    props[k] = props[k] * f
                    adjustments.append(
                        f"printed-part knockdown: {k} x {f:.2f} (user layer-adhesion factor, worst-case Z direction)"
                    )
        elif mfg.get("treat_isotropic", False):
            adjustments.append("user chose to treat printed material as isotropic (approximation)")
        else:
            adjustments.append(
                "printed polymer with no layer-adhesion factor supplied: strengths NOT derated; "
                "Z-direction strength may be substantially lower than reported"
            )
    props["_adjustments"] = adjustments
    return props
