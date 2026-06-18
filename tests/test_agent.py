"""Offline tests for the autonomous agent layer.

A scripted LLM and in-memory broker/data fakes exercise the full Research-then-
Decide loop, the hard guardrails, the degraded-perception short circuit, and the
audit trail — all with no network and no API key.
"""

import re
from types import SimpleNamespace

import pandas as pd
import pytest

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.schemas import AdversarialCheck, ReasoningState, TradeDecision
from trading_bot.agent.tools import AgentTools


# --------------------------------------------------------------------------- #
# Fakes
# --------------------------------------------------------------------------- #
class FakeBroker:
    def __init__(self, equity=100_000.0, positions=None):
        self._equity = equity
        self._positions = positions or []
        self.orders = []

    def get_account(self):
        return SimpleNamespace(equity=self._equity, cash=self._equity,
                               buying_power=self._equity * 2)

    def get_positions(self):
        return self._positions

    def submit_market_order(self, symbol, quantity, side):
        self.orders.append((symbol, quantity, side))
        return SimpleNamespace(id="order-1")

    def close_position(self, symbol):
        self.orders.append((symbol, 0, "close"))
        return SimpleNamespace(id="close-1")


class FakeData:
    def __init__(self, *, empty=False, price=150.0):
        self.empty = empty
        self.price = price

    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        if self.empty:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        n = 30
        idx = pd.date_range("2024-01-01", periods=n, freq="B")
        close = pd.Series([self.price * (1 + 0.001 * i) for i in range(n)], index=idx)
        return pd.DataFrame({
            "open": close, "high": close + 1, "low": close - 1,
            "close": close, "volume": 1_000_000,
        })

    def get_news(self, symbol, *, limit=10):
        return [{"headline": f"{symbol} beats earnings", "summary": "strong quarter",
                 "source": "wire", "created_at": "2024-06-01"}]


class ScriptedLLM:
    """Deterministic stand-in for Claude. Drives the perception tools and returns
    canned structured outputs."""

    def __init__(self, decision: TradeDecision):
        self.decision = decision

    def run_tool_loop(self, *, system, instruction, tools, schemas):
        ticker = re.search(r"for (\w+)", instruction).group(1)
        calls = [
            tools.dispatch("get_market_bars", {"ticker": ticker, "limit": 30}),
            tools.dispatch("get_company_news", {"ticker": ticker}),
            tools.dispatch("get_portfolio_state", {}),
        ]
        return "scripted perception summary", calls

    def parse(self, *, system, prompt, schema):
        if schema is ReasoningState:
            return ReasoningState(summary="plan", data_found=["price up"],
                                  subtasks_to_verify=["check trend"], key_risks=["macro"])
        if schema is AdversarialCheck:
            return AdversarialCheck(bull_case="up", bull_points=["momentum"],
                                    bear_case="down", bear_points=["valuation"],
                                    net_assessment="balanced")
        if schema is TradeDecision:
            return self.decision
        raise AssertionError(f"unexpected schema {schema}")


def make_loop(tmp_path, broker, data, decision):
    tools = AgentTools(broker, data)
    return CognitiveLoop(
        llm=ScriptedLLM(decision),
        tools=tools,
        guardrails=Guardrails(),
        audit=AuditLog(log_dir=tmp_path),
        system_prompt="TEST MANUAL",
    )


# --------------------------------------------------------------------------- #
# Guardrails
# --------------------------------------------------------------------------- #
def test_guardrail_resizes_buy_to_5pct_cap():
    g = Guardrails()
    # Equity 100k -> 5% cap = $5,000. Propose $50,000 at $100 -> capped to 50 shares.
    v = g.validate_decision(action="BUY", ticker="X", target_notional_usd=50_000,
                            equity=100_000, price=100, current_position_qty=0)
    assert v.approved and v.action == "BUY"
    assert v.quantity == 50  # $5,000 / $100
    assert any("5% cap" in n for n in v.notes)


def test_guardrail_buy_under_one_share_forces_hold():
    g = Guardrails()
    # 5% of $1,000 = $50; price $1,000 -> 0 shares -> HOLD.
    v = g.validate_decision(action="BUY", ticker="X", target_notional_usd=50,
                            equity=1_000, price=1_000, current_position_qty=0)
    assert not v.approved and v.action == "HOLD"


def test_guardrail_sell_without_position_forces_hold():
    g = Guardrails()
    v = g.validate_decision(action="SELL", ticker="X", target_notional_usd=0,
                            equity=100_000, price=100, current_position_qty=0)
    assert not v.approved and v.action == "HOLD"


def test_guardrail_sell_with_position_approved():
    g = Guardrails()
    v = g.validate_decision(action="SELL", ticker="X", target_notional_usd=0,
                            equity=100_000, price=100, current_position_qty=12)
    assert v.approved and v.action == "SELL" and v.quantity == 12


def test_drawdown_breached():
    g = Guardrails()
    assert g.drawdown_breached(100_000, 98_000)        # down 2.0% -> tripped
    assert not g.drawdown_breached(100_000, 98_500)    # down 1.5% -> ok


