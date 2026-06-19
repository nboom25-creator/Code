"""Tests for conviction- and volatility-based position sizing."""

import json

import pandas as pd

from trading_bot.agent.guardrails import Guardrails
from trading_bot.agent.paper_sim import SimPaperBroker
from trading_bot.agent.tools import AgentTools


# --------------------------------------------------------------------------- #
# The sizer in isolation
# --------------------------------------------------------------------------- #
def test_target_notional_scales_with_conviction():
    g = Guardrails(max_position_pct=0.05)
    # Calm stock (atr_pct below reference -> calmness capped at 1).
    full = g.target_notional(equity=100_000, confidence=1.0, atr_pct=0.02)
    half = g.target_notional(equity=100_000, confidence=0.5, atr_pct=0.02)
    assert full == 5_000          # 5% of 100k at full conviction, calm
    assert half == 2_500          # half conviction -> half size


def test_target_notional_shrinks_for_volatile_stock():
    g = Guardrails(max_position_pct=0.05, reference_atr_pct=0.03)
    calm = g.target_notional(equity=100_000, confidence=1.0, atr_pct=0.03)   # calmness 1.0
    jumpy = g.target_notional(equity=100_000, confidence=1.0, atr_pct=0.06)  # calmness 0.5
    assert calm == 5_000
    assert jumpy == 2_500         # twice as volatile -> half the size


def test_target_notional_no_vol_info_uses_full_cap():
    g = Guardrails()
    assert g.target_notional(equity=100_000, confidence=1.0, atr_pct=0.0) == 5_000


def test_sizer_never_exceeds_hard_cap_then_validate_clamps():
    g = Guardrails()
    # Very calm stock can't push above the 5% cap (calmness capped at 1).
    target = g.target_notional(equity=100_000, confidence=1.0, atr_pct=0.001)
    assert target == 5_000


# --------------------------------------------------------------------------- #
# ATR is exposed by the bars tool
# --------------------------------------------------------------------------- #
class _VolData:
    def __init__(self, swing):
        self.swing = swing

    def get_bars(self, symbol, *, timeframe="1Day", limit=30):
        idx = pd.date_range("2024-01-01", periods=30, freq="B")
        # Alternating high/low spread of `swing` around a ~100 price.
        close = pd.Series([100.0] * 30, index=idx)
        return pd.DataFrame({"open": close, "high": close + self.swing,
                             "low": close - self.swing, "close": close,
                             "volume": 1_000_000})

    def get_news(self, symbol, *, limit=10):
        return []


def test_bars_tool_reports_higher_atr_for_jumpier_stock():
    calm = AgentTools(SimPaperBroker(), _VolData(swing=0.5))
    jumpy = AgentTools(SimPaperBroker(), _VolData(swing=5.0))
    calm_atr = json.loads(calm.get_market_bars("X"))["atr_pct"]
    jumpy_atr = json.loads(jumpy.get_market_bars("X"))["atr_pct"]
    assert jumpy_atr > calm_atr > 0
