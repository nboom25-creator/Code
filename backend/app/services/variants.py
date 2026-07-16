"""Design-variant generation.

Variants apply validated operation graphs derived from auto-generatable
recommendations to a COPY of the base mesh, then re-run geometry checks (and
FEA when a load case exists) and score themselves against the baseline with
evidence-based metrics. Improvement claims are only made where backed by a
re-run analysis or an explicit geometry rule.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

import numpy as np
import trimesh

from .geometry import compute_health, compute_metrics
from .operations import (
    OperationError,
    apply_operation,
    validate_operation,
    validate_result,
)
from .thickness import estimate_thickness

STRATEGIES = {
    "conservative": {"scale": 0.7, "max_ops": 2, "bbox_growth": 0.10,
                     "description": "Smallest geometry change, manufacturability first."},
    "balanced": {"scale": 1.0, "max_ops": 4, "bbox_growth": 0.20,
                 "description": "Moderate changes for strength-to-weight."},
    "performance": {"scale": 1.4, "max_ops": 6, "bbox_growth": 0.30,
                    "description": "Aggressive reinforcement within envelope limits."},
}

_SCALABLE_KEYS = {"offset", "leg", "width", "height", "thickness", "offset_fraction_of_diag"}


@dataclass
class OpRecord:
    doc: dict
    status: str  # applied|failed|rejected
    error: str | None = None
    recommendation_id: str | None = None
    reason: str = ""


@dataclass
class VariantResult:
    strategy: str
    mesh: trimesh.Trimesh | None
    ops: list[OpRecord] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)
    error: str | None = None


def build_ops_from_recommendations(recs: list[dict], strategy: str,
                                   protected_tri: list[int]) -> list[dict]:
    cfg = STRATEGIES[strategy]
    docs: list[dict] = []
    sev_order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    usable = [r for r in recs if r.get("auto_generatable") and r.get("auto_op")]
    usable.sort(key=lambda r: sev_order.get(r.get("severity", "info"), 5))
    for rec in usable[: cfg["max_ops"]]:
        tmpl = rec["auto_op"]
        params = dict(tmpl.get("params", {}))
        for k in list(params):
            if k in _SCALABLE_KEYS and isinstance(params[k], (int, float)):
                params[k] = float(params[k]) * cfg["scale"]
        doc = {
            "op_type": tmpl["op_type"],
            **params,
            "reason": rec.get("proposed_change") or rec.get("title", ""),
            "recommendation_id": rec.get("id"),
            "protected_triangle_indices": list(protected_tri),
            "validation": {"max_bbox_growth_fraction": cfg["bbox_growth"]},
        }
        docs.append(doc)
    return docs


def generate_variant(
    base: trimesh.Trimesh,
    op_docs: list[dict],
    strategy: str,
    unit: str | None,
    unit_scale_to_m: float | None,
    density_kg_m3: float | None,
    progress: Callable[[float, str], None] = lambda f, m: None,
) -> VariantResult:
    result = VariantResult(strategy=strategy, mesh=None)
    if not op_docs:
        result.error = ("No auto-generatable operations are available for this strategy. "
                        "The open recommendations require manual/CAD changes.")
        return result

    current = base.copy()
    applied = 0
    for i, doc in enumerate(op_docs):
        progress(0.1 + 0.5 * i / max(len(op_docs), 1), f"Applying {doc.get('op_type')} ({i + 1}/{len(op_docs)})")
        rec_id = doc.get("recommendation_id")
        try:
            op = validate_operation(doc)
            candidate = apply_operation(current, op)
            problems = validate_result(current, candidate, op)
            if problems:
                result.ops.append(OpRecord(doc=doc, status="rejected",
                                           error="; ".join(problems), recommendation_id=rec_id,
                                           reason=doc.get("reason", "")))
                continue
            current = candidate
            applied += 1
            result.ops.append(OpRecord(doc=doc, status="applied", recommendation_id=rec_id,
                                       reason=doc.get("reason", "")))
        except OperationError as exc:
            result.ops.append(OpRecord(doc=doc, status="failed", error=str(exc),
                                       recommendation_id=rec_id, reason=doc.get("reason", "")))

    if applied == 0:
        result.error = ("All operations failed or were rejected by geometry validation; "
                        "no variant was produced. "
                        + "; ".join(f"{o.doc.get('op_type')}: {o.error}" for o in result.ops if o.error))
        return result

    progress(0.65, "Repairing and validating variant mesh")
    current.merge_vertices()
    current.update_faces(current.nondegenerate_faces())
    current.process(validate=True)
    trimesh.repair.fix_normals(current)
    if not current.is_watertight:
        result.error = "Variant mesh lost watertightness after operations; rejected."
        return result

    progress(0.75, "Re-running geometry checks on variant")
    metrics = compute_metrics(current, unit, density_kg_m3)
    health = compute_health(current)
    thick = estimate_thickness(current)
    result.mesh = current
    result.metrics = {
        "metrics": metrics,
        "health": {k: v for k, v in health.items() if k != "issues"},
        "issue_count": len(health.get("issues", [])),
        "min_wall_estimate": thick.get("min_wall_estimate") if thick.get("ok") else None,
    }
    return result


def comparison_table(baseline: dict, variants: list[dict]) -> dict:
    """baseline/variants: {name, metrics, fea_summary|None, overhang_fraction|None, warnings}"""
    def row(entry: dict) -> dict:
        m = entry.get("metrics", {})
        fea = entry.get("fea_summary") or {}
        mass = m.get("estimated_mass_kg")
        return {
            "name": entry.get("name"),
            "mass_kg": mass,
            "volume_m3": m.get("volume_m3"),
            "triangle_count": m.get("triangle_count"),
            "min_wall_estimate": entry.get("min_wall_estimate"),
            "max_displacement_m": fea.get("max_displacement_m"),
            "max_von_mises_pa": fea.get("max_von_mises_pa"),
            "p95_von_mises_pa": fea.get("p95_von_mises_pa"),
            "fos_yield": fea.get("factor_of_safety_yield"),
            "fos_valid": fea.get("fos_valid"),
            "geometry_warning_count": entry.get("warning_count"),
            "overhang_fraction": entry.get("overhang_fraction"),
        }

    base_row = row(baseline)
    rows = [base_row]
    for v in variants:
        r = row(v)
        deltas = {}
        for key in ("mass_kg", "max_displacement_m", "p95_von_mises_pa", "fos_yield"):
            b, a = base_row.get(key), r.get(key)
            if b and a and b != 0:
                deltas[key + "_change_pct"] = (a - b) / abs(b) * 100.0
        r["deltas"] = deltas
        both_fea_valid = bool(base_row.get("fos_valid")) and bool(r.get("fos_valid"))
        r["confidence"] = "high" if both_fea_valid else (
            "medium" if base_row.get("fos_yield") and r.get("fos_yield") else "low")
        r["score"] = _score(base_row, r, both_fea_valid)
        rows.append(r)
    return {
        "rows": rows,
        "score_explanation": (
            "Score = 45% strength change (FoS ratio when valid FEA exists on both designs; otherwise "
            "min-wall-thickness ratio as a geometric proxy) + 25% stiffness change (inverse max "
            "displacement) + 15% mass economy + 15% geometry-warning reduction. Purely comparative; "
            "not an engineering acceptance value."),
    }


def _score(base: dict, var: dict, fea_valid: bool) -> float | None:
    strength = None
    if fea_valid and base.get("fos_yield") and var.get("fos_yield"):
        strength = min(var["fos_yield"] / base["fos_yield"], 3.0) - 1.0
    elif base.get("min_wall_estimate") and var.get("min_wall_estimate"):
        strength = min(var["min_wall_estimate"] / base["min_wall_estimate"], 3.0) - 1.0
    stiffness = None
    if base.get("max_displacement_m") and var.get("max_displacement_m") and var["max_displacement_m"] > 0:
        stiffness = min(base["max_displacement_m"] / var["max_displacement_m"], 3.0) - 1.0
    mass = None
    if base.get("mass_kg") and var.get("mass_kg"):
        mass = -(var["mass_kg"] - base["mass_kg"]) / base["mass_kg"]  # lighter is positive
        mass = float(np.clip(mass, -1.0, 1.0))
    warn = None
    b, a = base.get("geometry_warning_count"), var.get("geometry_warning_count")
    if b is not None and a is not None:
        warn = float(np.clip((b - a) / max(b, 1), -1.0, 1.0))
    parts = [(0.45, strength), (0.25, stiffness), (0.15, mass), (0.15, warn)]
    avail = [(w, x) for w, x in parts if x is not None]
    if not avail:
        return None
    total_w = sum(w for w, _ in avail)
    return round(sum(w * x for w, x in avail) / total_w * 100.0, 1)
