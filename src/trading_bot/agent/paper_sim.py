"""In-memory simulated paper broker.

A zero-credential stand-in for Alpaca that satisfies the ``BrokerPort`` interface
(``get_account`` / ``get_positions`` / ``submit_market_order`` / ``close_position``).
Used by the dry-run when no Alpaca keys are present, so the full research loop —
perception, reasoning, decision, guardrails, audit — runs end to end offline.

It is intentionally simple: a fixed starting equity and an order ledger. Because
the dry-run intercepts execution, orders are typically never even submitted here;
this exists so ``get_portfolio_state`` returns something coherent.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import SimpleNamespace


@dataclass
class _SimPosition:
    symbol: str
    quantity: float
    avg_price: float
    market_value: float


@dataclass
class SimPaperBroker:
    """A minimal simulated broker. Not for real money — research/dry-run only."""

    equity: float = 100_000.0
    cash: float = 100_000.0
    positions: dict[str, _SimPosition] = field(default_factory=dict)
    orders: list[tuple] = field(default_factory=list)

    def get_account(self):
        return SimpleNamespace(
            equity=self.equity, cash=self.cash, buying_power=self.cash * 2
        )

    def get_positions(self):
        return list(self.positions.values())

    def submit_market_order(self, symbol: str, quantity: int, side: str):
        self.orders.append((symbol, quantity, side))
        return SimpleNamespace(id=f"sim-{len(self.orders)}", symbol=symbol,
                               qty=quantity, side=side)

    def close_position(self, symbol: str):
        self.orders.append((symbol, 0, "close"))
        self.positions.pop(symbol, None)
        return SimpleNamespace(id=f"sim-close-{symbol}")

    def is_market_open(self) -> bool:  # convenience for parity with AlpacaBroker
        return True
