import pytest

from app.services.units import (
    convert_force,
    convert_pressure,
    convert_torque,
    length_scale_to_m,
    suggest_unit_from_bbox,
)


def test_length_scales():
    assert length_scale_to_m("mm") == 1e-3
    assert length_scale_to_m("in") == pytest.approx(0.0254)
    with pytest.raises(ValueError):
        length_scale_to_m("furlong")


def test_force_conversion():
    assert convert_force(1, "kN") == 1000
    assert convert_force(1, "lbf") == pytest.approx(4.448, rel=1e-3)
    with pytest.raises(ValueError):
        convert_force(1, "stone")


def test_pressure_conversion():
    assert convert_pressure(1, "MPa") == 1e6
    assert convert_pressure(1, "psi") == pytest.approx(6894.76, rel=1e-4)


def test_torque_conversion():
    assert convert_torque(1000, "Nmm") == pytest.approx(1.0)
    assert convert_torque(1, "lbf·ft") == pytest.approx(1.3558, rel=1e-3)


def test_unit_suggestion_is_estimate():
    s = suggest_unit_from_bbox([60, 40, 55])
    assert s["suggestion"] == "mm"
    assert s["estimate"] is True
    assert "confirm" in s["note"].lower()
