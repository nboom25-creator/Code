"""Alpaca broker adapter (REST over httpx).

Paper and live share one implementation; the only difference is the base URL,
which :attr:`Settings.alpaca_trading_base_url` derives from the operating mode.
That is deliberate — paper and live must exercise identical code, otherwise paper
results say nothing about live behaviour.

Safety properties:

* ``is_paper`` is read from the resolved base URL, not from a flag the caller
  passes, so a misconfiguration cannot make a live account look like paper.
* ``client_order_id`` is passed through, giving broker-side idempotency.
* A submission that times out raises :class:`BrokerSubmitUncertain` instead of
  being retried, because a blind retry is how duplicate orders happen.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

import httpx

from aegisquant.config import get_settings
from aegisquant.db.enums import OrderStatus, OrderType, Side, TimeInForce
from aegisquant.execution.broker.base import (
    Broker,
    BrokerAccount,
    BrokerDisconnected,
    BrokerError,
    BrokerFill,
    BrokerNotConfigured,
    BrokerOrder,
    BrokerPosition,
    BrokerRejected,
    BrokerSubmitUncertain,
)
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import D
from aegisquant.utils.timeutil import ensure_utc, utcnow

log = get_logger(__name__)

_STATUS_MAP = {
    "new": OrderStatus.NEW,
    "accepted": OrderStatus.NEW,
    "pending_new": OrderStatus.PENDING_NEW,
    "accepted_for_bidding": OrderStatus.NEW,
    "stopped": OrderStatus.NEW,
    "partially_filled": OrderStatus.PARTIALLY_FILLED,
    "filled": OrderStatus.FILLED,
    "canceled": OrderStatus.CANCELED,
    "cancelled": OrderStatus.CANCELED,
    "pending_cancel": OrderStatus.PENDING_CANCEL,
    "pending_replace": OrderStatus.PENDING_REPLACE,
    "replaced": OrderStatus.REPLACED,
    "rejected": OrderStatus.REJECTED,
    "expired": OrderStatus.EXPIRED,
    "suspended": OrderStatus.NEW,
    "calculated": OrderStatus.NEW,
    "held": OrderStatus.NEW,
}

_TYPE_MAP = {
    OrderType.MARKET: "market",
    OrderType.LIMIT: "limit",
    OrderType.STOP: "stop",
    OrderType.STOP_LIMIT: "stop_limit",
}
_TYPE_REVERSE = {v: k for k, v in _TYPE_MAP.items()}


class AlpacaBroker(Broker):
    name = "alpaca"
    supports_fractional = True
    supports_short = False  # disabled in v1 regardless of account entitlement

    def __init__(self) -> None:
        s = get_settings()
        if not (s.alpaca_key_id and s.alpaca_secret_key):
            raise BrokerNotConfigured(self.name, "AEGIS_ALPACA_KEY_ID and AEGIS_ALPACA_SECRET_KEY must be set")
        self._base = s.alpaca_trading_base_url.rstrip("/")
        # Paper status is derived from the URL actually in use, never asserted.
        self.is_paper = "paper-api" in self._base
        self._headers = {
            "APCA-API-KEY-ID": s.alpaca_key_id.get_secret_value(),
            "APCA-API-SECRET-KEY": s.alpaca_secret_key.get_secret_value(),
            "content-type": "application/json",
            "accept": "application/json",
        }
        self._timeout = s.provider_timeout_seconds
        log.info("alpaca_broker_initialised", base_url=self._base, is_paper=self.is_paper)

    # ------------------------------------------------------------------
    def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        url = f"{self._base}{path}"
        try:
            resp = httpx.request(method, url, headers=self._headers, json=json, params=params, timeout=self._timeout)
        except httpx.TimeoutException as exc:
            if idempotency_key:
                raise BrokerSubmitUncertain(self.name, idempotency_key, str(exc)) from exc
            raise BrokerDisconnected(self.name, f"timeout calling {path}: {exc}") from exc
        except httpx.HTTPError as exc:
            if idempotency_key:
                raise BrokerSubmitUncertain(self.name, idempotency_key, str(exc)) from exc
            raise BrokerDisconnected(self.name, f"transport error calling {path}: {exc}") from exc

        if resp.status_code in (401, 403):
            raise BrokerNotConfigured(self.name, "credentials rejected by Alpaca")
        if resp.status_code == 404:
            return None
        if resp.status_code == 422:
            raise BrokerRejected(self.name, _safe_error(resp))
        if resp.status_code == 429:
            raise BrokerDisconnected(self.name, "rate limited by Alpaca")
        if resp.status_code >= 500:
            if idempotency_key:
                raise BrokerSubmitUncertain(self.name, idempotency_key, f"upstream {resp.status_code}")
            raise BrokerDisconnected(self.name, f"upstream {resp.status_code}")
        if resp.status_code >= 400:
            raise BrokerError(self.name, _safe_error(resp), status_code=resp.status_code)
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            raise BrokerError(self.name, "non-JSON response") from exc

    # -- account -------------------------------------------------------------
    def get_account(self) -> BrokerAccount:
        payload = self._request("GET", "/v2/account")
        if not payload:
            raise BrokerError(self.name, "empty account response")
        return BrokerAccount(
            account_id=str(payload.get("account_number") or payload.get("id") or "unknown"),
            equity=D(payload.get("equity") or 0),
            cash=D(payload.get("cash") or 0),
            buying_power=D(payload.get("buying_power") or 0),
            currency=payload.get("currency") or "USD",
            pattern_day_trader=bool(payload.get("pattern_day_trader")),
            day_trade_count=int(payload.get("daytrade_count") or 0),
            trading_blocked=bool(payload.get("trading_blocked")),
            transfers_blocked=bool(payload.get("transfers_blocked")),
            account_blocked=bool(payload.get("account_blocked")),
            shorting_enabled=bool(payload.get("shorting_enabled")),
            multiplier=D(payload.get("multiplier") or 1),
            is_paper=self.is_paper,
            retrieved_at=utcnow(),
            # Deliberately do NOT keep the raw payload: it contains account
            # identifiers that must not leak into logs or API responses.
            raw={},
        )

    def get_positions(self) -> list[BrokerPosition]:
        payload = self._request("GET", "/v2/positions") or []
        out = []
        for row in payload:
            out.append(
                BrokerPosition(
                    symbol=row["symbol"].upper(),
                    quantity=D(row.get("qty") or 0),
                    avg_entry_price=D(row.get("avg_entry_price") or 0),
                    market_value=D(row.get("market_value") or 0),
                    current_price=D(row.get("current_price") or 0),
                    unrealized_pnl=D(row.get("unrealized_pl") or 0),
                    cost_basis=D(row.get("cost_basis") or 0),
                    side=row.get("side") or "long",
                )
            )
        return out

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
        body: dict[str, Any] = {
            "symbol": symbol.upper(),
            "qty": str(quantity),
            "side": side.value,
            "type": _TYPE_MAP[order_type],
            "time_in_force": time_in_force.value,
            "client_order_id": client_order_id,
            "extended_hours": extended_hours,
        }
        if limit_price is not None:
            body["limit_price"] = str(limit_price)
        if stop_price is not None:
            body["stop_price"] = str(stop_price)

        try:
            payload = self._request("POST", "/v2/orders", json=body, idempotency_key=client_order_id)
        except BrokerRejected:
            raise
        except BrokerSubmitUncertain:
            # Do not retry. Look the id up instead; if it exists, use it.
            existing = self.get_order(client_order_id=client_order_id)
            if existing is not None:
                log.warning("alpaca_submit_recovered", client_order_id=client_order_id)
                return existing
            raise
        if not payload:
            raise BrokerError(self.name, "empty order response")
        return self._parse_order(payload)

    def get_order(
        self, *, client_order_id: str | None = None, broker_order_id: str | None = None
    ) -> BrokerOrder | None:
        if client_order_id:
            payload = self._request("GET", "/v2/orders:by_client_order_id", params={"client_order_id": client_order_id})
        elif broker_order_id:
            payload = self._request("GET", f"/v2/orders/{broker_order_id}", params={"nested": "true"})
        else:
            return None
        return self._parse_order(payload) if payload else None

    def list_open_orders(self) -> list[BrokerOrder]:
        payload = self._request("GET", "/v2/orders", params={"status": "open", "limit": 500, "nested": "true"}) or []
        return [self._parse_order(row) for row in payload]

    def cancel_order(self, broker_order_id: str) -> bool:
        try:
            self._request("DELETE", f"/v2/orders/{broker_order_id}")
            return True
        except BrokerError as exc:
            log.warning("alpaca_cancel_failed", broker_order_id=broker_order_id, error=exc.message)
            return False

    def cancel_all_orders(self) -> int:
        payload = self._request("DELETE", "/v2/orders") or []
        return len([r for r in payload if str(r.get("status", "")).startswith("2")])

    def replace_order(
        self,
        broker_order_id: str,
        *,
        quantity: Decimal | None = None,
        limit_price: Decimal | None = None,
        stop_price: Decimal | None = None,
        client_order_id: str | None = None,
    ) -> BrokerOrder | None:
        """Native replace — atomic at the venue, so the account is never briefly naked."""
        body: dict[str, Any] = {}
        if quantity is not None:
            body["qty"] = str(quantity)
        if limit_price is not None:
            body["limit_price"] = str(limit_price)
        if stop_price is not None:
            body["stop_price"] = str(stop_price)
        if client_order_id:
            body["client_order_id"] = client_order_id
        if not body:
            return self.get_order(broker_order_id=broker_order_id)
        payload = self._request("PATCH", f"/v2/orders/{broker_order_id}", json=body, idempotency_key=client_order_id)
        return self._parse_order(payload) if payload else None

    # -- market status -------------------------------------------------------
    def is_market_open(self) -> bool:
        try:
            payload = self._request("GET", "/v2/clock")
            return bool(payload and payload.get("is_open"))
        except BrokerError:
            return super().is_market_open()  # fall back to the calendar

    # ------------------------------------------------------------------
    def _parse_order(self, row: dict[str, Any]) -> BrokerOrder:
        fills: list[BrokerFill] = []
        for leg in row.get("legs") or []:
            if leg.get("filled_qty") and D(leg["filled_qty"]) > 0:
                fills.append(
                    BrokerFill(
                        fill_id=str(leg.get("id")),
                        at=_ts(leg.get("filled_at")) or utcnow(),
                        quantity=D(leg["filled_qty"]),
                        price=D(leg.get("filled_avg_price") or 0),
                    )
                )
        if not fills and row.get("filled_qty") and D(row["filled_qty"]) > 0:
            fills.append(
                BrokerFill(
                    fill_id=f"{row.get('id')}-agg",
                    at=_ts(row.get("filled_at")) or utcnow(),
                    quantity=D(row["filled_qty"]),
                    price=D(row.get("filled_avg_price") or 0),
                )
            )
        return BrokerOrder(
            client_order_id=row.get("client_order_id") or "",
            broker_order_id=str(row.get("id")) if row.get("id") else None,
            symbol=(row.get("symbol") or "").upper(),
            side=Side(row.get("side") or "buy"),
            order_type=_TYPE_REVERSE.get(row.get("type") or "market", OrderType.MARKET),
            quantity=D(row.get("qty") or 0),
            status=_STATUS_MAP.get(str(row.get("status") or "new").lower(), OrderStatus.NEW),
            time_in_force=TimeInForce(str(row.get("time_in_force") or "day").lower()),
            limit_price=D(row["limit_price"]) if row.get("limit_price") else None,
            stop_price=D(row["stop_price"]) if row.get("stop_price") else None,
            filled_quantity=D(row.get("filled_qty") or 0),
            avg_fill_price=D(row["filled_avg_price"]) if row.get("filled_avg_price") else None,
            submitted_at=_ts(row.get("submitted_at")) or _ts(row.get("created_at")),
            updated_at=_ts(row.get("updated_at")),
            reject_reason=row.get("failed_at") and "rejected by broker" or None,
            fills=fills,
            raw={},  # never retain the raw payload
        )


def _ts(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    try:
        return ensure_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))
    except ValueError:
        return None


def _safe_error(resp: httpx.Response) -> str:
    """Extract a broker error message without echoing back credentials or payload."""
    try:
        data = resp.json()
        message = data.get("message") or data.get("error") or "rejected"
    except ValueError:
        message = "rejected"
    return f"{message} (HTTP {resp.status_code})"
