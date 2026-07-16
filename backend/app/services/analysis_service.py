"""Orchestrates the Tier-A geometry-only analysis and persists field data."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import trimesh

from .features import detect_features
from .geometry import compute_health, compute_metrics, sharp_edge_field
from .overhang import analyze_overhangs
from .thickness import estimate_thickness


def run_geometry_analysis(mesh: trimesh.Trimesh, unit: str | None, density: float | None,
                          build_direction: list[float] | None,
                          fields_out: Path,
                          progress=lambda f, m: None) -> dict:
    progress(0.05, "Computing mesh metrics")
    metrics = compute_metrics(mesh, unit, density)
    progress(0.2, "Checking mesh health")
    health = compute_health(mesh)
    progress(0.35, "Estimating wall thickness (ray casting)")
    thick = estimate_thickness(mesh)
    progress(0.6, "Analyzing overhangs and cavities")
    over = analyze_overhangs(mesh, build_direction)
    progress(0.75, "Detecting geometric features")
    feats = detect_features(mesh)
    progress(0.9, "Building heat-map fields")
    sharp = sharp_edge_field(mesh)

    fields_out.parent.mkdir(parents=True, exist_ok=True)
    thickness_pv = thick.pop("per_vertex", None)
    thick.pop("per_face", None)
    overhang_pv = over.pop("per_vertex", None)
    np.savez_compressed(
        fields_out,
        thickness=np.nan_to_num(thickness_pv, nan=-1.0) if thickness_pv is not None else np.zeros(0),
        overhang=overhang_pv if overhang_pv is not None else np.zeros(0),
        sharpness=sharp,
    )

    warnings = list(health.get("issues", []))
    if thick.get("ok") and metrics.get("unit"):
        pass  # thresholds are applied by the rules engine with user context
    return {
        "metrics": metrics,
        "health": health,
        "thickness": thick,
        "overhang": over,
        "features": feats,
        "warnings": warnings,
        "fields_path": str(fields_out),
    }
