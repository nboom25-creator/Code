"""Broker abstraction.

Any broker that can do the following can be plugged in without touching the
decision path: report the account, report positions, submit and cancel orders,
and be queried for order state. Interactive Brokers, Tradier or a crypto venue
would each be a new subclass here and nothing else.

Two rules the implementations must honour:

**Idempotency.** ``submit_order`` takes a caller-generated ``client_order_id``
and must not create a second order for the same id. If the broker has already
seen it, return the existing order. This is what makes restart-after-crash safe.

**Honesty about uncertainty.** If a submission times out, the order may or may
not exist. Implementations raise :class:`BrokerSubmitUncertain` rather than
guessing, and the order manager then reconciles by looking the id up.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from aegisquant.db.enums import OrderStatus, OrderType, Side, TimeInForce


class BrokerError(RuntimeError):
    def __init__(self, broker: str, message: str, *, status_code: int | None = None) -> None:
        super().__init__(f"[{broker}] {message}")
        self.broker = broker
        self.message = message
        self.status_code = status_code


class BrokerDisconnected(BrokerError):
    """Transport failure. The account state is unknown until it reconnects."""


class BrokerRejected(BrokerError):
    """The broker refused the order outright. Terminal, do not retry blindly."""


class BrokerSubmitUncertain(BrokerError):
    """Submission outcome unknown — the order may or may not have been created."""

    def __init__(self, broker: str, client_order_id: str, message: str) -> None:
        super().__init__(broker, f"submission outcome unknown for {client_order_id}: {message}")
        self.client_order_id = client_order_id


class BrokerNotConfigured(BrokerError):
    pass


@dataclass(slots=True)
class BrokerAccount:
    account_id: str
    equity: Decimal
    cash: Decimal
    buying_power: Decimal
    currency: str = "USD"
    pattern_day_trader: bool = False
    day_trade_count: int = 0
    trading_blocked: bool = False
    transfers_blocked: bool = False
    account_blocked: bool = False
    shorting_enabled: bool = False
    multiplier: Decimal = Decimal("1")
    is_paper: bool = True
    retrieved_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def masked_account_id(self) -> str:
        """Account identifier for display: enough to recognise, not to leak."""
        if len(self.account_id) <= 8:
            return self.account_id
        return f"{self.account_id[:4]}…{self.account_id[-4:]}"


@dataclass(slots=True)
class BrokerPosition:
    symbol: str
    quantity: Decimal
    avg_entry_price: Decimal
    market_value: Decimal
    current_price: Decimal
    unrealized_pnl: Decimal = Decimal("0")
    cost_basis: Decimal = Decimal("0")
    side: str = "long"
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class BrokerFill:
    fill_id: str
    at: datetime
    quantity: Decimal
    price: Decimal
    commission: Decimal = Decimal("0")


@dataclass(slots=True)
class BrokerOrder:
    client_order_id: str
    broker_order_id: str | None
    symbol: str
    side: Side
    order_type: OrderType
    quantity: Decimal
    status: OrderStatus
    time_in_force: TimeInForce = TimeInForce.DAY
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    filled_quantity: Decimal = Decimal("0")
    avg_fill_price: Decimal | None = None
    submitted_at: datetime | None = None
    updated_at: datetime | None = None
    reject_reason: str | None = None
    fills: list[BrokerFill] = field(default_factory=list)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def remaining(self) -> Decimal:
        return max(Decimal("0"), self.quantity - self.filled_quantity)


class Broker(abc.ABC):
    """The interface every broker adapter implements."""

    name: str = "abstract"
    supports_fractional: bool = False
    supports_short: bool = False
    is_paper: bool = True

    # -- account -------------------------------------------------------------
    @abc.abstractmethod
    def get_account(self) -> BrokerAccount: ...

    @abc.abstractmethod
    def get_positions(self) -> list[BrokerPosition]: ...

    # -- orders --------------------------------------------------------------
    @abc.abstractmethod
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
    ) -> BrokerOrder: ...

    @abc.abstractmethod
    def get_order(
        self, *, client_order_id: str | None = None, broker_order_id: str | None = None
    ) -> BrokerOrder | None: ...

    @abc.abstractmethod
    def list_open_orders(self) -> list[BrokerOrder]: ...

    @abc.abstractmethod
    def cancel_order(self, broker_order_id: str) -> bool: ...

    def cancel_all_orders(self) -> int:
        """Cancel every open order. Returns how many cancels were accepted."""
        count = 0
        for order in self.list_open_orders():
            if order.broker_order_id and self.cancel_order(order.broker_order_id):
                count += 1
        return count

    def replace_order(
        self,
        broker_order_id: str,
        *,
        quantity: Decimal | None = None,
        limit_price: Decimal | None = None,
        stop_price: Decimal | None = None,
        client_order_id: str | None = None,
    ) -> BrokerOrder | None:
        """Cancel-and-replace. Default implementation is cancel-then-submit.

        Subclasses override when the venue supports a native replace, which is
        safer because it cannot leave the account briefly unhedged.
        """
        existing = self.get_order(broker_order_id=broker_order_id)
        if existing is None:
            return None
        if not self.cancel_order(broker_order_id):
            return None
        return self.submit_order(
            client_order_id=client_order_id or f"{existing.client_order_id}-r",
            symbol=existing.symbol,
            side=existing.side,
            quantity=quantity if quantity is not None else existing.remaining,
            order_type=existing.order_type,
            time_in_force=existing.time_in_force,
            limit_price=limit_price if limit_price is not None else existing.limit_price,
            stop_price=stop_price if stop_price is not None else existing.stop_price,
        )

    # -- market status -------------------------------------------------------
    def is_market_open(self) -> bool:
        from aegisquant.data.providers.calendar_static import is_trading_day
        from aegisquant.utils.timeutil import NY, utcnow

        now = utcnow().astimezone(NY)
        if not is_trading_day(now.date()):
            return False
        return (now.hour, now.minute) >= (9, 30) and (now.hour, now.minute) < (16, 0)

    # -- health --------------------------------------------------------------
    def health(self) -> dict[str, Any]:
        try:
            account = self.get_account()
            return {
                "broker": self.name,
                "ok": True,
                "connected": True,
                "is_paper": self.is_paper,
                "account_id": account.masked_account_id,
                "trading_blocked": account.trading_blocked,
                "equity": str(account.equity),
            }
        except BrokerError as exc:
            return {"broker": self.name, "ok": False, "connected": False, "error": exc.message}

    def close(self) -> None:  # pragma: no cover - optional cleanup hook
        return None
