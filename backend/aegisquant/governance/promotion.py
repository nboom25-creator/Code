"""Paper-to-live promotion gate.

A strategy climbs a ladder: ``research`` → ``validated`` → ``paper`` →
``live_eligible`` → ``live``. Each step has evidence requirements, and every
evaluation is persisted as a :class:`PromotionRecord` whether it passed or not —
the failures are the more useful half of that history.

These are **configurable governance thresholds, not proof of future
profitability**. Passing means the strategy has cleared the bar the operator set;
it does not mean it will make money. Live activation is always a separate,
deliberate human action.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aegisquant.config import PromotionThresholds, get_settings
from aegisquant.db import enums as E
from aegisquant.db.models import (
    BacktestRun,
    DataQualityIssue,
    Decision,
    PromotionRecord,
    ReconciliationRun,
)
from aegisquant.db.models import (
    Strategy as StrategyRow,
)
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)

#: The only transitions the gate will authorise.
LADDER: dict[E.StrategyStatus, E.StrategyStatus] = {
    E.StrategyStatus.RESEARCH: E.StrategyStatus.VALIDATED,
    E.StrategyStatus.VALIDATED: E.StrategyStatus.PAPER,
    E.StrategyStatus.PAPER: E.StrategyStatus.LIVE_ELIGIBLE,
    E.StrategyStatus.LIVE_ELIGIBLE: E.StrategyStatus.LIVE,
}


@dataclass(slots=True)
class Check:
    name: str
    passed: bool
    observed: Any
    required: Any
    message: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "observed": _plain(self.observed),
            "required": _plain(self.required),
            "message": self.message,
        }


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    return value


@dataclass(slots=True)
class GateResult:
    strategy_key: str
    from_status: E.StrategyStatus
    to_status: E.StrategyStatus | None
    passed: bool
    checks: list[Check] = field(default_factory=list)
    blocking: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "strategy_key": self.strategy_key,
            "from_status": self.from_status.value,
            "to_status": self.to_status.value if self.to_status else None,
            "passed": self.passed,
            "checks": [c.as_dict() for c in self.checks],
            "blocking": self.blocking,
            "notes": self.notes,
            "disclaimer": (
                "These are configurable governance thresholds, not evidence of future "
                "profitability. Passing the gate makes a strategy eligible for a human to "
                "consider promoting; it never promotes anything by itself."
            ),
        }


# ---------------------------------------------------------------------------
def evaluate(
    session: Session,
    strategy_key: str,
    *,
    thresholds: PromotionThresholds | None = None,
    target_status: E.StrategyStatus | None = None,
) -> GateResult:
    """Evaluate whether ``strategy_key`` may advance one rung."""
    t = thresholds or get_settings().promotion
    row = session.scalar(select(StrategyRow).where(StrategyRow.key == strategy_key))
    if row is None:
        return GateResult(
            strategy_key=strategy_key,
            from_status=E.StrategyStatus.RESEARCH,
            to_status=None,
            passed=False,
            blocking=[f"strategy '{strategy_key}' is not registered"],
        )

    to_status = target_status or LADDER.get(row.status)
    result = GateResult(strategy_key=strategy_key, from_status=row.status, to_status=to_status, passed=False)
    if to_status is None:
        result.blocking.append(f"'{strategy_key}' is {row.status.value}; there is no further promotion step")
        return result
    if target_status and LADDER.get(row.status) is not target_status:
        result.blocking.append(
            f"cannot promote directly from {row.status.value} to {target_status.value}; "
            f"the next permitted step is {LADDER.get(row.status, 'none')}"
        )
        return result

    checks: list[Check] = []

    # --- out-of-sample backtest evidence ---
    oos = _best_run(session, row.id, E.BacktestPhase.OUT_OF_SAMPLE)
    if oos is None:
        checks.append(
            Check(
                "out_of_sample_backtest",
                False,
                None,
                "at least one completed out-of-sample run",
                "no completed out-of-sample backtest exists for this strategy",
            )
        )
    else:
        metrics = oos.metrics or {}
        days = (oos.end_date - oos.start_date).days
        checks.append(
            Check(
                "out_of_sample_history_days",
                days >= t.min_oos_days,
                days,
                t.min_oos_days,
                f"out-of-sample window covers {days} days",
            )
        )
        trades = ((metrics.get("trade_stats") or {}).get("trades")) or 0
        checks.append(
            Check(
                "out_of_sample_trades",
                trades >= t.min_trades,
                trades,
                t.min_trades,
                f"{trades} out-of-sample trades",
            )
        )
        sharpe = metrics.get("sharpe")
        checks.append(
            Check(
                "net_sharpe",
                sharpe is not None and D(sharpe) >= t.min_net_sharpe,
                sharpe,
                str(t.min_net_sharpe),
                f"net-of-cost Sharpe {sharpe}",
            )
        )
        cagr = metrics.get("cagr")
        checks.append(
            Check(
                "net_cagr",
                cagr is not None and D(cagr) >= t.min_net_cagr,
                cagr,
                str(t.min_net_cagr),
                f"net-of-cost CAGR {cagr}",
            )
        )
        mdd = metrics.get("max_drawdown")
        checks.append(
            Check(
                "max_drawdown",
                mdd is not None and abs(D(mdd)) <= t.max_drawdown_pct,
                mdd,
                str(-t.max_drawdown_pct),
                f"maximum drawdown {mdd}",
            )
        )
        diagnostics = oos.diagnostics or {}
        cost_share = (metrics.get("trade_stats") or {}).get("cost_share_of_gross")
        if cost_share is not None:
            checks.append(
                Check(
                    "costs_do_not_dominate",
                    D(cost_share) < Decimal("0.5"),
                    cost_share,
                    "< 0.5",
                    f"modelled costs consumed {float(cost_share):.0%} of gross profit",
                )
            )
        # Walk-forward and sensitivity are stored on the run's diagnostics.
        wf = diagnostics.get("walk_forward") or {}
        if wf:
            rate = wf.get("pass_rate")
            checks.append(
                Check(
                    "walkforward_pass_rate",
                    rate is not None and D(rate) >= t.min_walkforward_pass_rate,
                    rate,
                    str(t.min_walkforward_pass_rate),
                    f"{float(rate or 0):.0%} of walk-forward folds held up",
                )
            )
        else:
            checks.append(
                Check(
                    "walkforward_pass_rate",
                    False,
                    None,
                    str(t.min_walkforward_pass_rate),
                    "no walk-forward analysis has been recorded for this strategy",
                )
            )
        sens = diagnostics.get("sensitivity") or []
        if sens:
            worst = max((s.get("sharpe_cv") or 0) for s in sens)
            checks.append(
                Check(
                    "parameter_stability",
                    D(worst) <= t.max_param_sensitivity_cv,
                    worst,
                    str(t.max_param_sensitivity_cv),
                    f"worst parameter sensitivity coefficient of variation {worst}",
                )
            )
        else:
            checks.append(
                Check(
                    "parameter_stability",
                    False,
                    None,
                    str(t.max_param_sensitivity_cv),
                    "no parameter-sensitivity analysis has been recorded",
                )
            )
        stress = diagnostics.get("stress") or {}
        if stress:
            worst_impact = stress.get("worst_estimated_impact")
            checks.append(
                Check(
                    "stress_test",
                    worst_impact is not None and D(worst_impact) >= t.min_stress_survival_pct,
                    worst_impact,
                    str(t.min_stress_survival_pct),
                    f"worst modelled stress impact {worst_impact}",
                )
            )
        else:
            checks.append(Check("stress_test", False, None, "stress results recorded", "no stress test recorded"))
        if oos.uses_synthetic_data:
            result.notes.append(
                "the out-of-sample evidence was produced from SIMULATED data; promotion beyond "
                "paper should require a run against a real market-data provider"
            )
            checks.append(
                Check(
                    "real_market_data",
                    False,
                    "synthetic",
                    "real provider data",
                    "the supporting backtest used simulated data",
                )
            )

    # --- paper-trading evidence (needed from PAPER onwards) ---
    if row.status in (E.StrategyStatus.PAPER, E.StrategyStatus.LIVE_ELIGIBLE):
        paper_decisions = list(
            session.scalars(
                select(Decision).where(
                    Decision.strategy_key == strategy_key,
                    Decision.mode == E.Mode.PAPER,
                    Decision.approval_state.in_([E.ApprovalState.AUTO_APPROVED, E.ApprovalState.APPROVED]),
                )
            )
        )
        first = min((d.decided_at for d in paper_decisions), default=None)
        paper_days = (utcnow() - first).days if first else 0
        checks.append(
            Check(
                "paper_trading_days",
                paper_days >= t.min_paper_days,
                paper_days,
                t.min_paper_days,
                f"{paper_days} days of paper trading recorded",
            )
        )
        checks.append(
            Check(
                "paper_trades",
                len(paper_decisions) >= t.min_paper_trades,
                len(paper_decisions),
                t.min_paper_trades,
                f"{len(paper_decisions)} approved paper decisions",
            )
        )
        tracking = _paper_vs_sim_tracking_error(session, strategy_key, oos)
        checks.append(
            Check(
                "paper_matches_simulation",
                tracking is None or D(tracking) <= t.max_paper_sim_tracking_error,
                tracking,
                str(t.max_paper_sim_tracking_error),
                (
                    f"paper results differ from simulation by {tracking}"
                    if tracking is not None
                    else "not enough paper history to compare against simulation"
                ),
            )
        )
        if tracking is None:
            checks[-1].passed = False

    # --- system hygiene ---
    if t.require_zero_open_data_issues:
        blocking_issues = session.scalar(
            select(func.count())
            .select_from(DataQualityIssue)
            .where(
                DataQualityIssue.resolved.is_(False),
                DataQualityIssue.severity.in_([E.IssueSeverity.ERROR, E.IssueSeverity.CRITICAL]),
            )
        )
        checks.append(
            Check(
                "no_unresolved_data_issues",
                (blocking_issues or 0) == 0,
                blocking_issues or 0,
                0,
                f"{blocking_issues or 0} unresolved blocking data-quality issue(s)",
            )
        )
    if t.require_zero_open_recon_breaks:
        unresolved = session.scalar(
            select(func.count()).select_from(ReconciliationRun).where(ReconciliationRun.resolved.is_(False))
        )
        checks.append(
            Check(
                "no_unresolved_reconciliation",
                (unresolved or 0) == 0,
                unresolved or 0,
                0,
                f"{unresolved or 0} unresolved reconciliation run(s)",
            )
        )

    # --- strategy must not be paused or quarantined ---
    checks.append(
        Check(
            "strategy_enabled",
            row.enabled and row.status not in (E.StrategyStatus.PAUSED, E.StrategyStatus.QUARANTINED),
            f"{row.status.value}, enabled={row.enabled}",
            "enabled and not paused or quarantined",
            f"strategy status is {row.status.value}",
        )
    )

    result.checks = checks
    result.blocking = [c.message for c in checks if not c.passed]
    result.passed = not result.blocking
    return result


def _best_run(session: Session, strategy_id: int, phase: E.BacktestPhase) -> BacktestRun | None:
    return session.scalar(
        select(BacktestRun)
        .where(
            BacktestRun.strategy_id == strategy_id,
            BacktestRun.phase == phase,
            BacktestRun.status == E.RunStatus.COMPLETED,
        )
        .order_by(BacktestRun.finished_at.desc())
        .limit(1)
    )


def _paper_vs_sim_tracking_error(session: Session, strategy_key: str, sim_run: BacktestRun | None) -> Decimal | None:
    """Relative difference between paper and simulated mean trade return.

    A large divergence means the simulation is not modelling reality — usually
    costs, fills or data timing — and that must be understood before real money.
    """
    if sim_run is None or not sim_run.metrics:
        return None
    from aegisquant.db.models import PostTradeReview

    rows = list(
        session.execute(
            select(PostTradeReview.realized_return_pct)
            .join(Decision, Decision.id == PostTradeReview.decision_id)
            .where(Decision.strategy_key == strategy_key, Decision.mode == E.Mode.PAPER)
        )
    )
    returns = [float(r[0]) for r in rows if r[0] is not None]
    if len(returns) < 5:
        return None
    sim_expectancy = (sim_run.metrics.get("trade_stats") or {}).get("expectancy")
    sim_avg = None
    if sim_expectancy is not None and sim_run.starting_cash:
        sim_avg = float(sim_expectancy) / float(sim_run.starting_cash)
    if not sim_avg:
        return None
    paper_avg = sum(returns) / len(returns)
    denominator = abs(sim_avg) if abs(sim_avg) > 1e-9 else 1e-9
    return D(round(abs(paper_avg - sim_avg) / denominator, 6))


# ---------------------------------------------------------------------------
def promote(
    session: Session,
    strategy_key: str,
    *,
    requested_by: str,
    approved_by: str | None = None,
    note: str | None = None,
    thresholds: PromotionThresholds | None = None,
    force: bool = False,
) -> tuple[GateResult, PromotionRecord]:
    """Evaluate the gate and, if it passes, advance the strategy one rung.

    ``force`` records an explicit human override. It still writes the failed
    checks to the audit record, so an override is visible forever rather than
    looking like a clean pass.
    """
    result = evaluate(session, strategy_key, thresholds=thresholds)
    row = session.scalar(select(StrategyRow).where(StrategyRow.key == strategy_key))
    record = PromotionRecord(
        at=utcnow(),
        strategy_id=row.id if row else 0,
        strategy_key=strategy_key,
        from_status=result.from_status.value,
        to_status=result.to_status.value if result.to_status else "none",
        passed=result.passed,
        checks={"checks": [c.as_dict() for c in result.checks], "blocking": result.blocking},
        thresholds=(thresholds or get_settings().promotion).model_dump(mode="json"),
        requested_by=requested_by,
        approved_by=approved_by,
        note=note,
    )
    session.add(record)

    should_apply = result.passed or force
    if should_apply and row is not None and result.to_status is not None:
        # Reaching LIVE additionally requires the live-mode authorisation flow;
        # this gate can only mark a strategy *eligible*.
        if result.to_status is E.StrategyStatus.LIVE and not approved_by:
            record.note = (
                note + "; " if note else ""
            ) + "promotion to LIVE requires an explicit approver and the live-mode authorisation workflow"
            record.passed = False
            session.flush()
            result.blocking.append(record.note)
            result.passed = False
            return result, record
        row.status = result.to_status
        if force and not result.passed:
            record.note = (
                record.note + "; " if record.note else ""
            ) + f"HUMAN OVERRIDE by {approved_by or requested_by} despite {len(result.blocking)} failed check(s)"
        from aegisquant.ops.alerts import raise_alert

        raise_alert(
            session,
            E.AlertKind.PROMOTION,
            E.AlertSeverity.WARNING if force and not result.passed else E.AlertSeverity.INFO,
            f"Strategy promoted: {strategy_key} → {result.to_status.value}",
            (
                f"Requested by {requested_by}"
                + (f", approved by {approved_by}" if approved_by else "")
                + (f". OVERRIDE: {len(result.blocking)} check(s) failed." if force and not result.passed else "")
            ),
        )
    session.flush()
    return result, record


def evaluate_all(session: Session) -> list[dict[str, Any]]:
    out = []
    for row in session.scalars(select(StrategyRow).order_by(StrategyRow.key)):
        out.append(evaluate(session, row.key).as_dict())
    return out
