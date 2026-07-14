"""Assemble the technical-analysis section from indicator values."""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.analysis import indicators as ind
from app.schemas import (
    IndicatorPoint,
    TechnicalAnalysis,
    TechnicalIndicator,
)


def _series_points(series: pd.Series, tail: int = 180) -> list[IndicatorPoint]:
    s = series.tail(tail)
    pts: list[IndicatorPoint] = []
    for idx, val in s.items():
        pts.append(
            IndicatorPoint(
                date=idx.date(),
                value=None if val is None or (isinstance(val, float) and np.isnan(val)) else round(float(val), 4),
            )
        )
    return pts


def build_technical(df: pd.DataFrame) -> TechnicalAnalysis:
    price = df["adj_close"].astype(float)
    volume = df["volume"].astype(float)
    last = float(price.iloc[-1])

    sma50 = ind.sma(price, 50)
    sma200 = ind.sma(price, 200)
    rsi14 = ind.rsi(price, 14)
    macd = ind.macd(price)
    bb = ind.bollinger_bands(price, 20)
    mom = ind.momentum(price, 21)

    indicators: list[TechnicalIndicator] = []
    bullish = 0
    bearish = 0

    # Trend: price vs 50/200 SMA and golden/death cross
    s50 = float(sma50.iloc[-1]) if not np.isnan(sma50.iloc[-1]) else None
    s200 = float(sma200.iloc[-1]) if not np.isnan(sma200.iloc[-1]) else None
    if s50 and s200:
        if s50 > s200 and last > s50:
            trend_signal, trend = "bullish", "Price is above a rising 50-day average and the 50-day is above the 200-day (golden-cross regime)."
            bullish += 1
        elif s50 < s200 and last < s50:
            trend_signal, trend = "bearish", "Price is below the 50-day average and the 50-day is below the 200-day (death-cross regime)."
            bearish += 1
        else:
            trend_signal, trend = "neutral", "Moving averages are mixed; no clear trend."
    else:
        trend_signal, trend = "neutral", "Not enough history for 200-day trend."
    indicators.append(
        TechnicalIndicator(
            name="Trend (50/200 SMA)", latest=s50, signal=trend_signal, explanation=trend,
            series=_series_points(sma50),
        )
    )

    # RSI
    rsi_val = float(rsi14.iloc[-1]) if not np.isnan(rsi14.iloc[-1]) else None
    if rsi_val is not None:
        if rsi_val >= 70:
            rsi_sig = "bearish"; rsi_txt = f"RSI {rsi_val:.0f} is overbought (>70); momentum may be overextended."; bearish += 1
        elif rsi_val <= 30:
            rsi_sig = "bullish"; rsi_txt = f"RSI {rsi_val:.0f} is oversold (<30); a bounce is possible."; bullish += 1
        else:
            rsi_sig = "neutral"; rsi_txt = f"RSI {rsi_val:.0f} is in the neutral 30–70 band."
    else:
        rsi_sig, rsi_txt = "neutral", "RSI unavailable."
    indicators.append(
        TechnicalIndicator(name="RSI (14)", latest=rsi_val, signal=rsi_sig, explanation=rsi_txt, series=_series_points(rsi14))
    )

    # MACD
    macd_hist = float(macd["hist"].iloc[-1]) if not np.isnan(macd["hist"].iloc[-1]) else None
    if macd_hist is not None:
        if macd_hist > 0:
            macd_sig = "bullish"; macd_txt = "MACD is above its signal line (positive histogram) — upward momentum."; bullish += 1
        else:
            macd_sig = "bearish"; macd_txt = "MACD is below its signal line (negative histogram) — downward momentum."; bearish += 1
    else:
        macd_sig, macd_txt = "neutral", "MACD unavailable."
    indicators.append(
        TechnicalIndicator(name="MACD (12,26,9)", latest=macd_hist, signal=macd_sig, explanation=macd_txt, series=_series_points(macd["hist"]))
    )

    # Bollinger position
    pct_b = float(bb["pct_b"].iloc[-1]) if not np.isnan(bb["pct_b"].iloc[-1]) else None
    if pct_b is not None:
        if pct_b > 1:
            bb_sig = "bearish"; bb_txt = "Price is above the upper Bollinger band — stretched to the upside."
        elif pct_b < 0:
            bb_sig = "bullish"; bb_txt = "Price is below the lower Bollinger band — stretched to the downside."
        else:
            bb_sig = "neutral"; bb_txt = f"Price sits at {pct_b:.0%} of the Bollinger band width."
    else:
        bb_sig, bb_txt = "neutral", "Bollinger bands unavailable."
    indicators.append(
        TechnicalIndicator(name="Bollinger %B (20,2)", latest=pct_b, signal=bb_sig, explanation=bb_txt, series=_series_points(bb["pct_b"]))
    )

    # Momentum
    mom_val = float(mom.iloc[-1]) if not np.isnan(mom.iloc[-1]) else None
    if mom_val is not None:
        if mom_val > 0:
            mom_sig = "bullish"; mom_txt = f"21-day momentum is +{mom_val:.1%}."; bullish += 1
        else:
            mom_sig = "bearish"; mom_txt = f"21-day momentum is {mom_val:.1%}."; bearish += 1
    else:
        mom_sig, mom_txt = "neutral", "Momentum unavailable."
    indicators.append(
        TechnicalIndicator(name="Momentum (21d)", latest=mom_val, signal=mom_sig, explanation=mom_txt, series=_series_points(mom))
    )

    if bullish > bearish:
        overall = "bullish"
    elif bearish > bullish:
        overall = "bearish"
    else:
        overall = "neutral"
    summary = (
        f"{bullish} bullish vs {bearish} bearish technical signals. Technicals describe "
        "recent price behaviour and are not a forecast on their own."
    )
    return TechnicalAnalysis(indicators=indicators, overall_signal=overall, summary=summary)
