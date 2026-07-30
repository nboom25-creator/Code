"""The autonomous decision loop.

Fifteen explicit steps, each recorded on the :class:`LoopRun` row so a cycle can
be audited after the fact:

1.  verify system and data health
2.  determine whether the market is open
3.  update point-in-time data
4.  classify the market regime
5.  generate candidates
6.  validate signal freshness
7.  estimate expected return, uncertainty, costs and downside
8.  compare each opportunity with existing portfolio risk
9.  produce proposed actions
10. pass every action through the deterministic risk engine
11. submit orders only if all checks pass
12. monitor acknowledgements, fills, rejections and partial fills
13. reconcile broker and local state
14. update the audit log
15. continue monitoring exit criteria and risk conditions

Failing early is the normal case. A cycle that stops at step 1 because data is
stale has done its job. Every stop reason is recorded.
"""

from __future__ import annotations

import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from aegisquant.backtest.costs import CostModel, estimate_total_cost_bps
from aegisquant.config import Settings, get_settings
from aegisquant.data import quality as Q
from aegisquant.data.ingest import ingest_universe, refresh_quote
from aegisquant.data.registry import provider_health
from aegisquant.db import enums as E
from aegisquant.db.models import (
    Decision,
    Instrument,
    LoopRun,
    Order,
    PortfolioSnapshot,
    Position,
    Quarantine,
    Quote,
    ReconciliationRun,
    RiskCheck,
    RiskConfig,
)
from aegisquant.db.models import (
    Strategy as StrategyRow,
)
from aegisquant.db.repo import (
    current_mode,
    get_active_risk_config,
    get_system_state,
    is_market_open_on,
    latest_snapshot,
    open_orders,
)
from aegisquant.execution.broker.base import Broker, BrokerError
from aegisquant.execution.broker.factory import get_broker
from aegisquant.execution.oms import OrderManager, SubmitRequest
from aegisquant.explain.narrator import explain_decision, explain_review
from aegisquant.features.engine import compute_bundle, persist_bundle
from aegisquant.features.market_view import MarketView
from aegisquant.logging_setup import get_logger
from aegisquant.ops.alerts import raise_alert, record_metric
from aegisquant.portfolio.construction import construct_portfolio
from aegisquant.portfolio.sizing import quantity_from_weight
from aegisquant.risk.engine import (
    AccountSnapshot,
    OrderIntent,
    PositionSnapshot,
    RiskEngine,
    cooldown_expiry,
    derive_risk_state,
)
from aegisquant.strategies import regime as regime_mod
from aegisquant.strategies.base import OpenPositionState, Strategy, StrategyContext
from aegisquant.strategies.ensemble import load_previous_weights, paused_strategies
from aegisquant.strategies.registry import build_all
from aegisquant.utils.money import ZERO, D, safe_div
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)


@dataclass(slots=True)
class StepRecord:
    name: str
    ok: bool
    detail: dict[str, Any] = field(default_factory=dict)
    message: str = ""
    duration_ms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "ok": self.ok,
            "message": self.message,
            "duration_ms": self.duration_ms,
            "detail": self.detail,
        }


@dataclass(slots=True)
class LoopOutcome:
    run_id: int | None
    status: E.RunStatus
    steps: list[StepRecord] = field(default_factory=list)
    halted_reason: str | None = None
    summary: str = ""
    decisions: list[int] = field(default_factory=list)
    orders_submitted: int = 0
    orders_rejected: int = 0
    candidates: int = 0
    regime: E.Regime | None = None
    error: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status.value,
            "halted_reason": self.halted_reason,
            "summary": self.summary,
            "decisions": self.decisions,
            "orders_submitted": self.orders_submitted,
            "orders_rejected": self.orders_rejected,
            "candidates": self.candidates,
            "regime": self.regime.value if self.regime else None,
            "steps": [s.as_dict() for s in self.steps],
            "error": self.error,
        }


