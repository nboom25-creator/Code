"""Order-management system.

Responsibilities: idempotent submission, order state transitions, partial-fill
accounting, cancel-and-replace, duplicate prevention across restarts, and
reconciliation of local state against the broker.

The duplicate-order problem is the one that costs real money, so it is defended
three times over:

1. ``client_order_id`` is **deterministic** — derived from mode, symbol, side,
   quantity, strategy and a time bucket. The same decision, replayed after a
   crash, produces the same id, and the broker rejects or returns the existing
   order rather than creating a second one.
2. A ``UNIQUE`` constraint on ``orders.client_order_id`` means the database
   refuses a duplicate even if two workers race.
3. Before submitting, the OMS checks for an in-flight order on the same symbol
   and side, and refuses to stack.

When a submission's outcome is unknown, the OMS never retries blindly: it looks
the id up at the broker and adopts whatever it finds.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from aegisquant.db import enums as E
from aegisquant.db.models import Alert, Fill, Order, OrderEvent, Position, ReconciliationRun
from aegisquant.db.repo import current_mode, get_or_create_instrument, get_system_state
from aegisquant.execution.broker.base import (
    Broker,
    BrokerDisconnected,
    BrokerError,
    BrokerOrder,
    BrokerRejected,
    BrokerSubmitUncertain,
)
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import ZERO, D, safe_div
from aegisquant.utils.money import price as q_price
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)

#: Legal order state transitions. Anything else is logged as an anomaly rather
#: than silently applied, because an impossible transition means the local model
#: and the broker have diverged.
ALLOWED_TRANSITIONS: dict[E.OrderStatus, set[E.OrderStatus]] = {
    E.OrderStatus.PENDING_NEW: {
        E.OrderStatus.NEW,
        E.OrderStatus.REJECTED,
        E.OrderStatus.CANCELED,
        E.OrderStatus.PARTIALLY_FILLED,
        E.OrderStatus.FILLED,
        E.OrderStatus.EXPIRED,
    },
    E.OrderStatus.NEW: {
        E.OrderStatus.PARTIALLY_FILLED,
        E.OrderStatus.FILLED,
        E.OrderStatus.PENDING_CANCEL,
        E.OrderStatus.CANCELED,
        E.OrderStatus.PENDING_REPLACE,
        E.OrderStatus.REPLACED,
        E.OrderStatus.REJECTED,
        E.OrderStatus.EXPIRED,
    },
    E.OrderStatus.PARTIALLY_FILLED: {
        E.OrderStatus.PARTIALLY_FILLED,
        E.OrderStatus.FILLED,
        E.OrderStatus.PENDING_CANCEL,
        E.OrderStatus.CANCELED,
        E.OrderStatus.PENDING_REPLACE,
        E.OrderStatus.REPLACED,
        E.OrderStatus.EXPIRED,
    },
    E.OrderStatus.PENDING_CANCEL: {
        E.OrderStatus.CANCELED,
        E.OrderStatus.FILLED,
        E.OrderStatus.PARTIALLY_FILLED,
        E.OrderStatus.EXPIRED,
    },
    E.OrderStatus.PENDING_REPLACE: {
        E.OrderStatus.REPLACED,
        E.OrderStatus.CANCELED,
        E.OrderStatus.FILLED,
        E.OrderStatus.PARTIALLY_FILLED,
    },
    # Terminal states accept nothing.
    E.OrderStatus.FILLED: set(),
    E.OrderStatus.CANCELED: set(),
    E.OrderStatus.REJECTED: set(),
    E.OrderStatus.EXPIRED: set(),
    E.OrderStatus.REPLACED: set(),
}


def client_order_id(
    *,
    mode: E.Mode,
    symbol: str,
    side: E.Side,
    quantity: Decimal,
    strategy_key: str | None,
    at: datetime,
    bucket_seconds: int = 300,
    salt: str = "",
) -> str:
    """Deterministic client order id.

    Bucketing the timestamp is what makes this idempotent: the same decision
    replayed within the same bucket yields the same id, so a retry after a crash
    cannot create a second order. A genuinely new decision for the same symbol in
    the next bucket gets a distinct id.
    """
    bucket = int(at.timestamp() // bucket_seconds)
    payload = "|".join(
        [
            mode.value,
            symbol.upper(),
            side.value,
            f"{quantity.normalize():f}",
            strategy_key or "-",
            str(bucket),
            salt,
        ]
    )
    digest = hashlib.sha256(payload.encode()).hexdigest()[:20]
    return f"aq-{mode.value.lower()}-{digest}"


@dataclass(slots=True)
class SubmitRequest:
    symbol: str
    side: E.Side
    quantity: Decimal
    order_type: E.OrderType
    reference_price: Decimal
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    time_in_force: E.TimeInForce = E.TimeInForce.DAY
    strategy_key: str | None = None
    decision_id: int | None = None
    reduce_only: bool = False
    expected_spread_bps: Decimal | None = None
    expected_slippage_bps: Decimal | None = None
    expected_impact_bps: Decimal | None = None
    expected_total_cost_bps: Decimal | None = None
    idempotency_salt: str = ""


@dataclass(slots=True)
class SubmitOutcome:
    order: Order | None
    submitted: bool
    duplicate: bool = False
    rejected: bool = False
    uncertain: bool = False
    reason: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "order_id": self.order.id if self.order else None,
            "client_order_id": self.order.client_order_id if self.order else None,
            "broker_order_id": self.order.broker_order_id if self.order else None,
            "status": self.order.status.value if self.order else None,
            "submitted": self.submitted,
            "duplicate": self.duplicate,
            "rejected": self.rejected,
            "uncertain": self.uncertain,
            "reason": self.reason,
        }


class OrderManager:
    """Owns the local order lifecycle and its agreement with the broker."""

    def __init__(self, session: Session, broker: Broker, mode: E.Mode | None = None) -> None:
        self.session = session
        self.broker = broker
        self.mode = mode or current_mode()

    # ------------------------------------------------------------------
    # submission
    # ------------------------------------------------------------------
    def submit(self, request: SubmitRequest, *, now: datetime | None = None) -> SubmitOutcome:
        now = now or utcnow()
        symbol = request.symbol.upper()
        coid = client_order_id(
            mode=self.mode,
            symbol=symbol,
            side=request.side,
            quantity=request.quantity,
            strategy_key=request.strategy_key,
            at=now,
            salt=request.idempotency_salt,
        )

        # Defence 1: have we already recorded this exact order?
        existing = self.session.scalar(select(Order).where(Order.client_order_id == coid))
        if existing is not None:
            log.info("order_duplicate_suppressed", client_order_id=coid, symbol=symbol)
            return SubmitOutcome(
                order=existing,
                submitted=False,
                duplicate=True,
                reason="an order with this client order id already exists",
            )

        # Defence 2: refuse to stack on an in-flight order for the same symbol/side.
        in_flight = self.session.scalars(
            select(Order).where(
                Order.mode == self.mode,
                Order.symbol == symbol,
                Order.side == request.side,
                Order.status.in_([s for s in E.OrderStatus if s.is_open]),
            )
        ).all()
        if in_flight:
            return SubmitOutcome(
                order=None,
                submitted=False,
                duplicate=True,
                reason=(
                    f"{len(in_flight)} open {request.side.value} order(s) already exist for {symbol}; refusing to stack"
                ),
            )

        # Ensure the instrument row exists before the order references the symbol.
        get_or_create_instrument(self.session, symbol)
        order = Order(
            client_order_id=coid,
            decision_id=request.decision_id,
            mode=self.mode,
            symbol=symbol,
            side=request.side,
            order_type=request.order_type,
            time_in_force=request.time_in_force,
            quantity=request.quantity,
            limit_price=request.limit_price,
            stop_price=request.stop_price,
            status=E.OrderStatus.PENDING_NEW,
            strategy_key=request.strategy_key,
            reference_price=request.reference_price,
            expected_spread_bps=request.expected_spread_bps,
            expected_slippage_bps=request.expected_slippage_bps,
            expected_impact_bps=request.expected_impact_bps,
            expected_total_cost_bps=request.expected_total_cost_bps,
            broker=self.broker.name,
            submit_attempts=1,
            expires_at=now + timedelta(hours=8),
            is_synthetic=self.broker.name == "mock",
        )
        self.session.add(order)
        try:
            self.session.flush()
        except IntegrityError:
            # Defence 3: the unique constraint caught a concurrent writer.
            self.session.rollback()
            existing = self.session.scalar(select(Order).where(Order.client_order_id == coid))
            return SubmitOutcome(
                order=existing,
                submitted=False,
                duplicate=True,
                reason="a concurrent writer created this order first",
            )

        self._event(order, "created", None, E.OrderStatus.PENDING_NEW, message="order recorded locally")

        try:
            broker_order = self.broker.submit_order(
                client_order_id=coid,
                symbol=symbol,
                side=request.side,
                quantity=request.quantity,
                order_type=request.order_type,
                time_in_force=request.time_in_force,
                limit_price=request.limit_price,
                stop_price=request.stop_price,
            )
        except BrokerRejected as exc:
            self._transition(order, E.OrderStatus.REJECTED, "broker_rejected", exc.message, source="broker")
            order.reject_reason = exc.message
            self._alert(
                E.AlertKind.ORDER_REJECTED,
                E.AlertSeverity.WARNING,
                f"Order rejected: {symbol}",
                exc.message,
                symbol,
            )
            return SubmitOutcome(order=order, submitted=False, rejected=True, reason=exc.message)
        except BrokerSubmitUncertain as exc:
            # Never retry. Look it up; adopt whatever exists.
            log.warning("order_submit_uncertain", client_order_id=coid, error=exc.message)
            self._event(
                order,
                "submit_uncertain",
                order.status,
                order.status,
                message=exc.message,
                source="broker",
            )
            recovered = None
            try:
                recovered = self.broker.get_order(client_order_id=coid)
            except BrokerError as lookup_exc:
                log.error("order_lookup_failed", client_order_id=coid, error=str(lookup_exc))
            if recovered is not None:
                self._apply_broker_order(order, recovered, source="recovery")
                return SubmitOutcome(
                    order=order,
                    submitted=True,
                    uncertain=True,
                    reason="submission outcome was unknown but the order was found at the broker",
                )
            self._alert(
                E.AlertKind.APPLICATION_FAILURE,
                E.AlertSeverity.CRITICAL,
                f"Order state unknown: {symbol}",
                (
                    f"Submission of {request.side.value} {request.quantity} {symbol} timed out and "
                    f"the order could not be found at the broker. Client order id {coid}. "
                    "Reconciliation will retry; do not resubmit manually."
                ),
                symbol,
            )
            return SubmitOutcome(
                order=order,
                submitted=False,
                uncertain=True,
                reason="submission outcome unknown; left for reconciliation",
            )
        except BrokerDisconnected as exc:
            self._transition(order, E.OrderStatus.REJECTED, "broker_disconnected", exc.message, source="broker")
            order.reject_reason = exc.message
            self._alert(
                E.AlertKind.BROKER_DISCONNECT,
                E.AlertSeverity.CRITICAL,
                "Broker disconnected",
                f"Could not submit {symbol}: {exc.message}",
                symbol,
            )
            return SubmitOutcome(order=order, submitted=False, rejected=True, reason=exc.message)

        self._apply_broker_order(order, broker_order, source="broker")
        self._alert(
            E.AlertKind.ORDER_SUBMITTED,
            E.AlertSeverity.INFO,
            f"Order submitted: {request.side.value} {request.quantity} {symbol}",
            (
                f"{request.order_type.value} order for {request.quantity} {symbol} at reference "
                f"${request.reference_price}" + (f", limit ${request.limit_price}" if request.limit_price else "")
            ),
            symbol,
        )
        return SubmitOutcome(order=order, submitted=True)

    # ------------------------------------------------------------------
    # state application
    # ------------------------------------------------------------------
    def _apply_broker_order(self, order: Order, bo: BrokerOrder, source: str = "broker") -> None:
        """Fold a broker order snapshot into local state."""
        if bo.broker_order_id and not order.broker_order_id:
            order.broker_order_id = bo.broker_order_id
        if bo.submitted_at and not order.submitted_at:
            order.submitted_at = bo.submitted_at
        if order.acknowledged_at is None and bo.status is not E.OrderStatus.PENDING_NEW:
            order.acknowledged_at = bo.updated_at or utcnow()
        order.last_event_at = utcnow()

        # Book any fills we have not seen yet. The set is built from a query
        # rather than ``order.fills``: that relationship is loaded once and
        # cached, so a second poll of a partially-filled order would see a stale
        # empty collection and re-insert a fill it had already booked.
        seen = set(self.session.scalars(select(Fill.broker_fill_id).where(Fill.order_id == order.id)).all())
        new_qty = ZERO
        for bf in bo.fills:
            if bf.fill_id in seen:
                continue
            slippage = None
            if order.reference_price and order.reference_price > 0:
                direction = Decimal(1) if order.side is E.Side.BUY else Decimal(-1)
                slippage = (
                    safe_div(bf.price - order.reference_price, order.reference_price) * Decimal(10_000) * direction
                ).quantize(Decimal("0.01"))
            self.session.add(
                Fill(
                    order_id=order.id,
                    broker_fill_id=bf.fill_id,
                    at=bf.at,
                    symbol=order.symbol,
                    side=order.side,
                    quantity=bf.quantity,
                    price=bf.price,
                    commission=bf.commission,
                    is_partial=bo.status is E.OrderStatus.PARTIALLY_FILLED,
                    slippage_bps=slippage,
                )
            )
            new_qty += bf.quantity
            self._event(
                order,
                "fill",
                order.status,
                bo.status,
                quantity=bf.quantity,
                price=bf.price,
                message=f"filled {bf.quantity} at {bf.price}",
                source=source,
            )

        prior_filled = order.filled_quantity
        order.filled_quantity = bo.filled_quantity
        order.avg_fill_price = bo.avg_fill_price
        if bo.avg_fill_price and order.reference_price and order.reference_price > 0:
            direction = Decimal(1) if order.side is E.Side.BUY else Decimal(-1)
            order.realized_slippage_bps = (
                safe_div(bo.avg_fill_price - order.reference_price, order.reference_price) * Decimal(10_000) * direction
            ).quantize(Decimal("0.01"))
        order.commission = sum((f.commission for f in bo.fills), ZERO)

        if bo.status is not order.status:
            self._transition(order, bo.status, "broker_update", bo.reject_reason, source=source)
        if bo.reject_reason:
            order.reject_reason = bo.reject_reason

        if bo.filled_quantity > prior_filled:
            self._apply_position_change(order, bo.filled_quantity - prior_filled, bo.avg_fill_price)
            if bo.status is E.OrderStatus.FILLED:
                self._alert(
                    E.AlertKind.ORDER_FILLED,
                    E.AlertSeverity.INFO,
                    f"Filled: {order.side.value} {bo.filled_quantity} {order.symbol}",
                    (
                        f"Average fill ${bo.avg_fill_price} versus reference "
                        f"${order.reference_price} "
                        f"({order.realized_slippage_bps}bps slippage)"
                    ),
                    order.symbol,
                )
        self.session.flush()

    def _apply_position_change(self, order: Order, quantity: Decimal, price: Decimal | None) -> None:
        """Update the local position from a newly booked fill quantity."""
        if quantity <= 0 or price is None:
            return
        pos = self.session.scalar(select(Position).where(Position.mode == self.mode, Position.symbol == order.symbol))
        if pos is None:
            pos = Position(
                mode=self.mode,
                symbol=order.symbol,
                quantity=ZERO,
                avg_entry_price=ZERO,
                cost_basis=ZERO,
                strategy_key=order.strategy_key,
                entry_decision_id=order.decision_id,
                opened_at=utcnow(),
                is_synthetic=order.is_synthetic,
            )
            # Carry the thesis and exit plan onto the position so the portfolio
            # view and every later review are anchored to why it was bought.
            if order.decision is not None:
                pos.entry_thesis = order.decision.entry_thesis
                pos.exit_criteria = order.decision.exit_criteria
                criteria = order.decision.exit_criteria or {}
                trailing = criteria.get("trailing_stop_pct")
                if trailing is not None:
                    pos.trailing_stop_pct = D(trailing)
                stop_pct = criteria.get("stop_loss_pct")
                if stop_pct is not None and price:
                    pos.stop_price = q_price(price * (Decimal(1) - D(stop_pct)))
            self.session.add(pos)
            self.session.flush()

        notional = quantity * price
        if order.side is E.Side.BUY:
            total = pos.quantity + quantity
            pos.cost_basis = (pos.cost_basis or ZERO) + notional
            pos.avg_entry_price = q_price(safe_div(pos.cost_basis, total))
            pos.quantity = total
            if pos.opened_at is None:
                pos.opened_at = utcnow()
            if not pos.strategy_key:
                pos.strategy_key = order.strategy_key
        else:
            sold = min(quantity, pos.quantity)
            cost_share = safe_div(pos.cost_basis, pos.quantity) * sold if pos.quantity else ZERO
            pos.realized_pnl = (pos.realized_pnl or ZERO) + (sold * price - cost_share)
            pos.cost_basis = (pos.cost_basis or ZERO) - cost_share
            pos.quantity -= sold
        pos.last_price = price
        pos.last_price_at = utcnow()
        pos.market_value = pos.quantity * price
        pos.peak_price = max(pos.peak_price or ZERO, price)
        if pos.avg_entry_price and pos.avg_entry_price > 0:
            pos.unrealized_pnl = pos.market_value - pos.cost_basis
            pos.unrealized_pnl_pct = safe_div(price - pos.avg_entry_price, pos.avg_entry_price)
        if pos.quantity <= 0:
            pos.quantity = ZERO
            pos.market_value = ZERO
            pos.unrealized_pnl = ZERO
            pos.cost_basis = ZERO
        self.session.flush()

    def _transition(
        self,
        order: Order,
        to_status: E.OrderStatus,
        event_type: str,
        message: str | None = None,
        source: str = "local",
    ) -> bool:
        from_status = order.status
        if to_status is from_status:
            return True
        allowed = ALLOWED_TRANSITIONS.get(from_status, set())
        if to_status not in allowed:
            log.warning(
                "illegal_order_transition",
                order_id=order.id,
                from_status=from_status.value,
                to_status=to_status.value,
            )
            self._event(
                order,
                "illegal_transition",
                from_status,
                to_status,
                message=(
                    f"broker reported {to_status.value} but local state was {from_status.value}; "
                    "recorded without applying"
                ),
                source=source,
            )
            return False
        order.status = to_status
        if to_status is E.OrderStatus.CANCELED:
            order.canceled_at = utcnow()
        self._event(order, event_type, from_status, to_status, message=message, source=source)
        # Sessions run with autoflush off, so the duplicate-detection queries in
        # submit() read the database directly. Without this flush a status change
        # made earlier in the same transaction would be invisible to them, and a
        # rejected order would keep blocking the next decision for that symbol.
        self.session.flush()
        return True

    def _event(
        self,
        order: Order,
        event_type: str,
        from_status: E.OrderStatus | None,
        to_status: E.OrderStatus | None,
        *,
        quantity: Decimal | None = None,
        price: Decimal | None = None,
        message: str | None = None,
        source: str = "local",
    ) -> None:
        self.session.add(
            OrderEvent(
                order_id=order.id,
                at=utcnow(),
                event_type=event_type,
                from_status=from_status,
                to_status=to_status,
                quantity=quantity,
                price=price,
                message=message,
                source=source,
            )
        )

    def _alert(
        self,
        kind: E.AlertKind,
        severity: E.AlertSeverity,
        title: str,
        message: str,
        symbol: str | None = None,
    ) -> None:
        self.session.add(
            Alert(
                at=utcnow(),
                kind=kind,
                severity=severity,
                title=title,
                message=message,
                symbol=symbol,
            )
        )

    # ------------------------------------------------------------------
    # polling / cancel / replace
    # ------------------------------------------------------------------
    def poll_open_orders(self) -> dict[str, Any]:
        """Refresh every locally-open order from the broker."""
        open_local = self.session.scalars(
            select(Order).where(
                Order.mode == self.mode,
                Order.status.in_([s for s in E.OrderStatus if s.is_open]),
            )
        ).all()
        updated = failed = 0
        for order in open_local:
            try:
                bo = self.broker.get_order(client_order_id=order.client_order_id, broker_order_id=order.broker_order_id)
            except BrokerError as exc:
                failed += 1
                log.warning("order_poll_failed", order_id=order.id, error=str(exc))
                continue
            if bo is None:
                # Locally open but unknown to the broker: it never made it.
                self._transition(
                    order,
                    E.OrderStatus.REJECTED,
                    "not_found_at_broker",
                    "order is unknown to the broker; treating as never placed",
                    source="recon",
                )
                updated += 1
                continue
            self._apply_broker_order(order, bo, source="poll")
            updated += 1
        return {"polled": len(open_local), "updated": updated, "failed": failed}

    def cancel(self, order: Order, reason: str = "cancelled by operator") -> bool:
        if order.status.is_terminal:
            return False
        if not order.broker_order_id:
            self._transition(order, E.OrderStatus.CANCELED, "cancel_local", reason)
            return True
        self._transition(order, E.OrderStatus.PENDING_CANCEL, "cancel_requested", reason)
        try:
            ok = self.broker.cancel_order(order.broker_order_id)
        except BrokerError as exc:
            self._event(order, "cancel_failed", order.status, order.status, message=str(exc))
            return False
        if ok:
            self._transition(order, E.OrderStatus.CANCELED, "cancel_confirmed", reason, source="broker")
        return ok

    def cancel_all(self, reason: str = "cancel-all requested") -> int:
        cancelled = 0
        for order in self.session.scalars(
            select(Order).where(
                Order.mode == self.mode,
                Order.status.in_([s for s in E.OrderStatus if s.is_open]),
            )
        ).all():
            if self.cancel(order, reason):
                cancelled += 1
        return cancelled

    def cancel_stale_orders(self, max_age_seconds: int) -> int:
        """Cancel orders that have been open beyond the configured budget."""
        cutoff = utcnow() - timedelta(seconds=max_age_seconds)
        stale = self.session.scalars(
            select(Order).where(
                Order.mode == self.mode,
                Order.status.in_([s for s in E.OrderStatus if s.is_open]),
                Order.submitted_at.is_not(None),
                Order.submitted_at < cutoff,
            )
        ).all()
        count = 0
        for order in stale:
            if self.cancel(order, f"open longer than the {max_age_seconds}s budget"):
                count += 1
        return count

    def replace(
        self,
        order: Order,
        *,
        quantity: Decimal | None = None,
        limit_price: Decimal | None = None,
        stop_price: Decimal | None = None,
        reason: str = "cancel-replace",
    ) -> SubmitOutcome:
        """Cancel-and-replace, preserving the audit chain."""
        if order.status.is_terminal or not order.broker_order_id:
            return SubmitOutcome(order=order, submitted=False, reason="order is not replaceable")
        self._transition(order, E.OrderStatus.PENDING_REPLACE, "replace_requested", reason)
        new_coid = f"{order.client_order_id}-r{order.submit_attempts}"
        try:
            bo = self.broker.replace_order(
                order.broker_order_id,
                quantity=quantity,
                limit_price=limit_price,
                stop_price=stop_price,
                client_order_id=new_coid,
            )
        except BrokerError as exc:
            self._event(order, "replace_failed", order.status, order.status, message=str(exc))
            return SubmitOutcome(order=order, submitted=False, reason=str(exc))
        if bo is None:
            return SubmitOutcome(order=order, submitted=False, reason="broker declined the replace")

        self._transition(order, E.OrderStatus.REPLACED, "replaced", reason, source="broker")
        replacement = Order(
            client_order_id=bo.client_order_id or new_coid,
            broker_order_id=bo.broker_order_id,
            decision_id=order.decision_id,
            replaces_order_id=order.id,
            mode=self.mode,
            symbol=order.symbol,
            side=order.side,
            order_type=bo.order_type,
            time_in_force=bo.time_in_force,
            quantity=bo.quantity,
            limit_price=bo.limit_price,
            stop_price=bo.stop_price,
            status=E.OrderStatus.PENDING_NEW,
            strategy_key=order.strategy_key,
            reference_price=order.reference_price,
            broker=self.broker.name,
            submit_attempts=order.submit_attempts + 1,
            is_synthetic=order.is_synthetic,
        )
        self.session.add(replacement)
        self.session.flush()
        self._event(replacement, "created_from_replace", None, E.OrderStatus.PENDING_NEW, message=reason)
        self._apply_broker_order(replacement, bo, source="broker")
        return SubmitOutcome(order=replacement, submitted=True)

    # ------------------------------------------------------------------
    # reconciliation
    # ------------------------------------------------------------------
    def reconcile(self, *, auto_heal: bool = True) -> ReconciliationRun:
        """Compare local state to the broker and record every disagreement.

        Position quantity differences are healed toward the broker, which is the
        authoritative record of what is actually owned. Order-state differences
        are healed by adopting the broker's view. Anything that cannot be healed
        is left unresolved, and the risk engine then blocks new orders until an
        operator clears it.
        """
        started = utcnow()
        run = ReconciliationRun(at=started, mode=self.mode, status=E.ReconStatus.CLEAN)
        breaks: list[dict[str, Any]] = []
        healed: list[dict[str, Any]] = []

        try:
            broker_positions = {p.symbol.upper(): p for p in self.broker.get_positions()}
            broker_open = {o.client_order_id: o for o in self.broker.list_open_orders()}
        except BrokerError as exc:
            run.status = E.ReconStatus.FAILED
            run.error = exc.message
            run.resolved = False
            self.session.add(run)
            self._alert(
                E.AlertKind.BROKER_DISCONNECT,
                E.AlertSeverity.CRITICAL,
                "Reconciliation failed",
                f"Could not reach the broker: {exc.message}",
            )
            self.session.flush()
            return run

        local_positions = {
            p.symbol: p
            for p in self.session.scalars(select(Position).where(Position.mode == self.mode, Position.quantity != 0))
        }
        run.positions_checked = len(set(local_positions) | set(broker_positions))

        for symbol in sorted(set(local_positions) | set(broker_positions)):
            local = local_positions.get(symbol)
            remote = broker_positions.get(symbol)
            local_qty = local.quantity if local else ZERO
            remote_qty = remote.quantity if remote else ZERO
            if abs(local_qty - remote_qty) <= Decimal("0.000001"):
                if local and remote:  # refresh marks while we are here
                    local.last_price = remote.current_price
                    local.last_price_at = utcnow()
                    local.market_value = remote.market_value
                    local.unrealized_pnl = remote.unrealized_pnl
                continue

            entry = {
                "kind": "position_quantity",
                "symbol": symbol,
                "local_quantity": str(local_qty),
                "broker_quantity": str(remote_qty),
                "difference": str(remote_qty - local_qty),
            }
            breaks.append(entry)
            if not auto_heal:
                continue
            if remote is None:
                if local is not None:
                    local.quantity = ZERO
                    local.market_value = ZERO
                    local.cost_basis = ZERO
                    local.unrealized_pnl = ZERO
                    healed.append({**entry, "action": "closed the local position (broker has none)"})
            else:
                if local is None:
                    get_or_create_instrument(self.session, symbol)
                    local = Position(
                        mode=self.mode,
                        symbol=symbol,
                        quantity=remote.quantity,
                        avg_entry_price=remote.avg_entry_price,
                        cost_basis=remote.cost_basis,
                        opened_at=utcnow(),
                        is_synthetic=self.broker.name == "mock",
                    )
                    self.session.add(local)
                    healed.append({**entry, "action": "created the local position from the broker"})
                else:
                    local.quantity = remote.quantity
                    local.avg_entry_price = remote.avg_entry_price
                    local.cost_basis = remote.cost_basis
                    healed.append({**entry, "action": "adopted the broker quantity"})
                local.last_price = remote.current_price
                local.market_value = remote.market_value
                local.unrealized_pnl = remote.unrealized_pnl

        # Orders: adopt the broker's view of anything we think is open, and
        # adopt any broker order we have never seen.
        local_open = {
            o.client_order_id: o
            for o in self.session.scalars(
                select(Order).where(
                    Order.mode == self.mode,
                    Order.status.in_([s for s in E.OrderStatus if s.is_open]),
                )
            )
        }
        run.orders_checked = len(set(local_open) | set(broker_open))
        for coid in sorted(set(local_open) | set(broker_open)):
            local_order = local_open.get(coid)
            remote_order = broker_open.get(coid)
            if local_order is not None and remote_order is not None:
                if local_order.status is not remote_order.status:
                    breaks.append(
                        {
                            "kind": "order_status",
                            "client_order_id": coid,
                            "local_status": local_order.status.value,
                            "broker_status": remote_order.status.value,
                        }
                    )
                    if auto_heal:
                        self._apply_broker_order(local_order, remote_order, source="recon")
                        healed.append(
                            {
                                "kind": "order_status",
                                "client_order_id": coid,
                                "action": "adopted broker status",
                            }
                        )
                continue
            if local_order is not None and remote_order is None:
                try:
                    fetched = self.broker.get_order(client_order_id=coid)
                except BrokerError:
                    fetched = None
                breaks.append(
                    {
                        "kind": "order_missing_at_broker",
                        "client_order_id": coid,
                        "local_status": local_order.status.value,
                        "broker_status": fetched.status.value if fetched else None,
                    }
                )
                if auto_heal:
                    if fetched is not None:
                        self._apply_broker_order(local_order, fetched, source="recon")
                        healed.append(
                            {
                                "kind": "order_missing_at_broker",
                                "client_order_id": coid,
                                "action": "adopted terminal state",
                            }
                        )
                    else:
                        self._transition(
                            local_order,
                            E.OrderStatus.REJECTED,
                            "recon_not_found",
                            "unknown to the broker at reconciliation",
                            source="recon",
                        )
                        healed.append(
                            {
                                "kind": "order_missing_at_broker",
                                "client_order_id": coid,
                                "action": "marked rejected",
                            }
                        )
            elif remote_order is not None and local_order is None:
                # An order at the broker we have no record of. Never adopt it as
                # ours; flag it loudly — it could be a manual trade or a bug.
                breaks.append(
                    {
                        "kind": "unknown_broker_order",
                        "client_order_id": coid,
                        "symbol": remote_order.symbol,
                        "broker_status": remote_order.status.value,
                        "note": "an order exists at the broker with no local record",
                    }
                )

        run.breaks = {"items": breaks, "count": len(breaks)}
        run.auto_healed = {"items": healed, "count": len(healed)}
        run.status = E.ReconStatus.BREAKS_FOUND if breaks else E.ReconStatus.CLEAN
        unhealed = len(breaks) - len(healed)
        run.resolved = unhealed <= 0
        run.duration_ms = int((utcnow() - started).total_seconds() * 1000)
        self.session.add(run)

        state = get_system_state(self.session)
        state.last_reconcile_at = started
        state.broker_connected = True
        state.broker_last_ok_at = started

        if breaks:
            self._alert(
                E.AlertKind.RECONCILIATION_MISMATCH,
                E.AlertSeverity.CRITICAL if not run.resolved else E.AlertSeverity.WARNING,
                f"Reconciliation found {len(breaks)} break(s)",
                (
                    f"{len(healed)} healed automatically, {max(0, unhealed)} unresolved. "
                    + "; ".join(f"{b['kind']}:{b.get('symbol') or b.get('client_order_id')}" for b in breaks[:5])
                ),
            )
        self.session.flush()
        return run

    # ------------------------------------------------------------------
    # emergency controls
    # ------------------------------------------------------------------
    def flatten_positions(self, reason: str = "flatten requested") -> dict[str, Any]:
        """Cancel everything, then market-sell every long position.

        Deliberately uses market orders: when flattening, certainty of execution
        matters more than price.
        """
        cancelled = self.cancel_all(f"flatten: {reason}")
        submitted: list[dict[str, Any]] = []
        failures: list[dict[str, Any]] = []
        for pos in self.session.scalars(
            select(Position).where(Position.mode == self.mode, Position.quantity > 0)
        ).all():
            outcome = self.submit(
                SubmitRequest(
                    symbol=pos.symbol,
                    side=E.Side.SELL,
                    quantity=pos.quantity,
                    order_type=E.OrderType.MARKET,
                    reference_price=pos.last_price or pos.avg_entry_price,
                    strategy_key=pos.strategy_key,
                    reduce_only=True,
                    idempotency_salt=f"flatten-{utcnow().isoformat(timespec='seconds')}",
                )
            )
            (submitted if outcome.submitted else failures).append(
                {"symbol": pos.symbol, "quantity": str(pos.quantity), "reason": outcome.reason}
            )
        self._alert(
            E.AlertKind.KILL_SWITCH,
            E.AlertSeverity.CRITICAL,
            "Flatten-positions workflow executed",
            f"{cancelled} order(s) cancelled, {len(submitted)} exit order(s) submitted. Reason: {reason}",
        )
        return {
            "cancelled_orders": cancelled,
            "exit_orders_submitted": len(submitted),
            "submitted": submitted,
            "failures": failures,
        }
