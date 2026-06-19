"""Tests for the market-regime filter and its exposure gating."""

import numpy as np
import pandas as pd

from trading_bot.agent.audit import AuditLog
from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.llm import HeuristicLLM
from trading_bot.agent.paper_sim import SimPaperBroker
from trading_bot.agent.regime import assess_regime
from trading_bot.agent.runner import AgentRunner, DayState
from trading_bot.agent.tools import AgentTools
from trading_bot.config import Config


def _bench(path_values):
    """Wrap a close-price path in a data provider returning it for any symbol."""
    class _D:
        def get_bars(self, symbol, *, timeframe="1Day", limit=None):
            close = pd.Series(path_values, dtype=float)
            df = pd.DataFrame({"open": close, "high": close + 1, "low": close - 1,
                               "close": close, "volume": 1_000_000})
            return df.tail(limit) if limit else df

        def get_news(self, symbol, *, limit=10):
            return []
    return _D()


# --------------------------------------------------------------------------- #
# Assessment
# --------------------------------------------------------------------------- #
def test_regime_risk_on_uptrend_calm():
    # Steady low-vol uptrend: price well above trend -> risk_on, full size.
    path = [100 + i * 0.5 for i in range(220)]
    r = assess_regime(_bench(path))
    assert r.regime == "risk_on" and r.exposure_scale == 1.0


def test_regime_risk_off_downtrend():
    # Price below its long trend -> risk_off, no new exposure.
    path = [200 - i * 0.5 for i in range(220)]
    r = assess_regime(_bench(path))
    assert r.regime == "risk_off" and r.exposure_scale == 0.0


def test_regime_neutral_high_vol():
    # Uptrend but very choppy (high vol) -> neutral, half size.
    rng = np.random.default_rng(0)
    base = np.array([100 + i * 0.3 for i in range(220)])
    noisy = base + rng.normal(0, 8, 220)  # large daily swings
    r = assess_regime(_bench(list(noisy)))
    assert r.regime in ("neutral", "risk_off")  # elevated vol pulls off full size
    assert r.exposure_scale < 1.0


def test_regime_insufficient_data_defaults_neutral():
    r = assess_regime(_bench([100, 101, 102]))  # < 30 bars
    assert r.regime == "neutral" and r.exposure_scale == 0.5


# --------------------------------------------------------------------------- #
# Exposure gating in the guardrail
# --------------------------------------------------------------------------- #
def test_exposure_scale_halves_the_cap():
    g = Guardrails()
    full = g.validate_decision(action="BUY", ticker="X", target_notional_usd=100_000,
                              equity=100_000, price=100, current_position_qty=0,
                              exposure_scale=1.0)
    half = g.validate_decision(action="BUY", ticker="X", target_notional_usd=100_000,
                              equity=100_000, price=100, current_position_qty=0,
                              exposure_scale=0.5)
    assert half.quantity == full.quantity // 2  # 25 vs 50 shares


def test_exposure_zero_blocks_new_entry():
    g = Guardrails()
    v = g.validate_decision(action="BUY", ticker="X", target_notional_usd=5_000,
                            equity=100_000, price=100, current_position_qty=0,
                            exposure_scale=0.0)
    assert not v.approved and v.action == "HOLD"
    assert any("Risk-off" in n for n in v.notes)


# --------------------------------------------------------------------------- #
# Runner skips entries in risk-off
# --------------------------------------------------------------------------- #
def test_runner_skips_entries_in_risk_off(tmp_path):
    broker = SimPaperBroker(equity=100_000, cash=100_000)
    # Benchmark in a downtrend -> risk_off; entries should be skipped entirely.
    data = _bench([200 - i * 0.5 for i in range(220)])
    runner = AgentRunner(
        config=Config(symbols=["AAA"], benchmark="SPY"),
        llm=HeuristicLLM(),
        tools=AgentTools(broker, data),
        broker=broker,
        audit=AuditLog(log_dir=tmp_path),
        day_state=DayState(tmp_path / ".day_state.json"),
        watchlist=["AAA"],
        dry_run=True,
    )
    result = runner.run_day()
    assert result["regime"].regime == "risk_off"
    assert result["results"] == []  # no entry cycles ran
    import datetime as dt
    md = (tmp_path / f"{dt.date.today().isoformat()}.md").read_text()
    assert "Risk-off regime" in md
