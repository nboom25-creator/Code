"""Tests that operator config drives the agent's rules (caps + discovery)."""

import pandas as pd

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.guardrails import build_guardrails
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker
from trading_bot.agent.research import ResearchBundle, SimResearch
from trading_bot.agent.runner import AgentRunner, DayState
from trading_bot.agent.tools import AgentTools
from trading_bot.config import AgentRiskConfig, Config, DiscoveryConfig


def _bundle():
    sim = SimResearch()
    return ResearchBundle(fundamentals_client=sim, sec_client=sim,
                          web_client=sim, screener_client=sim, capabilities=["sim"])


class _UpData:
    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        close = pd.Series([100 + i for i in range(30)], index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": 1_000_000})

    def get_news(self, symbol, *, limit=10):
        return [{"headline": f"{symbol} up", "summary": "x"} for _ in range(4)]


def test_build_guardrails_from_config():
    cfg = AgentRiskConfig(max_position_pct=0.08, daily_drawdown_limit_pct=0.03,
                          stop_loss_pct=0.05, take_profit_pct=0.10)
    g = build_guardrails(cfg)
    assert g.max_position_pct == 0.08
    assert g.daily_drawdown_limit_pct == 0.03
    # 8% cap honored by the sizer at full conviction + calm stock.
    assert g.target_notional(equity=100_000, confidence=1.0, atr_pct=0.01) == 8_000


def test_runner_uses_config_agent_risk():
    cfg = Config(symbols=["AAA"], agent_risk=AgentRiskConfig(max_position_pct=0.08,
                                                             daily_drawdown_limit_pct=0.03))
    runner = AgentRunner(config=cfg, llm=HeuristicLLM(),
                         tools=AgentTools(SimPaperBroker(), _UpData()),
                         broker=SimPaperBroker(), dry_run=True)
    assert runner.guardrails.max_position_pct == 0.08
    assert runner.guardrails.daily_drawdown_limit_pct == 0.03


def test_discovery_expands_entry_universe(tmp_path):
    broker = SimPaperBroker(equity=1_000_000, cash=1_000_000)
    cfg = Config(symbols=["AAPL"], benchmark="SPY",
                 discovery=DiscoveryConfig(enabled=True, sectors=["technology"],
                                           max_candidates=3))
    runner = AgentRunner(
        config=cfg, llm=HeuristicLLM(),
        tools=AgentTools(broker, _UpData(), research=_bundle()),
        broker=broker, audit=AuditLog(log_dir=tmp_path),
        day_state=DayState(tmp_path / ".s.json"), watchlist=["AAPL"], dry_run=True)
    universe = runner._entry_universe()
    assert "AAPL" in universe                       # the watchlist name
    assert any(t.startswith("TEC") for t in universe)  # sim-discovered small-caps


def test_discovery_off_by_default():
    cfg = Config(symbols=["AAPL"])
    runner = AgentRunner(config=cfg, llm=HeuristicLLM(),
                         tools=AgentTools(SimPaperBroker(), _UpData(), research=_bundle()),
                         broker=SimPaperBroker(), watchlist=["AAPL"], dry_run=True)
    assert runner._entry_universe() == ["AAPL"]     # discovery disabled -> just the watchlist
