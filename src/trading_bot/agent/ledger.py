"""Persistent trade ledger — the agent's memory of outcomes.

Every fill (entry or exit) the agent makes is appended here as one JSON line,
carrying the metadata needed for attribution: cap profile, the agent's stated
confidence, mode (live/paper/dry_run), and the protective levels. Closing fills
are matched against opening lots FIFO to produce realized P&L per closed trade.

This is what turns the bot into a *learning* system: you can finally ask "is the
small-cap engine adding value? does the agent's confidence predict outcomes?"
"""

from __future__ import annotations

import datetime as dt
import json
from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class Fill:
    ticker: str
    side: str  # "buy" / "sell"
    qty: int
    price: float
    mode: str = "dry_run"          # live / paper / dry_run
    profile: str = ""              # small-cap / large-cap
    confidence: float = 0.0
    rationale: str = ""
    timestamp: str = field(default_factory=lambda: dt.datetime.now().isoformat(timespec="seconds"))


@dataclass
class ClosedTrade:
    ticker: str
    qty: int
    entry_price: float
    exit_price: float
    entry_time: str
    exit_time: str
    pnl: float
    pnl_pct: float
    profile: str
    entry_confidence: float
    mode: str


class TradeLedger:
    def __init__(self, path: str | Path = "logs/ledger.jsonl") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ #
    def record(self, fill: Fill) -> None:
        with self.path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(asdict(fill)) + "\n")

    def fills(self, *, mode: str | None = None) -> list[Fill]:
        if not self.path.exists():
            return []
        out: list[Fill] = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            if mode and data.get("mode") != mode:
                continue
            out.append(Fill(**data))
        out.sort(key=lambda f: f.timestamp)
        return out

    # ------------------------------------------------------------------ #
    def closed_trades(self, *, mode: str | None = None) -> list[ClosedTrade]:
        """Match sells against prior buys FIFO, per ticker, to realize P&L."""
        lots: dict[str, deque] = defaultdict(deque)
        closed: list[ClosedTrade] = []
        for f in self.fills(mode=mode):
            if f.side == "buy":
                lots[f.ticker].append([f.qty, f.price, f.timestamp,
                                       f.profile, f.confidence, f.mode])
            elif f.side == "sell":
                remaining = f.qty
                while remaining > 0 and lots[f.ticker]:
                    lot = lots[f.ticker][0]
                    matched = min(remaining, lot[0])
                    entry_price = lot[1]
                    pnl = (f.price - entry_price) * matched
                    closed.append(ClosedTrade(
                        ticker=f.ticker, qty=matched, entry_price=entry_price,
                        exit_price=f.price, entry_time=lot[2], exit_time=f.timestamp,
                        pnl=round(pnl, 2),
                        pnl_pct=round((f.price / entry_price - 1) * 100, 2)
                        if entry_price else 0.0,
                        profile=lot[3], entry_confidence=lot[4], mode=lot[5],
                    ))
                    lot[0] -= matched
                    remaining -= matched
                    if lot[0] == 0:
                        lots[f.ticker].popleft()
        return closed

    def open_lots(self, *, mode: str | None = None) -> dict[str, int]:
        """Net open share count per ticker (buys not yet matched by sells)."""
        net: dict[str, int] = defaultdict(int)
        for f in self.fills(mode=mode):
            net[f.ticker] += f.qty if f.side == "buy" else -f.qty
        return {k: v for k, v in net.items() if v != 0}
