"""Tests for the extra trading-rule filters: min price, min confidence, max buys."""

import datetime as dt

import pandas as pd

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker
from trading_bot.agent.research import ResearchBundle, SimResearch
from trading_bot.agent.runner import AgentRunner, DayState
from trading_bot.agent.schemas import TradeDecision
from trading_bot.agent.tools import AgentTools
from trading_bot.config import Config, DiscoveryConfig, TradingRulesConfig


def _bundle():
    sim = SimResearch()
    return ResearchBundle(fundamentals_client=sim, sec_client=sim,
                          web_client=sim, screener_client=sim, capabilities=["sim"])


class _UpData:
    def __init__(self, price_base=100):
        self.price_base = price_base

    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        # Gentle uptrend that stays near price_base (so a $1 base is a penny stock).
        close = pd.Series([self.price_base * (1 + 0.003 * i) for i in range(30)],
                          index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close * 1.01, "low": close * 0.99,
                             "close": close, "volume": 1_000_000})

    def get_news(self, symbol, *, limit=10):
        return [{"headline": f"{symbol} up", "summary": "x"} for _ in range(4)]


class _FixedLLM(HeuristicLLM):
    """Force a BUY at a chosen confidence, to test the rule filters directly."""

    def __init__(self, confidence):
        super().__init__()
        self._forced_conf = confidence

    def parse(self, *, system, prompt, schema):
        if schema is TradeDecision:
            return TradeDecision(action="BUY", ticker=self._ticker,
                                 target_notional_usd=8_000,
                                 confidence=self._forced_conf, rationale="forced")
        return super().parse(system=system, prompt=prompt, schema=schema)


def _loop(tmp_path, rules, llm=None, data=None):
    return CognitiveLoop(
        llm=llm or HeuristicLLM(),
        tools=AgentTools(SimPaperBroker(equity=100_000, cash=100_000),
                         data or _UpData(), research=_bundle()),
        guardrails=Guardrails(), audit=AuditLog(log_dir=tmp_path),
        system_prompt="M", dry_run=True, rules=rules)


def test_min_price_blocks_cheap_stock(tmp_path):
    # Stock trades ~ $2-3; a $5 floor should block the buy.
    loop = _loop(tmp_path, TradingRulesConfig(min_price=5.0),
                 llm=_FixedLLM(0.9), data=_UpData(price_base=1))
    result = loop.run_for_ticker("CHEAP", equity=100_000)
    assert result.final_action == "HOLD" and not result.executed
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "below the $5.00 minimum" in md


def test_min_confidence_blocks_weak_idea(tmp_path):
    loop = _loop(tmp_path, TradingRulesConfig(min_confidence=0.60),
                 llm=_FixedLLM(0.45))   # 45% < 60% floor
    result = loop.run_for_ticker("AAA", equity=100_000)
    assert result.final_action == "HOLD" and not result.executed
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "below the 60% minimum" in md


def test_confident_expensive_trade_passes(tmp_path):
    loop = _loop(tmp_path, TradingRulesConfig(min_price=5.0, min_confidence=0.60),
                 llm=_FixedLLM(0.85), data=_UpData(price_base=100))
    result = loop.run_for_ticker("AAA", equity=100_000)
    assert result.final_action == "BUY"   # $100 stock, 85% confidence -> allowed


def test_max_new_buys_per_run(tmp_path):
    broker = SimPaperBroker(equity=1_000_000, cash=1_000_000)
    cfg = Config(symbols=["AAA", "BBB", "CCC", "DDD", "EEE"], benchmark="SPY",
                 rules=TradingRulesConfig(max_new_buys_per_run=2),
                 discovery=DiscoveryConfig(enabled=False))
    runner = AgentRunner(
        config=cfg, llm=_FixedLLM(0.85),
        tools=AgentTools(broker, _UpData(), research=_bundle()),
        broker=broker, audit=AuditLog(log_dir=tmp_path),
        day_state=DayState(tmp_path / ".s.json"),
        watchlist=["AAA", "BBB", "CCC", "DDD", "EEE"], dry_run=True)
    result = runner.run_day()
    buys = [r for r in result["results"] if r.final_action == "BUY"]
    assert len(buys) == 2   # stopped after 2 new buys
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "Max new buys per run (2) reached" in md