class AutonomousLoop:
    """One cycle of the research-then-decide loop."""

    def __init__(
        self,
        session: Session,
        *,
        broker: Broker | None = None,
        settings: Settings | None = None,
        universe: list[str] | None = None,
        now: datetime | None = None,
        ingest: bool = True,
        trigger: str = "scheduler",
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.broker = broker or get_broker()
        self.mode = current_mode()
        self.now = now or utcnow()
        self.universe = [s.upper() for s in universe] if universe else self._default_universe()
        self.do_ingest = ingest
        self.trigger = trigger
        self.limits = self._limits()
        self.risk_engine = RiskEngine(self.limits)
        self.strategies: list[Strategy] = build_all()
        self.steps: list[StepRecord] = []
        self._run: LoopRun | None = None

    # ------------------------------------------------------------------
    def _default_universe(self) -> list[str]:
        rows = self.session.scalars(
            select(Instrument.symbol).where(
                Instrument.is_active.is_(True),
                Instrument.is_tradable.is_(True),
                Instrument.is_leveraged_etf.is_(False),
            )
        ).all()
        universe = list(rows)[: self.settings.universe_max_symbols]
        if self.settings.benchmark_symbol not in universe:
            universe.append(self.settings.benchmark_symbol)
        return universe

    def _limits(self):
        from aegisquant.config import RiskLimits

        row: RiskConfig | None = get_active_risk_config(self.session)
        if row is None:
            return self.settings.risk
        try:
            return RiskLimits(**row.limits)
        except Exception as exc:
            log.warning("risk_config_invalid_using_defaults", error=str(exc))
            return self.settings.risk

    def _step(self, name: str) -> Any:
        class _Ctx:
            def __init__(self, outer: AutonomousLoop, step_name: str) -> None:
                self.outer = outer
                self.record = StepRecord(name=step_name, ok=True)
                self.started = 0.0

            def __enter__(self) -> StepRecord:
                self.started = time.monotonic()
                return self.record

            def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
                # Returns None so an exception is never suppressed: a step that
                # raised must still fail the cycle.
                self.record.duration_ms = int((time.monotonic() - self.started) * 1000)
                if exc_type is not None:
                    self.record.ok = False
                    self.record.message = f"{exc_type.__name__}: {exc}"
                self.outer.steps.append(self.record)

        return _Ctx(self, name)

    # ------------------------------------------------------------------
    def run(self) -> LoopOutcome:
        started = utcnow()
        run = LoopRun(
            started_at=started,
            mode=self.mode,
            status=E.RunStatus.RUNNING,
            trigger=self.trigger,
        )
        self.session.add(run)
        self.session.flush()
        self._run = run
        outcome = LoopOutcome(run_id=run.id, status=E.RunStatus.RUNNING)

        try:
            self._execute(outcome)
            outcome.status = E.RunStatus.COMPLETED
        except Exception as exc:
            log.exception("loop_failed")
            outcome.status = E.RunStatus.FAILED
            outcome.error = f"{type(exc).__name__}: {exc}"
            raise_alert(
                self.session,
                E.AlertKind.APPLICATION_FAILURE,
                E.AlertSeverity.CRITICAL,
                "Autonomous loop failed",
                f"{outcome.error}\n{traceback.format_exc(limit=4)}",
            )
        finally:
            finished = utcnow()
            run.finished_at = finished
            run.status = outcome.status
            run.steps = {"steps": [s.as_dict() for s in self.steps]}
            run.halted_reason = outcome.halted_reason
            run.summary = outcome.summary
            run.error = outcome.error
            run.regime = outcome.regime
            run.candidates_considered = outcome.candidates
            run.decisions_made = len(outcome.decisions)
            run.orders_submitted = outcome.orders_submitted
            run.orders_rejected = outcome.orders_rejected
            run.duration_ms = int((finished - started).total_seconds() * 1000)
            run.health_ok = all(s.ok for s in self.steps[:2]) if self.steps else None
            state = get_system_state(self.session)
            state.last_loop_at = started
            record_metric(self.session, "loop_duration_ms", run.duration_ms)
            self.session.flush()
        outcome.steps = self.steps
        return outcome

    # ------------------------------------------------------------------
    def _execute(self, outcome: LoopOutcome) -> None:
        settings = self.settings

        # === 1. system and data health ===
        with self._step("1_verify_health") as step:
            health = provider_health()
            issues = Q.open_issue_summary(self.session)
            state = get_system_state(self.session)
            broker_health = self.broker.health()
            step.detail = {
                "providers": health,
                "data_issues": issues,
                "broker": broker_health,
                "kill_switch": state.kill_switch_engaged,
                "read_only": state.read_only,
                "risk_state": state.risk_state.value,
            }
            state.broker_connected = bool(broker_health.get("connected"))
            if broker_health.get("connected"):
                state.broker_last_ok_at = self.now

            blockers: list[str] = []
            if state.kill_switch_engaged:
                blockers.append(f"kill switch engaged: {state.kill_switch_reason or 'no reason recorded'}")
            if state.read_only:
                blockers.append("system is in read-only mode")
            if not broker_health.get("ok"):
                blockers.append(f"broker unavailable: {broker_health.get('error')}")
            if not health.get("all_ok"):
                failed = [k for k, v in health.items() if isinstance(v, dict) and not v.get("ok")]
                blockers.append(f"data providers unavailable: {', '.join(failed)}")
            if issues["blocking"] > 0:
                blockers.append(f"{issues['blocking']} blocking data-quality issue(s) open")

            if blockers:
                step.ok = False
                step.message = "; ".join(blockers)
                outcome.halted_reason = step.message
                outcome.summary = "Cycle stopped at the health check without trading. " + step.message
                # Even when halted, keep managing existing risk if we can talk to
                # the broker: exits are what protect capital.
                if broker_health.get("ok") and not state.read_only:
                    self._monitor_and_reconcile(outcome)
                return
            step.message = "system, provider and broker health all verified"

        # === 2. market open? ===
        with self._step("2_market_status") as step:
            try:
                broker_open = self.broker.is_market_open()
            except BrokerError as exc:
                broker_open = False
                step.message = f"broker clock unavailable ({exc.message}); using the calendar"
            calendar_open = is_market_open_on(self.session, self.now.date())
            market_open = bool(broker_open and calendar_open)
            step.detail = {
                "broker_says_open": broker_open,
                "calendar_says_open": calendar_open,
                "session_date": self.now.date().isoformat(),
            }
            if self._run:
                self._run.market_open = market_open
            if not market_open:
                step.ok = True
                step.message = "market is closed — monitoring and reconciling only, no new orders"
                outcome.halted_reason = "market closed"
                self._monitor_and_reconcile(outcome)
                outcome.summary = "Market closed. Positions and orders were reconciled; no orders were placed."
                return
            step.message = "market is open"

        # === 3. update point-in-time data ===
        with self._step("3_update_data") as step:
            if self.do_ingest:
                report = ingest_universe(
                    self.session,
                    self.universe,
                    self.now.date() - timedelta(days=420),
                    self.now.date(),
                    with_fundamentals=True,
                    with_news=True,
                )
                step.detail = report.as_dict()
                step.ok = report.symbols_ok > 0
                step.message = (
                    f"ingested {report.symbols_ok} symbol(s), {report.bars_written} bar(s); "
                    f"{report.symbols_failed} failed"
                )
                if report.symbols_failed and report.symbols_ok == 0:
                    outcome.halted_reason = "market-data ingestion failed for the entire universe"
                    outcome.summary = (
                        "No market data could be retrieved, so no decision was made. "
                        "Doing nothing is the correct outcome when data cannot be verified."
                    )
                    return
            else:
                step.message = "ingestion skipped (data assumed current)"

        # === 4. classify regime ===
        with self._step("4_classify_regime") as step:
            view = MarketView.load(self.session, self.universe, benchmark=settings.benchmark_symbol)
            bundle = compute_bundle(
                view,
                self.now,
                min_price=float(self.limits.min_price),
                min_adv_usd=float(self.limits.min_adv_usd),
            )
            assessment = regime_mod.assess(bundle, self.session)
            regime_mod.persist(self.session, self.now, assessment)
            outcome.regime = assessment.regime
            step.detail = assessment.as_dict()
            step.message = assessment.explanation
            if assessment.unclassifiable:
                step.ok = False

        # === 5-6. candidates and signal freshness ===
        with self._step("5_generate_candidates") as step:
            paused = paused_strategies(self.session)
            signals = []
            per_strategy: dict[str, int] = {}
            positions = self._position_states(bundle)
            ctx = StrategyContext(
                as_of=self.now,
                pit=view.at(self.now),
                features=bundle,
                regime=assessment.regime,
                regime_score=assessment.score,
                positions=positions,
                equity=float(self._equity()),
                cash=float(self._cash()),
            )
            for strategy in self.strategies:
                if strategy.meta.key in paused:
                    continue
                if not strategy.supports_regime(assessment.regime):
                    continue
                try:
                    produced = strategy.generate(ctx)
                except Exception:
                    log.exception("strategy_failed", strategy=strategy.meta.key)
                    continue
                per_strategy[strategy.meta.key] = len(produced)
                signals.extend(produced)
            outcome.candidates = len(signals)
            step.detail = {
                "per_strategy": per_strategy,
                "paused": sorted(paused),
                "universe_size": len(bundle.symbols),
                "total_signals": len(signals),
            }
            step.message = f"{len(signals)} signal(s) from {len(per_strategy)} active strategy(ies)"
            persist_bundle(self.session, bundle)

        with self._step("6_validate_signal_freshness") as step:
            stale: list[str] = []
            for signal in list(signals):
                age = view.at(self.now).data_age_seconds(signal.symbol)
                if age is None or age > self.limits.max_data_age_seconds + 86400:
                    # Daily bars are a day old by nature; the budget applies to the
                    # quote at order time. Anything beyond a day plus the budget is
                    # genuinely stale and the candidate is dropped.
                    stale.append(signal.symbol)
                    signals.remove(signal)
            step.detail = {"dropped_for_staleness": stale, "remaining": len(signals)}
            step.message = (
                f"{len(stale)} candidate(s) dropped for stale data; {len(signals)} remain"
                if stale
                else f"all {len(signals)} candidate(s) have fresh data"
            )

        # === 7-8. expectations and portfolio comparison ===
        with self._step("7_estimate_and_compare") as step:
            equity = self._equity()
            snapshot = latest_snapshot(self.session, self.mode)
            drawdown = snapshot.drawdown_pct if snapshot and snapshot.drawdown_pct else ZERO
            target = construct_portfolio(
                as_of=self.now,
                pit=view.at(self.now),
                features=bundle,
                signals=signals,
                positions=self._position_states(bundle),
                limits=self.limits,
                regime=assessment.regime,
                regime_scale=assessment.new_entry_scale,
                concentration_scale=assessment.concentration_scale,
                min_confidence=assessment.min_confidence,
                strategy_weights=load_previous_weights(self.session)[0],
                sizing_methods={s.meta.key: s.meta.sizing_method for s in self.strategies},
                current_drawdown=drawdown,
                max_new_positions=3,
            )
            step.detail = {
                "targets": len(target.targets),
                "rejected": target.rejected,
                "cash_target": str(target.cash_target),
                "cash_reason": target.cash_reason,
                "gross_target": str(target.gross_target),
                "notes": target.notes,
            }
            step.message = (
                f"{len(target.targets)} target position(s); {len(target.rejected)} candidate(s) "
                f"rejected by portfolio construction"
            )

        # === 9-11. propose, risk-check, submit ===
        oms = OrderManager(self.session, self.broker, self.mode)
        account = self._account_snapshot(assessment.regime, bundle)

        with self._step("9_review_open_positions") as step:
            reviews = self._review_positions(ctx, oms, account, outcome)
            step.detail = {"reviews": reviews}
            step.message = f"reviewed {len(reviews)} open position(s)"

        with self._step("10_risk_and_submit") as step:
            submitted, rejected, decision_ids = self._process_targets(
                target, bundle, view, assessment, account, oms, equity
            )
            outcome.orders_submitted += submitted
            outcome.orders_rejected += rejected
            outcome.decisions.extend(decision_ids)
            step.detail = {
                "submitted": submitted,
                "rejected": rejected,
                "decisions": decision_ids,
            }
            step.message = f"{submitted} order(s) submitted, {rejected} blocked by the risk engine"

        # === 12-13. monitor and reconcile ===
        self._monitor_and_reconcile(outcome)

        # === 14. audit / snapshot ===
        with self._step("14_update_audit") as step:
            snapshot = self._write_snapshot(assessment.regime)
            step.detail = {
                "equity": str(snapshot.equity),
                "cash": str(snapshot.cash),
                "positions": snapshot.open_positions,
                "risk_state": snapshot.risk_state.value,
                "drawdown": str(snapshot.drawdown_pct),
            }
            step.message = "portfolio snapshot and audit records written"

        # === 15. risk-condition monitoring ===
        with self._step("15_monitor_risk_conditions") as step:
            actions = self._enforce_risk_state(snapshot, oms)
            step.detail = actions
            step.message = actions.get("summary", "risk conditions within tolerance")

        outcome.summary = (
            f"{assessment.regime.value} regime. {outcome.candidates} candidate(s) considered, "
            f"{len(outcome.decisions)} decision(s) recorded, {outcome.orders_submitted} order(s) "
            f"submitted, {outcome.orders_rejected} blocked by risk. "
            f"Equity {snapshot.equity:,.2f}, drawdown {float(snapshot.drawdown_pct or 0):.2%}."
        )

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------
    def _positions(self) -> list[Position]:
        return list(self.session.scalars(select(Position).where(Position.mode == self.mode, Position.quantity != 0)))

    def _equity(self) -> Decimal:
        try:
            return self.broker.get_account().equity
        except BrokerError:
            snapshot = latest_snapshot(self.session, self.mode)
            return snapshot.equity if snapshot else ZERO

    def _cash(self) -> Decimal:
        try:
            return self.broker.get_account().cash
        except BrokerError:
            snapshot = latest_snapshot(self.session, self.mode)
            return snapshot.cash if snapshot else ZERO

    def _position_states(self, bundle: Any) -> dict[str, OpenPositionState]:
        equity = self._equity()
        out: dict[str, OpenPositionState] = {}
        for pos in self._positions():
            price = pos.last_price or pos.avg_entry_price
            out[pos.symbol] = OpenPositionState(
                symbol=pos.symbol,
                quantity=float(pos.quantity),
                avg_entry_price=float(pos.avg_entry_price),
                last_price=float(price),
                unrealized_pnl_pct=float(pos.unrealized_pnl_pct or 0),
                holding_days=(self.now - pos.opened_at).days if pos.opened_at else 0,
                peak_price=float(pos.peak_price or price),
                weight=float(safe_div(pos.quantity * price, equity)),
                strategy_key=pos.strategy_key,
                entry_thesis=pos.entry_thesis,
                exit_criteria=pos.exit_criteria or {},
            )
        return out

    def _account_snapshot(self, regime: E.Regime, bundle: Any) -> AccountSnapshot:
        state = get_system_state(self.session)
        try:
            account = self.broker.get_account()
            equity, cash, buying_power = account.equity, account.cash, account.buying_power
            connected = True
        except BrokerError:
            snapshot = latest_snapshot(self.session, self.mode)
            equity = snapshot.equity if snapshot else ZERO
            cash = snapshot.cash if snapshot else ZERO
            buying_power = cash
            connected = False

        positions: dict[str, PositionSnapshot] = {}
        for pos in self._positions():
            price = pos.last_price or pos.avg_entry_price
            inst = self.session.scalar(select(Instrument).where(Instrument.symbol == pos.symbol))
            positions[pos.symbol] = PositionSnapshot(
                symbol=pos.symbol,
                quantity=pos.quantity,
                market_value=pos.quantity * price,
                avg_entry_price=pos.avg_entry_price,
                last_price=price,
                sector=(inst.sector if inst else None) or "Unclassified",
                strategy_key=pos.strategy_key,
                unrealized_pnl=pos.unrealized_pnl or ZERO,
            )

        open_local = open_orders(self.session, self.mode)
        oldest = None
        if open_local:
            ages = [(self.now - o.submitted_at).total_seconds() for o in open_local if o.submitted_at is not None]
            oldest = max(ages) if ages else None

        today_snapshots = list(
            self.session.scalars(
                select(PortfolioSnapshot)
                .where(
                    PortfolioSnapshot.mode == self.mode,
                    PortfolioSnapshot.session_date == self.now.date(),
                )
                .order_by(PortfolioSnapshot.at)
            )
        )
        day_start = today_snapshots[0].equity if today_snapshots else equity
        week_start = day_start
        monday = self.now.date() - timedelta(days=self.now.weekday())
        week_rows = list(
            self.session.scalars(
                select(PortfolioSnapshot)
                .where(
                    PortfolioSnapshot.mode == self.mode,
                    PortfolioSnapshot.session_date >= monday,
                )
                .order_by(PortfolioSnapshot.at)
            )
        )
        if week_rows:
            week_start = week_rows[0].equity
        hwm = self.session.scalar(
            select(PortfolioSnapshot.high_water_mark)
            .where(PortfolioSnapshot.mode == self.mode)
            .order_by(PortfolioSnapshot.at.desc())
            .limit(1)
        )

        quarantined = {
            q.key
            for q in self.session.scalars(
                select(Quarantine).where(Quarantine.active.is_(True), Quarantine.scope == "symbol")
            )
        }
        unresolved_recon = (
            self.session.scalar(
                select(ReconciliationRun)
                .where(ReconciliationRun.resolved.is_(False))
                .order_by(ReconciliationRun.at.desc())
                .limit(1)
            )
            is not None
        )
        issues = Q.open_issue_summary(self.session)

        turnover_today = sum(
            (
                (o.filled_quantity or ZERO) * (o.avg_fill_price or ZERO)
                for o in self.session.scalars(
                    select(Order).where(
                        Order.mode == self.mode,
                        Order.created_at
                        >= datetime.combine(self.now.date(), datetime.min.time(), tzinfo=self.now.tzinfo),
                    )
                )
            ),
            ZERO,
        )

        return AccountSnapshot(
            as_of=self.now,
            equity=equity,
            cash=cash,
            buying_power=buying_power,
            positions=positions,
            open_order_count=len(open_local),
            oldest_open_order_age_seconds=oldest,
            day_start_equity=day_start,
            week_start_equity=week_start,
            high_water_mark=hwm or equity,
            turnover_today_notional=turnover_today,
            market_open=True,
            session_date=self.now.date(),
            regime=regime,
            risk_state=state.risk_state,
            kill_switch=state.kill_switch_engaged,
            read_only=state.read_only,
            cooldown_until=state.cooldown_until,
            trading_halted=state.trading_halted_for_date == self.now.date(),
            halt_reason=state.halt_reason,
            quarantined_symbols=quarantined,
            paused_strategies=paused_strategies(self.session),
            open_data_issues=issues["open_total"],
            unresolved_recon_breaks=1 if unresolved_recon else 0,
            broker_connected=connected,
        )

    # ------------------------------------------------------------------
    def _review_positions(
        self,
        ctx: StrategyContext,
        oms: OrderManager,
        account: AccountSnapshot,
        outcome: LoopOutcome,
    ) -> list[dict[str, Any]]:
        by_key = {s.meta.key: s for s in self.strategies}
        results: list[dict[str, Any]] = []
        for symbol, state in ctx.positions.items():
            strategy = by_key.get(state.strategy_key or "")
            if strategy is None:
                strategy = self.strategies[0]  # default conservative review
            review = strategy.review(ctx, state)
            explanation = explain_review(
                symbol=symbol,
                action=review.action,
                thesis_status=review.thesis_status,
                reason=review.reason,
                signal_inputs=review.signal_inputs,
                unrealized_pnl_pct=D(state.unrealized_pnl_pct),
                holding_days=state.holding_days,
            )
            results.append({**review.as_dict(), "explanation": explanation})

            if review.action in ("hold", "add"):
                # Adds go through the normal entry path so they are risk-checked
                # like any other purchase; nothing is bought from a review.
                continue

            pos = self.session.scalar(select(Position).where(Position.mode == self.mode, Position.symbol == symbol))
            if pos is None or pos.quantity <= 0:
                continue
            quantity = (
                pos.quantity
                if review.action == "exit"
                else (pos.quantity * (Decimal(1) - D(review.target_fraction))).quantize(Decimal("1"))
            )
            if quantity <= 0:
                continue

            decision = self._record_decision(
                action=E.DecisionAction.EXIT if review.action == "exit" else E.DecisionAction.TRIM,
                symbol=symbol,
                strategy_key=state.strategy_key,
                proposed_quantity=quantity,
                reference_price=D(state.last_price),
                confidence=D(review.confidence),
                signal_inputs=review.signal_inputs,
                explanation=explanation,
                regime=ctx.regime,
                thesis=pos.entry_thesis or "",
                exit_criteria=pos.exit_criteria or {},
            )
            intent = OrderIntent(
                symbol=symbol,
                side=E.Side.SELL,
                quantity=quantity,
                order_type=E.OrderType.MARKET,
                reference_price=D(state.last_price),
                strategy_key=state.strategy_key,
                sector=account.positions[symbol].sector if symbol in account.positions else "Unclassified",
                reduce_only=True,
                data_age_seconds=0.0,
                fractionable=self.broker.supports_fractional,
                confidence=D(review.confidence),
            )
            verdict = self.risk_engine.evaluate(intent, account)
            self._record_risk_checks(decision, verdict)
            decision.risk_verdict = verdict.as_dict()
            decision.approved_quantity = verdict.approved_quantity
            if not verdict.approved:
                decision.approval_state = E.ApprovalState.REJECTED_BY_RISK
                decision.rejection_reason = "; ".join(verdict.rejections[:2])
                outcome.orders_rejected += 1
                outcome.decisions.append(decision.id)
                continue
            decision.approval_state = E.ApprovalState.AUTO_APPROVED
            result = oms.submit(
                SubmitRequest(
                    symbol=symbol,
                    side=E.Side.SELL,
                    quantity=verdict.approved_quantity,
                    order_type=E.OrderType.MARKET,
                    reference_price=D(state.last_price),
                    strategy_key=state.strategy_key,
                    decision_id=decision.id,
                    reduce_only=True,
                ),
                now=self.now,
            )
            if result.submitted:
                outcome.orders_submitted += 1
            outcome.decisions.append(decision.id)
        return results

    # ------------------------------------------------------------------
    def _process_targets(
        self,
        target: Any,
        bundle: Any,
        view: MarketView,
        assessment: Any,
        account: AccountSnapshot,
        oms: OrderManager,
        equity: Decimal,
    ) -> tuple[int, int, list[int]]:
        submitted = rejected = 0
        decision_ids: list[int] = []
        cost_model = CostModel(allow_fractional=self.broker.supports_fractional)
        pit = view.at(self.now)

        for tp in target.targets:
            if tp.delta_weight <= 0:
                continue
            quote = self._refresh_quote(tp.symbol)
            price = self._decision_price(tp.symbol, quote, pit)
            if price is None or price <= 0:
                continue
            quantity = quantity_from_weight(tp.delta_weight, equity, price, self.broker.supports_fractional)
            if quantity <= 0:
                continue

            sf = bundle.symbols.get(tp.symbol)
            adv_usd = D(sf.get("adv_usd_20")) if sf and sf.get("adv_usd_20") else None
            vol = tp.expected_vol
            spread_bps = quote.spread_bps if quote else None
            costs = estimate_total_cost_bps(
                quantity=quantity,
                price=price,
                bar_volume=(adv_usd / price) if adv_usd else None,
                cost_model=cost_model,
                daily_vol=(vol / D(16)) if vol else None,
                dollar_volume=adv_usd,
                quoted_spread_bps=spread_bps,
                order_type=E.OrderType.LIMIT,
            )
            inst = self.session.scalar(select(Instrument).where(Instrument.symbol == tp.symbol))
            limit_price = (price * (Decimal(1) + Decimal("0.003"))).quantize(Decimal("0.01"))

            decision = self._record_decision(
                action=E.DecisionAction.ADD if tp.action == "add" else E.DecisionAction.BUY,
                symbol=tp.symbol,
                strategy_key=tp.primary_strategy,
                proposed_quantity=quantity,
                reference_price=price,
                limit_price=limit_price,
                confidence=tp.confidence,
                signal_inputs=tp.signal_inputs,
                explanation="",  # filled in after the risk verdict
                regime=assessment.regime,
                thesis=tp.thesis,
                exit_criteria=tp.exit_criteria,
                expected_return=tp.expected_return,
                expected_holding_days=tp.expected_holding_days,
                risk_contribution=tp.risk_contribution,
                estimated_cost_bps=costs["total_cost_bps"],
                sizing_detail=tp.sizing.as_dict(),
                supporting=tp.supporting_evidence,
                opposing=tp.opposing_evidence,
                invalidating=tp.invalidating_conditions,
            )

            intent = OrderIntent(
                symbol=tp.symbol,
                side=E.Side.BUY,
                quantity=quantity,
                order_type=E.OrderType.LIMIT,
                reference_price=price,
                limit_price=limit_price,
                strategy_key=tp.primary_strategy,
                sector=tp.sector or "Unclassified",
                adv_usd=adv_usd,
                adv_shares=(adv_usd / price) if adv_usd else None,
                spread_bps=spread_bps,
                estimated_impact_bps=costs["impact_bps"],
                estimated_total_cost_bps=costs["total_cost_bps"],
                asset_vol=vol,
                data_age_seconds=((self.now - quote.observed_at).total_seconds() if quote else None),
                data_quality=(quote.data_quality.value if quote else "missing"),
                correlation_to_book=tp.correlation_to_book,
                tradable=bool(inst.is_tradable) if inst else True,
                shortable=bool(inst.shortable) if inst else False,
                is_leveraged_etf=bool(inst.is_leveraged_etf) if inst else False,
                delisted=bool(inst and inst.delisted_on),
                fractionable=self.broker.supports_fractional,
                confidence=tp.confidence,
            )
            verdict = self.risk_engine.evaluate(intent, account)
            self._record_risk_checks(decision, verdict)
            decision.risk_verdict = verdict.as_dict()
            decision.approved_quantity = verdict.approved_quantity
            decision.explanation = explain_decision(
                action=decision.action,
                symbol=tp.symbol,
                quantity=quantity,
                approved_quantity=verdict.approved_quantity,
                reference_price=price,
                strategy_key=tp.primary_strategy,
                strategies=tp.strategies,
                confidence=tp.confidence,
                signal_inputs=tp.signal_inputs,
                sizing_detail=tp.sizing.as_dict(),
                risk_verdict=verdict.as_dict(),
                regime=assessment.regime,
                sector=tp.sector,
                expected_return=tp.expected_return,
                expected_holding_days=tp.expected_holding_days,
                growth_score=tp.growth_score,
                exit_criteria=tp.exit_criteria,
                estimated_cost_bps=costs["total_cost_bps"],
                weaknesses=(sf.growth.weaknesses if sf and sf.growth else None),
                thesis=tp.thesis,
            )
            decision_ids.append(decision.id)

            if not verdict.approved:
                decision.approval_state = E.ApprovalState.REJECTED_BY_RISK
                decision.rejection_reason = "; ".join(verdict.rejections[:3])
                rejected += 1
                continue

            decision.approval_state = E.ApprovalState.AUTO_APPROVED
            result = oms.submit(
                SubmitRequest(
                    symbol=tp.symbol,
                    side=E.Side.BUY,
                    quantity=verdict.approved_quantity,
                    order_type=E.OrderType.LIMIT,
                    reference_price=price,
                    limit_price=limit_price,
                    strategy_key=tp.primary_strategy,
                    decision_id=decision.id,
                    expected_spread_bps=costs["spread_bps"],
                    expected_slippage_bps=costs["slippage_bps"],
                    expected_impact_bps=costs["impact_bps"],
                    expected_total_cost_bps=costs["total_cost_bps"],
                ),
                now=self.now,
            )
            if result.submitted:
                submitted += 1
                # Fold the new exposure into the snapshot so later candidates in
                # the same cycle see it.
                account.positions[tp.symbol] = PositionSnapshot(
                    symbol=tp.symbol,
                    quantity=verdict.approved_quantity,
                    market_value=verdict.approved_quantity * price,
                    avg_entry_price=price,
                    last_price=price,
                    sector=tp.sector or "Unclassified",
                    strategy_key=tp.primary_strategy,
                )
                account.cash -= verdict.approved_quantity * price
                account.buying_power = account.cash
                account.turnover_today_notional += verdict.approved_quantity * price
            else:
                rejected += 1
                decision.rejection_reason = result.reason
        return submitted, rejected, decision_ids

    def _refresh_quote(self, symbol: str) -> Quote | None:
        try:
            return refresh_quote(self.session, symbol)
        except Exception as exc:
            log.warning("quote_refresh_failed", symbol=symbol, error=str(exc))
            return None

    def _decision_price(self, symbol: str, quote: Quote | None, pit: Any) -> Decimal | None:
        if quote is not None:
            for candidate in (quote.last, quote.bid and quote.ask and (quote.bid + quote.ask) / 2):
                if candidate:
                    return D(candidate)
        close = pit.last_close(symbol)
        return D(close) if close else None

    # ------------------------------------------------------------------
    def _record_decision(
        self,
        *,
        action: E.DecisionAction,
        symbol: str,
        strategy_key: str | None,
        proposed_quantity: Decimal,
        reference_price: Decimal,
        confidence: Decimal,
        signal_inputs: dict[str, Any],
        explanation: str,
        regime: E.Regime,
        thesis: str = "",
        exit_criteria: dict[str, Any] | None = None,
        limit_price: Decimal | None = None,
        expected_return: Decimal | None = None,
        expected_holding_days: int | None = None,
        risk_contribution: Decimal | None = None,
        estimated_cost_bps: Decimal | None = None,
        sizing_detail: dict[str, Any] | None = None,
        supporting: list[str] | None = None,
        opposing: list[str] | None = None,
        invalidating: list[str] | None = None,
    ) -> Decision:
        from aegisquant.features.registry import registry_version

        strategy_version = None
        if strategy_key:
            row = self.session.scalar(select(StrategyRow).where(StrategyRow.key == strategy_key))
            if row and row.versions:
                strategy_version = row.versions[-1].version

        decision = Decision(
            decided_at=self.now,
            loop_run_id=self._run.id if self._run else None,
            mode=self.mode,
            symbol=symbol,
            action=action,
            strategy_key=strategy_key,
            strategy_version=strategy_version,
            model_version=registry_version(),
            registry_version=registry_version(),
            proposed_quantity=proposed_quantity,
            proposed_notional=proposed_quantity * reference_price,
            reference_price=reference_price,
            limit_price=limit_price,
            confidence=confidence,
            uncertainty=(Decimal(1) - confidence) if confidence is not None else None,
            expected_return=expected_return,
            expected_holding_days=expected_holding_days,
            risk_contribution=risk_contribution,
            estimated_cost_bps=estimated_cost_bps,
            regime=regime,
            signal_inputs=signal_inputs,
            entry_thesis=thesis,
            exit_criteria=exit_criteria,
            invalidating_conditions={"conditions": invalidating} if invalidating else None,
            bull_case="; ".join(supporting) if supporting else None,
            bear_case="; ".join(opposing) if opposing else None,
            explanation=explanation,
            sizing_detail=sizing_detail,
            approval_state=E.ApprovalState.PENDING_HUMAN,
            is_synthetic=self.broker.name == "mock",
        )
        self.session.add(decision)
        self.session.flush()
        return decision

    def _record_risk_checks(self, decision: Decision, verdict: Any) -> None:
        for check in verdict.checks:
            self.session.add(
                RiskCheck(
                    decision_id=decision.id,
                    at=self.now,
                    check_name=check.name,
                    result=check.result,
                    observed=check.observed,
                    limit_value=check.limit_value,
                    utilization=check.utilization,
                    message=check.message,
                    detail=check.detail or None,
                )
            )
        self.session.flush()

    # ------------------------------------------------------------------
    def _monitor_and_reconcile(self, outcome: LoopOutcome) -> None:
        with self._step("12_monitor_orders") as step:
            try:
                poll = OrderManager(self.session, self.broker, self.mode).poll_open_orders()
                stale = OrderManager(self.session, self.broker, self.mode).cancel_stale_orders(
                    self.limits.max_open_order_seconds
                )
                step.detail = {**poll, "stale_cancelled": stale}
                step.message = f"polled {poll['polled']} open order(s); cancelled {stale} stale order(s)"
            except BrokerError as exc:
                step.ok = False
                step.message = f"order monitoring failed: {exc.message}"

        with self._step("13_reconcile") as step:
            try:
                run = OrderManager(self.session, self.broker, self.mode).reconcile()
                step.detail = {
                    "status": run.status.value,
                    "breaks": (run.breaks or {}).get("count", 0),
                    "healed": (run.auto_healed or {}).get("count", 0),
                    "resolved": run.resolved,
                }
                step.ok = run.status is not E.ReconStatus.FAILED
                step.message = (
                    f"reconciliation {run.status.value}: "
                    f"{(run.breaks or {}).get('count', 0)} break(s), "
                    f"{(run.auto_healed or {}).get('count', 0)} healed"
                )
            except Exception as exc:
                step.ok = False
                step.message = f"reconciliation error: {exc}"

    def _write_snapshot(self, regime: E.Regime) -> PortfolioSnapshot:
        try:
            account = self.broker.get_account()
            equity, cash, buying_power = account.equity, account.cash, account.buying_power
            source = "broker"
        except BrokerError:
            previous = latest_snapshot(self.session, self.mode)
            equity = previous.equity if previous else ZERO
            cash = previous.cash if previous else ZERO
            buying_power = cash
            source = "local"

        positions = self._positions()
        long_mv = sum((p.quantity * (p.last_price or p.avg_entry_price) for p in positions), ZERO)
        prior = latest_snapshot(self.session, self.mode)
        hwm = max(equity, prior.high_water_mark if prior and prior.high_water_mark else equity)
        drawdown = safe_div(equity - hwm, hwm)

        today = list(
            self.session.scalars(
                select(PortfolioSnapshot)
                .where(
                    PortfolioSnapshot.mode == self.mode,
                    PortfolioSnapshot.session_date == self.now.date(),
                )
                .order_by(PortfolioSnapshot.at)
            )
        )
        day_start = today[0].equity if today else equity
        state = get_system_state(self.session)
        new_state, reason = derive_risk_state(drawdown, self.limits, state.risk_state)
        if new_state is not state.risk_state:
            state.risk_state = new_state
            state.risk_state_reason = reason
            raise_alert(
                self.session,
                E.AlertKind.DRAWDOWN,
                E.AlertSeverity.CRITICAL
                if new_state in (E.RiskState.EMERGENCY, E.RiskState.DEFENSIVE_2)
                else E.AlertSeverity.WARNING,
                f"Risk state changed to {new_state.value}",
                reason,
            )

        sector_exposure: dict[str, str] = {}
        strategy_exposure: dict[str, str] = {}
        for pos in positions:
            inst = self.session.scalar(select(Instrument).where(Instrument.symbol == pos.symbol))
            sector = (inst.sector if inst else None) or "Unclassified"
            value = pos.quantity * (pos.last_price or pos.avg_entry_price)
            sector_exposure[sector] = str(D(sector_exposure.get(sector, "0")) + safe_div(value, equity))
            if pos.strategy_key:
                strategy_exposure[pos.strategy_key] = str(
                    D(strategy_exposure.get(pos.strategy_key, "0")) + safe_div(value, equity)
                )

        snapshot = PortfolioSnapshot(
            at=self.now,
            mode=self.mode,
            session_date=self.now.date(),
            equity=equity,
            cash=cash,
            buying_power=buying_power,
            long_market_value=long_mv,
            short_market_value=ZERO,
            gross_exposure=safe_div(long_mv, equity),
            net_exposure=safe_div(long_mv, equity),
            day_pnl=equity - day_start,
            day_pnl_pct=safe_div(equity - day_start, day_start),
            cumulative_pnl=equity - (prior.equity if prior else equity),
            high_water_mark=hwm,
            drawdown_pct=drawdown,
            open_positions=len(positions),
            open_orders=len(open_orders(self.session, self.mode)),
            risk_state=state.risk_state,
            sector_exposure=sector_exposure or None,
            strategy_exposure=strategy_exposure or None,
            source=source,
        )
        self.session.add(snapshot)
        record_metric(self.session, "portfolio_equity", equity)
        record_metric(self.session, "portfolio_drawdown", drawdown)
        self.session.flush()
        return snapshot

    def _enforce_risk_state(self, snapshot: PortfolioSnapshot, oms: OrderManager) -> dict[str, Any]:
        """Act on loss limits and the defensive-stage ladder."""
        actions: dict[str, Any] = {}
        state = get_system_state(self.session)
        day_pnl = snapshot.day_pnl_pct or ZERO
        drawdown = snapshot.drawdown_pct or ZERO
        messages: list[str] = []

        if day_pnl <= -self.limits.max_daily_loss_pct and state.trading_halted_for_date != self.now.date():
            state.trading_halted_for_date = self.now.date()
            state.halt_reason = (
                f"daily loss {float(day_pnl):.2%} reached the {float(self.limits.max_daily_loss_pct):.2%} limit"
            )
            state.cooldown_until = cooldown_expiry(self.now, self.limits)
            state.cooldown_reason = state.halt_reason
            state.recovery_requires_approval = True
            cancelled = oms.cancel_all("daily loss limit reached")
            actions["trading_halted"] = True
            actions["orders_cancelled"] = cancelled
            messages.append(state.halt_reason + f"; {cancelled} order(s) cancelled")
            raise_alert(
                self.session,
                E.AlertKind.DAILY_LOSS,
                E.AlertSeverity.CRITICAL,
                "Daily loss limit reached — trading halted",
                (
                    f"{state.halt_reason}. All open orders were cancelled and a "
                    f"{self.limits.loss_cooldown_hours}-hour cooldown is in force. "
                    "Recovery requires operator approval."
                ),
            )

        if state.risk_state is E.RiskState.EMERGENCY:
            cancelled = oms.cancel_all("emergency risk state")
            state.recovery_requires_approval = True
            actions["emergency_orders_cancelled"] = cancelled
            messages.append(
                f"emergency stage at {float(drawdown):.2%} drawdown: {cancelled} order(s) "
                "cancelled and new entries disabled pending review"
            )
        elif state.risk_state is E.RiskState.DEFENSIVE_2:
            messages.append(
                f"defensive stage two at {float(drawdown):.2%} drawdown: weak positions are being "
                "closed and no new entries are permitted"
            )
        elif state.risk_state is E.RiskState.DEFENSIVE_1:
            messages.append(f"defensive stage one at {float(drawdown):.2%} drawdown: new position sizes halved")

        actions["risk_state"] = state.risk_state.value
        actions["summary"] = "; ".join(messages) if messages else "risk conditions within tolerance"
        self.session.flush()
        return actions


# ---------------------------------------------------------------------------
def run_cycle(
    session: Session,
    *,
    broker: Broker | None = None,
    universe: list[str] | None = None,
    now: datetime | None = None,
    ingest: bool = True,
    trigger: str = "manual",
) -> LoopOutcome:
    loop = AutonomousLoop(session, broker=broker, universe=universe, now=now, ingest=ingest, trigger=trigger)
    return loop.run()
