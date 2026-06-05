import math

from glidercalc import pressure_hull as ph


def test_pressure_depth_round_trip():
    p = ph.pressure_at_depth(200.0)
    d = ph.depth_for_pressure(p)
    assert math.isclose(d, 200.0, rel_tol=1e-12)


def test_cylinder_hoop_stress_formula():
    res = ph.analyze("cylinder", radius_m=0.1, thickness_m=0.006, depth_m=200,
                     yield_strength_pa=276e6, youngs_modulus_pa=69e9)
    expected = res.pressure_pa * 0.1 / 0.006
    assert math.isclose(res.hoop_stress_pa, expected, rel_tol=1e-12)


def test_yield_safety_factor_consistent():
    res = ph.analyze("cylinder", 0.1, 0.006, 200, 276e6, 69e9)
    assert math.isclose(res.yield_safety_factor,
                        res.yield_strength_pa / res.hoop_stress_pa, rel_tol=1e-12)


def test_thicker_wall_survives_deeper():
    thin = ph.analyze("cylinder", 0.1, 0.004, 200, 276e6, 69e9)
    thick = ph.analyze("cylinder", 0.1, 0.008, 200, 276e6, 69e9)
    assert thick.limiting_collapse_depth_m > thin.limiting_collapse_depth_m


def test_sphere_is_stronger_than_cylinder_same_dims():
    cyl = ph.analyze("cylinder", 0.1, 0.006, 200, 276e6, 69e9)
    sph = ph.analyze("sphere", 0.1, 0.006, 200, 276e6, 69e9)
    assert sph.yield_safety_factor > cyl.yield_safety_factor
