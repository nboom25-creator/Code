"""Authentication, authorisation, CSRF, secret handling and the live-mode gate.

The properties under test are the ones whose failure is a security incident
rather than a bug: credentials never leave the server, a viewer cannot mutate,
a mutation without a CSRF token is refused, and LIVE mode cannot be reached
without every gate being satisfied.
"""

from __future__ import annotations

import json
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from aegisquant.api.app import create_app
from aegisquant.api.security import (
    MAX_FAILED_LOGINS,
    CurrentUser,
    authenticate,
    create_access_token,
    hash_password,
    verify_password,
)
from aegisquant.config import get_settings
from aegisquant.db import enums as E
from aegisquant.db.models import AuditLog, LiveAuthorization, User
from aegisquant.db.session import session_scope

PASSWORD = "test-password-1234"


class TestPasswordHashing:
    def test_a_hash_never_contains_the_password(self) -> None:
        hashed = hash_password("correct horse battery staple")
        assert "correct" not in hashed
        assert hashed.startswith("$2")

    def test_verification_accepts_the_right_password_only(self) -> None:
        hashed = hash_password(PASSWORD)
        assert verify_password(PASSWORD, hashed) is True
        assert verify_password("wrong", hashed) is False

    def test_the_salt_makes_every_hash_unique(self) -> None:
        assert hash_password(PASSWORD) != hash_password(PASSWORD)

    def test_the_whole_passphrase_contributes_past_bcrypt_s_72_byte_limit(self) -> None:
        # bcrypt truncates at 72 bytes. Without the SHA-256 pre-hash these two
        # long passphrases would be indistinguishable, silently weakening every
        # long password to its first 72 characters.
        base = "x" * 80
        hashed = hash_password(base + "-suffix-one")
        assert verify_password(base + "-suffix-two", hashed) is False
        assert verify_password(base + "-suffix-one", hashed) is True

    def test_a_malformed_hash_fails_closed(self) -> None:
        assert verify_password(PASSWORD, "not-a-bcrypt-hash") is False
        assert verify_password(PASSWORD, "") is False


class TestAuthenticate:
    def test_an_unknown_address_gives_a_vague_error(self, session) -> None:
        user, error = authenticate(session, "nobody@example.com", PASSWORD)
        assert user is None
        # The message must not reveal whether the address exists.
        assert error == "Invalid email or password"

    def test_an_inactive_account_cannot_log_in(self, session) -> None:
        session.add(
            User(
                email="off@aegisquant.local", password_hash=hash_password(PASSWORD), role=E.Role.VIEWER, is_active=False
            )
        )
        session.flush()
        user, error = authenticate(session, "off@aegisquant.local", PASSWORD)
        assert user is None
        assert error == "Invalid email or password"

    def test_repeated_failures_lock_the_account(self, session) -> None:
        session.add(User(email="target@aegisquant.local", password_hash=hash_password(PASSWORD), role=E.Role.VIEWER))
        session.flush()
        for _ in range(MAX_FAILED_LOGINS):
            user, _error = authenticate(session, "target@aegisquant.local", "wrong")
            assert user is None
        # Even the correct password is now refused for the cooling-off period.
        user, error = authenticate(session, "target@aegisquant.local", PASSWORD)
        assert user is None
        assert "locked" in error.lower()

    def test_a_successful_login_clears_the_failure_counter(self, session) -> None:
        session.add(User(email="ok@aegisquant.local", password_hash=hash_password(PASSWORD), role=E.Role.VIEWER))
        session.flush()
        authenticate(session, "ok@aegisquant.local", "wrong")
        user, error = authenticate(session, "ok@aegisquant.local", PASSWORD)
        assert user is not None
        assert error is None
        assert user.failed_logins == 0
        assert user.last_login_at is not None


