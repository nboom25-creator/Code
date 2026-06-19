"""Tests for the trade ledger, performance attribution, and the review phase."""

import pandas as pd

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.ledger import Fill, TradeLedger
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker, _SimPosition
from trading_bot.agent.performance import summarize
from trading_bot.agent.research import ResearchBundle, SimResearch
from trading_bot.agent.tools import AgentTools


def _bundle():
    sim = SimResearch()
    return ResearchBundle(fundamentals_client=sim, sec_client=sim,
                          web_client=sim, screener_client=sim, capabilities=["sim"])


# --------------------------------------------------------------------------- #
# Ledger FIFO matching
# --------------------------------------------------------------------------- #
def test_ledger_fifo_closed_trades(tmp_path):
    led = TradeLedger(tmp_path / "ledger.jsonl")
    led.record(Fill("AAA", "buy", 10, 100.0, profile="small-cap", confidence=0.8,
                     timestamp="2026-01-01T10:00:00"))
    led.record(Fill("AAA", "buy", 10, 110.0, profile="small-cap", confidence=0.6,
                     timestamp="2026-01-02T10:00:00"))
    led.record(Fill("AAA", "sell", 15, 130.0, timestamp="2026-01-03T10:00:00"))

    closed = led.closed_trades()
    # 10 @100 fully closed, 5 of the 10 @110 closed.
    assert len(closed) == 2
    assert closed[0].qty == 10 and closed[0].pnl == 300.0   # (130-100)*10
    assert closed[1].qty == 5 and closed[1].pnl == 100.0    # (130-110)*5
    assert closed[0].entry_confidence == 0.8                # FIFO carries lot metadata
    assert led.open_lots() == {"AAA": 5}                    # 5 of the second lot remain


def test_ledger_filters_by_mode(tmp_path):
    led = TradeLedger(tmp_path / "ledger.jsonl")
    led.record(Fill("AAA", "buy", 1, 100.0, mode="live", timestamp="2026-01-01T10:00:00"))
    led.record(Fill("BBB", "buy", 1, 100.0, mode="dry_run", timestamp="2026-01-01T11:00:00"))
    assert {f.ticker for f in led.fills(mode="live")} == {"AAA"}


def test_performance_summary():
    from trading_bot.agent.ledger import ClosedTrade

    trades = [
        ClosedTrade("A", 1, 100, 130, "t1", "t2", 30.0, 30.0, "small-cap", 0.8, "dry_run"),
        ClosedTrade("B", 1, 100, 90, "t1", "t2", -10.0, -10.0, "large-cap", 0.4, "dry_run"),
        ClosedTrade("C", 1, 100, 120, "t1", "t2", 20.0, 20.0, "small-cap", 0.7, "dry_run"),
    ]
    m = summarize(trades)
    assert m["trades"] == 3
    assert m["total_pnl"] == 40.0
    assert round(m["win_rate"], 2) == 0.67
    assert m["profit_factor"] == 5.0  # 50 / 10
    assert m["worst"] == -10.0


# --------------------------------------------------------------------------- #
# Review phase — manage open positions
# --------------------------------------------------------------------------- #
class _DownData:
    """Falling price + a held position underwater → should EXIT."""

    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        close = pd.Series([200 - i * 3 for i in range(30)], index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": 1_000_000})

    def get_news(self, symbol, *, limit=10):
        return [{"headline": f"{symbol} falls on weak guidance", "summary": "miss"}]


def _review_loop(tmp_path, broker, data, ledger=None):
    return CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(broker, data, research=_bundle()),
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=True,
        ledger=ledger,
    )


def test_review_exits_losing_position(tmp_path):
    # Held 50 @ $250; price now far lower and falling → EXIT.
    broker = SimPaperBroker(equity=100_000, cash=50_000)
    broker.positions["LOSS"] = _SimPosition("LOSS", 50, 250.0, 50 * 130)
    ledger = TradeLedger(tmp_path / "ledger.jsonl")
    loop = _review_loop(tmp_path, broker, _DownData(), ledger=ledger)

    result = loop.review_position("LOSS", equity=100_000)
    assert result.final_action == "EXIT"
    assert result.quantity == 50  # full position
    # The (dry-run) exit fill was recorded to the ledger.
    fills = ledger.fills()
    assert any(f.ticker == "LOSS" and f.side == "sell" and f.qty == 50 for f in fills)
    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "POSITION REVIEW" in md and "EXIT" in md


def test_review_holds_when_no_position(tmp_path):
    broker = SimPaperBroker(equity=100_000, cash=100_000)  # no positions
    loop = _review_loop(tmp_path, broker, _DownData())
    result = loop.review_position("NONE", equity=100_000)
    assert result.final_action == "HOLD" and not result.executed
