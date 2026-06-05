import math

from glidercalc import buoyancy, constants


def test_neutral_buoyancy_gives_zero_net_force():
    rho = constants.DEFAULT_WATER_DENSITY
    mass = 52.0
    vol = mass / rho  # exactly neutral
    res = buoyancy.analyze(mass, vol, rho)
    assert math.isclose(res.net_force_n, 0.0, abs_tol=1e-6)
    assert math.isclose(res.volume_to_neutral_m3, 0.0, abs_tol=1e-9)


def test_positive_buoyancy_when_lighter_than_water():
    rho = 1025.0
    mass = 50.0
    vol = 0.060  # displaces more than its mass -> floats
    res = buoyancy.analyze(mass, vol, rho)
    assert res.is_positively_buoyant
    assert res.net_force_n > 0


def test_ballast_volume_round_trip():
    rho = 1025.0
    force = buoyancy.buoyancy_force(0.001, rho)  # 1 litre of displacement
    vol = buoyancy.ballast_volume_for_force(force, rho)
    assert math.isclose(vol, 0.001, rel_tol=1e-9)
