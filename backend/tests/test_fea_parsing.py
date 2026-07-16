import numpy as np
import pytest

from app.services.fea.bcs import validate_load_case
from app.services.fea.frd import FrdParseError, parse_frd, principal_stresses, von_mises


def test_von_mises_uniaxial():
    s = np.array([[100.0, 0, 0, 0, 0, 0]])
    assert von_mises(s)[0] == pytest.approx(100.0)


def test_von_mises_pure_shear():
    s = np.array([[0, 0, 0, 50.0, 0, 0]])
    assert von_mises(s)[0] == pytest.approx(50.0 * np.sqrt(3.0))


def test_principal_stresses():
    s = np.array([[100.0, 50.0, -25.0, 0, 0, 0]])
    p = principal_stresses(s)[0]
    assert p[0] == pytest.approx(100.0)
    assert p[2] == pytest.approx(-25.0)


def test_parse_frd(tmp_path):
    frd = tmp_path / "job.frd"
    frd.write_text(
        "    1C\n"
        "  100CL  101 1.000000000         3                     1\n"
        " -4  DISP        4    1\n"
        " -5  D1          1    2    1    0\n"
        " -5  D2          1    2    2    0\n"
        " -5  D3          1    2    3    0\n"
        " -5  ALL         1    2    0    0    1ALL\n"
        " -1         1 1.00000E-03-2.00000E-03 3.00000E-03\n"
        " -1         2 4.00000E-03 5.00000E-03 6.00000E-03\n"
        " -3\n"
        "  100CL  101 1.000000000         3                     1\n"
        " -4  STRESS      6    1\n"
        " -5  SXX         1    4    1    1\n"
        " -1         1 1.00000E+06 0.00000E+00 0.00000E+00 0.00000E+00 0.00000E+00 0.00000E+00\n"
        " -1         2 2.00000E+06 0.00000E+00 0.00000E+00 0.00000E+00 0.00000E+00 0.00000E+00\n"
        " -3\n"
        " 9999\n")
    out = parse_frd(frd)
    assert out["displacement"][1] == pytest.approx([1e-3, -2e-3, 3e-3])
    assert out["stress"][2][0] == pytest.approx(2e6)


def test_parse_frd_no_disp(tmp_path):
    frd = tmp_path / "bad.frd"
    frd.write_text("nothing useful\n")
    with pytest.raises(FrdParseError):
        parse_frd(frd)


def test_load_case_validation_missing_support():
    r = validate_load_case([{"bc_type": "force", "params": {"magnitude_si": 10, "direction": [0, 0, -1]},
                             "description": "f"}])
    assert not r["ok"]
    assert any("support" in e.lower() for e in r["errors"])


def test_load_case_validation_missing_load():
    r = validate_load_case([{"bc_type": "fixed", "params": {}, "description": "s"}])
    assert not r["ok"]
    assert any("load" in e.lower() for e in r["errors"])


def test_load_case_rollers_insufficient():
    rollers = [{"bc_type": "roller", "params": {"direction": [0, 0, 1]}, "description": "r"},
               {"bc_type": "force", "params": {"magnitude_si": 5, "direction": [1, 0, 0]},
                "description": "f"}]
    r = validate_load_case(rollers)
    assert not r["ok"]
    assert any("rigid-body" in e or "Rollers" in e for e in r["errors"])


def test_load_case_valid():
    r = validate_load_case([
        {"bc_type": "fixed", "params": {}, "description": "s"},
        {"bc_type": "force", "params": {"magnitude_si": 10, "direction": [0, 0, -1]},
         "description": "f"}])
    assert r["ok"]