class TestRoleHierarchy:
    @pytest.mark.parametrize(
        ("role", "can_view", "can_operate", "can_admin"),
        [
            (E.Role.READONLY, False, False, False),
            (E.Role.VIEWER, True, False, False),
            (E.Role.OPERATOR, True, True, False),
            (E.Role.ADMIN, True, True, True),
        ],
    )
    def test_the_ranking_is_strictly_ordered(
        self, role: E.Role, can_view: bool, can_operate: bool, can_admin: bool
    ) -> None:
        user = CurrentUser(id=1, email="x@y.z", role=role)
        assert user.at_least(E.Role.VIEWER) is can_view
        assert user.at_least(E.Role.OPERATOR) is can_operate
        assert user.at_least(E.Role.ADMIN) is can_admin
        assert user.at_least(E.Role.READONLY) is True


# ---------------------------------------------------------------------------
# HTTP-level tests
# ---------------------------------------------------------------------------
def login(client: TestClient, email: str, password: str = PASSWORD) -> str:
    response = client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    csrf = response.json()["csrf_token"]
    client.headers.update({"x-csrf-token": csrf})
    return csrf


@pytest.fixture()
def app_client(seeded: dict, mock_broker, strategies_registered: None) -> TestClient:
    """An unauthenticated client against a fully seeded application."""
    from aegisquant.seed import seed_users

    with session_scope() as s:
        seed_users(s, PASSWORD)
    return TestClient(create_app())


