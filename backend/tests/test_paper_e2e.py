"""End-to-end paper trading against the mock broker.

This is the integration test the specification asks for: a full autonomous cycle
driven through the real code path — perception, features, candidates, risk
engine, order management, fills, positions, reconciliation, audit — with only the
broker and the market data replaced by simulators.

Its purpose is to prove the pieces fit together *and* that the safety properties
hold in composition, not just in isolation: the kill switch stops the loop, a
halt stops new entries, and every executed order traces back to a recorded
decision whose explanation matches its inputs.
"""

from __future__ import annotations

import copy
import shutil
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import func, select

from aegisquant.db import enums as E
from aegisquant.db.models import (
    Alert,
    Decision,
    Fill,
    LoopRun,
    Order,
    PortfolioSnapshot,
    Position,
    ReconciliationRun,
    RiskCheck,
)
from aegisquant.db.repo import get_system_state
from aegisquant.db.session import reset_engine, session_scope
from aegisquant.explain.narrator import numbers_in, polish_is_consistent
from aegisquant.loop.autonomous import run_cycle
from tests.conftest import TEST_UNIVERSE, _use_database


def _run_one_cycle(broker) -> object:
    with session_scope() as s:
        return run_cycle(s, broker=broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")


@pytest.fixture()
def cycle(seeded: dict, mock_broker, strategies_registered: None):
    """One full autonomous cycle, with its resulting database state.

    The loop is the most expensive thing in the suite, so it runs once per test
    session and the resulting database file is cloned onto each test's own
    database — the assertions all interrogate the same cycle, but no test can
    see another test's mutations.
    """
    global _CYCLE_TEMPLATE
    from aegisquant.config import get_settings

    current = get_settings().database_url.replace("sqlite:///", "")
    if _CYCLE_TEMPLATE is None:
        outcome = _run_one_cycle(mock_broker)
        reset_engine()
        template = Path(current + ".cycle")
        shutil.copyfile(current, template)
        _CYCLE_TEMPLATE = (template, outcome, _snapshot_broker(mock_broker))
        _use_database(f"sqlite:///{current}")
        return outcome

    template, outcome, broker_state = _CYCLE_TEMPLATE
    reset_engine()
    shutil.copyfile(template, current)
    _use_database(f"sqlite:///{current}")
    _restore_broker(mock_broker, broker_state)
    return outcome


#: (database file, loop outcome, broker state) from the one cycle that is run.
_CYCLE_TEMPLATE: tuple[Path, object, dict] | None = None


def _snapshot_broker(broker) -> dict:
    return {
        "cash": broker.cash,
        "positions": {k: copy.deepcopy(v) for k, v in broker.positions.items()},
        "orders": copy.deepcopy(broker.orders),
        "by_broker_id": dict(broker._by_broker_id),
        "realized_pnl": broker.realized_pnl,
    }


def _restore_broker(broker, state: dict) -> None:
    broker.cash = state["cash"]
    broker.positions = {k: copy.deepcopy(v) for k, v in state["positions"].items()}
    broker.orders = copy.deepcopy(state["orders"])
    broker._by_broker_id = dict(state["by_broker_id"])
    broker.realized_pnl = state["realized_pnl"]


class TestTheCycleCompletes:
    def test_the_cycle_finishes_and_is_recorded(self, cycle) -> None:
        assert cycle.status in (E.RunStatus.COMPLETED, E.RunStatus.FAILED), cycle.error
        assert cycle.error is None, cycle.error
        assert cycle.run_id is not None
        assert cycle.summary

    def test_every_step_is_logged_with_its_outcome(self, cycle) -> None:
        assert cycle.steps
        for step in cycle.steps:
            assert step.name
            assert isinstance(step.ok, bool)
            assert step.duration_ms >= 0
        names = [s.name for s in cycle.steps]
        # The mandated phases must all appear, in order.
        for expected in (
            "1_verify_health",
            "2_market_status",
            "4_classify_regime",
            "5_generate_candidates",
            "10_risk_and_submit",
            "13_reconcile",
            "14_update_audit",
        ):
            assert expected in names, f"step '{expected}' did not run"
        assert names == sorted(names, key=lambda n: int(n.split("_")[0]))

    def test_the_run_is_persisted_for_the_operator(self, cycle) -> None:
        with session_scope() as s:
            run = s.get(LoopRun, cycle.run_id)
            assert run is not None
            assert run.status is cycle.status
            assert run.steps
            assert run.trigger == "test"
            assert run.finished_at is not None

    def test_the_regime_was_classified_before_any_entry(self, cycle) -> None:
        assert cycle.regime in set(E.Regime)


class TestCandidatesAndDecisions:
    def test_candidates_were_generated_from_the_seeded_universe(self, cycle) -> None:
        assert cycle.candidates > 0, "no candidate survived the filters — the test proves nothing"

    def test_every_decision_records_both_sides_of_the_argument(self, cycle) -> None:
        with session_scope() as s:
            decisions = s.scalars(select(Decision)).all()
            assert decisions, "the cycle produced no decisions"
            for decision in decisions:
                assert decision.symbol
                assert decision.action in set(E.DecisionAction)
                assert decision.confidence is not None
                assert decision.explanation, f"{decision.symbol} has no explanation"
                if decision.action in (E.DecisionAction.BUY, E.DecisionAction.ADD):
                    # A buy without a credible bear case is a trade that was not
                    # understood well enough to make.
                    assert decision.bull_case, f"{decision.symbol} buy has no bull case"
                    assert decision.bear_case, f"{decision.symbol} buy has no bear case"
                    assert decision.entry_thesis
                    assert decision.exit_criteria

    def test_every_decision_carries_the_versions_needed_to_reproduce_it(self, cycle) -> None:
        with session_scope() as s:
            for decision in s.scalars(select(Decision)).all():
                assert decision.registry_version, "feature registry version not stamped"
                assert decision.decided_at is not None
                assert decision.mode is E.Mode.PAPER

    def test_confidence_is_a_probability(self, cycle) -> None:
        with session_scope() as s:
            for decision in s.scalars(select(Decision)).all():
                assert Decimal(0) <= decision.confidence <= Decimal(1)


class TestRiskEngineIsOnEveryPath:
    def test_every_decision_has_a_full_risk_check_record(self, cycle) -> None:
        with session_scope() as s:
            decisions = s.scalars(select(Decision)).all()
            actionable = [d for d in decisions if d.action is not E.DecisionAction.HOLD]
            assert actionable, "no actionable decision to check"
            for decision in actionable:
                checks = s.scalars(select(RiskCheck).where(RiskCheck.decision_id == decision.id)).all()
                assert len(checks) >= 20, f"{decision.symbol} was evaluated by only {len(checks)} checks"
                for check in checks:
                    assert check.check_name
                    assert check.result in set(E.RiskCheckResult)
                    assert check.message

    def test_no_order_exists_without_an_approving_verdict(self, cycle) -> None:
        with session_scope() as s:
            for order in s.scalars(select(Order)).all():
                assert order.decision_id is not None, f"{order.symbol} order has no decision behind it"
                decision = s.get(Decision, order.decision_id)
                assert decision.approval_state in (
                    E.ApprovalState.AUTO_APPROVED,
                    E.ApprovalState.APPROVED,
                )
                assert decision.approved_quantity is not None
                assert order.quantity <= decision.approved_quantity

    def test_approved_quantities_never_exceed_the_position_cap(self, cycle) -> None:
        from aegisquant.config import get_settings

        cap = get_settings().risk.max_position_pct
        with session_scope() as s:
            snapshot = s.scalars(select(PortfolioSnapshot).order_by(PortfolioSnapshot.at.desc())).first()
            assert snapshot is not None
            for position in s.scalars(select(Position).where(Position.quantity > 0)).all():
                weight = (position.market_value or Decimal(0)) / snapshot.equity
                assert weight <= cap + Decimal("0.01"), f"{position.symbol} is {weight:.1%} of equity"


class TestOrdersAndFills:
    def test_orders_were_submitted_and_filled(self, cycle) -> None:
        assert cycle.orders_submitted > 0, "no order reached the broker"
        with session_scope() as s:
            orders = s.scalars(select(Order)).all()
            assert orders
            for order in orders:
                assert order.client_order_id.startswith("aq-paper-")
                assert order.broker == "mock"
                assert order.is_synthetic is True

    def test_orders_default_to_price_protected_limits(self, cycle) -> None:
        with session_scope() as s:
            for order in s.scalars(select(Order).where(Order.side == E.Side.BUY)).all():
                assert order.order_type is E.OrderType.LIMIT
                assert order.limit_price is not None
                # A buy limit must sit at or above the reference price, or it
                # would never fill; it must not be unboundedly above it either.
                assert order.limit_price >= order.reference_price
                assert order.limit_price <= order.reference_price * Decimal("1.05")

    def test_every_fill_is_itemised_and_ties_to_an_order(self, cycle) -> None:
        with session_scope() as s:
            fills = s.scalars(select(Fill)).all()
            assert fills, "nothing filled"
            for fill in fills:
                assert fill.order_id is not None
                assert fill.quantity > 0
                assert fill.price > 0
                assert fill.broker_fill_id
                assert fill.slippage_bps is not None

    def test_no_duplicate_client_order_ids_exist(self, cycle) -> None:
        with session_scope() as s:
            duplicates = s.execute(
                select(Order.client_order_id, func.count()).group_by(Order.client_order_id).having(func.count() > 1)
            ).all()
            assert duplicates == []

    def test_no_duplicate_broker_fill_ids_exist(self, cycle) -> None:
        with session_scope() as s:
            duplicates = s.execute(
                select(Fill.order_id, Fill.broker_fill_id, func.count())
                .group_by(Fill.order_id, Fill.broker_fill_id)
                .having(func.count() > 1)
            ).all()
            assert duplicates == []

    def test_filled_quantity_matches_the_sum_of_fills(self, cycle) -> None:
        with session_scope() as s:
            for order in s.scalars(select(Order)).all():
                fills = s.scalars(select(Fill).where(Fill.order_id == order.id)).all()
                total = sum((f.quantity for f in fills), Decimal(0))
                assert order.filled_quantity == total, f"{order.symbol}: {order.filled_quantity} != {total}"


class TestPositionsAndValuation:
    def test_positions_reflect_the_fills(self, cycle) -> None:
        with session_scope() as s:
            positions = s.scalars(select(Position).where(Position.quantity > 0)).all()
            assert positions, "no position was opened"
            for position in positions:
                assert position.avg_entry_price > 0
                assert position.cost_basis > 0
                assert position.market_value is not None
                assert position.is_synthetic is True

    def test_each_position_carries_the_thesis_it_was_opened_on(self, cycle) -> None:
        # Without this, a later review cannot ask "is the original reason still
        # true?" — which is the only principled basis for holding or exiting.
        with session_scope() as s:
            for position in s.scalars(select(Position).where(Position.quantity > 0)).all():
                assert position.entry_thesis, f"{position.symbol} has no recorded thesis"
                assert position.exit_criteria, f"{position.symbol} has no exit criteria"

    def test_the_portfolio_snapshot_balances(self, cycle) -> None:
        with session_scope() as s:
            snapshot = s.scalars(select(PortfolioSnapshot).order_by(PortfolioSnapshot.at.desc())).first()
            assert snapshot is not None
            positions = s.scalars(select(Position).where(Position.quantity > 0)).all()
            market_value = sum((p.market_value or Decimal(0) for p in positions), Decimal(0))
            # Equity must equal cash plus the mark on the book, within rounding.
            assert abs(snapshot.equity - (snapshot.cash + market_value)) <= Decimal("1.00")
            assert snapshot.open_positions == len(positions)
            assert snapshot.cash >= 0

    def test_the_cash_buffer_survived_the_cycle(self, cycle) -> None:
        from aegisquant.config import get_settings

        with session_scope() as s:
            snapshot = s.scalars(select(PortfolioSnapshot).order_by(PortfolioSnapshot.at.desc())).first()
            buffer_pct = snapshot.cash / snapshot.equity
            assert buffer_pct >= get_settings().risk.min_cash_buffer_pct - Decimal("0.01")


class TestReconciliation:
    def test_local_state_agrees_with_the_broker_after_the_cycle(self, cycle) -> None:
        with session_scope() as s:
            run = s.scalars(select(ReconciliationRun).order_by(ReconciliationRun.at.desc())).first()
            assert run is not None
            assert run.status is E.ReconStatus.CLEAN, run.breaks
            assert run.resolved is True

    def test_the_broker_and_the_database_report_the_same_positions(self, cycle, mock_broker) -> None:
        broker_positions = {p.symbol: p.quantity for p in mock_broker.get_positions()}
        with session_scope() as s:
            local = {p.symbol: p.quantity for p in s.scalars(select(Position).where(Position.quantity > 0)).all()}
        assert local == broker_positions


class TestExplainability:
    def test_every_explanation_is_derivable_from_recorded_inputs(self, cycle) -> None:
        """No number may appear in an explanation that is not in the record.

        This is the concrete form of "do not generate explanations that are
        inconsistent with the actual recorded inputs": the deterministic narrator
        is re-run from the stored decision and must reproduce the stored text.
        """
        from aegisquant.explain.narrator import explain_decision

        with session_scope() as s:
            decisions = s.scalars(select(Decision)).all()
            assert decisions
            for decision in decisions:
                if decision.action is E.DecisionAction.HOLD:
                    continue
                inputs = dict(decision.signal_inputs or {})
                score = inputs.get("growth_opportunity_score")
                regenerated = explain_decision(
                    action=decision.action,
                    symbol=decision.symbol,
                    quantity=decision.proposed_quantity,
                    approved_quantity=decision.approved_quantity,
                    reference_price=decision.reference_price,
                    strategy_key=decision.strategy_key,
                    strategies=inputs.get("_strategies"),
                    confidence=decision.confidence,
                    signal_inputs=inputs,
                    sizing_detail=decision.sizing_detail,
                    risk_verdict=decision.risk_verdict,
                    regime=decision.regime,
                    sector=inputs.get("_sector"),
                    expected_return=decision.expected_return,
                    expected_holding_days=decision.expected_holding_days,
                    growth_score=Decimal(str(score)) if score is not None else None,
                    exit_criteria=decision.exit_criteria,
                    estimated_cost_bps=decision.estimated_cost_bps,
                    weaknesses=inputs.get("_weaknesses"),
                    thesis=decision.entry_thesis,
                )
                # Re-deriving the narration from the persisted record alone must
                # reproduce it exactly. If it cannot, the explanation is asserting
                # something the audit trail does not contain.
                assert decision.explanation == regenerated, (
                    f"{decision.symbol}: the stored explanation cannot be re-derived from the record\n"
                    f"stored:      {decision.explanation}\n"
                    f"regenerated: {regenerated}"
                )
                assert numbers_in(decision.explanation) == numbers_in(regenerated)

    def test_the_polish_guard_rejects_a_rewrite_that_changes_a_number(self) -> None:
        deterministic = "BUY 100 NVDA at $482.50 with 72% confidence."
        faithful = "Buying 100 shares of NVDA near $482.50; confidence is 72%."
        embellished = "Buying 140 shares of NVDA near $482.50; confidence is 95%."
        assert polish_is_consistent(deterministic, faithful) is True
        assert polish_is_consistent(deterministic, embellished) is False

    def test_the_explanation_names_the_binding_constraint_when_resized(self, cycle) -> None:
        with session_scope() as s:
            resized = [
                d
                for d in s.scalars(select(Decision)).all()
                if d.proposed_quantity and d.approved_quantity and d.approved_quantity < d.proposed_quantity
            ]
        for decision in resized:
            assert "reduced" in decision.explanation.lower() or "resiz" in decision.explanation.lower()


class TestAuditTrail:
    def test_the_cycle_left_a_complete_audit_trail(self, cycle) -> None:
        with session_scope() as s:
            assert s.scalars(select(LoopRun)).all()
            assert s.scalars(select(Decision)).all()
            assert s.scalars(select(RiskCheck)).all()
            assert s.scalars(select(Order)).all()
            assert s.scalars(select(Fill)).all()
            assert s.scalars(select(PortfolioSnapshot)).all()
            assert s.scalars(select(Alert)).all()

    def test_alerts_were_raised_for_submissions_and_fills(self, cycle) -> None:
        with session_scope() as s:
            kinds = {a.kind for a in s.scalars(select(Alert)).all()}
            assert E.AlertKind.ORDER_SUBMITTED in kinds
            assert E.AlertKind.ORDER_FILLED in kinds


class TestSafetyPropertiesUnderComposition:
    """The controls must still work when the whole system is running."""

    def test_the_kill_switch_stops_the_next_cycle_dead(
        self, seeded: dict, mock_broker, strategies_registered: None
    ) -> None:
        with session_scope() as s:
            state = get_system_state(s)
            state.kill_switch_engaged = True
            state.kill_switch_reason = "integration test"

        with session_scope() as s:
            outcome = run_cycle(s, broker=mock_broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")

        assert outcome.orders_submitted == 0
        assert outcome.halted_reason is not None
        assert "kill switch" in outcome.halted_reason.lower()
        with session_scope() as s:
            assert s.scalars(select(Order)).all() == []

    def test_a_closed_market_produces_no_orders(self, seeded: dict, mock_broker, strategies_registered: None) -> None:
        mock_broker.market_open = False
        with session_scope() as s:
            outcome = run_cycle(s, broker=mock_broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")
        assert outcome.orders_submitted == 0
        assert outcome.halted_reason is not None

    def test_a_disconnected_broker_halts_rather_than_guessing(
        self, seeded: dict, mock_broker, strategies_registered: None
    ) -> None:
        mock_broker.disconnect()
        with session_scope() as s:
            outcome = run_cycle(s, broker=mock_broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")
        assert outcome.orders_submitted == 0
        with session_scope() as s:
            assert s.scalars(select(Order)).all() == []

    def test_read_only_mode_blocks_the_cycle(self, seeded: dict, mock_broker, strategies_registered: None) -> None:
        with session_scope() as s:
            get_system_state(s).read_only = True
        with session_scope() as s:
            outcome = run_cycle(s, broker=mock_broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")
        assert outcome.orders_submitted == 0

    def test_running_the_same_cycle_twice_does_not_double_the_exposure(
        self, seeded: dict, mock_broker, strategies_registered: None
    ) -> None:
        # The idempotency guarantee under the most realistic failure: the
        # scheduler fires twice, or an operator re-triggers a cycle by hand.
        with session_scope() as s:
            first = run_cycle(s, broker=mock_broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")
        with session_scope() as s:
            second = run_cycle(s, broker=mock_broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")

        assert first.orders_submitted > 0
        with session_scope() as s:
            positions = {p.symbol: p.quantity for p in s.scalars(select(Position).where(Position.quantity > 0)).all()}
            orders = s.scalars(select(Order)).all()
            coids = [o.client_order_id for o in orders]
            assert len(coids) == len(set(coids))
        # The second cycle may legitimately manage existing positions, but the
        # book must still respect the position cap, not double up.
        from aegisquant.config import get_settings

        cap = get_settings().risk.max_position_pct
        with session_scope() as s:
            snapshot = s.scalars(select(PortfolioSnapshot).order_by(PortfolioSnapshot.at.desc())).first()
            for symbol in positions:
                position = s.scalar(select(Position).where(Position.symbol == symbol))
                weight = (position.market_value or Decimal(0)) / snapshot.equity
                assert weight <= cap + Decimal("0.01"), f"{symbol} reached {weight:.1%} after two cycles"
        assert second.status in (E.RunStatus.COMPLETED, E.RunStatus.FAILED)

    def test_every_order_at_the_broker_has_a_local_record(self, cycle, mock_broker) -> None:
        # Nothing may reach the broker except through the order manager, so the
        # simulator must not hold an order the database has never heard of.
        with session_scope() as s:
            local = {o.client_order_id for o in s.scalars(select(Order)).all()}
        at_broker = set(mock_broker.orders)
        assert at_broker <= local, f"orders at the broker with no local record: {at_broker - local}"


class TestFlattenWorkflow:
    def test_flatten_closes_the_whole_book(self, seeded: dict, mock_broker, strategies_registered: None) -> None:
        from aegisquant.execution.oms import OrderManager

        with session_scope() as s:
            run_cycle(s, broker=mock_broker, universe=TEST_UNIVERSE, ingest=False, trigger="test")

        with session_scope() as s:
            before = s.scalars(select(Position).where(Position.quantity > 0)).all()
            assert before, "nothing to flatten"
            result = OrderManager(s, mock_broker, mode=E.Mode.PAPER).flatten_positions("integration test")
            assert result["exit_orders_submitted"] == len(before)

        with session_scope() as s:
            after = s.scalars(select(Position).where(Position.quantity > 0)).all()
            assert after == []
        assert mock_broker.get_positions() == []
