"""Forecasting pipeline.

Design choices that keep the forecasts defensible:

* **Forecast returns, not prices.** Models predict the forward *log-return* over
  each horizon; prices are reconstructed as ``P0 * exp(return)``. This keeps the
  target roughly stationary and avoids fitting an arbitrary trend line.
* **Walk-forward validation only.** Time order is never shuffled and features
  never see the future (see ``features.py``). Each fold trains on the past and
  is scored on the immediately following block.
* **Baseline-anchored selection.** A model is only chosen over the naive
  random-walk baseline if it actually beats it out-of-sample. Otherwise the
  baseline wins and the UI says so.
* **Honest uncertainty.** Prediction intervals come from the empirical
  distribution of walk-forward residuals for that horizon — not an assumption
  that the model is right.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from app.analysis.features import assemble_xy, build_feature_frame
from app.schemas import (
    Forecast,
    ForecastPoint,
    ModelMetric,
    ScenarioCard,
)

# Horizons in trading days (approx). 21 ≈ 1 month, 63 ≈ 3 months, etc.
HORIZONS: list[tuple[str, int]] = [
    ("1 day", 1),
    ("1 week", 5),
    ("1 month", 21),
    ("3 months", 63),
    ("6 months", 126),
    ("1 year", 252),
]

_TRADING_DAYS_YEAR = 252


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class BaseModel:
    name = "base"
    uses_features = True

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "BaseModel":
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:  # returns horizon log-return
        raise NotImplementedError


class NaiveModel(BaseModel):
    """Random-walk: best guess of the future return is zero (price unchanged)."""

    name = "Naive (random walk)"
    uses_features = False

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return np.zeros(len(X))


class DriftModel(BaseModel):
    """Exponentially-weighted drift baseline.

    Predicts the horizon return by projecting the recent average daily return
    (feature ``ret_mean_21``) forward. No parameters to fit.
    """

    name = "EWMA drift"
    uses_features = True

    def __init__(self, horizon: int):
        self.horizon = horizon

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        if "ret_mean_21" in X.columns:
            return (X["ret_mean_21"].fillna(0.0) * self.horizon).to_numpy()
        return np.zeros(len(X))


class RidgeModel(BaseModel):
    name = "Ridge regression"

    def __init__(self):
        self._pipe = make_pipeline(StandardScaler(), Ridge(alpha=5.0))

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "RidgeModel":
        self._pipe.fit(X.to_numpy(), y.to_numpy())
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self._pipe.predict(X.to_numpy())


class GradientBoostingModel(BaseModel):
    name = "Gradient boosting"

    def __init__(self):
        self._model = HistGradientBoostingRegressor(
            max_depth=3, max_iter=200, learning_rate=0.05, l2_regularization=1.0,
            min_samples_leaf=20, random_state=42,
        )

    def fit(self, X: pd.DataFrame, y: pd.Series) -> "GradientBoostingModel":
        self._model.fit(X.to_numpy(), y.to_numpy())
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return self._model.predict(X.to_numpy())


def _candidate_models(horizon: int) -> list[BaseModel]:
    return [NaiveModel(), DriftModel(horizon), RidgeModel(), GradientBoostingModel()]


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #
@dataclass
class FoldScore:
    model: str
    price_actual: np.ndarray = field(default_factory=lambda: np.array([]))
    price_pred: np.ndarray = field(default_factory=lambda: np.array([]))
    ret_actual: np.ndarray = field(default_factory=lambda: np.array([]))
    ret_pred: np.ndarray = field(default_factory=lambda: np.array([]))
    n_folds: int = 0

    def metrics(self, naive_rmse: float | None) -> ModelMetric:
        err = self.price_pred - self.price_actual
        mae = float(np.mean(np.abs(err))) if err.size else float("nan")
        rmse = float(np.sqrt(np.mean(err**2))) if err.size else float("nan")
        with np.errstate(divide="ignore", invalid="ignore"):
            mape_arr = np.abs(err) / np.where(self.price_actual != 0, self.price_actual, np.nan)
        mape = float(np.nanmean(mape_arr) * 100) if err.size else None
        dir_acc = (
            float(np.mean(np.sign(self.ret_pred) == np.sign(self.ret_actual)))
            if self.ret_actual.size
            else 0.0
        )
        skill = (1 - rmse / naive_rmse) if (naive_rmse and naive_rmse > 0) else 0.0
        return ModelMetric(
            model=self.model,
            mae=round(mae, 4),
            rmse=round(rmse, 4),
            mape=round(mape, 3) if mape is not None else None,
            directional_accuracy=round(dir_acc, 4),
            skill_vs_naive=round(float(skill), 4),
            n_folds=self.n_folds,
        )


# --------------------------------------------------------------------------- #
# Walk-forward validation
# --------------------------------------------------------------------------- #
def walk_forward(
    df: pd.DataFrame,
    horizon: int,
    benchmark: pd.Series | None,
    n_folds: int = 4,
    min_train: int = 252,
) -> dict[str, FoldScore]:
    """Expanding-window walk-forward evaluation for every candidate model."""
    X, y = assemble_xy(df, horizon, benchmark)
    price = df["adj_close"].astype(float).reindex(X.index)
    n = len(X)
    scores: dict[str, FoldScore] = {m.name: FoldScore(m.name) for m in _candidate_models(horizon)}
    if n < min_train + horizon + 10:
        # Not enough history for robust CV; return empty scores (caller handles).
        return scores

    test_size = max(horizon, (n - min_train) // n_folds)
    fold_starts = list(range(min_train, n - horizon, test_size))[:n_folds]
    for start in fold_starts:
        end = min(start + test_size, n - horizon)
        if end <= start:
            continue
        X_train, y_train = X.iloc[:start], y.iloc[:start]
        X_test = X.iloc[start:end]
        y_test = y.iloc[start:end].to_numpy()
        p0 = price.iloc[start:end].to_numpy()
        actual_price = p0 * np.exp(y_test)
        for model in _candidate_models(horizon):
            try:
                if model.uses_features:
                    model.fit(X_train, y_train)
                pred_ret = np.asarray(model.predict(X_test), dtype=float)
            except Exception:
                continue
            pred_price = p0 * np.exp(pred_ret)
            s = scores[model.name]
            s.price_actual = np.concatenate([s.price_actual, actual_price])
            s.price_pred = np.concatenate([s.price_pred, pred_price])
            s.ret_actual = np.concatenate([s.ret_actual, y_test])
            s.ret_pred = np.concatenate([s.ret_pred, pred_ret])
            s.n_folds += 1
    return scores


def _select(scores: dict[str, FoldScore]) -> tuple[str, list[ModelMetric], dict[str, FoldScore]]:
    naive = scores.get(NaiveModel().name)
    naive_rmse = None
    if naive and naive.price_actual.size:
        err = naive.price_pred - naive.price_actual
        naive_rmse = float(np.sqrt(np.mean(err**2)))
    metrics = [s.metrics(naive_rmse) for s in scores.values() if s.price_actual.size]
    metrics.sort(key=lambda m: m.rmse)
    if not metrics:
        return NaiveModel().name, [], scores
    # Prefer the lowest-RMSE model, but only over naive if it truly beats it.
    best = metrics[0]
    if best.model != NaiveModel().name and best.skill_vs_naive <= 0.0:
        best = next((m for m in metrics if m.model == NaiveModel().name), best)
    return best.model, metrics, scores


# --------------------------------------------------------------------------- #
# Public API
# --------------------------------------------------------------------------- #
def _model_by_name(name: str, horizon: int) -> BaseModel:
    for m in _candidate_models(horizon):
        if m.name == name:
            return m
    return NaiveModel()


def build_forecast(
    df: pd.DataFrame,
    benchmark: pd.Series | None = None,
    is_demo: bool = False,
    interval_confidence: float = 0.80,
) -> tuple[Forecast, list[ScenarioCard]]:
    """Produce multi-horizon forecasts with intervals and validation metrics."""
    price = df["adj_close"].astype(float)
    last_price = float(price.iloc[-1])
    last_date = df.index[-1].date()
    z = 1.2816  # ~80% two-sided normal quantile
    if abs(interval_confidence - 0.90) < 1e-6:
        z = 1.6449
    elif abs(interval_confidence - 0.95) < 1e-6:
        z = 1.9600

    # Validation is dominated by the 1-month horizon for model selection so the
    # chosen model is stable across horizons; each horizon still reports its own
    # residual spread for the interval.
    selection_scores = walk_forward(df, 21, benchmark)
    selected_name, selection_metrics, _ = _select(selection_scores)

    feats_all = build_feature_frame(df, benchmark)
    latest_feat = feats_all.iloc[[-1]].fillna(0.0)

    horizons_out: list[ForecastPoint] = []
    scenarios: list[ScenarioCard] = []
    low_conf_reasons: list[str] = []

    X_full, _ = assemble_xy(df, 21, benchmark)
    enough_data = len(X_full) >= 200
    if not enough_data:
        selected_name = NaiveModel().name
        low_conf_reasons.append(
            "Fewer than ~1 year of usable rows after feature warm-up; "
            "forecasts fall back to the naive baseline."
        )

    for label, h in HORIZONS:
        # Per-horizon walk-forward to size the interval from real residuals.
        scores = walk_forward(df, h, benchmark)
        model = _model_by_name(selected_name, h)
        Xtr, ytr = assemble_xy(df, h, benchmark)
        point_ret = 0.0
        try:
            if enough_data and len(Xtr) > 60:
                if model.uses_features:
                    model.fit(Xtr, ytr)
                point_ret = float(np.asarray(model.predict(latest_feat))[0])
        except Exception:
            point_ret = 0.0

        # Residual std for this horizon (fallback to volatility scaling).
        s = scores.get(selected_name)
        if s and s.ret_actual.size >= 5:
            resid = s.ret_pred - s.ret_actual
            sigma = float(np.std(resid))
        else:
            daily_vol = float(np.log(price / price.shift(1)).std())
            sigma = daily_vol * np.sqrt(h)
            low_conf_reasons.append(f"{label}: interval estimated from volatility, not residuals.")

        base_price = last_price * np.exp(point_ret)
        lower = last_price * np.exp(point_ret - z * sigma)
        upper = last_price * np.exp(point_ret + z * sigma)
        bull = last_price * np.exp(point_ret + sigma)
        bear = last_price * np.exp(point_ret - sigma)

        target_date = last_date + timedelta(days=int(h * 365 / _TRADING_DAYS_YEAR))
        horizons_out.append(
            ForecastPoint(
                date=target_date,
                horizon_label=label,
                horizon_days=h,
                predicted_price=round(base_price, 2),
                lower=round(lower, 2),
                upper=round(upper, 2),
                bull=round(bull, 2),
                base=round(base_price, 2),
                bear=round(bear, 2),
                expected_return_pct=round((base_price / last_price - 1) * 100, 2),
            )
        )
        scenarios.append(
            ScenarioCard(
                horizon_label=label,
                bull=round(bull, 2),
                base=round(base_price, 2),
                bear=round(bear, 2),
                bull_return_pct=round((bull / last_price - 1) * 100, 2),
                base_return_pct=round((base_price / last_price - 1) * 100, 2),
                bear_return_pct=round((bear / last_price - 1) * 100, 2),
            )
        )

    # Rationale
    naive_metric = next((m for m in selection_metrics if m.model == NaiveModel().name), None)
    sel_metric = next((m for m in selection_metrics if m.model == selected_name), None)
    if selected_name == NaiveModel().name:
        rationale = (
            "No candidate model beat the naive random-walk baseline out-of-sample, "
            "so the baseline is used. This is a feature, not a bug: for many liquid "
            "stocks short-horizon returns are close to unpredictable."
        )
    elif sel_metric and naive_metric:
        rationale = (
            f"{selected_name} was selected because it beat the naive baseline in "
            f"walk-forward validation (RMSE {sel_metric.rmse} vs {naive_metric.rmse}, "
            f"skill {sel_metric.skill_vs_naive:+.2f}, directional accuracy "
            f"{sel_metric.directional_accuracy:.0%})."
        )
    else:
        rationale = f"{selected_name} selected by walk-forward validation."

    low_conf = None
    if low_conf_reasons:
        low_conf = " ".join(dict.fromkeys(low_conf_reasons))
    elif sel_metric and sel_metric.directional_accuracy < 0.5:
        low_conf = (
            "Directional accuracy is at or below a coin flip in validation — treat "
            "the direction of this forecast with low confidence."
        )

    forecast = Forecast(
        ticker=str(df.attrs.get("ticker", "")),
        generated_at=datetime.now(timezone.utc),
        selected_model=selected_name,
        model_rationale=rationale,
        horizons=horizons_out,
        interval_confidence=interval_confidence,
        validation=selection_metrics,
        is_demo=is_demo,
        low_confidence_warning=low_conf,
    )
    return forecast, scenarios
