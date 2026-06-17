from glidercalc import report


def _base_config():
    return {
        "water_density": 1025,
        "buoyancy": {"mass_kg": 52.0, "displaced_volume_l": 50.7},
        "glide": {"wing_area_m2": 0.10, "cd0": 0.10, "k": 0.30},
        "hull": {
            "shape": "cylinder", "radius_mm": 100, "thickness_mm": 6,
            "depth_m": 200, "yield_strength_mpa": 276, "youngs_modulus_gpa": 69,
        },
        "energy": {"battery_wh": 200, "ballast_volume_l": 0.5},
    }


def test_full_report_runs_all_sections():
    rep = report.run(_base_config())
    assert rep.buoyancy is not None
    assert rep.glide is not None
    assert rep.hull is not None
    assert rep.energy is not None
    # depth band defaulted from hull depth
    assert rep.energy.depth_band_m == 200


def test_report_requires_buoyancy_section():
    try:
        report.run({"glide": {}})
    except ValueError:
        return
    raise AssertionError("expected ValueError when buoyancy section missing")


def test_neutral_buoyancy_warns_and_skips_glide():
    cfg = _base_config()
    # set displaced volume so net force ~ 0
    cfg["buoyancy"]["displaced_volume_m3"] = 52.0 / 1025.0
    cfg["buoyancy"].pop("displaced_volume_l")
    rep = report.run(cfg)
    assert rep.glide is None
    assert any("Net buoyancy" in w for w in rep.warnings)


def test_summary_is_a_string():
    rep = report.run(_base_config())
    text = rep.summary()
    assert "UNDERWATER GLIDER" in text
    assert "Buoyancy" in text


def test_water_section_uses_local_density_and_pressure():
    cfg = _base_config()
    cfg["water"] = {"surface_density": 1025, "working_depth_m": 200}
    rep = report.run(cfg)
    assert rep.water is not None
    # buoyancy used the denser local water (deeper than surface density)
    assert rep.buoyancy.water_density > 1025
    # hull pressure exceeds the simple surface-density estimate
    assert rep.hull.pressure_pa > 1025 * 9.80665 * 200


def test_stability_section_components():
    cfg = _base_config()
    cfg["stability"] = {
        "components": [
            {"name": "battery", "mass_kg": 10, "x_m": 0.0, "z_m": -0.03},
            {"name": "hull", "mass_kg": 42, "x_m": 0.0, "z_m": 0.0},
        ],
        "cb": {"x_m": 0.0, "z_m": 0.0},
    }
    rep = report.run(cfg)
    assert rep.stability is not None
    assert rep.stability.is_stable  # CG pulled below CB by the battery
    assert "Stability" in rep.summary()
