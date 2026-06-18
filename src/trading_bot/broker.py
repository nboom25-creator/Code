"""Broker abstraction over Alpaca's Trading API.

Defaults to the **paper** trading endpoint. Constructing a live broker requires
``mode == "live"`` in config *and* the ``LIVE_TRADING_CONFIRM`` environment
variable, both validated upstream in :func:`trading_bot.config.Config.validate`.
As a final backstop, :meth:`AlpacaBroker.__init__` re-checks the confirmation
before ever pointing at the live endpoint.

Alpaca SDK imports are lazy so the rest of the package stays importable without
the dependency or network.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import LIVE_CONFIRM_VALUE, Config


@dataclass
class AccountSnapshot:
    equity: float
    cash: float
    buying_power: float


@dataclass
class PositionSnapshot:
    symbol: str
    quantity: float
    avg_price: float
    market_value: float


class AlpacaBroker:
    def __init__(self, config: Config) -> None:
        self.config = config
        creds = config.credentials
        if not creds.api_key or not creds.api_secret:
            raise ValueError(
                "Alpaca API credentials are required. Set ALPACA_API_KEY and "
                "ALPACA_API_SECRET in your environment/.env."
            )
        self._paper = not config.is_live
        if config.is_live and creds.live_confirm != LIVE_CONFIRM_VALUE:
            # Defense in depth: should already be caught by config.validate().
            raise RuntimeError(
                "Refusing to construct a LIVE broker without "
                f"LIVE_TRADING_CONFIRM={LIVE_CONFIRM_VALUE}."
            )
        self._client = None  # lazy

    @property
    def is_paper(self) -> bool:
        return self._paper

    def _get_client(self):
        if self._client is None:
            from alpaca.trading.client import TradingClient

            self._client = TradingClient(
                self.config.credentials.api_key,
                self.config.credentials.api_secret,
                paper=self._paper,
            )
        return self._client

    # ------------------------------------------------------------------ #
    # Account / positions
    # ------------------------------------------------------------------ #
    def get_account(self) -> AccountSnapshot:
        acct = self._get_client().get_account()
        return AccountSnapshot(
            equity=float(acct.equity),
            cash=float(acct.cash),
            buying_power=float(acct.buying_power),
        )

    def get_positions(self) -> list[PositionSnapshot]:
        positions = self._get_client().get_all_positions()
        return [
            PositionSnapshot(
                symbol=p.symbol,
                quantity=float(p.qty),
                avg_price=float(p.avg_entry_price),
                market_value=float(p.market_value),
            )
            for p in positions
        ]

    def get_position(self, symbol: str) -> PositionSnapshot | None:
        for pos in self.get_positions():
            if pos.symbol == symbol:
                return pos
        return None

    # ------------------------------------------------------------------ #
    # Orders
    # ------------------------------------------------------------------ #
    def submit_market_order(self, symbol: str, quantity: int, side: str):
        """Submit a day market order. ``side`` is "buy" or "sell"."""
        from alpaca.trading.enums import OrderSide, TimeInForce
        from alpaca.trading.requests import MarketOrderRequest

        if quantity <= 0:
            raise ValueError("quantity must be positive")
        order_side = OrderSide.BUY if side == "buy" else OrderSide.SELL
        request = MarketOrderRequest(
            symbol=symbol,
            qty=quantity,
            side=order_side,
            time_in_force=TimeInForce.DAY,
        )
        return self._get_client().submit_order(request)

    def submit_bracket_order(
        self,
        symbol: str,
        quantity: int,
        *,
        stop_loss_price: float,
        take_profit_price: float | None = None,
    ):
        """Submit a long entry with broker-managed protective exits.

        A bracket order attaches a stop-loss (and optional take-profit) that the
        broker manages even if this bot is offline — important for an autonomous
        system. Prices are rounded to the cent.
        """
        from alpaca.trading.enums import OrderClass, OrderSide, TimeInForce
        from alpaca.trading.requests import (
            MarketOrderRequest,
            StopLossRequest,
            TakeProfitRequest,
        )

        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if stop_loss_price <= 0:
            raise ValueError("stop_loss_price must be positive")

        kwargs = dict(
            symbol=symbol,
            qty=quantity,
            side=OrderSide.BUY,
            time_in_force=TimeInForce.DAY,
            order_class=OrderClass.BRACKET,
            stop_loss=StopLossRequest(stop_price=round(stop_loss_price, 2)),
        )
        if take_profit_price and take_profit_price > 0:
            kwargs["take_profit"] = TakeProfitRequest(
                limit_price=round(take_profit_price, 2)
            )
        return self._get_client().submit_order(MarketOrderRequest(**kwargs))

    def close_position(self, symbol: str):
        return self._get_client().close_position(symbol)

    def is_market_open(self) -> bool:
        return bool(self._get_client().get_clock().is_open)
