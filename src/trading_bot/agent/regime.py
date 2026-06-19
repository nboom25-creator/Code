"""Market regime filter — a portfolio-level risk-on / risk-off gate.

Before taking *new* exposure, assess the broad market via a benchmark (default
SPY): is price above or below its long-term trend, and is volatility elevated?
The result is an ``exposure_scale`` in [0, 1] that the harness multiplies into
the position-size cap for new entries:

* **risk_on**  (price clearly above trend, calm vol) → scale 1.0 (full size)
* **neutral**  (near trend, or elevated vol)         → scale 0.5 (half size)
* **risk_off** (price below trend)                   → scale 0.0 (no new entries)

This is deliberately simple and interpretable. It only gates *entries* (and
position ADDs) — EXITs and TRIMs always run, because you especially want to be
able to reduce risk in a downtrend. When benchmark data is missing it defaults
to the conservative `neutral` (half size), never to full risk.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field


@dataclass
class RegimeAssessment:
    regime: str  # risk_on / neutral / risk_off
    exposure_scale: float
    reason: str
    details: dict = field(default_factory=dict)


def assess_regime(
    data,
    *,
    benchmark: str = "SPY",
    trend_window: int = 200,
    vol_window: int = 20,
    band_pct: float = 1.0,        # +/- % around the trend that counts as "neutral"
    high_vol_annual: float = 0.35,  # annualized vol above this trims exposure
) -> RegimeAssessment:
    """Classify the market regime from benchmark daily bars."""
    try:
        bars = data.get_bars(benchmark, timeframe="1Day", limit=trend_window + 30)
    except Exception as exc:  # noqa: BLE001
        return RegimeAssessment("neutral", 0.5,
                                f"regime data unavailable ({exc}) — defaulting to half size.")

    if bars is None or len(bars) < 30:
        return RegimeAssessment("neutral", 0.5,
                                "insufficient benchmark history — defaulting to half size.")

    close = bars["close"]
    price = float(close.iloc[-1])
    window = min(trend_window, len(close))
    sma = float(close.tail(window).mean())
    pct_above = (price / sma - 1) * 100 if sma else 0.0

    returns = close.pct_change().dropna()
    if len(returns) >= 2:
        vol_annual = float(returns.tail(vol_window).std() * math.sqrt(252))
    else:
        vol_annual = 0.0

    details = {
        "benchmark": benchmark,
        "price": round(price, 2),
        f"sma_{window}": round(sma, 2),
        "pct_above_trend": round(pct_above, 2),
        "annualized_vol": round(vol_annual, 3),
        "trend_window_used": window,
    }

    # Below trend → risk-off, no new exposure.
    if pct_above < -band_pct:
        return RegimeAssessment(
            "risk_off", 0.0,
            f"{benchmark} is {pct_above:.1f}% below its {window}-day trend — "
            f"risk-off; no new entries.", details)

    # Above trend but volatile, or sitting in the neutral band → half size.
    if vol_annual > high_vol_annual or pct_above <= band_pct:
        why = ("elevated volatility" if vol_annual > high_vol_annual
               else "price near its trend")
        return RegimeAssessment(
            "neutral", 0.5,
            f"{benchmark} {pct_above:+.1f}% vs trend, vol {vol_annual:.0%} — "
            f"neutral ({why}); half size.", details)

    # Clearly above trend and calm → full size.
    return RegimeAssessment(
        "risk_on", 1.0,
        f"{benchmark} {pct_above:+.1f}% above its {window}-day trend, vol "
        f"{vol_annual:.0%} — risk-on; full size.", details)
