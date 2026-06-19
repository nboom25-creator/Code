"""Portfolio-level risk caps.

The per-trade guardrails look at one trade at a time. This looks at the *whole
account* so the bot doesn't quietly turn ten small trades into one big bet:

* **Cash buffer** — stay at most ``max_invested_pct`` invested (keep some cash).
* **Sector cap** — at most ``max_sector_pct`` of the account in any one sector.
* **Max positions** — hold at most ``max_positions`` names at once.

It reports the dollar "headroom" still available for a new buy; the per-trade
guardrail then takes the smaller of that and its own caps. If a sector is
unknown (no research configured), the sector cap is simply not applied.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Holding:
    symbol: str
    market_value: float
    sector: str = ""


@dataclass
class PortfolioRisk:
    equity: float
    holdings: list[Holding] = field(default_factory=list)
    max_invested_pct: float = 0.90   # keep >=10% cash
    max_sector_pct: float = 0.30     # <=30% in any one sector
    max_positions: int = 10
    use_sector: bool = True          # disabled when sectors are unknown

    # ------------------------------------------------------------------ #
    def invested_value(self) -> float:
        return sum(h.market_value for h in self.holdings)

    def sector_value(self, sector: str) -> float:
        return sum(h.market_value for h in self.holdings if h.sector == sector)

    def symbols(self) -> set[str]:
        return {h.symbol for h in self.holdings}

    def position_count(self) -> int:
        return len(self.symbols())

    def can_open_new(self, ticker: str) -> bool:
        """A new *name* is allowed only if we're under the position-count cap;
        adding to a name we already hold is always allowed by this check."""
        return ticker in self.symbols() or self.position_count() < self.max_positions

    def headroom(self, sector: str) -> float:
        """Max additional dollars allowed for a buy in ``sector`` right now."""
        total_room = max(0.0, self.equity * self.max_invested_pct - self.invested_value())
        if self.use_sector and sector:
            sector_room = max(0.0, self.equity * self.max_sector_pct
                              - self.sector_value(sector))
            return min(total_room, sector_room)
        return total_room

    def explain(self, sector: str) -> str:
        inv = self.invested_value()
        parts = [
            f"invested {inv / self.equity:.0%} (cap {self.max_invested_pct:.0%})",
            f"{self.position_count()}/{self.max_positions} positions",
        ]
        if self.use_sector and sector:
            parts.append(f"{sector} at {self.sector_value(sector) / self.equity:.0%} "
                         f"(cap {self.max_sector_pct:.0%})")
        return ", ".join(parts)

    def add(self, symbol: str, notional: float, sector: str = "") -> None:
        """Reflect a (proposed or executed) buy so the next candidate in the same
        run sees the reduced headroom."""
        for h in self.holdings:
            if h.symbol == symbol:
                h.market_value += notional
                return
        self.holdings.append(Holding(symbol, notional, sector))
