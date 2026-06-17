import math

from glidercalc import water


def test_surface_density_at_zero_depth():
    assert math.isclose(water.seawater_density(0.0, 1025.0), 1025.0, rel_tol=1e-12)


def test_density_increases_with_depth():
    shallow = water.seawater_density(100.0)
    deep = water.seawater_density(1000.0)
    assert deep > shallow > water.seawater_density(0.0)


def test_gradient_from_compressibility_sign_and_scale():
    grad = water.density_gradient_from_compressibility(1025.0, 2.2e9)
    # ~0.0047 kg/m^3 per m for seawater
    assert 0.004 < grad < 0.006


def test_variable_density_pressure_exceeds_constant():
    # integrated pressure with increasing density beats rho_surface*g*d
    d = 1000.0
    p_var = water.pressure_at_depth(d, 1025.0)
    p_const = 1025.0 * 9.80665 * d
    assert p_var > p_const


def test_mean_density_is_midpoint_for_linear_model():
    grad = 0.005
    d = 800.0
    expected = 1025.0 + 0.5 * grad * d
    assert math.isclose(water.mean_density(d, 1025.0, gradient=grad), expected,
                        rel_tol=1e-12)


def test_explicit_gradient_overrides_compressibility():
    rho = water.seawater_density(500.0, 1025.0, gradient=0.0)
    assert math.isclose(rho, 1025.0, rel_tol=1e-12)
