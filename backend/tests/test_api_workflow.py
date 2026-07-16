"""Integration tests: full workflow through the HTTP API."""
import io

import pytest

from .conftest import fea_available, wait_for_job
from .fixtures import binary_stl_bytes, corrupted_stl_bytes, cube, open_cube, thin_wall_bracket


def _mk_project(client, name="wf"):
    r = client.post("/api/v1/projects", json={"name": name})
    assert r.status_code == 200
    return r.json()["id"]


def _upload(client, pid, mesh, name="part.stl"):
    r = client.post(f"/api/v1/projects/{pid}/upload",
                    files={"file": (name, io.BytesIO(binary_stl_bytes(mesh)), "model/stl")})
    assert r.status_code == 200, r.text
    return r.json()


def test_upload_and_analyze(client):
    pid = _mk_project(client, "upload-analyze")
    up = _upload(client, pid, cube(10))
    assert up["mesh_version"]["watertight"] is True
    assert up["unit_suggestion"]["estimate"] is True
    mv = up["mesh_version"]["id"]

    # units must be explicitly confirmed
    r = client.post(f"/api/v1/projects/{pid}/unit", json={"unit": "furlong"})
    assert r.status_code == 422
    assert client.post(f"/api/v1/projects/{pid}/unit", json={"unit": "mm"}).status_code == 200

    job = client.post(f"/api/v1/projects/{pid}/analyze/geometry",
                      json={"mesh_version_id": mv}).json()
    done = wait_for_job(client, job["id"])
    assert done["status"] == "succeeded", done
    a = client.get(f"/api/v1/meshes/{mv}/analysis").json()
    assert a["metrics"]["volume_mesh_units3"] == pytest.approx(1000.0)
    assert a["health"]["watertight"] is True
    scal = client.get(f"/api/v1/meshes/{mv}/scalars", params={"field": "thickness"}).json()
    assert len(scal["values"]) > 0


def test_corrupted_upload_rejected(client):
    pid = _mk_project(client, "bad-upload")
    r = client.post(f"/api/v1/projects/{pid}/upload",
                    files={"file": ("bad.stl", io.BytesIO(corrupted_stl_bytes()), "model/stl")})
    assert r.status_code == 422
    assert "STL" in r.json()["detail"]


def test_repair_preserves_original(client):
    pid = _mk_project(client, "repair")
    up = _upload(client, pid, open_cube(), "open.stl")
    mv = up["mesh_version"]["id"]
    orig_sha = up["mesh_version"]["sha256"]
    assert up["mesh_version"]["watertight"] is False

    prev = client.post(f"/api/v1/meshes/{mv}/repair/preview",
                       json={"operations": ["merge_vertices", "fill_holes"]}).json()
    assert prev["before"]["watertight"] is False
    # preview must not change anything
    assert client.get(f"/api/v1/meshes/{mv}").json()["sha256"] == orig_sha

    commit = client.post(f"/api/v1/meshes/{mv}/repair/commit",
                         json={"operations": ["merge_vertices", "fill_holes"]}).json()
    new_mv = commit["mesh_version"]
    assert new_mv["id"] != mv
    assert new_mv["parent_mesh_id"] == mv
    # original untouched, new version tracked separately
    assert client.get(f"/api/v1/meshes/{mv}").json()["sha256"] == orig_sha
    meshes = client.get(f"/api/v1/projects/{pid}/meshes").json()
    assert {m["kind"] for m in meshes} == {"original", "repaired"}

    r = client.post(f"/api/v1/meshes/{mv}/repair/preview", json={"operations": ["explode"]})
    assert r.status_code == 422


def test_material_and_usecase_flow(client):
    pid = _mk_project(client, "material")
    mats = client.get("/api/v1/materials").json()
    assert any(m["values_are_estimates"] for m in mats)
    al = next(m for m in mats if m["key"] == "al_6061_t6")

    r = client.put(f"/api/v1/projects/{pid}/material",
                   json={"material_id": al["id"], "overrides": {"yield_strength": -5},
                         "confirmed": True})
    assert r.status_code == 422  # negative override rejected

    r = client.put(f"/api/v1/projects/{pid}/material",
                   json={"material_id": al["id"], "overrides": {"yield_strength": 240e6},
                         "confirmed": True})
    assert r.status_code == 200
    eff = r.json()["effective_properties"]
    assert eff["yield_strength"] == 240e6

    r = client.put(f"/api/v1/projects/{pid}/manufacturing",
                   json={"method": "fdm", "params": {"layer_height_mm": 0.2,
                                                     "layer_adhesion_factor": 0.7}})
    assert r.status_code == 200
    r = client.put(f"/api/v1/projects/{pid}/usecase",
                   json={"preset": "mounting_bracket", "free_text": "holds a pump",
                         "answers": {"flags": ["structural"], "target_safety_factor": 2}})
    assert "never auto-populated" in r.json()["note"]


