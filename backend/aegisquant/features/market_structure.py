"""Market-structure feature computations.

Every function takes a :class:`~aegisquant.features.market_view.PointInTime` and
returns ``float | None``. ``None`` means "not computable from the data visible at
this instant" — never a filled-in zero, because a zero would be read as a real
signal value downstream.
"""

from __future__ import annotations

import numpy as np

from aegisquant.features.market_view import PointInTime

TRADING_DAYS = 252
SQRT_252 = float(np.sqrt(TRADING_DAYS))


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def _returns(closes: np.ndarray) -> np.ndarray:
    if closes.size < 2:
        return np.array([])
    return np.diff(closes) / closes[:-1]


def _log_returns(closes: np.ndarray) -> np.ndarray:
    if closes.size < 2:
        return np.array([])
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.diff(np.log(closes))


def _safe(value: float) -> float | None:
    if value is None:
        return None
    v = float(value)
    if not np.isfinite(v):
        return None
    return v


def _sma_ratio(closes: np.ndarray, window: int) -> float | None:
    if closes.size < window:
        return None
    sma = float(np.mean(closes[-window:]))
    if sma <= 0:
        return None
    return _safe(closes[-1] / sma - 1.0)


def _total_return(closes: np.ndarray, window: int) -> float | None:
    if closes.size < window + 1:
        return None
    start = closes[-(window + 1)]
    if start <= 0:
        return None
    return _safe(closes[-1] / start - 1.0)


def _realized_vol(closes: np.ndarray, window: int) -> float | None:
    rets = _log_returns(closes[-(window + 1) :])
    if rets.size < max(5, window // 3):
        return None
    return _safe(float(np.std(rets, ddof=1)) * SQRT_252)


# ---------------------------------------------------------------------------
# trend
# ---------------------------------------------------------------------------
def trend_20(pit: PointInTime, symbol: str) -> float | None:
    return _sma_ratio(pit.closes(symbol, 40), 20)


def trend_63(pit: PointInTime, symbol: str) -> float | None:
    return _sma_ratio(pit.closes(symbol, 120), 63)


def trend_126(pit: PointInTime, symbol: str) -> float | None:
    return _sma_ratio(pit.closes(symbol, 200), 126)


def trend_252(pit: PointInTime, symbol: str) -> float | None:
    return _sma_ratio(pit.closes(symbol, 400), 252)


def _log_fit(closes: np.ndarray) -> tuple[float, float] | None:
    """Return (annualised slope, r-squared) of a linear fit to log price."""
    if closes.size < 30 or np.any(closes <= 0):
        return None
    y = np.log(closes)
    x = np.arange(y.size, dtype=float)
    x_mean, y_mean = x.mean(), y.mean()
    denom = float(((x - x_mean) ** 2).sum())
    if denom == 0:
        return None
    slope = float(((x - x_mean) * (y - y_mean)).sum() / denom)
    intercept = y_mean - slope * x_mean
    pred = intercept + slope * x
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y_mean) ** 2).sum())
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return slope * TRADING_DAYS, max(0.0, min(1.0, r2))


def trend_quality_126(pit: PointInTime, symbol: str) -> float | None:
    fit = _log_fit(pit.closes(symbol, 126))
    return None if fit is None else _safe(fit[1])


def trend_slope_126(pit: PointInTime, symbol: str) -> float | None:
    fit = _log_fit(pit.closes(symbol, 126))
    return None if fit is None else _safe(fit[0])


# ---------------------------------------------------------------------------
# relative strength / momentum
# ---------------------------------------------------------------------------
def _rel_strength(pit: PointInTime, symbol: str, window: int) -> float | None:
    own = _total_return(pit.closes(symbol, window + 5), window)
    bench = _total_return(pit.closes(pit.benchmark, window + 5), window)
    if own is None or bench is None:
        return None
    return _safe(own - bench)


def rel_strength_63(pit: PointInTime, symbol: str) -> float | None:
    return _rel_strength(pit, symbol, 63)


def rel_strength_126(pit: PointInTime, symbol: str) -> float | None:
    return _rel_strength(pit, symbol, 126)


def rel_strength_252(pit: PointInTime, symbol: str) -> float | None:
    return _rel_strength(pit, symbol, 252)


