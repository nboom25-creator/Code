"""Tests for the research rating and backtesting engine."""
import asyncio

from app import service
from app.analysis import to_dataframe
from app.analysis.backtest import run_backtest
from app.analysis.forecasting import build_forecast
from app.analysis.rating import WEIGHTS, build_rating
from app.analysis.risk import build_risk
from app.providers.demo import DemoProvider
from app.schemas import BacktestRequest


def _demo_df(ticker="NVDA"):
    bars = asyncio.run(DemoProvider().get_daily_history(ticker))
    df = to_dataframe(bars)
    df.attrs["ticker"] = ticker
    return df


def test_rating_weights_sum_to_one():
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


def test_rating_composite_equals_sum_of_contributions():
    df = _demo_df()
    funds = asyncio.run(DemoProvider().get_fundamentals("NVDA"))
    forecast, _ = build_forecast(df, None, is_demo=True)
    risk = build_risk(df, None)
    rating = build_rating("NVDA", df, funds, forecast, risk, 0.1)
    total = sum(c.contribution for c in rating.components)
    assert abs(total - rating.composite_score) < 1e-6
    assert -1.0 <= rating.composite_score <= 1.0
    assert 0.0 <= rating.confidence <= 1.0
    assert rating.rating in {"Buy", "Accumulate", "Hold", "Reduce", "Sell"}


def test_rating_model_forecast_weight_is_bounded():
    # A model forecast alone must not dominate: its weight is <= 0.12.
    assert WEIGHTS["Model forecast"] <= 0.12


def test_backtest_runs_and_is_consistent():
    df = _demo_df()
    res = run_backtest(df, None, model_name="gradient_boosting", horizon=5,
                       initial_investment=10_000, transaction_cost_bps=5, is_demo=True)
    assert len(res.points) > 0
    # After-cost return should never exceed gross return.
    assert res.strategy_return_after_costs_pct <= res.strategy_return_pct + 1e-6
    assert res.final_value_after_costs <= res.final_value + 1e-6
    assert 0.0 <= res.directional_accuracy <= 1.0
    assert len(res.equity_curve) == len(res.points) + 1
    assert any("Survivorship" in x for x in res.limitations)


def test_backtest_service_invalid_ticker():
    import pytest
    from app.providers.base import ProviderError
    with pytest.raises(ProviderError):
        asyncio.run(service.backtest(BacktestRequest(ticker="", horizon_days=5)))