class TestAuthenticationEndpoints:
    def test_an_unauthenticated_request_is_refused(self, app_client: TestClient) -> None:
        assert app_client.get("/api/overview").status_code == 401

    def test_a_bad_password_is_refused_and_audited(self, app_client: TestClient) -> None:
        response = app_client.post("/api/auth/login", json={"email": "admin@aegisquant.local", "password": "nope"})
        assert response.status_code == 401
        with session_scope() as s:
            rows = s.scalars(select(AuditLog).where(AuditLog.action == "login_failed")).all()
            assert rows

    def test_a_successful_login_sets_httponly_session_and_readable_csrf_cookies(self, app_client: TestClient) -> None:
        settings = get_settings()
        response = app_client.post("/api/auth/login", json={"email": "admin@aegisquant.local", "password": PASSWORD})
        assert response.status_code == 200
        cookies = {c.split("=")[0]: c for c in response.headers.get_list("set-cookie")}
        session_cookie = next(v for k, v in cookies.items() if k == settings.cookie_name)
        csrf_cookie = next(v for k, v in cookies.items() if k == settings.csrf_cookie_name)
        assert "HttpOnly" in session_cookie
        assert "HttpOnly" not in csrf_cookie  # the SPA has to echo it back
        assert "SameSite=lax" in session_cookie.lower() or "samesite=lax" in session_cookie.lower()

    def test_the_login_response_contains_no_credential_material(self, app_client: TestClient) -> None:
        response = app_client.post("/api/auth/login", json={"email": "admin@aegisquant.local", "password": PASSWORD})
        body = response.json()
        blob = json.dumps(body)
        assert "password" not in blob.lower()
        assert PASSWORD not in blob
        assert set(body["user"]) == {"id", "email", "role", "is_active"}

    def test_the_current_user_endpoint_never_exposes_a_hash(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        body = app_client.get("/api/auth/me").json()
        assert "password_hash" not in json.dumps(body)
        assert "$2" not in json.dumps(body)

    def test_a_tampered_token_is_rejected(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        settings = get_settings()
        app_client.cookies.set(settings.cookie_name, "not.a.real.token")
        assert app_client.get("/api/overview").status_code == 401

    def test_a_token_signed_with_the_wrong_key_is_rejected(self, app_client: TestClient) -> None:
        from jose import jwt

        from aegisquant.api.security import ALGORITHM

        forged = jwt.encode({"sub": "1", "role": "admin", "exp": 9_999_999_999}, "wrong-key", algorithm=ALGORITHM)
        client = TestClient(create_app())
        client.cookies.set(get_settings().cookie_name, forged)
        assert client.get("/api/overview").status_code == 401

    def test_an_expired_token_is_rejected(self, app_client: TestClient) -> None:
        with session_scope() as s:
            user = s.scalar(select(User).where(User.email == "admin@aegisquant.local"))
            expired = create_access_token(user, expires_minutes=-10)
        client = TestClient(create_app())
        client.cookies.set(get_settings().cookie_name, expired)
        assert client.get("/api/overview").status_code == 401

    def test_logout_clears_the_session(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        assert app_client.get("/api/overview").status_code == 200
        assert app_client.post("/api/auth/logout").status_code == 200
        app_client.cookies.clear()
        assert app_client.get("/api/overview").status_code == 401


class TestCsrfProtection:
    def test_a_mutation_without_the_csrf_header_is_refused(self, app_client: TestClient) -> None:
        app_client.post("/api/auth/login", json={"email": "admin@aegisquant.local", "password": PASSWORD})
        # Authenticated by cookie, but no x-csrf-token header: exactly the
        # cross-site request shape the double-submit check exists to stop.
        response = app_client.post("/api/controls/kill-switch", json={"engage": True, "reason": "csrf probe"})
        assert response.status_code == 403
        assert "csrf" in response.json()["detail"].lower()

    def test_a_mismatched_csrf_token_is_refused(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        app_client.headers.update({"x-csrf-token": "some-other-value"})
        response = app_client.post("/api/controls/kill-switch", json={"engage": True, "reason": "csrf probe"})
        assert response.status_code == 403

    def test_a_matching_csrf_token_is_accepted(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        response = app_client.post("/api/controls/kill-switch", json={"engage": True, "reason": "authorised test"})
        assert response.status_code == 200
        assert response.json()["kill_switch_engaged"] is True

    def test_reads_do_not_require_a_csrf_token(self, app_client: TestClient) -> None:
        app_client.post("/api/auth/login", json={"email": "admin@aegisquant.local", "password": PASSWORD})
        assert app_client.get("/api/portfolio").status_code == 200


class TestApiPermissions:
    def test_a_viewer_can_read_everything_it_should(self, app_client: TestClient) -> None:
        login(app_client, "viewer@aegisquant.local")
        for path in ("/api/overview", "/api/portfolio", "/api/risk", "/api/journal", "/api/backtests"):
            assert app_client.get(path).status_code == 200, path

    def test_a_viewer_cannot_engage_the_kill_switch(self, app_client: TestClient) -> None:
        login(app_client, "viewer@aegisquant.local")
        response = app_client.post("/api/controls/kill-switch", json={"engage": True, "reason": "viewer probe"})
        assert response.status_code == 403
        assert "operator" in response.json()["detail"]

    def test_a_viewer_cannot_flatten_or_cancel(self, app_client: TestClient) -> None:
        login(app_client, "viewer@aegisquant.local")
        for path in ("/api/controls/cancel-all", "/api/controls/flatten"):
            assert app_client.post(path, json={"engage": True, "reason": "probe"}).status_code == 403

    def test_an_operator_can_use_emergency_controls(self, app_client: TestClient) -> None:
        login(app_client, "operator@aegisquant.local")
        response = app_client.post("/api/controls/kill-switch", json={"engage": True, "reason": "operator drill"})
        assert response.status_code == 200

    def test_an_operator_cannot_change_risk_limits(self, app_client: TestClient) -> None:
        # Raising a risk limit is an admin action, deliberately separated from
        # day-to-day operation.
        login(app_client, "operator@aegisquant.local")
        response = app_client.post(
            "/api/settings/risk",
            json={"limits": {"max_position_pct": "0.99"}, "note": "operator probe"},
        )
        assert response.status_code == 403

    def test_an_operator_cannot_enable_live_trading(self, app_client: TestClient) -> None:
        login(app_client, "operator@aegisquant.local")
        response = app_client.post(
            "/api/live/enable",
            json={
                "confirmation_phrase": "I AUTHORIZE LIVE TRADING",
                "ui_confirmed": True,
                "acknowledged_account_identifier": "MOCK-PAPER-000001",
            },
        )
        assert response.status_code == 403

    def test_an_operator_cannot_create_users(self, app_client: TestClient) -> None:
        login(app_client, "operator@aegisquant.local")
        response = app_client.post(
            "/api/auth/users",
            json={"email": "new@aegisquant.local", "password": "a-long-enough-password", "role": "viewer"},
        )
        assert response.status_code == 403

    def test_an_admin_can_change_risk_limits_and_it_is_audited(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        response = app_client.post(
            "/api/settings/risk",
            json={"limits": {"max_position_pct": "0.10"}, "note": "tightening for the test"},
        )
        assert response.status_code == 200
        with session_scope() as s:
            rows = s.scalars(select(AuditLog).where(AuditLog.action.like("risk%"))).all()
            assert rows


class TestSecretExposure:
    def test_the_settings_endpoint_returns_no_secret_of_any_kind(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        blob = app_client.get("/api/settings").text
        settings = get_settings()
        for secret in settings.secret_values():
            assert secret not in blob, "a secret value was returned through the API"
        for forbidden in ("secret_key", "password_hash", "alpaca_secret_key", "api_secret"):
            assert forbidden not in blob

    def test_no_endpoint_leaks_a_password_hash(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        for path in (
            "/api/overview",
            "/api/portfolio",
            "/api/risk",
            "/api/settings",
            "/api/auth/me",
            "/api/auth/users",
            "/api/journal",
            "/api/audit",
        ):
            response = app_client.get(path)
            if response.status_code != 200:
                continue
            assert "$2b$" not in response.text, f"{path} leaked a bcrypt hash"
            assert "password_hash" not in response.text, f"{path} leaked a hash field"

    def test_audit_detail_is_redacted(self, session) -> None:
        from aegisquant.api.security import record_audit

        record_audit(
            session,
            actor="admin@aegisquant.local",
            actor_role="admin",
            action="test",
            detail={"password": "hunter2", "confirmation_phrase": "I AUTHORIZE LIVE TRADING", "symbol": "NVDA"},
        )
        session.flush()
        row = session.scalars(select(AuditLog).where(AuditLog.action == "test")).one()
        assert row.detail["password"] == "***REDACTED***"
        assert row.detail["confirmation_phrase"] == "***REDACTED***"
        assert row.detail["symbol"] == "NVDA"  # non-sensitive fields survive

    def test_the_redaction_processor_strips_secret_values_and_keys(self) -> None:
        from aegisquant.logging_setup import _redact

        secret = get_settings().secret_values()[0]
        event = _redact(
            None,
            "info",
            {
                "event": "probe",
                "password": "hunter2",
                "authorization": "Bearer abc",
                "message": f"connecting with {secret}",
                "nested": {"api_key": "AK123", "symbol": "NVDA"},
                "symbol": "NVDA",
            },
        )
        assert event["password"] == "***REDACTED***"
        assert event["authorization"] == "***REDACTED***"
        assert secret not in event["message"]
        assert event["nested"]["api_key"] == "***REDACTED***"
        # Non-sensitive fields must survive, or the logs become useless.
        assert event["nested"]["symbol"] == "NVDA"
        assert event["symbol"] == "NVDA"
        assert event["event"] == "probe"

    def test_the_redaction_processor_is_actually_installed(self) -> None:
        import structlog

        from aegisquant.logging_setup import _redact, configure_logging

        configure_logging(json_output=True)
        assert _redact in structlog.get_config()["processors"]


class TestLiveModeSafeguards:
    """Every one of these must fail closed. A single gap means real money."""

    def _payload(self, **overrides) -> dict:
        base = {
            "confirmation_phrase": get_settings().live_confirmation_phrase.get_secret_value(),
            "ui_confirmed": True,
            "acknowledged_account_identifier": "MOCK-PAPER-000001",
        }
        base.update(overrides)
        return base

    def test_the_process_is_not_running_in_live_mode(self) -> None:
        settings = get_settings()
        assert settings.mode is not E.Mode.LIVE
        assert settings.live_trading_enabled is False

    def test_enabling_live_is_refused_while_the_env_flag_is_off(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        response = app_client.post("/api/live/enable", json=self._payload())
        # 409: understood, but the system is not in a state that permits it.
        assert response.status_code == 409
        detail = response.json()["detail"]
        assert detail["failures"], "live activation was refused without saying why"
        assert any("live" in f.lower() for f in detail["failures"])

    def test_the_wrong_confirmation_phrase_is_refused(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        response = app_client.post(
            "/api/live/enable", json=self._payload(confirmation_phrase="i authorize live trading")
        )
        assert response.status_code == 409
        assert any("phrase" in f.lower() for f in response.json()["detail"]["failures"])

    def test_skipping_the_ui_confirmation_is_refused(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        response = app_client.post("/api/live/enable", json=self._payload(ui_confirmed=False))
        assert response.status_code == 409
        assert any("confirm" in f.lower() for f in response.json()["detail"]["failures"])

    def test_acknowledging_the_wrong_account_is_refused(self, app_client: TestClient) -> None:
        # The operator must demonstrate they know which account will be traded.
        login(app_client, "admin@aegisquant.local")
        response = app_client.post(
            "/api/live/enable", json=self._payload(acknowledged_account_identifier="SOME-OTHER-ACCOUNT")
        )
        assert response.status_code == 409
        assert any("account" in f.lower() for f in response.json()["detail"]["failures"])

    def test_every_refused_attempt_is_recorded_permanently(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        app_client.post("/api/live/enable", json=self._payload())
        with session_scope() as s:
            records = s.scalars(select(LiveAuthorization)).all()
            assert records
            assert all(r.granted is False for r in records)
            audits = s.scalars(select(AuditLog).where(AuditLog.action == "live_enable_attempt")).all()
            assert audits

    def test_the_preflight_report_lists_every_requirement(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        body = app_client.get("/api/live/preflight").json()
        assert body["granted"] is False
        assert body["currently_authorized"] is False
        assert body["checks"]
        for check in body["checks"]:
            assert check["name"]
            assert check["message"]
            assert "passed" in check
        # The operator is told the whole path, not just the first blocker.
        assert len(body["required_steps"]) >= 5
        assert "never falls back from paper to live" in body["warning"]

    def test_disabling_live_is_never_gated(self, app_client: TestClient) -> None:
        # De-risking must always be possible, whatever the system state.
        login(app_client, "admin@aegisquant.local")
        response = app_client.post("/api/live/disable", json={"reason": "test de-risking path"})
        assert response.status_code == 200
        assert response.json()["disabled"] is True

    def test_the_broker_factory_refuses_a_mock_broker_in_live_mode(self, monkeypatch) -> None:
        from aegisquant.execution.broker import factory
        from aegisquant.execution.broker.base import BrokerNotConfigured

        live_settings = get_settings().model_copy(update={"mode": E.Mode.LIVE})
        monkeypatch.setattr(factory, "get_settings", lambda: live_settings)
        with pytest.raises(BrokerNotConfigured) as excinfo:
            factory.build_broker("mock")
        assert "live" in str(excinfo.value).lower()

    def test_the_public_settings_payload_states_the_mode_plainly(self, app_client: TestClient) -> None:
        login(app_client, "viewer@aegisquant.local")
        body = app_client.get("/api/settings").json()
        blob = json.dumps(body)
        assert '"PAPER"' in blob or "PAPER" in blob
        assert "live_trading_enabled" in blob


class TestSyntheticDataIsLabelled:
    def test_the_api_declares_simulated_data_on_every_relevant_payload(self, app_client: TestClient) -> None:
        # The UI banner depends on this flag; without it, simulated performance
        # could be read as a real track record.
        login(app_client, "viewer@aegisquant.local")
        for path in ("/api/overview", "/api/portfolio", "/api/opportunities"):
            body = app_client.get(path).json()
            # Exposed at the top level where the page has its own banner, and via
            # the shared config payload on the overview.
            flag = body.get("using_synthetic_data")
            if flag is None:
                flag = body.get("config", {}).get("using_synthetic_data")
            assert flag is True, path

    def test_backtest_results_carry_the_simulated_flag(self, app_client: TestClient) -> None:
        login(app_client, "viewer@aegisquant.local")
        body = app_client.get("/api/backtests").json()
        for run in body if isinstance(body, list) else body.get("runs", []):
            assert "uses_synthetic_data" in run or "is_synthetic" in run


class TestInputValidation:
    def test_a_malformed_email_is_rejected_with_422(self, app_client: TestClient) -> None:
        response = app_client.post("/api/auth/login", json={"email": "not-an-email", "password": PASSWORD})
        assert response.status_code == 422

    def test_a_short_password_is_refused_on_user_creation(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        response = app_client.post(
            "/api/auth/users", json={"email": "new@aegisquant.local", "password": "short", "role": "viewer"}
        )
        assert response.status_code == 422

    def test_a_self_hosted_reserved_domain_is_accepted(self, app_client: TestClient) -> None:
        # ops@company.internal is a normal address for a self-hosted deployment;
        # a strict RFC validator would reject exactly these.
        login(app_client, "admin@aegisquant.local")
        response = app_client.post(
            "/api/auth/users",
            json={"email": "ops@company.internal", "password": "a-sufficiently-long-password", "role": "viewer"},
        )
        assert response.status_code == 201

    def test_an_unknown_risk_limit_field_is_rejected(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        response = app_client.post(
            "/api/settings/risk",
            json={"limits": {"not_a_real_limit": "1"}, "note": "probe"},
        )
        assert response.status_code in (400, 422)

    def test_a_risk_limit_outside_its_own_validator_is_rejected(self, app_client: TestClient) -> None:
        # Full Kelly must be unreachable through the API as well as the config.
        login(app_client, "admin@aegisquant.local")
        response = app_client.post(
            "/api/settings/risk",
            json={"limits": {"kelly_fraction": "1.0"}, "note": "attempting full Kelly"},
        )
        assert response.status_code in (400, 422)


class TestHealthEndpoints:
    def test_health_is_public_and_says_nothing_sensitive(self, app_client: TestClient) -> None:
        response = app_client.get("/api/health")
        assert response.status_code == 200
        blob = response.text
        for secret in get_settings().secret_values():
            assert secret not in blob

    def test_readiness_reports_database_connectivity(self, app_client: TestClient) -> None:
        response = app_client.get("/api/ready")
        assert response.status_code in (200, 503)
        assert "database" in response.text.lower() or "checks" in response.text.lower()


class TestErrorHandling:
    def test_an_unknown_path_returns_404_without_a_stack_trace(self, app_client: TestClient) -> None:
        response = app_client.get("/api/does-not-exist")
        assert response.status_code == 404
        assert "Traceback" not in response.text

    def test_a_missing_resource_returns_404_not_500(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        assert app_client.get("/api/orders/999999").status_code == 404
        assert app_client.get("/api/journal/999999").status_code == 404


class TestRateLimiting:
    def test_login_attempts_are_rate_limited(self, app_client: TestClient) -> None:
        codes = [
            app_client.post(
                "/api/auth/login", json={"email": "nobody@aegisquant.local", "password": "wrong"}
            ).status_code
            for _ in range(15)
        ]
        assert 429 in codes, "the login endpoint accepted unlimited attempts"

    def test_the_limiter_window_is_per_identity(self) -> None:
        from aegisquant.api.security import RateLimiter

        limiter = RateLimiter(per_minute=3)
        assert all(limiter.check("a") for _ in range(3))
        assert limiter.check("a") is False
        assert limiter.check("b") is True  # a different identity is unaffected


class TestRiskLimitChangesAreVersioned:
    def test_a_limit_change_creates_a_new_version_and_keeps_the_old(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        before = app_client.get("/api/settings/risk/history").json()
        app_client.post(
            "/api/settings/risk",
            json={"limits": {"max_position_pct": "0.11"}, "note": "first change"},
        )
        app_client.post(
            "/api/settings/risk",
            json={"limits": {"max_position_pct": "0.12"}, "note": "second change"},
        )
        after = app_client.get("/api/settings/risk/history").json()
        assert len(after) >= len(before) + 2
        # History is append-only: the earlier configuration is still readable.
        notes = [row.get("note") for row in after]
        assert "first change" in notes
        assert "second change" in notes

    def test_a_limit_change_records_who_made_it(self, app_client: TestClient) -> None:
        login(app_client, "admin@aegisquant.local")
        app_client.post(
            "/api/settings/risk",
            json={"limits": {"max_position_pct": "0.13"}, "note": "attribution test"},
        )
        history = app_client.get("/api/settings/risk/history").json()
        row = next(r for r in history if r.get("note") == "attribution test")
        assert row["updated_by"] == "admin@aegisquant.local"


class TestKillSwitchEndToEnd:
    def test_engaging_the_kill_switch_blocks_the_risk_engine(self, app_client: TestClient) -> None:
        from aegisquant.db.repo import get_system_state
        from aegisquant.risk.engine import RiskEngine
        from tests.helpers import account, intent

        login(app_client, "operator@aegisquant.local")
        assert app_client.post("/api/controls/kill-switch", json={"engage": True, "reason": "drill"}).status_code == 200
        with session_scope() as s:
            state = get_system_state(s)
            assert state.kill_switch_engaged is True
            assert state.kill_switch_engaged_by == "operator@aegisquant.local"
            assert state.kill_switch_engaged_at is not None
            verdict = RiskEngine().evaluate(intent(), account(kill_switch=state.kill_switch_engaged))
            assert verdict.approved is False

    def test_releasing_the_kill_switch_is_a_separate_audited_action(self, app_client: TestClient) -> None:
        login(app_client, "operator@aegisquant.local")
        app_client.post("/api/controls/kill-switch", json={"engage": True, "reason": "drill"})
        app_client.post("/api/controls/kill-switch", json={"engage": False, "reason": "drill complete"})
        with session_scope() as s:
            actions = [r.action for r in s.scalars(select(AuditLog).where(AuditLog.action.like("kill_switch%"))).all()]
            assert "kill_switch_engage" in actions
            assert "kill_switch_release" in actions

    def test_read_only_mode_can_be_engaged_and_is_audited(self, app_client: TestClient) -> None:
        from aegisquant.db.repo import get_system_state

        login(app_client, "operator@aegisquant.local")
        response = app_client.post("/api/controls/read-only", json={"engage": True, "reason": "emergency drill"})
        assert response.status_code == 200
        with session_scope() as s:
            assert get_system_state(s).read_only is True

    def test_quarantining_a_symbol_records_it_as_active(self, app_client: TestClient) -> None:
        login(app_client, "operator@aegisquant.local")
        response = app_client.post(
            "/api/controls/quarantine",
            json={"scope": "symbol", "key": "NVDA", "active": True, "reason": "suspicious data"},
        )
        assert response.status_code == 200
        listed = app_client.get("/api/controls/quarantine").json()
        row = next(r for r in listed if r["scope"] == "symbol" and r["key"] == "NVDA")
        assert row["active"] is True
        assert row["engaged_by"] == "operator@aegisquant.local"

    def test_a_quarantine_can_be_released(self, app_client: TestClient) -> None:
        login(app_client, "operator@aegisquant.local")
        app_client.post(
            "/api/controls/quarantine",
            json={"scope": "symbol", "key": "MSFT", "active": True, "reason": "probe"},
        )
        response = app_client.post(
            "/api/controls/quarantine",
            json={"scope": "symbol", "key": "MSFT", "active": False, "reason": "cleared"},
        )
        assert response.status_code == 200
        listed = app_client.get("/api/controls/quarantine").json()
        row = next(r for r in listed if r["key"] == "MSFT")
        assert row["active"] is False
        assert row["released_by"] == "operator@aegisquant.local"

    def test_releasing_a_quarantine_that_does_not_exist_is_a_404(self, app_client: TestClient) -> None:
        login(app_client, "operator@aegisquant.local")
        response = app_client.post(
            "/api/controls/quarantine",
            json={"scope": "symbol", "key": "NOSUCH", "active": False, "reason": "probe"},
        )
        assert response.status_code == 404


class TestDecisionApprovalWorkflow:
    def test_a_pending_decision_cannot_be_approved_by_a_viewer(self, app_client: TestClient) -> None:
        from aegisquant.db.models import Decision
        from aegisquant.utils.timeutil import utcnow

        with session_scope() as s:
            decision = Decision(
                decided_at=utcnow(),
                mode=E.Mode.PAPER,
                symbol="NVDA",
                action=E.DecisionAction.BUY,
                confidence=Decimal("0.5"),
                approval_state=E.ApprovalState.PENDING_HUMAN,
            )
            s.add(decision)
            s.flush()
            decision_id = decision.id

        login(app_client, "viewer@aegisquant.local")
        response = app_client.post(
            f"/api/journal/{decision_id}/approval", json={"approve": True, "reason": "looks fine"}
        )
        assert response.status_code == 403