def test_bc_requires_units(client):
    pid = _mk_project(client, "bc-units")
    lc = client.post(f"/api/v1/projects/{pid}/loadcases", json={"name": "LC1"}).json()
    # force without units rejected
    r = client.post(f"/api/v1/loadcases/{lc['id']}/bcs",
                    json={"bc_type": "force", "region_id": "0" * 32, "magnitude": 100,
                          "direction": [0, 0, -1]})
    assert r.status_code == 422
    assert "units" in r.json()["detail"]


def test_fea_preconditions_enforced(client):
    pid = _mk_project(client, "fea-gates")
    up = _upload(client, pid, cube(10))
    mv = up["mesh_version"]["id"]
    lc = client.post(f"/api/v1/projects/{pid}/loadcases", json={"name": "LC"}).json()
    r = client.post(f"/api/v1/projects/{pid}/analyze/fea",
                    json={"mesh_version_id": mv, "load_case_id": lc["id"]})
    assert r.status_code == 409
    assert "units" in r.json()["detail"].lower()


def test_ai_proposal_is_draft(client):
    pid = _mk_project(client, "ai")
    r = client.post(f"/api/v1/projects/{pid}/ai/propose-loadcase",
                    json={"text": "bracket bolted to a wall holds 50 N hanging downward"})
    assert r.status_code == 200
    body = r.json()
    assert "DRAFT" in body["note"]
    bcs = body["proposal"]["boundary_conditions"]
    force = next(b for b in bcs if b["bc_type"] == "force")
    assert force["magnitude"] == 50.0  # only the number the user wrote
    assert any(b["bc_type"] == "fixed" for b in bcs)


@pytest.mark.skipif(not fea_available(), reason="Gmsh/CalculiX not installed")
def test_demo_full_lifecycle(client):
    d = client.post("/api/v1/demo").json()
    pid = d["project"]["id"]
    for j in client.get(f"/api/v1/projects/{pid}/jobs").json():
        done = wait_for_job(client, j["id"], timeout_s=420)
        assert done["status"] == "succeeded", done

    recs = client.get(f"/api/v1/projects/{pid}/recommendations").json()
    rule_ids = {r["rule_id"] for r in recs}
    assert "R-GUSSET-001" in rule_ids
    assert "R-CORNER-001" in rule_ids

    results = client.get(f"/api/v1/projects/{pid}/results").json()
    assert len(results) >= 1
    assert all(r["summary"]["converged"] for r in results)
    assert not any(r["is_mock"] for r in results)

    variants = client.get(f"/api/v1/projects/{pid}/variants").json()
    ok = [v for v in variants if v["status"] == "succeeded"]
    assert len(ok) >= 1
    applied = [o for v in ok for o in v["operations"] if o["status"] == "applied"]
    assert any(o["op_type"] == "add_gusset" for o in applied)

    comp = client.get(f"/api/v1/projects/{pid}/comparison").json()
    assert len(comp["rows"]) >= 2
    baseline, variant_rows = comp["rows"][0], comp["rows"][1:]
    assert baseline["mass_kg"] == pytest.approx(0.056, rel=0.05)
    # the gusset variant must be measurably stiffer under the same load case
    stiffer = [r for r in variant_rows
               if r.get("max_displacement_m") and baseline.get("max_displacement_m")
               and r["max_displacement_m"] < baseline["max_displacement_m"]]
    assert stiffer, comp["rows"]
    assert "score_explanation" in comp

    # variant STL download + recipe
    v = ok[0]
    stl = client.get(f"/api/v1/meshes/{v['result_mesh_id']}/file")
    assert stl.status_code == 200 and len(stl.content) > 1000
    recipe = client.get(f"/api/v1/variants/{v['id']}/recipe").json()
    assert recipe["operations"] and recipe["operations"][0]["document"]

    # report + archive
    rj = client.post(f"/api/v1/projects/{pid}/report", json={}).json()
    assert wait_for_job(client, rj["id"], timeout_s=180)["status"] == "succeeded"
    reports = client.get(f"/api/v1/projects/{pid}/reports").json()
    pdf = client.get(f"/api/v1/reports/{reports[0]['id']}/file")
    assert pdf.content[:4] == b"%PDF"
    archive = client.get(f"/api/v1/projects/{pid}/archive")
    assert archive.status_code == 200 and len(archive.content) > 10000


def test_job_cancellation(client):
    pid = _mk_project(client, "cancel")
    up = _upload(client, pid, thin_wall_bracket())
    client.post(f"/api/v1/projects/{pid}/unit", json={"unit": "mm"})
    job = client.post(f"/api/v1/projects/{pid}/analyze/geometry",
                      json={"mesh_version_id": up["mesh_version"]["id"]}).json()
    r = client.post(f"/api/v1/jobs/{job['id']}/cancel")
    assert r.status_code == 200
    done = wait_for_job(client, job["id"])
    assert done["status"] in ("cancelled", "succeeded")  # may already have finished
