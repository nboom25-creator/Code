"""Verify the FEA pipeline against analytically solvable cases.

Documented tolerances:
- Axial bar: mid-length stress within 10% of F/A; end displacement (away from the
  constrained end's Poisson-restraint zone) within 15% of FL/AE.
- Cantilever: tip deflection within 15% of FL^3/3EI + shear correction; the raw
  Euler-Bernoulli value is used with a generous band because the FE model includes
  shear deformation and root compliance effects the hand formula ignores.
"""
import numpy as np
import pytest
import trimesh

from .conftest import fea_available

pytestmark = pytest.mark.skipif(not fea_available(), reason="Gmsh/CalculiX not installed")


def _run(mesh_mm, bcs, workdir, mat=None):
    from app.services.fea.pipeline import run_fea
    mat = mat or dict(elastic_modulus=68.9e9, poisson_ratio=0.33, density=2700,
                      yield_strength=276e6)
    stl = workdir / "part.stl"
    mesh_mm.export(stl)
    return run_fea(stl_path=stl, unit_scale_to_m=1e-3, material_props=mat, bcs=bcs,
                   display_vertices=np.asarray(mesh_mm.vertices, float),
                   display_faces=np.asarray(mesh_mm.faces),
                   workdir=workdir, settings_override={"target_elements": 15000})


def test_axial_bar(tmp_path):
    """10x10x100 mm bar, fixed base, 1000 N axial: sigma = 10 MPa, delta = 14.51 um."""
    bar = trimesh.creation.box(extents=[10, 10, 100])
    bar.apply_translation([0, 0, 50])
    centers = bar.triangles_center
    bottom = np.nonzero(np.abs(centers[:, 2]) < 1e-6)[0].tolist()
    top = np.nonzero(np.abs(centers[:, 2] - 100) < 1e-6)[0].tolist()
    res = _run(bar, [
        {"bc_type": "fixed", "description": "base", "triangle_indices": bottom, "params": {}},
        {"bc_type": "force", "description": "pull", "triangle_indices": top,
         "params": {"magnitude_si": 1000.0, "direction": [0, 0, 1]}},
    ], tmp_path)
    s = res["summary"]
    assert s["converged"]
    # reaction balances applied load exactly
    rz = list(s["reactions_n"].values())[0][2]
    assert rz == pytest.approx(-1000.0, rel=1e-3)
    # nominal stress sampled at mid-length, away from the fixed-end Poisson
    # restraint (which legitimately elevates local stress) and the load face
    npz = np.load(res["fields_path"])
    pos, disp = npz["positions"], npz["displacement_m"]
    vm = npz["von_mises_pa"]
    mid = np.abs(pos[:, 2] - 50) < 5.0
    assert mid.any()
    assert vm[mid].mean() == pytest.approx(10e6, rel=0.10)
    # p95 sanity: within 25% of nominal (includes constrained-end region)
    assert s["p95_von_mises_pa"] == pytest.approx(10e6, rel=0.25)
    at_top_center = (np.abs(pos[:, 2] - 100) < 1e-3) & (np.linalg.norm(pos[:, :2], axis=1) < 3.0)
    assert at_top_center.any()
    uz = disp[at_top_center, 2].mean()
    delta_expected = 1000 * 0.1 / (1e-4 * 68.9e9)  # 1.4514e-5 m
    assert uz == pytest.approx(delta_expected, rel=0.15)


def test_cantilever_beam(tmp_path):
    """10x10x100 mm cantilever, tip load 100 N lateral: delta = FL^3/3EI = 0.2 mm (steel)."""
    beam = trimesh.creation.box(extents=[10, 10, 100])
    beam.apply_translation([0, 0, 50])
    centers = beam.triangles_center
    bottom = np.nonzero(np.abs(centers[:, 2]) < 1e-6)[0].tolist()
    top = np.nonzero(np.abs(centers[:, 2] - 100) < 1e-6)[0].tolist()
    mat = dict(elastic_modulus=200e9, poisson_ratio=0.29, density=7850, yield_strength=250e6)
    res = _run(beam, [
        {"bc_type": "fixed", "description": "root", "triangle_indices": bottom, "params": {}},
        {"bc_type": "force", "description": "tip load", "triangle_indices": top,
         "params": {"magnitude_si": 100.0, "direction": [1, 0, 0]}},
    ], tmp_path, mat=mat)
    s = res["summary"]
    assert s["converged"]
    E, L, b, h, F = 200e9, 0.1, 0.01, 0.01, 100.0
    inertia = b * h ** 3 / 12.0
    delta_eb = F * L ** 3 / (3 * E * inertia)          # 2.0e-4 m Euler-Bernoulli
    # include first-order shear correction (Timoshenko, kappa = 5/6)
    G = E / (2 * (1 + 0.29))
    delta_shear = F * L / (5 / 6 * G * b * h)
    delta_expected = delta_eb + delta_shear
    assert s["max_displacement_m"] == pytest.approx(delta_expected, rel=0.15)
    # bending stress at mid-length: sigma = F*(L/2)*c/I = 30 MPa
    npz = np.load(res["fields_path"])
    pos, vm = npz["positions"], npz["von_mises_pa"]
    mid = (np.abs(pos[:, 2] - 50) < 2.0) & (np.abs(np.abs(pos[:, 0]) - 5) < 0.3) & \
          (np.abs(pos[:, 1]) < 3.0)
    assert mid.any()
    sigma_mid = vm[mid].mean()
    assert sigma_mid == pytest.approx(30e6, rel=0.20)


def test_fea_refuses_unconstrained(tmp_path):
    from app.services.fea.pipeline import FeaError, run_fea
    bar = trimesh.creation.box(extents=[10, 10, 10])
    stl = tmp_path / "cube.stl"
    bar.export(stl)
    top = np.nonzero(bar.triangles_center[:, 2] > 4.9)[0].tolist()
    with pytest.raises(FeaError, match="support"):
        run_fea(stl_path=stl, unit_scale_to_m=1e-3,
                material_props=dict(elastic_modulus=1e9, poisson_ratio=0.3),
                bcs=[{"bc_type": "force", "description": "f", "triangle_indices": top,
                      "params": {"magnitude_si": 10, "direction": [0, 0, 1]}}],
                display_vertices=np.asarray(bar.vertices, float),
                display_faces=np.asarray(bar.faces), workdir=tmp_path)
