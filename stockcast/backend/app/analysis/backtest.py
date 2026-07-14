"""Walk-forward backtesting engine.

Simulates the forecasting strategy out-of-sample: at each rebalance date the
model is trained only on data available up to that date (no look-ahead), it
predicts the h-day-ahead return, and the strategy goes long when the predicted
return is positive. Performance is compared to buy-and-hold, before and after
transaction costs.

Bias notes surfaced to the user:
* Look-ahead bias is avoided by expanding-window training and forward targets.
* Survivorship bias still applies — we only test tickers that exist today.
* Adjusted close is used so splits/dividends do not create phantom returns.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from app.analysis import indicators as ind
from app.analysis.features import assemble_xy, build_feature_frame
from app.analysis.forecasting import (
    GradientBoostingModel,
    NaiveModel,
    RidgeModel,
    DriftModel,
    walk_forward,
    _select,
)
from app.schemas import BacktestPoint, BacktestResult


def _resolve_model(name: str, df: pd.DataFrame, benchmark, horizon: int):
    name = (name or "auto").lower()
    if name in ("auto", ""):
        selected, _, _ = _select(walk_forward(df, horizon, benchmark))
        return selected
    mapping = {
        "naive": NaiveModel().name,
        "drift": DriftModel(horizon).name,
        "ridge": RidgeModel().name,
        "gradient_boosting": GradientBoostingModel().name,
        "gbm": GradientBoostingModel().name,
    }
    return mapping.get(name, name)


def _model_instance(name: str, horizon: int):
    for m in (NaiveModel(), DriftModel(horizon), RidgeModel(), GradientBoostingModel()):
        if m.name == name:
            return m
    return NaiveModel()


def run_backtest(
    df: pd.DataFrame,
    benchmark: pd.Series | None,
    model_name: str = "auto",
    horizon: int = 5,
    initial_investment: float = 10_000.0,
    transaction_cost_bps: float = 5.0,
    is_demo: bool = False,
    min_train: int = 252,
) -> BacktestResult:
    price = df["adj_close"].astype(float)
    selected = _resolve_model(model_name, df, benchmark, horizon)

    X, y = assemble_xy(df, horizon, benchmark)
    aligned_price = price.reindex(X.index)
    n = len(X)

    limitations = [
        "Survivorship bias: only currently-listed tickers can be tested.",
        "Assumes fills at the daily close with a fixed per-trade cost; slippage and "
        "market impact are not modelled.",
        "Past out-of-sample performance does not guarantee future results.",
    ]
    if is_demo:
        limitations.insert(0, "DEMO DATA: prices are synthetic — results are illustrative only.")

    if n < min_train + horizon + 20:
        return BacktestResult(
            ticker=str(df.attrs.get("ticker", "")), model=selected, horizon_days=horizon,
            is_demo=is_demo, points=[], directional_accuracy=0.0, mae=0.0, rmse=0.0, mape=None,
            strategy_return_pct=0.0, strategy_return_after_costs_pct=0.0,
            buy_and_hold_return_pct=0.0, max_drawdown_pct=0.0, sharpe_ratio=0.0,
            n_trades=0, final_value=initial_investment, final_value_after_costs=initial_investment,
            equity_curve=[], limitations=limitations + ["Not enough history to backtest this horizon."],
        )

    cost = transaction_cost_bps / 10_000.0
    step = horizon  # non-overlapping rebalances so realised returns are independent

    points: list[BacktestPoint] = []
    ret_pred_signs: list[int] = []
    ret_actual_signs: list[int] = []
    strat_returns_gross: list[float] = []
    strat_returns_net: list[float] = []
    bh_multiplier = 1.0
    prev_position = 0
    n_trades = 0

    idx = min_train
    while idx + horizon < n:
        model = _model_instance(selected, horizon)
        X_train, y_train = X.iloc[:idx], y.iloc[:idx]
        try:
            if model.uses_features:
                model.fit(X_train, y_train)
            pred_ret = float(np.asarray(model.predict(X.iloc[[idx]]))[0])
        except Exception:
            pred_ret = 0.0

        p0 = float(aligned_price.iloc[idx])
        p1 = float(aligned_price.iloc[idx + horizon])
        actual_ret = p1 / p0 - 1.0
        pred_price = p0 * np.exp(pred_ret)

        points.append(
            BacktestPoint(
                date=X.index[idx + horizon].date(),
                actual=round(p1, 2),
                predicted=round(pred_price, 2),
                error=round(pred_price - p1, 2),
            )
        )
        ret_pred_signs.append(1 if pred_ret > 0 else -1 if pred_ret < 0 else 0)
        ret_actual_signs.append(1 if actual_ret > 0 else -1)

        # Long-only strategy: hold when predicted return > 0, else in cash.
        position = 1 if pred_ret > 0 else 0
        gross = position * actual_ret
        turnover = abs(position - prev_position)
        if turnover:
            n_trades += 1
        net = gross - turnover * cost
        strat_returns_gross.append(gross)
        strat_returns_net.append(net)
        bh_multiplier *= (1 + actual_ret)
        prev_position = position
        idx += step

    # Aggregate
    gross_growth = float(np.prod([1 + r for r in strat_returns_gross]))
    net_growth = float(np.prod([1 + r for r in strat_returns_net]))
    bh_return = (bh_multiplier - 1) * 100

    # Equity curves. Strategy compounds net returns; buy-and-hold tracks the
    # actual price relative to the first backtested close.
    equity = initial_investment
    curve = [{"date": None, "strategy": round(initial_investment, 2), "buy_hold": round(initial_investment, 2)}]
    first_price = points[0].actual if points else 1.0
    for i, pt in enumerate(points):
        equity *= (1 + strat_returns_net[i])
        bh_equity = initial_investment * (pt.actual / first_price) if first_price else initial_investment
        curve.append({"date": pt.date.isoformat(), "strategy": round(equity, 2), "buy_hold": round(bh_equity, 2)})

    # Metrics on predicted vs actual price
    errors = np.array([p.error for p in points], dtype=float)
    actuals = np.array([p.actual for p in points], dtype=float)
    mae = float(np.mean(np.abs(errors))) if errors.size else 0.0
    rmse = float(np.sqrt(np.mean(errors**2))) if errors.size else 0.0
    mape = float(np.mean(np.abs(errors) / np.where(actuals != 0, actuals, np.nan)) * 100) if errors.size else None
    dir_acc = (
        float(np.mean([1 if p == a else 0 for p, a in zip(ret_pred_signs, ret_actual_signs)]))
        if ret_pred_signs else 0.0
    )

    strat_series = pd.Series(strat_returns_net)
    # Annualise Sharpe from per-period (horizon-length) returns.
    periods_per_year = max(1, round(252 / horizon))
    sharpe = ind.sharpe_ratio(strat_series, periods_per_year=periods_per_year)
    eq = pd.Series([c["strategy"] for c in curve])
    mdd = ind.max_drawdown(eq)

    return BacktestResult(
        ticker=str(df.attrs.get("ticker", "")),
        model=selected,
        horizon_days=horizon,
        is_demo=is_demo,
        points=points,
        directional_accuracy=round(dir_acc, 4),
        mae=round(mae, 4),
        rmse=round(rmse, 4),
        mape=round(mape, 3) if mape is not None else None,
        strategy_return_pct=round((gross_growth - 1) * 100, 2),
        strategy_return_after_costs_pct=round((net_growth - 1) * 100, 2),
        buy_and_hold_return_pct=round(bh_return, 2),
        max_drawdown_pct=round(mdd * 100, 2),
        sharpe_ratio=round(sharpe, 3),
        n_trades=n_trades,
        final_value=round(initial_investment * gross_growth, 2),
        final_value_after_costs=round(initial_investment * net_growth, 2),
        equity_curve=curve,
        limitations=limitations,
    )
