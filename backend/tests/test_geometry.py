import numpy as np
import pytest

from app.services.geometry import compute_health, compute_metrics
from app.services.thickness import estimate_thickness

from .fixtures import (
    cube,
    inverted_normals_cube,
    multi_body,
    non_manifold_mesh,
    open_cube,
    plate_with_hole,
)


def test_cube_metrics_exact():
    m = compute_metrics(cube(10.0), unit="mm", density_kg_m3=2700)
    assert m["triangle_count"] == 12
    assert m["watertight"] is True
    assert m["volume_mesh_units3"] == pytest.approx(1000.0)
    assert m["surface_area_mesh_units2"] == pytest.approx(600.0)
    assert np.allclose(m["center_of_mass_mesh_units"], [5, 5, 5], atol=1e-6)
    # mass: 1000 mm^3 = 1e-6 m^3 * 2700 kg/m^3 = 2.7 g
    assert m["estimated_mass_kg"] == pytest.approx(2.7e-3, rel=1e-6)
    assert "estimated" in m["mass_note"].lower() or "estimate" in m["mass_note"].lower()


def test_open_cube_health():
    h = compute_health(open_cube())
    assert h["watertight"] is False
    assert h["boundary_edge_count"] > 0
    codes = [i["code"] for i in h["issues"]]
    assert "not_watertight" in codes


def test_volume_requires_watertight():
    m = compute_metrics(open_cube(), unit="mm")
    assert m["volume_mesh_units3"] is None
    assert m["volume_note"] is not None


def test_non_manifold_detected():
    h = compute_health(non_manifold_mesh())
    assert h["non_manifold_edge_count"] >= 1


def test_inverted_normals_detected():
    h = compute_health(inverted_normals_cube())
    assert h["winding_consistent"] is False


def test_multi_body_components():
    h = compute_health(multi_body())
    assert h["connected_components"] == 2


def test_thickness_plate():
    t = estimate_thickness(plate_with_hole(t=2.0))
    assert t["ok"]
    assert t["min_wall_estimate"] == pytest.approx(2.0, rel=0.15)
