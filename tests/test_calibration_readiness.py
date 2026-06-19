"""Confidence calibration + go-live readiness gate."""

from trading_bot.agent.ledger import ClosedTrade, Fill, TradeLedger
from trading_bot.agent.performance import (
    calibration,
    readiness,
    threshold_split,
)


def _ct(conf, pnl):
    return ClosedTrade(ticker="X", qty=1, entry_price=100.0,
                       exit_price=100.0 + pnl, entry_time="t0", exit_time="t1",
                       pnl=pnl, pnl_pct=pnl, profile="large-cap",
                       entry_confidence=conf, mode="paper")


def test_calibration_flags_overconfidence():
    # 90%-confidence trades that actually lose most of the time.
    trades = [_ct(0.9, -1) for _ in range(8)] + [_ct(0.9, +1) for _ in range(2)]
    rows = calibration(trades)
    row = next(r for r in rows if r["bucket"] == "90%-100%")
    assert row["n"] == 10
    assert row["actual"] == 0.2          # only 2/10 won
    assert row["gap"] < 0                # actual << predicted -> overconfident


def test_threshold_split_compares_above_and_below():
    trades = [_ct(0.8, +5), _ct(0.8, +5), _ct(0.6, -5), _ct(0.6, +1)]
    split = threshold_split(trades, 0.75)
    assert split["at_or_above"]["win_rate"] == 1.0   # both >=0.75 won
    assert split["below"]["win_rate"] == 0.5


def _round_trip(led, ticker, entry, exit_, conf, i, mode="paper"):
    led.record(Fill(ticker, "buy", 1, entry, mode=mode, confidence=conf,
                    timestamp=f"2024-01-{i:02d}T09:00:00"))
    led.record(Fill(ticker, "sell", 1, exit_, mode=mode,
                    timestamp=f"2024-01-{i:02d}T15:00:00"))


def test_readiness_not_ready_with_few_trades(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    _round_trip(led, "AAA", 100, 110, 0.8, 1)  # one good trade, but far too few
    r = readiness(led, mode="paper")           # default min_trades=30
    assert r["ready"] is False
    assert any(name == "Sample size" and not ok for name, ok, _ in r["checks"])


def test_readiness_passes_with_solid_record(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    for i in range(1, 7):                       # 6 profitable, high-conviction trades
        _round_trip(led, f"S{i}", 100, 112, 0.85, i)
    r = readiness(led, mode="paper", min_trades=3, auto_execute_threshold=0.75)
    assert r["ready"] is True
    assert all(ok for _, ok, _ in r["checks"])


def test_readiness_empty_ledger_is_not_ready(tmp_path):
    led = TradeLedger(tmp_path / "l.jsonl")
    assert readiness(led, mode="paper")["ready"] is False