# --------------------------------------------------------------------------- #
# Tools
# --------------------------------------------------------------------------- #
def test_tool_dispatch_market_bars_and_error():
    tools = AgentTools(FakeBroker(), FakeData())
    ok = tools.dispatch("get_market_bars", {"ticker": "AAPL", "limit": 30})
    assert not ok.is_error and "latest_close" in ok.output

    empty_tools = AgentTools(FakeBroker(), FakeData(empty=True))
    bad = empty_tools.dispatch("get_market_bars", {"ticker": "AAPL"})
    assert bad.is_error and "no bars" in bad.output


def test_tool_dispatch_unknown_tool():
    tools = AgentTools(FakeBroker(), FakeData())
    res = tools.dispatch("nope", {})
    assert res.is_error


def test_execute_order_is_driver_only_and_works():
    broker = FakeBroker()
    tools = AgentTools(broker, FakeData())
    tools.execute_order("AAPL", 10, "buy", "market")
    assert broker.orders == [("AAPL", 10, "buy")]


# --------------------------------------------------------------------------- #
# Cognitive loop — end to end
# --------------------------------------------------------------------------- #
def test_full_cycle_buy_is_capped_and_executed(tmp_path):
    broker = FakeBroker(equity=100_000)
    data = FakeData(price=200.0)
    # Model proposes a wildly oversized $80k buy; guardrails must cap to 5% = $5k.
    decision = TradeDecision(action="BUY", ticker="AAPL", target_notional_usd=80_000,
                             confidence=0.9, rationale="momentum")
    loop = make_loop(tmp_path, broker, data, decision)
    result = loop.run_for_ticker("AAPL", equity=100_000)

    assert result.final_action == "BUY"
    assert result.executed
    # $5,000 cap at the latest close (~200*1.029) -> floor -> 24 shares.
    symbol, qty, side = broker.orders[0]
    assert symbol == "AAPL" and side == "buy"
    assert qty * data.price * 1.03 <= 100_000 * 0.05 + 200  # within the 5% envelope
    assert qty >= 1
    # Audit trail written.
    md = (tmp_path / f"{__import__('datetime').date.today().isoformat()}.md").read_text()
    assert "Reflection — adversarial check" in md
    assert "Bull case" in md and "Bear case" in md


def test_degraded_perception_forces_hold(tmp_path):
    broker = FakeBroker(equity=100_000)
    data = FakeData(empty=True)  # market bars come back empty -> degraded
    decision = TradeDecision(action="BUY", ticker="AAPL", target_notional_usd=5_000,
                             confidence=0.9, rationale="should be ignored")
    loop = make_loop(tmp_path, broker, data, decision)
    result = loop.run_for_ticker("AAPL", equity=100_000)

    assert result.degraded and result.final_action == "HOLD"
    assert not result.executed
    assert broker.orders == []  # no trade on bad data
    md = (tmp_path / f"{__import__('datetime').date.today().isoformat()}.md").read_text()
    assert "Degraded perception" in md


def test_hold_decision_places_no_order(tmp_path):
    broker = FakeBroker(equity=100_000)
    decision = TradeDecision(action="HOLD", ticker="AAPL", target_notional_usd=0,
                             confidence=0.5, rationale="no edge")
    loop = make_loop(tmp_path, broker, FakeData(), decision)
    result = loop.run_for_ticker("AAPL", equity=100_000)
    assert result.final_action == "HOLD" and not result.executed
    assert broker.orders == []


# --------------------------------------------------------------------------- #
# Runner — drawdown circuit breaker
# --------------------------------------------------------------------------- #
def test_runner_halts_on_daily_drawdown(tmp_path):
    import json
    from datetime import date

    from trading_bot.agent.runner import AgentRunner, DayState
    from trading_bot.config import Config

    # Pre-seed today's opening equity high; current equity is down 3% -> halt.
    state_path = tmp_path / ".day_state.json"
    state_path.write_text(json.dumps({"date": date.today().isoformat(),
                                      "opening_equity": 100_000}))
    broker = FakeBroker(equity=97_000)
    decision = TradeDecision(action="HOLD", ticker="AAPL", target_notional_usd=0,
                             confidence=0.5, rationale="n/a")
    runner = AgentRunner(
        config=Config(symbols=["AAPL"]),
        llm=ScriptedLLM(decision),
        tools=AgentTools(broker, FakeData()),
        broker=broker,
        audit=AuditLog(log_dir=tmp_path),
        day_state=DayState(state_path),
        watchlist=["AAPL"],
    )
    result = runner.run_day()
    assert result["halted"] and result["reason"] == "daily_drawdown"
    assert broker.orders == []  # no trades after the breaker trips


def test_runner_runs_cycles_when_healthy(tmp_path):
    from trading_bot.agent.runner import AgentRunner, DayState
    from trading_bot.config import Config

    broker = FakeBroker(equity=100_000)
    decision = TradeDecision(action="HOLD", ticker="AAPL", target_notional_usd=0,
                             confidence=0.4, rationale="no edge today")
    runner = AgentRunner(
        config=Config(symbols=["AAPL", "MSFT"]),
        llm=ScriptedLLM(decision),
        tools=AgentTools(broker, FakeData()),
        broker=broker,
        audit=AuditLog(log_dir=tmp_path),
        day_state=DayState(tmp_path / ".day_state.json"),
        watchlist=["AAPL", "MSFT"],
    )
    result = runner.run_day()
    assert not result["halted"]
    assert len(result["results"]) == 2
