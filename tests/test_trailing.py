"""Trailing stop: the peak store and the deterministic forced-EXIT in review."""

from types import SimpleNamespace

from test_agent import FakeBroker, FakeData, ScriptedLLM

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.cognition import CognitiveLoop
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.schemas import TradeDecision
from trading_bot.agent.tools import AgentTools
from trading_bot.agent.trailing import TrailingStopStore


def test_store_tracks_peak_and_detects_breach(tmp_path):
    store = TrailingStopStore(tmp_path / "ts.json")
    # First sighting sets the peak; not a breach.
    breached, peak, _ = store.check("AAA", 100.0, 0.10)
    assert not breached and peak == 100.0
    # Price rises -> peak ratchets up, still no breach.
    breached, peak, _ = store.check("AAA", 120.0, 0.10)
    assert not breached and peak == 120.0
    # Falls 10% from the 120 peak (->108) -> breach.
    breached, peak, stop = store.check("AAA", 107.0, 0.10)
    assert breached and peak == 120.0 and stop == 108.0


def test_store_drop_and_prune(tmp_path):
    store = TrailingStopStore(tmp_path / "ts.json")
    store.check("AAA", 100.0, 0.10)
    store.check("BBB", 50.0, 0.10)
    store.prune({"AAA"})            # BBB no longer held
    assert store.peak("BBB") == 0.0 and store.peak("AAA") == 100.0
    store.drop("AAA")
    assert store.peak("AAA") == 0.0


def test_zero_pct_never_breaches(tmp_path):
    store = TrailingStopStore(tmp_path / "ts.json")
    store.check("AAA", 100.0, 0.0)
    breached, _, _ = store.check("AAA", 1.0, 0.0)  # collapse, but feature off
    assert not breached


class _NoThinkLLM(ScriptedLLM):
    """Proves the trailing exit is deterministic: the LLM is never consulted."""

    def __init__(self):
        super().__init__(TradeDecision(action="HOLD", ticker="X",
                                       target_notional_usd=0, confidence=0.0,
                                       rationale=""))

    def parse(self, **_kwargs):
        raise AssertionError("LLM must not be called once the trailing stop fires")


def test_trailing_stop_forces_exit(tmp_path):
    broker = FakeBroker(equity=100_000, positions=[
        SimpleNamespace(symbol="AAPL", quantity=10, avg_price=100.0,
                        market_value=1_500.0)])
    store = TrailingStopStore(tmp_path / "ts.json")
    store._save({"AAPL": 200.0})  # a prior peak well above the current ~$150

    loop = CognitiveLoop(
        llm=_NoThinkLLM(), tools=AgentTools(broker, FakeData(price=150.0)),
        guardrails=Guardrails(), audit=AuditLog(log_dir=tmp_path),
        system_prompt="T", dry_run=False,
        trailing_stop_pct=0.10, trailing_store=store)

    result = loop.review_position("AAPL", equity=100_000)
    assert result.final_action == "EXIT" and result.executed
    assert any(o[0] == "AAPL" and o[2] == "sell" for o in broker.orders)
    assert store.peak("AAPL") == 0.0  # forgotten after the exit
    md = (tmp_path / f"{__import__('datetime').date.today().isoformat()}.md").read_text()
    assert "TRAILING STOP" in md
