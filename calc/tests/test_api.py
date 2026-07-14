"""API-level tests for the calc service."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_evaluate_endpoint():
    r = client.post(
        "/evaluate",
        json={
            "expression": "m*Cp*(T2-T1)",
            "variables": {"m": "2 kg", "Cp": "4186 J/(kg*K)", "T1": "293.15 K", "T2": "353.15 K"},
            "expectedUnit": "J",
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert abs(body["value"] - 2 * 4186 * 60) < 1e-3


def test_convert_delta_temperature():
    # A 5 degF difference is 5*(5/9) K, NOT converted through the offset.
    r = client.post("/convert", json={"value": 5, "from": "degF", "to": "K", "is_delta": True})
    body = r.json()
    assert body["ok"] is True
    assert abs(body["value"] - 5 * 5 / 9) < 1e-6


def test_convert_absolute_temperature():
    r = client.post("/convert", json={"value": 100, "from": "degC", "to": "K"})
    body = r.json()
    assert body["ok"] is True
    assert abs(body["value"] - 373.15) < 1e-6
