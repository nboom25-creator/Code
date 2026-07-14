"""Risk metrics derived from price history."""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.analysis import indicators as ind
from app.schemas import RiskAnalysis


def build_risk(df: pd.DataFrame, benchmark: pd.Series | None = None) -> RiskAnalysis:
    price = df["adj_close"].astype(float)
    log_ret = np.log(price / price.shift(1)).dropna()
    ann_vol = float(log_ret.std() * np.sqrt(252)) if not log_ret.empty else 0.0
    mdd = ind.max_drawdown(price.tail(252 * 5))
    var95 = float(np.percentile(log_ret, 5)) if not log_ret.empty else 0.0

    beta = None
    if benchmark is not None and not benchmark.empty:
        bench = benchmark.reindex(price.index).ffill()
        bench_ret = np.log(bench / bench.shift(1))
        joined = pd.concat([log_ret, bench_ret], axis=1, keys=["a", "b"]).dropna()
        if len(joined) > 30 and joined["b"].var() > 0:
            beta = float(np.cov(joined["a"], joined["b"])[0, 1] / joined["b"].var())

    sharpe = ind.sharpe_ratio(log_ret.tail(252))

    notes = []
    if ann_vol > 0.4:
        notes.append("Very high volatility — position sizing and stops matter more than the point forecast.")
    if mdd < -0.4:
        notes.append(f"Has historically drawn down more than {abs(mdd):.0%} from peak.")
    if var95 < -0.05:
        notes.append(f"On a bad day (5% worst) the stock has moved about {var95:.1%}.")
    if not notes:
        notes.append("Risk profile is moderate relative to the broad market.")

    return RiskAnalysis(
        annualized_volatility=round(ann_vol, 4),
        max_drawdown_5y=round(mdd, 4),
        value_at_risk_95_daily=round(var95, 4),
        beta_vs_benchmark=round(beta, 3) if beta is not None else None,
        sharpe_ratio_1y=round(sharpe, 3),
        downside_notes=notes,
    )