def momentum_12_1(pit: PointInTime, symbol: str) -> float | None:
    """12-month return skipping the most recent month (short-term reversal guard)."""
    closes = pit.closes(symbol, 300)
    if closes.size < 253:
        return None
    start, end = closes[-253], closes[-22]
    if start <= 0:
        return None
    return _safe(end / start - 1.0)


def vol_adj_momentum_126(pit: PointInTime, symbol: str) -> float | None:
    closes = pit.closes(symbol, 200)
    ret = _total_return(closes, 126)
    vol = _realized_vol(closes, 126)
    if ret is None or vol is None or vol <= 0:
        return None
    return _safe(ret / vol)


# ---------------------------------------------------------------------------
# breakout / consolidation
# ---------------------------------------------------------------------------
def breakout_55(pit: PointInTime, symbol: str) -> float | None:
    highs = pit.highs(symbol, 56)
    closes = pit.closes(symbol, 1)
    if highs.size < 30 or not closes.size:
        return None
    donchian = float(np.max(highs[:-1])) if highs.size > 1 else float(highs[-1])
    if donchian <= 0:
        return None
    return _safe(closes[-1] / donchian - 1.0)


def breakout_252(pit: PointInTime, symbol: str) -> float | None:
    highs = pit.highs(symbol, 253)
    closes = pit.closes(symbol, 1)
    if highs.size < 120 or not closes.size:
        return None
    high = float(np.max(highs[:-1]))
    if high <= 0:
        return None
    return _safe(closes[-1] / high - 1.0)


def base_tightness_55(pit: PointInTime, symbol: str) -> float | None:
    highs, lows, closes = pit.highs(symbol, 55), pit.lows(symbol, 55), pit.closes(symbol, 1)
    if highs.size < 30 or lows.size < 30 or not closes.size or closes[-1] <= 0:
        return None
    return _safe((float(np.max(highs)) - float(np.min(lows))) / float(closes[-1]))


def consolidation_days(pit: PointInTime, symbol: str) -> float | None:
    """Sessions the 55-day range has stayed inside 25% — a base-length proxy."""
    highs, lows = pit.highs(symbol, 400), pit.lows(symbol, 400)
    if highs.size < 60:
        return None
    count = 0
    for i in range(highs.size, 55, -1):
        window_high = float(np.max(highs[i - 55 : i]))
        window_low = float(np.min(lows[i - 55 : i]))
        if window_low <= 0:
            break
        if (window_high - window_low) / window_low > 0.25:
            break
        count += 1
    return float(count)


# ---------------------------------------------------------------------------
# mean reversion
# ---------------------------------------------------------------------------
def mean_rev_z_10(pit: PointInTime, symbol: str) -> float | None:
    closes = pit.closes(symbol, 40)
    if closes.size < 12:
        return None
    window = closes[-10:]
    sd = float(np.std(window, ddof=1))
    if sd <= 0:
        return None
    return _safe((closes[-1] - float(np.mean(window))) / sd)


def rsi_14(pit: PointInTime, symbol: str) -> float | None:
    closes = pit.closes(symbol, 120)
    if closes.size < 16:
        return None
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    period = 14
    avg_gain = float(np.mean(gains[:period]))
    avg_loss = float(np.mean(losses[:period]))
    for i in range(period, deltas.size):  # Wilder smoothing
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    rs = avg_gain / avg_loss
    return _safe(100.0 - 100.0 / (1.0 + rs))


# ---------------------------------------------------------------------------
# volatility
# ---------------------------------------------------------------------------
def atr_pct_14(pit: PointInTime, symbol: str) -> float | None:
    highs, lows, closes = pit.highs(symbol, 30), pit.lows(symbol, 30), pit.closes(symbol, 30)
    if closes.size < 16:
        return None
    prev_close = closes[:-1]
    tr = np.maximum(
        highs[1:] - lows[1:],
        np.maximum(np.abs(highs[1:] - prev_close), np.abs(lows[1:] - prev_close)),
    )
    if tr.size < 14 or closes[-1] <= 0:
        return None
    return _safe(float(np.mean(tr[-14:])) / float(closes[-1]))


def realized_vol_21(pit: PointInTime, symbol: str) -> float | None:
    return _realized_vol(pit.closes(symbol, 40), 21)


def realized_vol_63(pit: PointInTime, symbol: str) -> float | None:
    return _realized_vol(pit.closes(symbol, 90), 63)


