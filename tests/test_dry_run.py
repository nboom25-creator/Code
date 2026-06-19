"""Tests for the dry-run MVP: sentiment scorer, heuristic analyst, sim broker,
and the execute-order interception.

All offline — no network, no API key.
"""

import json
import re
from types import SimpleNamespace

import pandas as pd

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker
from trading_bot.agent.sentiment import aggregate, score_text, tag_news
from trading_bot.agent.tools import AgentTools


# --------------------------------------------------------------------------- #
# Sentiment scorer
# --------------------------------------------------------------------------- #
def test_score_text_positive_negative_neutral():
    assert score_text("Company beats earnings, shares surge")[0] == "positive"
    assert score_text("Stock plunges on fraud probe")[0] == "negative"
    assert score_text("Company holds annual meeting")[0] == "neutral"
    assert score_text("")[0] == "neutral"


def test_tag_and_aggregate():
    items = [
        {"headline": "X surges on record profit", "summary": ""},
        {"headline": "X plunges on lawsuit", "summary": ""},
        {"headline": "X to host conference", "summary": ""},
    ]
    tagged = tag_news(items)
    assert [t["sentiment"] for t in tagged] == ["positive", "negative", "neutral"]
    agg = aggregate(tagged)
    assert agg["count"] == 3 and agg["positive"] == 1 and agg["negative"] == 1


# --------------------------------------------------------------------------- #
# Sim broker
# --------------------------------------------------------------------------- #
def test_sim_paper_broker_account_and_orders():
    b = SimPaperBroker(equity=50_000, cash=50_000)
    acct = b.get_account()
    assert acct.equity == 50_000 and acct.buying_power == 100_000
    b.submit_market_order("AAPL", 5, "buy")
    assert b.orders == [("AAPL", 5, "buy")]


# --------------------------------------------------------------------------- #
# Heuristic analyst — grounded in real numbers
# --------------------------------------------------------------------------- #
class _UpData:
    """Strong uptrend + positive news."""

    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        close = pd.Series([100 + i for i in range(30)], index=idx, dtype=float)
        return pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                             "close": close, "volume": 1_000_000})

    def get_news(self, symbol, *, limit=10):
        return [{"headline": f"{symbol} beats and surges to record", "summary": "growth"}]


def test_heuristic_llm_buys_on_uptrend_and_positive_news():
    tools = AgentTools(SimPaperBroker(), _UpData())
    llm = HeuristicLLM()
    summary, calls = llm.run_tool_loop(
        system="m", instruction="Begin the Perception phase for AAPL.",
        tools=tools, schemas=[])
    assert "AAPL" in summary
    from trading_bot.agent.schemas import TradeDecision
    decision = llm.parse(system="m", prompt="", schema=TradeDecision)
    assert decision.action == "BUY"
    assert decision.target_notional_usd > 0


# --------------------------------------------------------------------------- #
# Dry-run interception — the crucial requirement
# --------------------------------------------------------------------------- #
def test_dry_run_intercepts_execution_but_logs_reasoning(tmp_path):
    broker = SimPaperBroker(equity=100_000, cash=100_000)
    data = _UpData()
    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(broker, data),
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=True,
    )
    result = loop.run_for_ticker("AAPL", equity=100_000)

    # Decision proposed BUY, but NO order was sent to the broker.
    assert result.final_action == "BUY"
    assert not result.executed
    assert broker.orders == []  # <-- interception proven

    # The audit log still captured the proposed trade AND the bull/bear reasoning.
    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "DRY RUN" in md
    assert "would have placed BUY" in md
    assert "Bull case" in md and "Bear case" in md
    assert "Decision (proposed)" in md


def test_live_mode_would_execute(tmp_path):
    """Sanity check that non-dry-run does place the order (so the dry-run flag is
    what's doing the interception, not a broken path)."""
    broker = SimPaperBroker(equity=100_000, cash=100_000)
    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(broker, _UpData()),
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=False,
    )
    result = loop.run_for_ticker("AAPL", equity=100_000)
    assert result.executed
    assert broker.orders and broker.orders[0][2] == "buy"


# --------------------------------------------------------------------------- #
# Bracket orders — protective stop + take-profit attached at entry
# --------------------------------------------------------------------------- #
def test_guardrails_bracket_prices():
    g = Guardrails(stop_loss_pct=0.05, take_profit_pct=0.10)
    stop, take = g.bracket_prices(100.0)
    assert stop == 95.0 and take == 110.0
    # Take-profit can be disabled.
    g2 = Guardrails(stop_loss_pct=0.04, take_profit_pct=0.0)
    stop2, take2 = g2.bracket_prices(200.0)
    assert stop2 == 192.0 and take2 is None


def test_agent_buy_executes_as_bracket_order(tmp_path):
    broker = SimPaperBroker(equity=100_000, cash=100_000)
    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(broker, _UpData()),
        guardrails=Guardrails(stop_loss_pct=0.05, take_profit_pct=0.10),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=False,
    )
    result = loop.run_for_ticker("AAPL", equity=100_000)
    assert result.executed and result.final_action == "BUY"
    # A bracket order was placed with a stop below and a take-profit above entry.
    assert len(broker.bracket_orders) == 1
    bracket = broker.bracket_orders[0]
    entry = 100 + 29  # _UpData close at bar 30 (100 + i)
    assert bracket["stop_loss_price"] < entry < bracket["take_profit_price"]


def test_dry_run_logs_bracket_levels(tmp_path):
    broker = SimPaperBroker(equity=100_000, cash=100_000)
    loop = CognitiveLoop(
        llm=HeuristicLLM(),
        tools=AgentTools(broker, _UpData()),
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
        dry_run=True,
    )
    loop.run_for_ticker("AAPL", equity=100_000)
    assert broker.bracket_orders == []  # still intercepted
    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "stop $" in md and "take-profit $" in md


def test_execute_order_sell_does_not_bracket():
    broker = SimPaperBroker()
    tools = AgentTools(broker, _UpData())
    tools.execute_order("AAPL", 5, "sell", "market")
    assert broker.orders == [("AAPL", 5, "sell")]
    assert broker.bracket_orders == []
