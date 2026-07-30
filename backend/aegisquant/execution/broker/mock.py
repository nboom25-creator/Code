"""Mock broker — a deterministic, deliberately awkward paper venue.

Used by the test suite and by the offline demo. It is not a happy-path stub: it
simulates the behaviours that break naive order management, because those paths
need to be exercised somewhere other than production.

* partial fills when an order exceeds the per-bar participation cap,
* rejections for insufficient buying power, unknown symbols, non-shortable
  names and sub-penny prices,
* limit orders that do not fill because the price never traded through,
* configurable latency, and a ``fail_next_submit`` switch that raises
  :class:`BrokerSubmitUncertain` so recovery logic can be tested,
* a disconnect switch that makes every call raise, to test the health path.

State lives in memory and is fully deterministic given the same seed.
"""

from __future__ import annotations

import itertools
import threading
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from aegisquant.db.enums import OrderStatus, OrderType, Side, TimeInForce
from aegisquant.execution.broker.base import (
    Broker,
    BrokerAccount,
    BrokerDisconnected,
    BrokerFill,
    BrokerOrder,
    BrokerPosition,
    BrokerRejected,
    BrokerSubmitUncertain,
)
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import ZERO, D
from aegisquant.utils.money import price as q_price
from aegisquant.utils.timeutil import utcnow

log = get_logger(__name__)


@dataclass
class MockMarket:
    """Prices and liquidity the mock broker fills against."""

    prices: dict[str, Decimal] = field(default_factory=dict)
    spreads_bps: dict[str, Decimal] = field(default_factory=dict)
    #: Maximum shares fillable in one go, per symbol. Lower values force partials.
    liquidity: dict[str, Decimal] = field(default_factory=dict)
    tradable: set[str] = field(default_factory=set)
    shortable: set[str] = field(default_factory=set)

    def price(self, symbol: str) -> Decimal | None:
        return self.prices.get(symbol.upper())

    def set_price(self, symbol: str, value: Any) -> None:
        self.prices[symbol.upper()] = D(value)
        self.tradable.add(symbol.upper())

    def half_spread(self, symbol: str) -> Decimal:
        bps = self.spreads_bps.get(symbol.upper(), Decimal("4"))
        price = self.price(symbol) or ZERO
        return price * bps / Decimal(20_000)


