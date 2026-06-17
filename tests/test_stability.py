import math

from glidercalc import stability


def test_center_of_mass_two_components():
    comps = [
        stability.MassComponent("a", 1.0, x_m=0.0),
        stability.MassComponent("b", 1.0, x_m=2.0),
    ]
    total, x, z = stability.center_of_mass(comps)
    assert math.isclose(total, 2.0)
    assert math.isclose(x, 1.0)


def test_stable_when_cb_above_cg():
    res = stability.analyze(cg_x_m=0.0, cg_z_m=-0.02, cb_x_m=0.0, cb_z_m=0.0,
                            total_mass_kg=50.0)
    assert res.is_stable
    assert res.bg_m > 0


def test_unstable_when_cg_above_cb():
    res = stability.analyze(cg_x_m=0.0, cg_z_m=0.01, cb_x_m=0.0, cb_z_m=0.0,
                            total_mass_kg=50.0)
    assert not res.is_stable


def test_pitch_from_mass_shift_matches_atan():
    bg = 0.02
    pitch = stability.pitch_from_mass_shift(mass_shift_kg=10.0,
                                            shift_distance_m=0.05,
                                            total_mass_kg=50.0, bg_m=bg)
    dx_cg = 10.0 * 0.05 / 50.0
    assert math.isclose(pitch, math.degrees(math.atan2(dx_cg, bg)), rel_tol=1e-9)


def test_mass_shift_for_pitch_round_trip():
    bg = 0.02
    travel = stability.mass_shift_for_pitch(target_pitch_deg=20.0,
                                            movable_mass_kg=10.0,
                                            total_mass_kg=50.0, bg_m=bg)
    pitch = stability.pitch_from_mass_shift(10.0, travel, 50.0, bg)
    assert math.isclose(pitch, 20.0, rel_tol=1e-9)


def test_smaller_bg_trims_more_for_same_shift():
    stiff = stability.pitch_from_mass_shift(10.0, 0.05, 50.0, bg_m=0.04)
    soft = stability.pitch_from_mass_shift(10.0, 0.05, 50.0, bg_m=0.01)
    assert abs(soft) > abs(stiff)
