"""Broker-agnostic trailing stop: track each open position's high-water mark and
exit when price falls a configured fraction below that peak.

Why software-side (not a broker trailing-stop order): it works identically on
every venue (Alpaca, the Robinhood MCP, the sim broker), it's deterministic and
testable, and the peak survives restarts. The fixed broker-bracket stop still
guards intraday downside between runs; this ratchets up to protect *gains* as a
winner runs.
"""

from __future__ import annotations

import json
from pathlib import Path


class TrailingStopStore:
    def __init__(self, path: str | Path = "logs/.trailing_stops.json") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def _load(self) -> dict[str, float]:
        if not self.path.exists():
            return {}
        try:
            return {k: float(v) for k, v in json.loads(self.path.read_text()).items()}
        except (json.JSONDecodeError, ValueError, AttributeError):
            return {}

    def _save(self, data: dict[str, float]) -> None:
        self.path.write_text(json.dumps({k: round(v, 4) for k, v in data.items()}))

    def peak(self, ticker: str) -> float:
        return self._load().get(ticker, 0.0)

    def check(self, ticker: str, price: float, trail_pct: float
              ) -> tuple[bool, float, float]:
        """Update the high-water mark with ``price`` and test the trailing stop.

        Returns ``(breached, peak, stop_level)``. ``breached`` is True only when
        ``trail_pct > 0`` and price has fallen to/through ``peak * (1 - trail_pct)``.
        """
        data = self._load()
        peak = max(data.get(ticker, 0.0), price)
        data[ticker] = peak
        self._save(data)
        stop_level = peak * (1 - trail_pct)
        breached = trail_pct > 0 and price > 0 and price <= stop_level
        return breached, peak, stop_level

    def drop(self, ticker: str) -> None:
        data = self._load()
        if data.pop(ticker, None) is not None:
            self._save(data)

    def prune(self, held: set[str]) -> None:
        """Forget peaks for names no longer held (so a re-entry starts fresh)."""
        data = self._load()
        kept = {k: v for k, v in data.items() if k in held}
        if len(kept) != len(data):
            self._save(kept)
