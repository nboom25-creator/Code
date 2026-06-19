"""Performance metrics and attribution over the trade ledger.

Turns a list of closed trades into the numbers that tell you whether there's any
edge: win rate, expectancy, profit factor, average win/loss, and a realized-P&L
drawdown — overall and broken down by group (cap profile, confidence bucket).

Honest by construction: these are *realized* metrics from matched round-trips,
not mark-to-market. They answer "of the trades that closed, how did they do?"
"""

from __future__ import annotations

import math

from .ledger import ClosedTrade, TradeLedger


def summarize(trades: list[ClosedTrade]) -> dict:
    if not trades:
        return {"trades": 0, "total_pnl": 0.0, "win_rate": 0.0, "expectancy": 0.0,
                "profit_factor": 0.0, "avg_win": 0.0, "avg_loss": 0.0,
                "avg_pnl_pct": 0.0, "max_drawdown": 0.0, "best": 0.0, "worst": 0.0}
    wins = [t.pnl for t in trades if t.pnl > 0]
    losses = [t.pnl for t in trades if t.pnl < 0]
    total = sum(t.pnl for t in trades)
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else math.inf

    # Drawdown on the cumulative realized-P&L curve.
    cum = 0.0
    peak = 0.0
    max_dd = 0.0
    for t in trades:
        cum += t.pnl
        peak = max(peak, cum)
        max_dd = min(max_dd, cum - peak)

    return {
        "trades": len(trades),
        "total_pnl": round(total, 2),
        "win_rate": round(len(wins) / len(trades), 4),
        "expectancy": round(total / len(trades), 2),  # avg P&L per trade
        "profit_factor": (round(profit_factor, 2) if profit_factor != math.inf else None),
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
        "avg_pnl_pct": round(sum(t.pnl_pct for t in trades) / len(trades), 2),
        "max_drawdown": round(max_dd, 2),
        "best": round(max(t.pnl for t in trades), 2),
        "worst": round(min(t.pnl for t in trades), 2),
    }


def grouped(trades: list[ClosedTrade], key) -> dict[str, dict]:
    buckets: dict[str, list[ClosedTrade]] = {}
    for t in trades:
        buckets.setdefault(key(t), []).append(t)
    return {k: summarize(v) for k, v in sorted(buckets.items())}


def _confidence_bucket(t: ClosedTrade) -> str:
    c = t.entry_confidence
    if c >= 0.7:
        return "high (≥0.7)"
    if c >= 0.5:
        return "med (0.5–0.7)"
    return "low (<0.5)"


def format_report(ledger: TradeLedger, *, mode: str | None = None) -> str:
    trades = ledger.closed_trades(mode=mode)
    overall = summarize(trades)
    lines = ["Agent performance" + (f" [mode={mode}]" if mode else ""), ""]
    if overall["trades"] == 0:
        lines.append("No closed trades yet. Run the agent over multiple sessions so "
                     "positions open and close, then check back.")
        open_lots = ledger.open_lots(mode=mode)
        if open_lots:
            lines.append("")
            lines.append("Open positions (unmatched): "
                         + ", ".join(f"{k} x{v}" for k, v in open_lots.items()))
        return "\n".join(lines)

    def block(title: str, m: dict) -> list[str]:
        pf = m["profit_factor"]
        return [
            title,
            f"  Trades:        {m['trades']}",
            f"  Total P&L:     ${m['total_pnl']:,.2f}",
            f"  Win rate:      {m['win_rate']:.1%}",
            f"  Expectancy:    ${m['expectancy']:,.2f} / trade",
            f"  Profit factor: {'∞' if pf is None else f'{pf:.2f}'}",
            f"  Avg win/loss:  ${m['avg_win']:,.2f} / ${m['avg_loss']:,.2f}",
            f"  Avg return:    {m['avg_pnl_pct']:+.2f}%",
            f"  Max drawdown:  ${m['max_drawdown']:,.2f}",
            f"  Best / worst:  ${m['best']:,.2f} / ${m['worst']:,.2f}",
        ]

    lines += block("Overall", overall)
    by_profile = grouped(trades, lambda t: t.profile or "unknown")
    if len(by_profile) > 1:
        lines.append("\nBy cap profile:")
        for name, m in by_profile.items():
            lines.append(f"  {name}: {m['trades']} trades, "
                         f"${m['total_pnl']:,.2f} P&L, {m['win_rate']:.0%} win")
    by_conf = grouped(trades, _confidence_bucket)
    if len(by_conf) > 1:
        lines.append("\nBy stated confidence (does conviction predict outcomes?):")
        for name, m in by_conf.items():
            lines.append(f"  {name}: {m['trades']} trades, "
                         f"${m['total_pnl']:,.2f} P&L, {m['win_rate']:.0%} win")
    return "\n".join(lines)
