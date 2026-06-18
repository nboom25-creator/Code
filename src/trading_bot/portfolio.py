"""In-memory portfolio used by the backtester.

Tracks cash, open positions, and a mark-to-market equity curve. The live engine
uses the broker's account/positions instead, but this mirrors the same concepts
so strategy behaviour is consistent between backtest and live.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Position:
    symbol: str
    quantity: int
    avg_price: float

    @property
    def cost_basis(self) -> float:
        return self.quantity * self.avg_price

    def market_value(self, price: float) -> float:
        return self.quantity * price


@dataclass
class Trade:
    symbol: str
    side: str  # "buy" or "sell"
    quantity: int
    price: float
    timestamp: object = None
    pnl: float = 0.0  # realized P&L on a closing trade


@dataclass
class Portfolio:
    cash: float
    positions: dict[str, Position] = field(default_factory=dict)
    trades: list[Trade] = field(default_factory=list)

    def has_position(self, symbol: str) -> bool:
        return symbol in self.positions and self.positions[symbol].quantity != 0

    def buy(self, symbol: str, quantity: int, price: float, *, commission: float = 0.0,
            timestamp: object = None) -> None:
        if quantity <= 0:
            return
        cost = quantity * price + commission
        if cost > self.cash + 1e-9:
            raise ValueError(
                f"insufficient cash for {quantity} {symbol} @ {price:.2f} "
                f"(need {cost:.2f}, have {self.cash:.2f})"
            )
        self.cash -= cost
        if symbol in self.positions:
            pos = self.positions[symbol]
            total_qty = pos.quantity + quantity
            pos.avg_price = (pos.cost_basis + quantity * price) / total_qty
            pos.quantity = total_qty
        else:
            self.positions[symbol] = Position(symbol, quantity, price)
        self.trades.append(Trade(symbol, "buy", quantity, price, timestamp))

    def sell(self, symbol: str, quantity: int, price: float, *, commission: float = 0.0,
             timestamp: object = None) -> None:
        if quantity <= 0 or symbol not in self.positions:
            return
        pos = self.positions[symbol]
        quantity = min(quantity, pos.quantity)
        proceeds = quantity * price - commission
        realized = (price - pos.avg_price) * quantity - commission
        self.cash += proceeds
        pos.quantity -= quantity
        if pos.quantity == 0:
            del self.positions[symbol]
        self.trades.append(Trade(symbol, "sell", quantity, price, timestamp, pnl=realized))

    def equity(self, prices: dict[str, float]) -> float:
        """Total mark-to-market value: cash + market value of open positions."""
        holdings = sum(
            pos.market_value(prices.get(sym, pos.avg_price))
            for sym, pos in self.positions.items()
        )
        return self.cash + holdings