class MockBroker(Broker):
    name = "mock"
    supports_fractional = True
    supports_short = False
    is_paper = True

    def __init__(
        self,
        *,
        starting_cash: Decimal | float | str = Decimal("100000"),
        market: MockMarket | None = None,
        account_id: str = "MOCK-PAPER-000001",
        latency_ms: int = 0,
        fill_immediately: bool = True,
        market_open: bool | None = None,
    ) -> None:
        self.market = market or MockMarket()
        self.cash: Decimal = D(starting_cash)
        self.starting_cash: Decimal = D(starting_cash)
        self.positions: dict[str, BrokerPosition] = {}
        self.orders: dict[str, BrokerOrder] = {}  # keyed by client_order_id
        self._by_broker_id: dict[str, str] = {}
        self._ids = itertools.count(1)
        self._fill_ids = itertools.count(1)
        self.account_id = account_id
        self.latency_ms = latency_ms
        self.fill_immediately = fill_immediately
        #: Override the simulated venue's session status. ``None`` follows the
        #: real US equity calendar. Only meaningful for a simulator — the broker
        #: factory refuses the mock broker in LIVE mode, so this can never affect
        #: a real account.
        self.market_open = market_open
        self.realized_pnl: Decimal = ZERO
        self.day_trade_count = 0
        # Failure-injection switches for tests.
        self.connected = True
        self.fail_next_submit = False
        self.reject_next_submit: str | None = None
        self.trading_blocked = False
        self._lock = threading.Lock()
        self.submit_calls = 0

    # -- helpers -------------------------------------------------------------
    def _guard(self) -> None:
        if not self.connected:
            raise BrokerDisconnected(self.name, "simulated disconnect")

    def _equity(self) -> Decimal:
        total = self.cash
        for pos in self.positions.values():
            price = self.market.price(pos.symbol) or pos.current_price
            total += pos.quantity * price
        return total

    # -- account -------------------------------------------------------------
    def get_account(self) -> BrokerAccount:
        self._guard()
        equity = self._equity()
        return BrokerAccount(
            account_id=self.account_id,
            equity=equity,
            cash=self.cash,
            buying_power=self.cash,  # no margin in v1
            pattern_day_trader=False,
            day_trade_count=self.day_trade_count,
            trading_blocked=self.trading_blocked,
            shorting_enabled=self.supports_short,
            is_paper=True,
            retrieved_at=utcnow(),
            raw={"simulated": True},
        )

    def get_positions(self) -> list[BrokerPosition]:
        self._guard()
        out = []
        for pos in self.positions.values():
            price = self.market.price(pos.symbol) or pos.current_price
            pos.current_price = price
            pos.market_value = pos.quantity * price
            pos.unrealized_pnl = pos.market_value - pos.cost_basis
            out.append(pos)
        return [p for p in out if p.quantity != 0]

    # -- orders --------------------------------------------------------------
    def submit_order(
        self,
        *,
        client_order_id: str,
        symbol: str,
        side: Side,
        quantity: Decimal,
        order_type: OrderType,
        time_in_force: TimeInForce = TimeInForce.DAY,
        limit_price: Decimal | None = None,
        stop_price: Decimal | None = None,
        extended_hours: bool = False,
    ) -> BrokerOrder:
        self._guard()
        with self._lock:
            self.submit_calls += 1
            symbol = symbol.upper()

            # Idempotency: the same client order id never creates a second order.
            existing = self.orders.get(client_order_id)
            if existing is not None:
                log.info("mock_duplicate_submit_ignored", client_order_id=client_order_id)
                return existing

            if self.fail_next_submit:
                self.fail_next_submit = False
                # The order IS created, but the caller is told the outcome is
                # unknown — the nastiest real-world case.
                order = self._create(
                    client_order_id,
                    symbol,
                    side,
                    quantity,
                    order_type,
                    time_in_force,
                    limit_price,
                    stop_price,
                )
                self.orders[client_order_id] = order
                if order.broker_order_id:
                    self._by_broker_id[order.broker_order_id] = client_order_id
                if self.fill_immediately:
                    self._try_fill(order)
                raise BrokerSubmitUncertain(self.name, client_order_id, "simulated network timeout")

            if self.reject_next_submit:
                reason, self.reject_next_submit = self.reject_next_submit, None
                order = self._create(
                    client_order_id,
                    symbol,
                    side,
                    quantity,
                    order_type,
                    time_in_force,
                    limit_price,
                    stop_price,
                )
                order.status = OrderStatus.REJECTED
                order.reject_reason = reason
                self.orders[client_order_id] = order
                raise BrokerRejected(self.name, reason)

            if self.trading_blocked:
                raise BrokerRejected(self.name, "trading is blocked on this account")

            price = self.market.price(symbol)
            if price is None:
                raise BrokerRejected(self.name, f"unknown or untradable symbol {symbol}")
            if price < Decimal("0.01"):
                raise BrokerRejected(self.name, f"{symbol} price {price} is sub-penny")
            if quantity <= 0:
                raise BrokerRejected(self.name, "quantity must be positive")

            held = self.positions.get(symbol)
            if side is Side.SELL:
                held_qty = held.quantity if held else ZERO
                if quantity > held_qty and symbol not in self.market.shortable:
                    raise BrokerRejected(self.name, f"{symbol} is not shortable and only {held_qty} is held")
            else:
                required = quantity * price
                if required > self.cash:
                    raise BrokerRejected(
                        self.name,
                        f"insufficient buying power: need ${required:,.2f}, have ${self.cash:,.2f}",
                    )

            order = self._create(
                client_order_id,
                symbol,
                side,
                quantity,
                order_type,
                time_in_force,
                limit_price,
                stop_price,
            )
            self.orders[client_order_id] = order
            if order.broker_order_id:
                self._by_broker_id[order.broker_order_id] = client_order_id
            if self.fill_immediately:
                self._try_fill(order)
            return order

    def _create(
        self,
        client_order_id: str,
        symbol: str,
        side: Side,
        quantity: Decimal,
        order_type: OrderType,
        time_in_force: TimeInForce,
        limit_price: Decimal | None,
        stop_price: Decimal | None,
    ) -> BrokerOrder:
        return BrokerOrder(
            client_order_id=client_order_id,
            broker_order_id=f"mock-{next(self._ids):06d}",
            symbol=symbol,
            side=side,
            order_type=order_type,
            quantity=quantity,
            status=OrderStatus.NEW,
            time_in_force=time_in_force,
            limit_price=limit_price,
            stop_price=stop_price,
            submitted_at=utcnow(),
            updated_at=utcnow(),
            raw={"simulated": True},
        )

    def _try_fill(self, order: BrokerOrder) -> None:
        """Attempt to fill, honouring limits and the liquidity cap."""
        price = self.market.price(order.symbol)
        if price is None:
            return
        half = self.market.half_spread(order.symbol)
        exec_price = price + half if order.side is Side.BUY else price - half

        if order.order_type is OrderType.LIMIT and order.limit_price is not None:
            if order.side is Side.BUY and exec_price > order.limit_price:
                return  # never traded through the limit; stays open
            if order.side is Side.SELL and exec_price < order.limit_price:
                return
            exec_price = (
                min(exec_price, order.limit_price) if order.side is Side.BUY else max(exec_price, order.limit_price)
            )
        if order.order_type in (OrderType.STOP, OrderType.STOP_LIMIT) and order.stop_price is not None:
            if order.side is Side.SELL and price > order.stop_price:
                return  # not triggered
            if order.side is Side.BUY and price < order.stop_price:
                return

        exec_price = q_price(max(Decimal("0.01"), exec_price))
        cap = self.market.liquidity.get(order.symbol)
        fillable = order.remaining if cap is None else min(order.remaining, cap)
        if fillable <= 0:
            return
        if order.side is Side.BUY:
            affordable = (self.cash / exec_price).quantize(Decimal("0.000001"))
            fillable = min(fillable, affordable)
        if fillable <= 0:
            order.status = OrderStatus.REJECTED
            order.reject_reason = "insufficient buying power at fill time"
            return

        self._book_fill(order, fillable, exec_price)

    def _book_fill(self, order: BrokerOrder, quantity: Decimal, price: Decimal) -> None:
        fill = BrokerFill(
            fill_id=f"mockfill-{next(self._fill_ids):06d}",
            at=utcnow(),
            quantity=quantity,
            price=price,
        )
        order.fills.append(fill)
        prior_qty, prior_avg = order.filled_quantity, order.avg_fill_price or ZERO
        order.filled_quantity += quantity
        order.avg_fill_price = q_price((prior_qty * prior_avg + quantity * price) / order.filled_quantity)
        order.status = OrderStatus.FILLED if order.remaining <= 0 else OrderStatus.PARTIALLY_FILLED
        order.updated_at = utcnow()

        notional = quantity * price
        pos = self.positions.get(order.symbol)
        if order.side is Side.BUY:
            self.cash -= notional
            if pos is None:
                self.positions[order.symbol] = BrokerPosition(
                    symbol=order.symbol,
                    quantity=quantity,
                    avg_entry_price=price,
                    market_value=notional,
                    current_price=price,
                    cost_basis=notional,
                )
            else:
                total = pos.quantity + quantity
                pos.cost_basis += notional
                pos.avg_entry_price = q_price(pos.cost_basis / total) if total else ZERO
                pos.quantity = total
                pos.current_price = price
                pos.market_value = pos.quantity * price
        else:
            self.cash += notional
            if pos is not None:
                cost_share = (pos.cost_basis / pos.quantity * quantity) if pos.quantity else ZERO
                self.realized_pnl += notional - cost_share
                pos.cost_basis -= cost_share
                pos.quantity -= quantity
                pos.current_price = price
                pos.market_value = pos.quantity * price
                if pos.quantity <= 0:
                    self.positions.pop(order.symbol, None)

    def get_order(
        self, *, client_order_id: str | None = None, broker_order_id: str | None = None
    ) -> BrokerOrder | None:
        self._guard()
        if client_order_id:
            return self.orders.get(client_order_id)
        if broker_order_id:
            key = self._by_broker_id.get(broker_order_id)
            return self.orders.get(key) if key else None
        return None

    def list_open_orders(self) -> list[BrokerOrder]:
        self._guard()
        return [o for o in self.orders.values() if o.status.is_open]

    def cancel_order(self, broker_order_id: str) -> bool:
        self._guard()
        order = self.get_order(broker_order_id=broker_order_id)
        if order is None or order.status.is_terminal:
            return False
        order.status = OrderStatus.CANCELED if order.filled_quantity == 0 else OrderStatus.FILLED
        order.updated_at = utcnow()
        return True

    def is_market_open(self) -> bool:
        if self.market_open is not None:
            return bool(self.market_open)
        return super().is_market_open()

    # -- test helpers --------------------------------------------------------
    def advance(self, prices: dict[str, Any] | None = None) -> int:
        """Move the market and try to fill resting orders. Returns fills booked."""
        for symbol, value in (prices or {}).items():
            self.market.set_price(symbol, value)
        before = sum(len(o.fills) for o in self.orders.values())
        for order in list(self.orders.values()):
            if order.status.is_open:
                self._try_fill(order)
        return sum(len(o.fills) for o in self.orders.values()) - before

    def disconnect(self) -> None:
        self.connected = False

    def reconnect(self) -> None:
        self.connected = True

    def flatten_all(self) -> int:
        """Close every position at the current price. Used by the flatten workflow."""
        closed = 0
        for symbol, pos in list(self.positions.items()):
            price = self.market.price(symbol) or pos.current_price
            order = self._create(
                f"flatten-{symbol}-{next(self._ids)}",
                symbol,
                Side.SELL,
                pos.quantity,
                OrderType.MARKET,
                TimeInForce.DAY,
                None,
                None,
            )
            self.orders[order.client_order_id] = order
            if order.broker_order_id:
                self._by_broker_id[order.broker_order_id] = order.client_order_id
            self._book_fill(order, pos.quantity, price)
            closed += 1
        return closed

    def health(self) -> dict[str, Any]:
        base = super().health()
        base["warning"] = "SIMULATED BROKER — no real orders are placed"
        base["submit_calls"] = self.submit_calls
        return base