def vol_regime(pit: PointInTime, symbol: str) -> float | None:
    closes = pit.closes(symbol, 300)
    short = _realized_vol(closes, 21)
    long = _realized_vol(closes, 252)
    if short is None or long is None or long <= 0:
        return None
    return _safe(short / long)


def downside_vol_63(pit: PointInTime, symbol: str) -> float | None:
    rets = _log_returns(pit.closes(symbol, 70))
    neg = rets[rets < 0]
    if neg.size < 8:
        return None
    return _safe(float(np.std(neg, ddof=1)) * SQRT_252)


# ---------------------------------------------------------------------------
# volume / liquidity
# ---------------------------------------------------------------------------
def volume_ratio_20(pit: PointInTime, symbol: str) -> float | None:
    vols = pit.volumes(symbol, 21)
    if vols.size < 10:
        return None
    avg = float(np.mean(vols[:-1]))
    if avg <= 0:
        return None
    return _safe(float(vols[-1]) / avg)


def accumulation_20(pit: PointInTime, symbol: str) -> float | None:
    closes, vols = pit.closes(symbol, 21), pit.volumes(symbol, 21)
    if closes.size < 12 or vols.size != closes.size:
        return None
    deltas = np.diff(closes)
    v = vols[1:]
    up = float(v[deltas > 0].sum())
    down = float(v[deltas < 0].sum())
    total = up + down
    if total <= 0:
        return None
    return _safe((up - down) / total)


def obv_slope_63(pit: PointInTime, symbol: str) -> float | None:
    closes, vols = pit.closes(symbol, 64), pit.volumes(symbol, 64)
    if closes.size < 30 or vols.size != closes.size:
        return None
    signs = np.sign(np.diff(closes))
    obv = np.cumsum(signs * vols[1:])
    scale = float(np.mean(vols)) * obv.size
    if scale <= 0:
        return None
    x = np.arange(obv.size, dtype=float)
    denom = float(((x - x.mean()) ** 2).sum())
    if denom == 0:
        return None
    slope = float(((x - x.mean()) * (obv - obv.mean())).sum() / denom)
    return _safe(slope * obv.size / scale)


def adv_usd_20(pit: PointInTime, symbol: str) -> float | None:
    closes, vols = pit.closes(symbol, 20), pit.volumes(symbol, 20)
    if closes.size < 5 or vols.size != closes.size:
        return None
    return _safe(float(np.mean(closes * vols)))


def turnover_20(pit: PointInTime, symbol: str) -> float | None:
    vols = pit.volumes(symbol, 20)
    fund = pit.latest_fundamental(symbol)
    if vols.size < 5 or fund is None:
        return None
    shares = fund.values.get("shares_outstanding")
    if not shares or shares <= 0:
        return None
    return _safe(float(np.mean(vols)) / shares)


# ---------------------------------------------------------------------------
# gaps
# ---------------------------------------------------------------------------
def gap_pct(pit: PointInTime, symbol: str) -> float | None:
    opens, closes = pit.opens(symbol, 2), pit.closes(symbol, 2)
    if opens.size < 2 or closes.size < 2 or closes[-2] <= 0:
        return None
    return _safe(opens[-1] / closes[-2] - 1.0)


def gap_risk_63(pit: PointInTime, symbol: str) -> float | None:
    opens, closes = pit.opens(symbol, 64), pit.closes(symbol, 64)
    if opens.size < 20 or opens.size != closes.size:
        return None
    prev = closes[:-1]
    valid = prev > 0
    if not valid.any():
        return None
    gaps = np.abs(opens[1:][valid] / prev[valid] - 1.0)
    return _safe(float(np.mean(gaps)))


