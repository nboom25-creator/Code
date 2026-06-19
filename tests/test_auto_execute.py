"""Tests for the auto-execute confidence gate (autonomous execution threshold)."""

from test_agent import FakeBroker, FakeData, ScriptedLLM

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.schemas import TradeDecision
from trading_bot.agent.tools import AgentTools
from trading_bot.config import ExecutionConfig


def _loop(tmp_path, broker, data, decision, *, auto_conf, dry_run=False):
    return CognitiveLoop(
        llm=ScriptedLLM(decision), tools=AgentTools(broker, data),
        guardrails=Guardrails(), audit=AuditLog(log_dir=tmp_path),
        system_prompt="T", dry_run=dry_run,
        execution=ExecutionConfig(auto_execute_confidence=auto_conf))


def _buy(conf):
    return TradeDecision(action="BUY", ticker="AAPL", target_notional_usd=4_000,
                         confidence=conf, rationale="momentum")


def test_high_confidence_buy_auto_executes(tmp_path):
    broker = FakeBroker(equity=100_000)
    loop = _loop(tmp_path, broker, FakeData(price=150), _buy(0.90), auto_conf=0.80)
    result = loop.run_for_ticker("AAPL", equity=100_000)
    assert result.final_action == "BUY"
    assert result.executed and not result.pending_approval
    assert broker.orders and broker.orders[0][2] == "buy"  # order actually placed


def test_low_confidence_buy_held_for_approval(tmp_path):
    broker = FakeBroker(equity=100_000)
    loop = _loop(tmp_path, broker, FakeData(price=150), _buy(0.65), auto_conf=0.80)
    result = loop.run_for_ticker("AAPL", equity=100_000)
    assert result.final_action == "BUY"          # still a BUY proposal...
    assert not result.executed and result.pending_approval  # ...but not auto-placed
    assert broker.orders == []                   # nothing sent to the broker
    md = (tmp_path / f"{__import__('datetime').date.today().isoformat()}.md").read_text()
    assert "Awaiting your approval" in md


def test_sell_auto_executes_below_threshold(tmp_path):
    # Risk-reducing exits always fire, even at low confidence.
    broker = FakeBroker(equity=100_000)
    loop = _loop(tmp_path, broker, FakeData(price=150), _buy(0.0), auto_conf=0.80)
    executed, msg = loop._execute(
        "AAPL", "SELL", 10, 150.0, confidence=0.40, profile="large-cap",
        rationale="cut risk", approved=True, equity=100_000)
    assert executed and broker.orders[0][2] == "sell"


def test_threshold_zero_executes_everything(tmp_path):
    # Feature off (0.0) -> behaves as before: even a low-confidence buy executes.
    broker = FakeBroker(equity=100_000)
    loop = _loop(tmp_path, broker, FakeData(price=150), _buy(0.30), auto_conf=0.0)
    result = loop.run_for_ticker("AAPL", equity=100_000)
    assert result.executed and not result.pending_approval
    assert broker.orders
