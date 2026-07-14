"""Tests for the deterministic calculation engine (SymPy + Pint)."""

import math

import pytest

from app.evaluator import evaluate, parse_quantity, CalcError


def test_energy_balance_kelvin():
    # Q = m*Cp*dT for 2 kg water heated 60 K.
    res = evaluate(
        "m*Cp*(T2-T1)",
        {"m": "2 kg", "Cp": "4186 J/(kg*K)", "T1": "293.15 K", "T2": "353.15 K"},
        expectedUnit="J",
    )
    assert res.ok
    assert res.dimensionallyConsistent is True
    assert res.value == pytest.approx(2 * 4186 * 60, rel=1e-6)
    assert res.unit == "J"


def test_dimensional_inconsistency_addition():
    # Adding a length and a time is dimensionally invalid.
    res = evaluate("a + b", {"a": "3 m", "b": "2 s"})
    assert res.ok is False
    assert res.dimensionallyConsistent is False
    assert "inconsist" in res.message.lower() or "dimension" in res.message.lower()


def test_expected_unit_mismatch_flagged():
    # Force in newtons is not energy in joules.
    res = evaluate("m*a", {"m": "10 kg", "a": "9.81 m/s^2"}, expectedUnit="J")
    assert res.ok
    assert res.dimensionallyConsistent is False
    assert "not compatible" in res.message.lower()


def test_unit_natural_output():
    res = evaluate("V/R", {"V": "12 V", "R": "4 ohm"}, expectedUnit="A")
    assert res.ok
    assert res.value == pytest.approx(3.0)
    assert res.unit == "A"


def test_bernoulli_velocity_sqrt():
    # v = sqrt(2*g*h)
    res = evaluate("sqrt(2*g*h)", {"g": "9.81 m/s^2", "h": "5 m"}, expectedUnit="m/s")
    assert res.ok
    assert res.value == pytest.approx(math.sqrt(2 * 9.81 * 5), rel=1e-6)


def test_unknown_symbol_rejected():
    res = evaluate("x + y", {"x": "1 m"})
    assert res.ok is False
    assert "unknown symbol" in res.message.lower()


def test_disallowed_attribute_access_rejected():
    # No attribute access / arbitrary code execution.
    res = evaluate("m.__class__", {"m": "1 kg"})
    assert res.ok is False


def test_disallowed_function_rejected():
    res = evaluate("eval('2')", {})
    assert res.ok is False


def test_celsius_warning():
    res = evaluate("T", {"T": "25 degC"}, expectedUnit="degC")
    assert any("celsius" in w.lower() for w in res.warnings)


def test_pressure_gauge_warning():
    res = evaluate("P", {"P": "30 psi"}, expectedUnit="psi")
    assert any("gauge" in w.lower() for w in res.warnings)


def test_parse_quantity_bad_unit():
    with pytest.raises(CalcError):
        parse_quantity("5 zorks")


def test_power_expression():
    # Kinetic energy 0.5*m*v^2
    res = evaluate("0.5*m*v**2", {"m": "2 kg", "v": "3 m/s"}, expectedUnit="J")
    assert res.ok
    assert res.value == pytest.approx(9.0)
