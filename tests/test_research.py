"""Tests for the small/micro-cap research layer: screener, deep-research tools,
the sparse-news fallback, cap classification, and asymmetric weighting.

All offline via the Sim research providers — no network, no API key.
"""

import json

import pandas as pd

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker
from trading_bot.agent.research import SimResearch, build_research_bundle
from trading_bot.agent.tools import AgentTools


# --------------------------------------------------------------------------- #
# Data fakes
# --------------------------------------------------------------------------- #
class _NoNewsData:
    """Flat-ish price, a volume spike on the last bar, and NO news at all."""

    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        close = pd.Series([100 + 0.05 * i for i in range(30)], index=idx, dtype=float)
        vol = [1_000_000] * 29 + [3_000_000]  # last-bar volume spike
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": vol})

    def get_news(self, symbol, *, limit=10):
        return []  # sparse coverage — the small-cap reality


# --------------------------------------------------------------------------- #
# Screener / bundle
# --------------------------------------------------------------------------- #
def test_build_research_bundle_sim_has_all_capabilities():
    bundle = build_research_bundle(sim=True)
    assert bundle.discover_small_caps("technology", 2e9, 1e5)
    assert bundle.get_fundamentals("ABCD") is not None
    assert bundle.get_sec_filings("ABCD")
    assert bundle.get_insider_activity("ABCD")
    assert bundle.web_research("ABCD stock analysis")


def test_discover_small_caps_tool():
    tools = AgentTools(SimPaperBroker(), _NoNewsData(), research=SimResearch_bundle())
    out = json.loads(tools.discover_small_caps("healthcare", 2e9, 1e5))
    assert out["count"] >= 1
    assert all(c["market_cap"] <= 2e9 for c in out["candidates"])


def test_deep_research_tools_dispatch():
    tools = AgentTools(SimPaperBroker(), _NoNewsData(), research=SimResearch_bundle())
    f = json.loads(tools.dispatch("get_fundamentals", {"ticker": "ABCD"}).output)
    assert f["fundamentals"]["debt_to_equity"] is not None
    filings = json.loads(tools.dispatch("get_sec_filings", {"ticker": "ABCD"}).output)
    assert filings["count"] >= 1
    web = json.loads(tools.dispatch("web_research", {"ticker": "ABCD"}).output)
    assert "stock analysis" in web["query"]


def test_tools_without_research_error_cleanly():
    tools = AgentTools(SimPaperBroker(), _NoNewsData(), research=None)
    call = tools.dispatch("get_fundamentals", {"ticker": "ABCD"})
    assert call.is_error and "no research provider" in call.output


def SimResearch_bundle():
    sim = SimResearch()
    from trading_bot.agent.research import ResearchBundle
    return ResearchBundle(fundamentals_client=sim, sec_client=sim,
                          web_client=sim, screener_client=sim,
                          capabilities=["sim"])


# --------------------------------------------------------------------------- #
# Fallback + classification + asymmetric weighting (end to end)
# --------------------------------------------------------------------------- #
def _small_cap_loop(tmp_path, dry_run=True):
    return CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(SimPaperBroker(equity=100_000, cash=100_000),
                         _NoNewsData(), research=SimResearch_bundle()),
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=dry_run,
    )


def test_sparse_news_triggers_deep_research_fallback(tmp_path):
    loop = _small_cap_loop(tmp_path)
    result = loop.run_for_ticker("ABCD", equity=100_000)

    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    # The deep-research tiers fired and were logged.
    assert "deep-research fallback" in md
    assert "get_sec_filings" in md
    assert "get_insider_activity" in md
    assert "web_research" in md
    # Classified as small-cap (sim market cap $420M < $2B).
    assert "small-cap" in md
    # It did NOT degrade to HOLD just because news was empty.
    assert not result.degraded


def test_small_cap_buys_on_fundamentals_with_empty_news(tmp_path):
    # Sim fundamentals are healthy (D/E 0.6, growth +18%) + a volume spike, and
    # there is zero news. The asymmetric logic should still reach a BUY.
    loop = _small_cap_loop(tmp_path)
    result = loop.run_for_ticker("ABCD", equity=100_000)
    assert result.final_action == "BUY"


class _ThinData:
    """Uptrend but very low average daily volume (illiquid micro-cap)."""

    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        close = pd.Series([100 + i for i in range(30)], index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": 2_000})  # ~2k ADV

    def get_news(self, symbol, *, limit=10):
        return []


def test_liquidity_cap_binds_end_to_end(tmp_path):
    # Large account so the 5% equity cap is loose; ADV ~2k -> 1% = 20 shares binds.
    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(SimPaperBroker(equity=5_000_000, cash=5_000_000),
                         _ThinData(), research=SimResearch_bundle()),
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=True,
    )
    result = loop.run_for_ticker("THIN", equity=5_000_000)
    assert result.final_action == "BUY"
    assert result.quantity == 20  # 1% of ~2,000 ADV, far below the equity cap
    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "Liquidity cap" in md


def test_large_cap_path_unaffected(tmp_path):
    """A name with dense news + no research bundle stays on the large-cap path."""
    class _DenseNews:
        def get_bars(self, symbol, *, timeframe="1Day", limit=30):
            idx = pd.date_range("2024-01-01", periods=30, freq="B")
            close = pd.Series([100 + i for i in range(30)], index=idx, dtype=float)
            return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                                 "close": close, "volume": 1_000_000})

        def get_news(self, symbol, *, limit=10):
            return [{"headline": f"{symbol} beats and surges", "summary": "growth"}
                    for _ in range(4)]

    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(SimPaperBroker(), _DenseNews(), research=SimResearch_bundle()),
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=True,
    )
    loop.run_for_ticker("AAPL", equity=100_000)
    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    # Dense news (4 items >= 3) means no deep-research fallback was triggered.
    assert "deep-research fallback" not in md
