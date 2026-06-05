import math

from glidercalc import energy


def test_pump_energy_scales_with_depth_and_volume():
    e1 = energy.pump_energy_per_inflation(0.0005, 100, efficiency=1.0,
                                          include_atmospheric=False)
    e2 = energy.pump_energy_per_inflation(0.0005, 200, efficiency=1.0,
                                          include_atmospheric=False)
    assert math.isclose(e2, 2 * e1, rel_tol=1e-12)


def test_range_per_cycle_formula():
    res = energy.analyze(battery_energy_j=200 * 3600, ballast_volume_m3=0.0005,
                         depth_band_m=200, glide_ratio=3.0,
                         horizontal_speed_mps=0.3)
    assert math.isclose(res.range_per_cycle_m, 2 * 200 * 3.0, rel_tol=1e-12)


def test_more_battery_gives_more_range():
    small = energy.analyze(100 * 3600, 0.0005, 200, 3.0, 0.3)
    big = energy.analyze(400 * 3600, 0.0005, 200, 3.0, 0.3)
    assert big.total_range_m > small.total_range_m


def test_efficiency_validation():
    try:
        energy.pump_energy_per_inflation(0.0005, 100, efficiency=0.0)
    except ValueError:
        return
    raise AssertionError("expected ValueError for zero efficiency")