# ---------------------------------------------------------------------------
# correlation / beta
# ---------------------------------------------------------------------------
def _aligned_returns(pit: PointInTime, symbol: str, window: int) -> tuple[np.ndarray, np.ndarray]:
    own = _log_returns(pit.closes(symbol, window + 1))
    bench = _log_returns(pit.closes(pit.benchmark, window + 1))
    n = min(own.size, bench.size)
    if n < max(10, window // 4):
        return np.array([]), np.array([])
    return own[-n:], bench[-n:]


def _corr(pit: PointInTime, symbol: str, window: int) -> float | None:
    own, bench = _aligned_returns(pit, symbol, window)
    if own.size == 0:
        return None
    if float(np.std(own)) == 0 or float(np.std(bench)) == 0:
        return None
    return _safe(float(np.corrcoef(own, bench)[0, 1]))


def corr_benchmark_63(pit: PointInTime, symbol: str) -> float | None:
    return _corr(pit, symbol, 63)


def corr_change_63_252(pit: PointInTime, symbol: str) -> float | None:
    short, long = _corr(pit, symbol, 63), _corr(pit, symbol, 252)
    if short is None or long is None:
        return None
    return _safe(short - long)


def beta_252(pit: PointInTime, symbol: str) -> float | None:
    own, bench = _aligned_returns(pit, symbol, 252)
    if own.size == 0:
        return None
    var = float(np.var(bench, ddof=1))
    if var <= 0:
        return None
    return _safe(float(np.cov(own, bench, ddof=1)[0, 1]) / var)


def downside_capture_252(pit: PointInTime, symbol: str) -> float | None:
    own, bench = _aligned_returns(pit, symbol, 252)
    if own.size == 0:
        return None
    mask = bench < 0
    if mask.sum() < 10:
        return None
    bench_mean = float(np.mean(bench[mask]))
    if bench_mean == 0:
        return None
    return _safe(float(np.mean(own[mask])) / bench_mean)


def recovery_speed_63(pit: PointInTime, symbol: str) -> float | None:
    """Fraction of the worst 63-session drawdown that has been recovered."""
    closes = pit.closes(symbol, 64)
    if closes.size < 30:
        return None
    peak = np.maximum.accumulate(closes)
    dd = closes / peak - 1.0
    trough = float(np.min(dd))
    if trough >= -1e-9:
        return 1.0
    current = float(dd[-1])
    return _safe(max(0.0, min(1.0, 1.0 - current / trough)))


def drawdown_252(pit: PointInTime, symbol: str) -> float | None:
    closes = pit.closes(symbol, 253)
    if closes.size < 40:
        return None
    high = float(np.max(closes))
    if high <= 0:
        return None
    return _safe(float(closes[-1]) / high - 1.0)


def dist_52w_high(pit: PointInTime, symbol: str) -> float | None:
    highs, closes = pit.highs(symbol, 253), pit.closes(symbol, 1)
    if highs.size < 40 or not closes.size:
        return None
    high = float(np.max(highs))
    if high <= 0:
        return None
    return _safe(float(closes[-1]) / high - 1.0)


def dist_52w_low(pit: PointInTime, symbol: str) -> float | None:
    lows, closes = pit.lows(symbol, 253), pit.closes(symbol, 1)
    if lows.size < 40 or not closes.size:
        return None
    low = float(np.min(lows))
    if low <= 0:
        return None
    return _safe(float(closes[-1]) / low - 1.0)


def sector_rel_strength_126(pit: PointInTime, symbol: str) -> float | None:
    """126-session return minus the equal-weighted return of same-sector names."""
    sector = pit.sector(symbol)
    peers = [s for s in pit.investable_symbols if pit.sector(s) == sector and s != symbol.upper()]
    if len(peers) < 2:
        return None
    own = _total_return(pit.closes(symbol, 132), 126)
    if own is None:
        return None
    peer_returns = [r for r in (_total_return(pit.closes(p, 132), 126) for p in peers) if r is not None]
    if len(peer_returns) < 2:
        return None
    return _safe(own - float(np.mean(peer_returns)))


# ---------------------------------------------------------------------------
# market-level breadth / rotation
# ---------------------------------------------------------------------------
def breadth_above_200sma(pit: PointInTime) -> float | None:
    above = total = 0
    for sym in pit.investable_symbols:
        closes = pit.closes(sym, 200)
        if closes.size < 200:
            continue
        total += 1
        if closes[-1] > float(np.mean(closes)):
            above += 1
    return None if total < 5 else _safe(above / total)


def breadth_advance_decline_20(pit: PointInTime) -> float | None:
    adv = dec = 0
    for sym in pit.investable_symbols:
        r = _total_return(pit.closes(sym, 25), 20)
        if r is None:
            continue
        if r > 0:
            adv += 1
        elif r < 0:
            dec += 1
    total = adv + dec
    return None if total < 5 else _safe((adv - dec) / total)


def breadth_new_high_low_63(pit: PointInTime) -> float | None:
    highs = lows = total = 0
    for sym in pit.investable_symbols:
        closes = pit.closes(sym, 63)
        if closes.size < 63:
            continue
        total += 1
        if closes[-1] >= float(np.max(closes)):
            highs += 1
        elif closes[-1] <= float(np.min(closes)):
            lows += 1
    return None if total < 5 else _safe((highs - lows) / total)


def _sector_returns(pit: PointInTime, window: int = 63) -> dict[str, float]:
    buckets: dict[str, list[float]] = {}
    for sym in pit.investable_symbols:
        if pit.instrument(sym).get("asset_class") == "etf":
            continue  # avoid double counting index products in sector stats
        r = _total_return(pit.closes(sym, window + 5), window)
        if r is None:
            continue
        buckets.setdefault(pit.sector(sym), []).append(r)
    return {k: float(np.mean(v)) for k, v in buckets.items() if len(v) >= 2}


def sector_momentum_dispersion(pit: PointInTime) -> float | None:
    rets = _sector_returns(pit)
    if len(rets) < 3:
        return None
    return _safe(float(np.std(list(rets.values()), ddof=1)))


def sector_rotation_leader_count(pit: PointInTime) -> float | None:
    rets = _sector_returns(pit)
    if len(rets) < 3:
        return None
    bench = _total_return(pit.closes(pit.benchmark, 68), 63)
    if bench is None:
        return None
    return float(sum(1 for v in rets.values() if v > bench))


def avg_pairwise_correlation_63(pit: PointInTime, max_symbols: int = 40) -> float | None:
    series = []
    for sym in pit.investable_symbols[:max_symbols]:
        r = _log_returns(pit.closes(sym, 64))
        if r.size >= 40:
            series.append(r[-40:])
    if len(series) < 4:
        return None
    matrix = np.vstack(series)
    if np.any(np.std(matrix, axis=1) == 0):
        matrix = matrix[np.std(matrix, axis=1) > 0]
        if matrix.shape[0] < 4:
            return None
    corr = np.corrcoef(matrix)
    iu = np.triu_indices_from(corr, k=1)
    vals = corr[iu]
    vals = vals[np.isfinite(vals)]
    return None if vals.size == 0 else _safe(float(np.mean(vals)))


SYMBOL_FEATURES = {
    "trend_20": trend_20,
    "trend_63": trend_63,
    "trend_126": trend_126,
    "trend_252": trend_252,
    "trend_quality_126": trend_quality_126,
    "trend_slope_126": trend_slope_126,
    "rel_strength_63": rel_strength_63,
    "rel_strength_126": rel_strength_126,
    "rel_strength_252": rel_strength_252,
    "momentum_12_1": momentum_12_1,
    "vol_adj_momentum_126": vol_adj_momentum_126,
    "breakout_55": breakout_55,
    "breakout_252": breakout_252,
    "consolidation_days": consolidation_days,
    "base_tightness_55": base_tightness_55,
    "mean_rev_z_10": mean_rev_z_10,
    "rsi_14": rsi_14,
    "atr_pct_14": atr_pct_14,
    "realized_vol_21": realized_vol_21,
    "realized_vol_63": realized_vol_63,
    "vol_regime": vol_regime,
    "downside_vol_63": downside_vol_63,
    "volume_ratio_20": volume_ratio_20,
    "accumulation_20": accumulation_20,
    "obv_slope_63": obv_slope_63,
    "adv_usd_20": adv_usd_20,
    "turnover_20": turnover_20,
    "gap_pct": gap_pct,
    "gap_risk_63": gap_risk_63,
    "corr_benchmark_63": corr_benchmark_63,
    "corr_change_63_252": corr_change_63_252,
    "beta_252": beta_252,
    "downside_capture_252": downside_capture_252,
    "recovery_speed_63": recovery_speed_63,
    "drawdown_252": drawdown_252,
    "dist_52w_high": dist_52w_high,
    "dist_52w_low": dist_52w_low,
    "sector_rel_strength_126": sector_rel_strength_126,
}

MARKET_FEATURES = {
    "breadth_above_200sma": breadth_above_200sma,
    "breadth_advance_decline_20": breadth_advance_decline_20,
    "breadth_new_high_low_63": breadth_new_high_low_63,
    "sector_momentum_dispersion": sector_momentum_dispersion,
    "sector_rotation_leader_count": sector_rotation_leader_count,
    "avg_pairwise_correlation_63": avg_pairwise_correlation_63,
}
