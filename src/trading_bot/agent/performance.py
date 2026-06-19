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


def calibration(trades: list[ClosedTrade]) -> list[dict]:
    """Per-confidence-bucket: predicted win rate (the bucket midpoint) vs the
    actual realized win rate. The gap tells you if the agent is over/under-confident.
    """
    edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]
    rows: list[dict] = []
    for lo, hi in zip(edges, edges[1:]):
        bt = [t for t in trades if lo <= t.entry_confidence < hi]
        if not bt:
            continue
        wins = sum(1 for t in bt if t.pnl > 0)
        actual = wins / len(bt)
        predicted = (lo + min(hi, 1.0)) / 2
        rows.append({
            "bucket": f"{lo:.0%}-{min(hi, 1.0):.0%}",
            "n": len(bt), "predicted": predicted, "actual": round(actual, 4),
            "gap": round(actual - predicted, 4),
            "pnl": round(sum(t.pnl for t in bt), 2),
        })
    return rows


def threshold_split(trades: list[ClosedTrade], threshold: float) -> dict:
    """Compare trades at/above the auto-execute confidence threshold vs below it."""
    at = [t for t in trades if t.entry_confidence >= threshold]
    below = [t for t in trades if t.entry_confidence < threshold]
    return {"threshold": threshold,
            "at_or_above": summarize(at), "below": summarize(below)}


def _calibration_block(trades: list[ClosedTrade]) -> list[str]:
    rows = calibration(trades)
    if not rows:
        return []
    out = ["", "Confidence calibration (predicted vs actual win rate):"]
    weighted_gap = sum(r["gap"] * r["n"] for r in rows) / sum(r["n"] for r in rows)
    for r in rows:
        flag = "" if abs(r["gap"]) < 0.1 else ("  ⚠ overconfident" if r["gap"] < 0
                                               else "  (underconfident)")
        out.append(f"  {r['bucket']}: predicted {r['predicted']:.0%}, "
                   f"actual {r['actual']:.0%} (n={r['n']}){flag}")
    verdict = ("well-calibrated" if abs(weighted_gap) < 0.1
               else ("OVERCONFIDENT — actual wins trail stated confidence"
                     if weighted_gap < 0 else "conservative — actual beats stated"))
    out.append(f"  → Overall: {verdict} (avg gap {weighted_gap:+.0%}).")
    return out


def readiness(ledger: TradeLedger, *, mode: str = "paper",
              min_trades: int = 30, min_profit_factor: float = 1.2,
              auto_execute_threshold: float = 0.75) -> dict:
    """Is the paper track record strong enough to risk real money? Returns a set
    of pass/fail checks and an overall verdict. Deliberately strict: the default
    answer is 'not yet'."""
    trades = ledger.closed_trades(mode=mode)
    m = summarize(trades)
    pf = m["profit_factor"]  # None means no losses yet (∞)
    split = threshold_split(trades, auto_execute_threshold)
    hi_wr = split["at_or_above"]["win_rate"]
    lo_wr = split["below"]["win_rate"]

    checks = [
        ("Sample size", m["trades"] >= min_trades,
         f"{m['trades']} closed trades (need ≥ {min_trades})"),
        ("Profitable", m["total_pnl"] > 0,
         f"total P&L ${m['total_pnl']:,.2f}"),
        ("Positive expectancy", m["expectancy"] > 0,
         f"${m['expectancy']:,.2f} per trade"),
        ("Profit factor", pf is None or pf >= min_profit_factor,
         f"{'∞' if pf is None else f'{pf:.2f}'} (need ≥ {min_profit_factor})"),
        ("Conviction has signal",
         m["trades"] >= min_trades and hi_wr >= lo_wr,
         f"win rate ≥{auto_execute_threshold:.0%}-conf {hi_wr:.0%} vs below {lo_wr:.0%}"),
    ]
    ready = all(ok for _, ok, _ in checks)
    return {"ready": ready, "checks": checks, "summary": m}


def format_readiness(ledger: TradeLedger, *, mode: str = "paper",
                     auto_execute_threshold: float = 0.75) -> str:
    r = readiness(ledger, mode=mode, auto_execute_threshold=auto_execute_threshold)
    head = "✅ READY for a live trial" if r["ready"] else "⛔ NOT READY for live trading"
    lines = [f"Go-live readiness [mode={mode}]: {head}", ""]
    for name, ok, detail in r["checks"]:
        lines.append(f"  [{'PASS' if ok else 'FAIL'}] {name}: {detail}")
    if not r["ready"]:
        lines += ["", "Keep running on paper until every check passes. A missed "
                  "opportunity costs nothing; risking real money on an unproven "
                  "edge can be unrecoverable."]
    return "\n".join(lines)


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
    lines += _calibration_block(trades)
    return "\n".join(lines)
