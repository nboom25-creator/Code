import math

from glidercalc import hydrodynamics as hd


def test_glide_ratio_matches_cl_over_cd():
    res = hd.glide(net_force_n=10.0, wing_area_m2=0.1, cl=0.5, cd0=0.1, k=0.3)
    assert math.isclose(res.glide_ratio, res.cl / res.cd, rel_tol=1e-12)
    # tan(angle) should equal D/L = 1/glide_ratio
    assert math.isclose(math.tan(math.radians(res.glide_angle_deg)),
                        1.0 / res.glide_ratio, rel_tol=1e-9)


def test_best_glide_cl_maximises_ratio():
    cd0, k = 0.1, 0.3
    cl_best = hd.best_glide_cl(cd0, k)
    best = hd.glide(10.0, 0.1, cl_best, cd0, k)
    # perturb either side: ratio should not be higher
    lower = hd.glide(10.0, 0.1, cl_best * 0.9, cd0, k)
    higher = hd.glide(10.0, 0.1, cl_best * 1.1, cd0, k)
    assert best.glide_ratio >= lower.glide_ratio
    assert best.glide_ratio >= higher.glide_ratio
    assert math.isclose(best.glide_ratio, hd.max_glide_ratio(cd0, k), rel_tol=1e-9)


def test_speed_components_consistent():
    res = hd.glide(20.0, 0.12, 0.6, 0.08, 0.25)
    v2 = res.horizontal_speed_mps ** 2 + res.vertical_speed_mps ** 2
    assert math.isclose(math.sqrt(v2), res.speed_mps, rel_tol=1e-9)


def test_perpendicular_force_balance():
    # F_net * cos(gamma) should equal lift = 0.5 rho V^2 S C_L
    rho = 1025.0
    res = hd.glide(15.0, 0.1, 0.5, 0.1, 0.3, water_density=rho)
    gamma = math.radians(res.glide_angle_deg)
    lift = 0.5 * rho * res.speed_mps ** 2 * res.wing_area_m2 * res.cl
    assert math.isclose(lift, res.net_force_n * math.cos(gamma), rel_tol=1e-9)
