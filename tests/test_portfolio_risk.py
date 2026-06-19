"""Tests for the account-wide portfolio risk caps."""

import pandas as pd

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker
from trading_bot.agent.portfolio_risk import Holding, PortfolioRisk
from trading_bot.agent.research import ResearchBundle, SimResearch
from trading_bot.agent.runner import AgentRunner, DayState
from trading_bot.agent.tools import AgentTools
from trading_bot.config import Config, PortfolioConfig


def _bundle():
    sim = SimResearch()
    return ResearchBundle(fundamentals_client=sim, sec_client=sim,
                          web_client=sim, screener_client=sim, capabilities=["sim"])


# --------------------------------------------------------------------------- #
# The checker's math
# --------------------------------------------------------------------------- #
def test_total_invested_headroom():
    pr = PortfolioRisk(equity=100_000,
                       holdings=[Holding("A", 80_000, "Tech")],
                       max_invested_pct=0.90, max_sector_pct=1.0)
    # 90k cap, 80k used -> 10k of total headroom left.
    assert pr.headroom("Other") == 10_000


def test_sector_headroom_is_tighter():
    pr = PortfolioRisk(equity=100_000,
                       holdings=[Holding("A", 25_000, "Tech")],
                       max_invested_pct=0.90, max_sector_pct=0.30)
    # Tech: 30k cap - 25k used = 5k. Total room is 65k. min -> 5k.
    assert pr.headroom("Tech") == 5_000
    # A fresh sector still can't exceed the 30% per-sector cap = 30k
    # (total room 65k is looser here, so the sector cap binds).
    assert pr.headroom("Energy") == 30_000


def test_max_positions_and_sector_disabled():
    pr = PortfolioRisk(equity=100_000,
                       holdings=[Holding("A", 1, "Tech"), Holding("B", 1, "Tech")],
                       max_positions=2)
    assert not pr.can_open_new("C")     # at the 2-name cap
    assert pr.can_open_new("A")          # adding to an existing name is fine
    pr.use_sector = False
    assert pr.headroom("Tech") == pr.headroom("Energy")  # sector cap ignored


# --------------------------------------------------------------------------- #
# Guardrail honours the portfolio headroom
# --------------------------------------------------------------------------- #
def test_guardrail_uses_portfolio_headroom():
    g = Guardrails()
    # 5% cap = $5,000, but portfolio only allows $1,200 more -> use $1,200.
    v = g.validate_decision(action="BUY", ticker="X", target_notional_usd=5_000,
                            equity=100_000, price=10, current_position_qty=0,
                            portfolio_cap=1_200)
    assert v.approved and v.quantity == 120  # $1,200 / $10
    assert any("Portfolio headroom" in n for n in v.notes)


def test_guardrail_blocks_when_no_headroom():
    g = Guardrails()
    v = g.validate_decision(action="BUY", ticker="X", target_notional_usd=5_000,
                            equity=100_000, price=10, current_position_qty=0,
                            portfolio_cap=0)
    assert not v.approved and any("Portfolio cap reached" in n for n in v.notes)


# --------------------------------------------------------------------------- #
# Runner stops opening new names at the position cap
# --------------------------------------------------------------------------- #
class _UpData:
    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        close = pd.Series([100 + i for i in range(30)], index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": 1_000_000})

    def get_news(self, symbol, *, limit=10):
        return [{"headline": f"{symbol} beats and surges", "summary": "growth"}
                for _ in range(4)]


def test_runner_stops_new_names_at_position_cap(tmp_path):
    broker = SimPaperBroker(equity=1_000_000, cash=1_000_000)
    runner = AgentRunner(
        config=Config(symbols=["AAA", "BBB"], benchmark="SPY",
                      portfolio=PortfolioConfig(max_positions=1, max_sector_pct=1.0)),
        llm=HeuristicLLM(),
        tools=AgentTools(broker, _UpData(), research=_bundle()),
        broker=broker,
        audit=AuditLog(log_dir=tmp_path),
        day_state=DayState(tmp_path / ".day_state.json"),
        watchlist=["AAA", "BBB"],
        dry_run=True,
    )
    result = runner.run_day()
    # Only the first name got a cycle; the second was skipped at the cap.
    assert len(result["results"]) == 1
    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "max positions (1) reached" in md
