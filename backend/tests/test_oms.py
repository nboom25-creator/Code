"""Order management: identity, state machine, fills, reconciliation, failures.

The OMS is where a bug costs real money twice — once by trading what it should
not, and again by losing track of what it did. The properties tested here:

* **Idempotency.** A replayed decision never becomes a second order.
* **Legal transitions only.** An impossible status change is recorded and
  refused, not applied.
* **Partial fills accumulate correctly**, including the average price.
* **Reconciliation** treats the broker as authoritative for positions and never
  adopts an unknown broker order as its own.
* **Broker failures** end in a defined local state, never in silence.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select

from aegisquant.db import enums as E
from aegisquant.db.models import Alert, Order, OrderEvent, Position
from aegisquant.execution.broker.base import BrokerDisconnected
from aegisquant.execution.broker.mock import MockBroker, MockMarket
from aegisquant.execution.oms import ALLOWED_TRANSITIONS, OrderManager, SubmitRequest, client_order_id
from aegisquant.utils.timeutil import utcnow

#: A timestamp aligned to the start of a 300-second idempotency bucket.
BUCKET_START = datetime(2026, 3, 2, 14, 35, 0, tzinfo=UTC)


@pytest.fixture()
def market() -> MockMarket:
    m = MockMarket()
    m.set_price("NVDA", Decimal("100"))
    m.set_price("MSFT", Decimal("400"))
    return m


@pytest.fixture()
def broker(market: MockMarket) -> MockBroker:
    return MockBroker(starting_cash=Decimal("100000"), market=market, market_open=True)


@pytest.fixture()
def oms(session, broker: MockBroker) -> OrderManager:
    return OrderManager(session, broker, mode=E.Mode.PAPER)


def buy(symbol: str = "NVDA", quantity: Decimal | int = 10, **kwargs) -> SubmitRequest:
    defaults = {
        "symbol": symbol,
        "side": E.Side.BUY,
        "quantity": Decimal(quantity),
        "order_type": E.OrderType.LIMIT,
        "reference_price": Decimal("100"),
        "limit_price": Decimal("101"),
        "strategy_key": "cross_sectional_momentum",
    }
    defaults.update(kwargs)
    return SubmitRequest(**defaults)  # type: ignore[arg-type]


def events(session, order: Order) -> list[str]:
    session.flush()
    rows = session.scalars(select(OrderEvent).where(OrderEvent.order_id == order.id).order_by(OrderEvent.id)).all()
    return [r.event_type for r in rows]


class TestClientOrderId:
    def test_the_same_decision_in_the_same_bucket_yields_the_same_id(self) -> None:
        # Anchored to a bucket boundary so the test cannot straddle one.
        now = BUCKET_START
        args = {
            "mode": E.Mode.PAPER,
            "symbol": "NVDA",
            "side": E.Side.BUY,
            "quantity": Decimal(10),
            "strategy_key": "momentum",
        }
        assert client_order_id(at=now, **args) == client_order_id(at=now + timedelta(seconds=30), **args)

    def test_a_later_bucket_yields_a_different_id(self) -> None:
        now = utcnow()
        args = {
            "mode": E.Mode.PAPER,
            "symbol": "NVDA",
            "side": E.Side.BUY,
            "quantity": Decimal(10),
            "strategy_key": "momentum",
        }
        assert client_order_id(at=now, **args) != client_order_id(at=now + timedelta(seconds=600), **args)

    def test_the_mode_is_part_of_the_identity(self) -> None:
        # A paper order and a live order must never share an id.
        now = utcnow()
        args = {
            "symbol": "NVDA",
            "side": E.Side.BUY,
            "quantity": Decimal(10),
            "strategy_key": "momentum",
            "at": now,
        }
        paper = client_order_id(mode=E.Mode.PAPER, **args)
        live = client_order_id(mode=E.Mode.LIVE, **args)
        assert paper != live
        assert paper.startswith("aq-paper-")
        assert live.startswith("aq-live-")

    @pytest.mark.parametrize(
        "override",
        [
            {"symbol": "MSFT"},
            {"side": E.Side.SELL},
            {"quantity": Decimal(11)},
            {"strategy_key": "breakout"},
            {"salt": "retry-1"},
        ],
    )
    def test_every_material_field_changes_the_id(self, override: dict) -> None:
        now = utcnow()
        base = {
            "mode": E.Mode.PAPER,
            "symbol": "NVDA",
            "side": E.Side.BUY,
            "quantity": Decimal(10),
            "strategy_key": "momentum",
            "at": now,
        }
        assert client_order_id(**base) != client_order_id(**{**base, **override})


class TestDuplicatePrevention:
    def test_replaying_the_same_request_does_not_place_a_second_order(self, oms: OrderManager, session) -> None:
        first = oms.submit(buy())
        assert first.submitted is True
        second = oms.submit(buy())
        assert second.submitted is False
        assert second.duplicate is True
        assert session.scalar(select(Order).where(Order.client_order_id == first.order.client_order_id)) is not None
        assert len(session.scalars(select(Order)).all()) == 1

    def test_the_broker_is_only_asked_once(self, oms: OrderManager, broker: MockBroker) -> None:
        oms.submit(buy())
        calls = broker.submit_calls
        oms.submit(buy())
        assert broker.submit_calls == calls

    def test_an_open_order_for_the_same_symbol_and_side_is_not_stacked(self, oms: OrderManager) -> None:
        # A resting order that cannot fill leaves an open order behind.
        resting = oms.submit(buy(quantity=5, limit_price=Decimal("50")))
        assert resting.order.status.is_open

        # A genuinely different decision (different quantity → different id) must
        # still be refused while the first is live, or exposure would double.
        stacked = oms.submit(buy(quantity=7, limit_price=Decimal("50")))
        assert stacked.submitted is False
        assert stacked.duplicate is True
        assert "refusing to stack" in stacked.reason

    def test_a_filled_order_does_not_block_the_next_decision(self, oms: OrderManager) -> None:
        filled = oms.submit(buy(quantity=5))
        assert filled.order.status is E.OrderStatus.FILLED
        again = oms.submit(buy(quantity=6, idempotency_salt="second-cycle"))
        assert again.submitted is True

    def test_the_mock_broker_is_itself_idempotent(self, broker: MockBroker) -> None:
        first = broker.submit_order(
            client_order_id="fixed-id",
            symbol="NVDA",
            side=E.Side.BUY,
            quantity=Decimal(5),
            order_type=E.OrderType.MARKET,
        )
        second = broker.submit_order(
            client_order_id="fixed-id",
            symbol="NVDA",
            side=E.Side.BUY,
            quantity=Decimal(5),
            order_type=E.OrderType.MARKET,
        )
        assert first is second
        assert len(broker.orders) == 1


class TestOrderStateMachine:
    def test_the_transition_table_has_no_escape_from_a_terminal_state(self) -> None:
        for status in (
            E.OrderStatus.FILLED,
            E.OrderStatus.CANCELED,
            E.OrderStatus.REJECTED,
            E.OrderStatus.EXPIRED,
            E.OrderStatus.REPLACED,
        ):
            assert ALLOWED_TRANSITIONS[status] == set(), f"{status} is not terminal"

    def test_a_normal_fill_walks_the_expected_path(self, oms: OrderManager, session) -> None:
        outcome = oms.submit(buy(quantity=5))
        order = outcome.order
        assert order.status is E.OrderStatus.FILLED
        assert "created" in events(session, order)
        assert order.filled_quantity == Decimal(5)
        assert order.avg_fill_price is not None

    def test_an_illegal_transition_is_recorded_and_refused(self, oms: OrderManager, session) -> None:
        outcome = oms.submit(buy(quantity=5))
        order = outcome.order
        assert order.status is E.OrderStatus.FILLED

        applied = oms._transition(order, E.OrderStatus.NEW, "bogus", "regression guard")
        assert applied is False
        assert order.status is E.OrderStatus.FILLED  # unchanged
        assert "illegal_transition" in events(session, order)

    def test_cancelling_a_terminal_order_is_a_no_op(self, oms: OrderManager) -> None:
        outcome = oms.submit(buy(quantity=5))
        assert outcome.order.status.is_terminal
        assert oms.cancel(outcome.order) is False

    def test_cancelling_a_resting_order_reaches_canceled(self, oms: OrderManager, session) -> None:
        resting = oms.submit(buy(quantity=5, limit_price=Decimal("50")))
        assert oms.cancel(resting.order, "operator changed their mind") is True
        assert resting.order.status is E.OrderStatus.CANCELED
        assert resting.order.canceled_at is not None
        assert "cancel_requested" in events(session, resting.order)

    def test_cancel_all_clears_the_book(self, oms: OrderManager) -> None:
        oms.submit(buy("NVDA", quantity=5, limit_price=Decimal("50")))
        oms.submit(buy("MSFT", quantity=5, reference_price=Decimal("400"), limit_price=Decimal("200")))
        assert oms.cancel_all("test") == 2

    def test_stale_orders_are_cancelled_on_age(self, oms: OrderManager, session) -> None:
        resting = oms.submit(buy(quantity=5, limit_price=Decimal("50")))
        resting.order.submitted_at = utcnow() - timedelta(hours=3)
        session.flush()
        assert oms.cancel_stale_orders(max_age_seconds=3600) == 1
        assert resting.order.status is E.OrderStatus.CANCELED

    def test_every_state_change_is_written_to_the_event_log(self, oms: OrderManager, session) -> None:
        resting = oms.submit(buy(quantity=5, limit_price=Decimal("50")))
        oms.cancel(resting.order)
        rows = session.scalars(
            select(OrderEvent).where(OrderEvent.order_id == resting.order.id).order_by(OrderEvent.id)
        ).all()
        assert len(rows) >= 3
        for row in rows:
            assert row.event_type
            assert row.at is not None
            assert row.source in ("local", "broker", "recon", "recovery")


class TestPartialFills:
    def test_a_liquidity_capped_order_fills_in_pieces(self, oms: OrderManager, broker: MockBroker, session) -> None:
        broker.market.liquidity["NVDA"] = Decimal(4)  # only 4 shares available per attempt
        outcome = oms.submit(buy(quantity=10))
        order = outcome.order
        assert order.status is E.OrderStatus.PARTIALLY_FILLED
        assert order.filled_quantity == Decimal(4)

        broker.advance()
        oms.poll_open_orders()
        assert order.filled_quantity == Decimal(8)
        assert order.status is E.OrderStatus.PARTIALLY_FILLED

        broker.advance()
        oms.poll_open_orders()
        assert order.filled_quantity == Decimal(10)
        assert order.status is E.OrderStatus.FILLED

    def test_the_average_fill_price_is_quantity_weighted(self, oms: OrderManager, broker: MockBroker) -> None:
        broker.market.liquidity["NVDA"] = Decimal(5)
        outcome = oms.submit(buy(quantity=10, limit_price=Decimal("200")))
        order = outcome.order
        first_price = order.avg_fill_price

        broker.advance({"NVDA": Decimal("110")})
        oms.poll_open_orders()
        assert order.filled_quantity == Decimal(10)
        # The blended price must sit strictly between the two execution prices.
        assert first_price < order.avg_fill_price < Decimal("111")

    def test_the_position_reflects_only_what_actually_filled(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        broker.market.liquidity["NVDA"] = Decimal(3)
        oms.submit(buy(quantity=10))
        position = session.scalar(select(Position).where(Position.symbol == "NVDA"))
        assert position is not None
        assert position.quantity == Decimal(3)

    def test_a_partial_fill_then_cancel_keeps_the_filled_shares(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        broker.market.liquidity["NVDA"] = Decimal(3)
        outcome = oms.submit(buy(quantity=10))
        oms.cancel(outcome.order, "changed mind mid-fill")
        position = session.scalar(select(Position).where(Position.symbol == "NVDA"))
        assert position.quantity == Decimal(3)
        assert outcome.order.filled_quantity == Decimal(3)


class TestPositionAccounting:
    def test_a_buy_then_sell_realises_the_difference(self, oms: OrderManager, broker: MockBroker, session) -> None:
        oms.submit(buy(quantity=10))
        broker.market.set_price("NVDA", Decimal("120"))
        oms.submit(
            SubmitRequest(
                symbol="NVDA",
                side=E.Side.SELL,
                quantity=Decimal(10),
                order_type=E.OrderType.MARKET,
                reference_price=Decimal("120"),
                reduce_only=True,
            )
        )
        position = session.scalar(select(Position).where(Position.symbol == "NVDA"))
        assert position.quantity == Decimal(0)
        assert position.realized_pnl > 0
        assert position.cost_basis == Decimal(0)

    def test_averaging_up_moves_the_entry_price(self, oms: OrderManager, broker: MockBroker, session) -> None:
        oms.submit(buy(quantity=10))
        entry = session.scalar(select(Position).where(Position.symbol == "NVDA")).avg_entry_price
        broker.market.set_price("NVDA", Decimal("150"))
        oms.submit(buy(quantity=10, reference_price=Decimal("150"), limit_price=Decimal("152"), idempotency_salt="add"))
        position = session.scalar(select(Position).where(Position.symbol == "NVDA"))
        assert position.quantity == Decimal(20)
        assert entry < position.avg_entry_price < Decimal("150")

    def test_the_position_inherits_the_decision_thesis(self, oms: OrderManager, session) -> None:
        from aegisquant.db.models import Decision

        decision = Decision(
            decided_at=utcnow(),
            mode=E.Mode.PAPER,
            symbol="NVDA",
            action=E.DecisionAction.BUY,
            strategy_key="cross_sectional_momentum",
            confidence=Decimal("0.7"),
            entry_thesis="Accelerating revenue with a volume-confirmed breakout.",
            exit_criteria={"thesis": "Exit if revenue growth decelerates two quarters running."},
            approval_state=E.ApprovalState.AUTO_APPROVED,
        )
        session.add(decision)
        session.flush()

        oms.submit(buy(quantity=5, decision_id=decision.id))
        position = session.scalar(select(Position).where(Position.symbol == "NVDA"))
        assert position.entry_thesis == decision.entry_thesis
        assert position.exit_criteria == decision.exit_criteria


class TestBrokerFailures:
    def test_a_broker_rejection_ends_in_a_local_rejected_state(self, oms: OrderManager, broker: MockBroker) -> None:
        broker.reject_next_submit = "insufficient buying power"
        outcome = oms.submit(buy())
        assert outcome.submitted is False
        assert outcome.rejected is True
        assert outcome.order.status is E.OrderStatus.REJECTED
        assert outcome.order.reject_reason == "insufficient buying power"

    def test_a_rejection_raises_an_alert(self, oms: OrderManager, broker: MockBroker, session) -> None:
        broker.reject_next_submit = "symbol not tradable"
        oms.submit(buy())
        session.flush()
        alerts = session.scalars(select(Alert).where(Alert.kind == E.AlertKind.ORDER_REJECTED)).all()
        assert alerts

    def test_a_disconnected_broker_leaves_a_rejected_order_and_a_critical_alert(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        broker.disconnect()
        outcome = oms.submit(buy())
        assert outcome.submitted is False
        assert outcome.order.status is E.OrderStatus.REJECTED
        session.flush()
        alerts = session.scalars(select(Alert).where(Alert.kind == E.AlertKind.BROKER_DISCONNECT)).all()
        assert alerts
        assert alerts[0].severity is E.AlertSeverity.CRITICAL

    def test_an_uncertain_submission_is_recovered_never_retried(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        # The nastiest real case: the order reached the broker but the response
        # was lost. Retrying would double the position; the OMS looks it up.
        broker.fail_next_submit = True
        outcome = oms.submit(buy(quantity=5))
        assert outcome.uncertain is True
        assert outcome.submitted is True
        assert outcome.order.broker_order_id is not None
        assert broker.submit_calls == 1
        assert "submit_uncertain" in events(session, outcome.order)
        # Exactly one order exists at the broker, and one locally.
        assert len(broker.orders) == 1
        assert len(session.scalars(select(Order)).all()) == 1

    def test_an_uncertain_submission_that_cannot_be_found_alerts_and_stops(
        self, oms: OrderManager, broker: MockBroker, session, monkeypatch
    ) -> None:
        broker.fail_next_submit = True
        monkeypatch.setattr(
            broker, "get_order", lambda **kwargs: (_ for _ in ()).throw(BrokerDisconnected("mock", "lookup failed"))
        )
        outcome = oms.submit(buy(quantity=5))
        assert outcome.submitted is False
        assert outcome.uncertain is True
        session.flush()
        alerts = session.scalars(select(Alert).where(Alert.kind == E.AlertKind.APPLICATION_FAILURE)).all()
        assert alerts
        assert "do not resubmit" in alerts[0].message

    def test_a_reconnect_restores_normal_operation(self, oms: OrderManager, broker: MockBroker) -> None:
        broker.disconnect()
        assert oms.submit(buy()).submitted is False
        broker.reconnect()
        assert oms.submit(buy(idempotency_salt="after-reconnect")).submitted is True


class TestReconciliation:
    def test_a_matching_book_reconciles_clean(self, oms: OrderManager, session) -> None:
        oms.submit(buy(quantity=10))
        run = oms.reconcile()
        assert run.status is E.ReconStatus.CLEAN
        assert run.breaks["count"] == 0
        assert run.resolved is True
        assert run.positions_checked >= 1

    def test_a_quantity_difference_heals_toward_the_broker(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        oms.submit(buy(quantity=10))
        local = session.scalar(select(Position).where(Position.symbol == "NVDA"))
        local.quantity = Decimal(7)  # simulate local drift
        session.flush()

        run = oms.reconcile()
        assert run.status is E.ReconStatus.BREAKS_FOUND
        assert run.breaks["count"] == 1
        session.refresh(local)
        assert local.quantity == Decimal(10)  # the broker is authoritative
        assert run.resolved is True

    def test_a_position_the_broker_does_not_have_is_closed_locally(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        oms.submit(buy(quantity=10))
        broker.positions.clear()
        run = oms.reconcile()
        session.expire_all()
        local = session.scalar(select(Position).where(Position.symbol == "NVDA"))
        assert local.quantity == Decimal(0)
        assert run.auto_healed["count"] == 1

    def test_a_broker_position_with_no_local_record_is_adopted(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        from aegisquant.execution.broker.base import BrokerPosition

        broker.positions["MSFT"] = BrokerPosition(
            symbol="MSFT",
            quantity=Decimal(5),
            avg_entry_price=Decimal("400"),
            current_price=Decimal("400"),
            market_value=Decimal("2000"),
            cost_basis=Decimal("2000"),
            unrealized_pnl=Decimal(0),
            side="long",
        )
        run = oms.reconcile()
        assert run.status is E.ReconStatus.BREAKS_FOUND
        local = session.scalar(select(Position).where(Position.symbol == "MSFT"))
        assert local is not None
        assert local.quantity == Decimal(5)

    def test_an_unknown_broker_order_is_flagged_not_adopted(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        # Could be a manual trade or a bug. Either way it is not ours to own.
        broker.submit_order(
            client_order_id="not-ours",
            symbol="MSFT",
            side=E.Side.BUY,
            quantity=Decimal(5),
            order_type=E.OrderType.LIMIT,
            limit_price=Decimal("100"),  # far below the market, so it rests
        )
        run = oms.reconcile()
        kinds = [b["kind"] for b in run.breaks["items"]]
        assert "unknown_broker_order" in kinds
        assert session.scalar(select(Order).where(Order.client_order_id == "not-ours")) is None
        assert run.resolved is False  # requires a human

    def test_an_unresolved_break_is_visible_to_the_risk_engine(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        broker.submit_order(
            client_order_id="not-ours",
            symbol="MSFT",
            side=E.Side.BUY,
            quantity=Decimal(5),
            order_type=E.OrderType.LIMIT,
            limit_price=Decimal("100"),
        )
        oms.reconcile()
        from aegisquant.db.models import ReconciliationRun

        unresolved = session.scalars(select(ReconciliationRun).where(ReconciliationRun.resolved.is_(False))).all()
        assert unresolved

    def test_reconciliation_records_a_failure_when_the_broker_is_unreachable(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        broker.disconnect()
        run = oms.reconcile()
        assert run.status is E.ReconStatus.FAILED
        assert run.error
        assert run.resolved is False
        session.flush()
        assert session.scalars(select(Alert).where(Alert.kind == E.AlertKind.BROKER_DISCONNECT)).all()

    def test_reconciliation_is_idempotent(self, oms: OrderManager, session) -> None:
        oms.submit(buy(quantity=10))
        first = oms.reconcile()
        second = oms.reconcile()
        assert first.status is second.status is E.ReconStatus.CLEAN


class TestCancelReplace:
    def test_a_replace_creates_a_linked_successor(self, oms: OrderManager, session) -> None:
        resting = oms.submit(buy(quantity=10, limit_price=Decimal("50")))
        outcome = oms.replace(resting.order, limit_price=Decimal("60"), reason="chasing the bid")
        assert outcome.submitted is True
        replacement = outcome.order
        assert replacement.id != resting.order.id
        assert replacement.replaces_order_id == resting.order.id
        assert resting.order.status is E.OrderStatus.REPLACED
        assert replacement.limit_price == Decimal("60")
        # The audit chain is preserved on both sides.
        assert "replace_requested" in events(session, resting.order)
        assert "created_from_replace" in events(session, replacement)

    def test_a_terminal_order_cannot_be_replaced(self, oms: OrderManager) -> None:
        filled = oms.submit(buy(quantity=5))
        outcome = oms.replace(filled.order, limit_price=Decimal("99"))
        assert outcome.submitted is False
        assert "not replaceable" in outcome.reason


class TestEmergencyControls:
    def test_flatten_cancels_orders_and_sells_every_position(
        self, oms: OrderManager, broker: MockBroker, session
    ) -> None:
        oms.submit(buy("NVDA", quantity=10))
        oms.submit(buy("MSFT", quantity=5, reference_price=Decimal("400"), limit_price=Decimal("404")))
        oms.submit(buy("NVDA", quantity=3, limit_price=Decimal("50"), idempotency_salt="resting"))

        result = oms.flatten_positions("test flatten")
        assert result["cancelled_orders"] >= 1
        assert len(result["submitted"]) == 2
        session.expire_all()
        for symbol in ("NVDA", "MSFT"):
            position = session.scalar(select(Position).where(Position.symbol == symbol))
            assert position.quantity == Decimal(0)

    def test_flatten_uses_market_orders_for_certainty_of_execution(self, oms: OrderManager, session) -> None:
        oms.submit(buy("NVDA", quantity=10))
        oms.flatten_positions("test")
        sells = session.scalars(select(Order).where(Order.side == E.Side.SELL)).all()
        assert sells
        assert all(o.order_type is E.OrderType.MARKET for o in sells)


class TestSyntheticLabelling:
    def test_mock_broker_orders_and_positions_are_marked_synthetic(self, oms: OrderManager, session) -> None:
        # Simulated fills must never be presentable as real trading history.
        oms.submit(buy(quantity=5))
        order = session.scalar(select(Order))
        position = session.scalar(select(Position))
        assert order.is_synthetic is True
        assert position.is_synthetic is True

    def test_the_mock_broker_declares_itself_in_its_health_report(self, broker: MockBroker) -> None:
        assert "SIMULATED" in broker.health()["warning"]
        assert broker.get_account().is_paper is True
