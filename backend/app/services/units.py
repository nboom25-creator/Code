"""Unit handling.

Mesh files carry no units. Geometry is kept in the file's native coordinates
("mesh units") and converted to SI only after the user has explicitly
confirmed the unit. We may *suggest* a unit from bounding-box size, but the
suggestion is labeled as an estimate and never applied silently.
"""
from __future__ import annotations

LENGTH_TO_M = {"mm": 1e-3, "cm": 1e-2, "m": 1.0, "in": 0.0254}

FORCE_TO_N = {"N": 1.0, "kN": 1e3, "lbf": 4.4482216153, "kgf": 9.80665}
PRESSURE_TO_PA = {"Pa": 1.0, "kPa": 1e3, "MPa": 1e6, "GPa": 1e9, "psi": 6894.757293, "bar": 1e5}
TORQUE_TO_NM = {"N·m": 1.0, "Nm": 1.0, "N·mm": 1e-3, "Nmm": 1e-3, "lbf·ft": 1.3558179483, "lbf·in": 0.1129848290}


def length_scale_to_m(unit: str) -> float:
    if unit not in LENGTH_TO_M:
        raise ValueError(f"unsupported length unit: {unit}")
    return LENGTH_TO_M[unit]


def convert_force(value: float, unit: str) -> float:
    if unit not in FORCE_TO_N:
        raise ValueError(f"unsupported force unit: {unit}")
    return value * FORCE_TO_N[unit]


def convert_pressure(value: float, unit: str) -> float:
    if unit not in PRESSURE_TO_PA:
        raise ValueError(f"unsupported pressure unit: {unit}")
    return value * PRESSURE_TO_PA[unit]


def convert_torque(value: float, unit: str) -> float:
    if unit not in TORQUE_TO_NM:
        raise ValueError(f"unsupported torque unit: {unit}")
    return value * TORQUE_TO_NM[unit]


def suggest_unit_from_bbox(extents_mesh_units: list[float]) -> dict:
    """Heuristic suggestion only. Returned with an explicit 'estimate' label."""
    longest = max(extents_mesh_units) if extents_mesh_units else 0.0
    if longest <= 0:
        return {"suggestion": None, "reason": "empty geometry"}
    if 1.0 <= longest <= 2000.0:
        s = "mm"
        reason = f"Longest bounding-box edge is {longest:.1f} units; typical parts are 1–2000 mm."
    elif longest < 1.0:
        s = "m"
        reason = f"Longest edge is {longest:.4f} units; if metres this is {longest * 1000:.1f} mm."
    else:
        s = "mm"
        reason = f"Longest edge is {longest:.0f} units; very large — confirm carefully."
    return {
        "suggestion": s,
        "reason": reason,
        "estimate": True,
        "note": "Units cannot be read from an STL file. Please confirm before analysis.",
    }
