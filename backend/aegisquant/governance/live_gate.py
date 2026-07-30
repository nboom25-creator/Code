"""Live-trading authorization gate.

Enabling live trading requires **all** of the following to line up. Any single
missing element is a refusal, and every attempt — granted or denied — is written
to :class:`LiveAuthorization`, which is append-only.

1. ``AEGIS_LIVE_TRADING_ENABLED=true`` in the server environment. A UI action
   alone can never enable live trading.
2. ``AEGIS_MODE=LIVE``. The mode is a deploy-time decision, and
   :class:`aegisquant.config.Settings` refuses to start in LIVE without (1).
3. An explicit UI confirmation from a user with the admin role.
4. Re-entry of the exact confirmation phrase.
5. Preflight checks: broker reachable, account not blocked, the resolved endpoint
   really is the live endpoint, reconciliation clean, no blocking data issues,
   kill switch off.
6. Validation thresholds: at least one strategy has passed the promotion gate to
   ``live_eligible``.
7. The account identifier is displayed back to the operator, so they can see
   which account is about to be traded.
8. A hard maximum allocation, below the account's own equity.
9. A persistent audit record.

There is no code path that upgrades PAPER to LIVE implicitly. The broker factory
refuses a paper endpoint in LIVE mode and a live endpoint in PAPER mode, so a
misconfiguration fails loudly instead of trading real money quietly.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegisquant.config import Mode, get_settings
from aegisquant.db import enums as E
from aegisquant.db.models import (
    DataQualityIssue,
    LiveAuthorization,
    ReconciliationRun,
)
from aegisquant.db.models import (
    Strategy as StrategyRow,
)
from aegisquant.db.repo import get_system_state
from aegisquant.execution.broker.base import Broker, BrokerError
from aegisquant.logging_setup import get_logger
from aegisquant.ops.alerts import raise_alert
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)

#: How long a granted authorisation stays valid before it must be renewed.
AUTHORIZATION_TTL_HOURS = 24


@dataclass(slots=True)
class PreflightCheck:
    name: str
    passed: bool
    message: str
    detail: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "message": self.message,
            "detail": self.detail,
        }


@dataclass(slots=True)
class LiveGateResult:
    granted: bool
    checks: list[PreflightCheck] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)
    account_identifier: str | None = None
    broker: str | None = None
    max_allocation_usd: Decimal | None = None
    expires_at: Any = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "granted": self.granted,
            "checks": [c.as_dict() for c in self.checks],
            "failures": self.failures,
            "account_identifier": self.account_identifier,
            "broker": self.broker,
            "max_allocation_usd": (str(self.max_allocation_usd) if self.max_allocation_usd is not None else None),
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
        }


def preflight(session: Session, broker: Broker | None = None) -> LiveGateResult:
    """Run the preflight checks without changing anything.

    Safe to call from the UI to show the operator exactly what stands between the
    system and live trading.
    """
    settings = get_settings()
    result = LiveGateResult(granted=False)
    checks = result.checks

    checks.append(
        PreflightCheck(
            "environment_flag",
            settings.live_trading_enabled,
            (
                "AEGIS_LIVE_TRADING_ENABLED is true"
                if settings.live_trading_enabled
                else "AEGIS_LIVE_TRADING_ENABLED is not set — live trading cannot be enabled "
                "from the user interface alone"
            ),
        )
    )
    checks.append(
        PreflightCheck(
            "mode_is_live",
            settings.mode is Mode.LIVE,
            f"AEGIS_MODE is {settings.mode.value}" + ("" if settings.mode is Mode.LIVE else " — must be LIVE"),
        )
    )
    checks.append(
        PreflightCheck(
            "broker_is_not_mock",
            settings.broker != "mock",
            f"broker is '{settings.broker}'"
            + (" — the mock broker cannot trade real money" if settings.broker == "mock" else ""),
        )
    )
    checks.append(
        PreflightCheck(
            "secret_key_is_real",
            not settings.secret_key.get_secret_value().startswith("dev-only"),
            "AEGIS_SECRET_KEY is a real secret"
            if not settings.secret_key.get_secret_value().startswith("dev-only")
            else "AEGIS_SECRET_KEY is still the development default",
        )
    )

    # --- broker reachability and identity ---
    account = None
    if broker is not None:
        try:
            account = broker.get_account()
            result.account_identifier = account.masked_account_id
            result.broker = broker.name
            checks.append(
                PreflightCheck(
                    "broker_reachable",
                    True,
                    f"connected to {broker.name}, account {account.masked_account_id}",
                    {"equity": str(account.equity), "is_paper": account.is_paper},
                )
            )
            checks.append(
                PreflightCheck(
                    "endpoint_is_live",
                    not broker.is_paper,
                    "the broker adapter resolved to the LIVE endpoint"
                    if not broker.is_paper
                    else "the broker adapter resolved to a PAPER endpoint — refusing to call it live",
                )
            )
            checks.append(
                PreflightCheck(
                    "account_not_blocked",
                    not (account.trading_blocked or account.account_blocked),
                    "the account is in good standing"
                    if not (account.trading_blocked or account.account_blocked)
                    else "the broker reports the account as blocked",
                )
            )
            checks.append(
                PreflightCheck(
                    "allocation_within_equity",
                    settings.live_max_allocation_usd <= account.equity,
                    (
                        f"the configured maximum allocation of "
                        f"${settings.live_max_allocation_usd:,.2f} is within account equity of "
                        f"${account.equity:,.2f}"
                    )
                    if settings.live_max_allocation_usd <= account.equity
                    else (
                        f"the configured maximum allocation of "
                        f"${settings.live_max_allocation_usd:,.2f} exceeds account equity of "
                        f"${account.equity:,.2f}"
                    ),
                )
            )
        except BrokerError as exc:
            checks.append(PreflightCheck("broker_reachable", False, f"broker unreachable: {exc.message}"))
    else:
        checks.append(PreflightCheck("broker_reachable", False, "no broker was supplied for the preflight"))

    # --- system hygiene ---
    state = get_system_state(session)
    checks.append(
        PreflightCheck(
            "kill_switch_off",
            not state.kill_switch_engaged,
            "the kill switch is not engaged"
            if not state.kill_switch_engaged
            else f"the kill switch is engaged: {state.kill_switch_reason}",
        )
    )
    checks.append(
        PreflightCheck(
            "not_read_only",
            not state.read_only,
            "the system is not in read-only mode" if not state.read_only else "the system is read-only",
        )
    )
    checks.append(
        PreflightCheck(
            "risk_state_normal",
            state.risk_state in (E.RiskState.NORMAL, E.RiskState.WARNING),
            f"risk state is {state.risk_state.value}",
        )
    )

    blocking_issues = (
        session.scalar(
            select(func.count())
            .select_from(DataQualityIssue)
            .where(
                DataQualityIssue.resolved.is_(False),
                DataQualityIssue.severity.in_([E.IssueSeverity.ERROR, E.IssueSeverity.CRITICAL]),
            )
        )
        or 0
    )
    checks.append(
        PreflightCheck(
            "no_blocking_data_issues",
            blocking_issues == 0,
            f"{blocking_issues} unresolved blocking data-quality issue(s)",
        )
    )

    unresolved_recon = (
        session.scalar(select(func.count()).select_from(ReconciliationRun).where(ReconciliationRun.resolved.is_(False)))
        or 0
    )
    checks.append(
        PreflightCheck(
            "reconciliation_clean",
            unresolved_recon == 0,
            f"{unresolved_recon} unresolved reconciliation run(s)",
        )
    )

    # --- validation thresholds ---
    eligible = list(
        session.scalars(
            select(StrategyRow.key).where(
                StrategyRow.status.in_([E.StrategyStatus.LIVE_ELIGIBLE, E.StrategyStatus.LIVE])
            )
        )
    )
    if settings.live_require_promotion_gate:
        checks.append(
            PreflightCheck(
                "promotion_gate_passed",
                bool(eligible),
                (f"{len(eligible)} strategy(ies) have passed the promotion gate: {', '.join(eligible)}")
                if eligible
                else "no strategy has passed the paper-to-live promotion gate",
                {"eligible": eligible},
            )
        )

    result.max_allocation_usd = settings.live_max_allocation_usd
    result.failures = [c.message for c in checks if not c.passed]
    result.granted = not result.failures
    return result


def request_live_activation(
    session: Session,
    *,
    requested_by: str,
    role: E.Role,
    confirmation_phrase: str,
    ui_confirmed: bool,
    acknowledged_account_identifier: str | None,
    broker: Broker | None = None,
    ip: str | None = None,
) -> tuple[bool, LiveGateResult, LiveAuthorization]:
    """Attempt to enable live trading. Records the attempt either way."""
    settings = get_settings()
    result = preflight(session, broker)

    # --- human-in-the-loop requirements ---
    if role is not E.Role.ADMIN:
        result.checks.append(PreflightCheck("admin_role", False, f"role '{role.value}' may not enable live trading"))
    else:
        result.checks.append(PreflightCheck("admin_role", True, "requester holds the admin role"))

    result.checks.append(
        PreflightCheck(
            "ui_confirmation",
            bool(ui_confirmed),
            "explicit UI confirmation received" if ui_confirmed else "explicit UI confirmation was not given",
        )
    )

    phrase_ok = hmac.compare_digest(
        (confirmation_phrase or "").strip(),
        settings.live_confirmation_phrase.get_secret_value().strip(),
    )
    result.checks.append(
        PreflightCheck(
            "confirmation_phrase",
            phrase_ok,
            "confirmation phrase matched" if phrase_ok else "the confirmation phrase did not match",
        )
    )

    account_ok = True
    if result.account_identifier:
        account_ok = (acknowledged_account_identifier or "").strip() == result.account_identifier
        result.checks.append(
            PreflightCheck(
                "account_acknowledged",
                account_ok,
                f"operator acknowledged account {result.account_identifier}"
                if account_ok
                else (
                    "the acknowledged account identifier does not match the connected account "
                    f"({result.account_identifier})"
                ),
            )
        )

    result.failures = [c.message for c in result.checks if not c.passed]
    result.granted = not result.failures
    if result.granted:
        result.expires_at = utcnow() + timedelta(hours=AUTHORIZATION_TTL_HOURS)

    record = LiveAuthorization(
        at=utcnow(),
        requested_by=requested_by,
        action="enable",
        granted=result.granted,
        account_identifier=result.account_identifier,
        broker=result.broker or settings.broker,
        max_allocation_usd=settings.live_max_allocation_usd,
        phrase_matched=phrase_ok,
        env_flag_enabled=settings.live_trading_enabled,
        preflight={"checks": [c.as_dict() for c in result.checks]},
        validation={"failures": result.failures},
        failure_reasons={"reasons": result.failures} if result.failures else None,
        ip=ip,
        expires_at=result.expires_at,
    )
    session.add(record)

    state = get_system_state(session)
    if result.granted:
        detail = dict(state.detail or {})
        detail["live_authorized_at"] = utcnow().isoformat()
        detail["live_authorized_by"] = requested_by
        detail["live_authorization_expires_at"] = result.expires_at.isoformat()
        detail["live_max_allocation_usd"] = str(settings.live_max_allocation_usd)
        state.detail = detail
        raise_alert(
            session,
            E.AlertKind.LIVE_MODE_CHANGE,
            E.AlertSeverity.CRITICAL,
            "LIVE TRADING ENABLED",
            (
                f"Live trading authorised by {requested_by} on account "
                f"{result.account_identifier} with a maximum allocation of "
                f"${settings.live_max_allocation_usd:,.2f}. "
                f"The authorisation expires at {result.expires_at.isoformat()}."
            ),
        )
        log.warning(
            "live_trading_enabled",
            requested_by=requested_by,
            account=result.account_identifier,
            expires_at=result.expires_at.isoformat(),
        )
    else:
        raise_alert(
            session,
            E.AlertKind.LIVE_MODE_CHANGE,
            E.AlertSeverity.WARNING,
            "Live-trading activation denied",
            f"Requested by {requested_by}. {len(result.failures)} requirement(s) unmet: "
            + "; ".join(result.failures[:4]),
        )
    session.flush()
    return result.granted, result, record


def revoke_live_activation(
    session: Session, *, requested_by: str, reason: str, ip: str | None = None
) -> LiveAuthorization:
    """Turn live trading off. Always permitted, never gated — de-risking is free."""
    state = get_system_state(session)
    detail = dict(state.detail or {})
    detail.pop("live_authorized_at", None)
    detail.pop("live_authorization_expires_at", None)
    detail["live_revoked_at"] = utcnow().isoformat()
    detail["live_revoked_by"] = requested_by
    detail["live_revoked_reason"] = reason
    state.detail = detail

    record = LiveAuthorization(
        at=utcnow(),
        requested_by=requested_by,
        action="disable",
        granted=True,
        broker=get_settings().broker,
        phrase_matched=True,
        env_flag_enabled=get_settings().live_trading_enabled,
        failure_reasons={"reason": reason},
        ip=ip,
        revoked_at=utcnow(),
    )
    session.add(record)
    raise_alert(
        session,
        E.AlertKind.LIVE_MODE_CHANGE,
        E.AlertSeverity.CRITICAL,
        "LIVE TRADING DISABLED",
        f"Disabled by {requested_by}. Reason: {reason}",
    )
    session.flush()
    return record


def is_live_authorized(session: Session) -> tuple[bool, str]:
    """Whether a currently-valid live authorisation exists."""
    settings = get_settings()
    if settings.mode is not Mode.LIVE:
        return False, f"mode is {settings.mode.value}, not LIVE"
    if not settings.live_trading_enabled:
        return False, "AEGIS_LIVE_TRADING_ENABLED is not set"
    state = get_system_state(session)
    detail = state.detail or {}
    expires = detail.get("live_authorization_expires_at")
    if not expires:
        return False, "no live authorisation on record"
    from datetime import datetime

    try:
        expiry = datetime.fromisoformat(expires)
    except ValueError:
        return False, "the recorded authorisation expiry is unreadable"
    if expiry <= utcnow():
        return False, f"the live authorisation expired at {expires}"
    return True, f"authorised until {expires} by {detail.get('live_authorized_by')}"


def allocation_headroom(session: Session, current_equity: Decimal) -> tuple[Decimal, str]:
    """Remaining capital the live authorisation permits to be deployed."""
    settings = get_settings()
    cap = settings.live_max_allocation_usd
    if current_equity <= 0:
        return D(0), "account equity is not positive"
    deployed = min(current_equity, cap)
    return cap, (
        f"the live authorisation caps deployed capital at ${cap:,.2f} "
        f"(account equity ${current_equity:,.2f}, effective cap ${deployed:,.2f})"
    )
