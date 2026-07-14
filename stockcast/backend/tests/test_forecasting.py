"""Tests for the forecasting pipeline and model selection."""
import asyncio

import numpy as np

from app.analysis import to_dataframe
from app.analysis.forecasting import (
    HORIZONS,
    NaiveModel,
    build_forecast,
    walk_forward,
    _select,
)
from app.providers.demo import DemoProvider


def _demo_df(ticker="MSFT"):
    bars = asyncio.run(DemoProvider().get_daily_history(ticker))
    df = to_dataframe(bars)
    df.attrs["ticker"] = ticker
    return df


def test_walk_forward_produces_scores():
    df = _demo_df()
    scores = walk_forward(df, 21, None)
    assert NaiveModel().name in scores
    naive = scores[NaiveModel().name]
    assert naive.n_folds > 0
    assert naive.price_actual.size > 0


def test_selection_prefers_naive_when_nothing_beats_it():
    df = _demo_df()
    scores = walk_forward(df, 21, None)
    selected, metrics, _ = _select(scores)
    # On synthetic random-walk data no model should reliably beat naive.
    naive_metric = next(m for m in metrics if m.model == NaiveModel().name)
    for m in metrics:
        if m.model != NaiveModel().name and m.skill_vs_naive <= 0:
            # A non-skillful model must never be selected over naive.
            assert selected != m.model or m.skill_vs_naive > 0
    assert selected in {m.model for m in metrics}


def test_forecast_has_all_horizons_and_intervals():
    df = _demo_df()
    forecast, scenarios = build_forecast(df, None, is_demo=True)
    assert len(forecast.horizons) == len(HORIZONS)
    for h in forecast.horizons:
        # Interval must bracket the base case (uncertainty is never zero-width).
        assert h.lower < h.base < h.upper
        assert h.bear <= h.base <= h.bull
    assert len(scenarios) == len(HORIZONS)
    assert forecast.is_demo is True


def test_metrics_are_finite():
    df = _demo_df()
    scores = walk_forward(df, 5, None)
    _, metrics, _ = _select(scores)
    for m in metrics:
        assert np.isfinite(m.rmse)
        assert np.isfinite(m.mae)
        assert 0.0 <= m.directional_accuracy <= 1.0
