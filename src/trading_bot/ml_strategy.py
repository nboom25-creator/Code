"""Machine-learning signal layer (optional).

A self-contained strategy that engineers technical features and trains a
classifier to predict whether the next bar's return will be positive. It plugs
into the same :class:`~trading_bot.strategy.Strategy` interface, so the
backtester and live engine treat it like any rule-based strategy.

scikit-learn is an *optional* dependency, imported lazily. Importing this module
without it works; only instantiating :class:`MLSignalStrategy` requires it.

The model refits periodically on an expanding window (``refit_every`` bars),
which keeps both backtests and live runs reasonably fast while adapting to new
data. Until enough history exists to train, it returns HOLD.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from . import indicators
from .strategy import Signal, Strategy, register_strategy


def build_features(bars: pd.DataFrame) -> pd.DataFrame:
    """Engineer a feature matrix from OHLCV bars.

    Features are intentionally simple and causal (computed only from past data):
    short/long returns, RSI, MACD histogram, rolling volatility, and the
    close-to-SMA gap. Returns a DataFrame aligned to ``bars.index``.
    """
    close = bars["close"]
    feats = pd.DataFrame(index=bars.index)
    feats["ret_1"] = close.pct_change(1)
    feats["ret_5"] = close.pct_change(5)
    feats["rsi"] = indicators.rsi(close, 14)
    feats["macd_hist"] = indicators.macd(close)["hist"]
    feats["vol_10"] = close.pct_change().rolling(10).std()
    sma20 = indicators.sma(close, 20)
    feats["sma_gap"] = (close - sma20) / sma20
    return feats


@register_strategy
class MLSignalStrategy(Strategy):
    """Classifier-based long/flat strategy.

    Predicts P(next return > 0). Emits BUY when that probability exceeds
    ``buy_threshold`` and SELL when it falls below ``sell_threshold``; otherwise
    HOLD. The engine/backtester turn these into long entries and exits.
    """

    name = "ml"

    def __init__(
        self,
        min_train: int = 200,
        refit_every: int = 50,
        buy_threshold: float = 0.55,
        sell_threshold: float = 0.45,
        n_estimators: int = 100,
        random_state: int = 42,
        **_: Any,
    ) -> None:
        super().__init__(
            min_train=min_train,
            refit_every=refit_every,
            buy_threshold=buy_threshold,
            sell_threshold=sell_threshold,
        )
        if not 0 < sell_threshold <= buy_threshold < 1:
            raise ValueError("require 0 < sell_threshold <= buy_threshold < 1")
        self.min_train = min_train
        self.refit_every = refit_every
        self.buy_threshold = buy_threshold
        self.sell_threshold = sell_threshold
        self.n_estimators = n_estimators
        self.random_state = random_state
        self._model = None
        self._last_fit_len = 0
        self._feature_cols: list[str] | None = None

    @property
    def min_bars(self) -> int:
        # Need enough to train plus the longest feature lookback (~26 for MACD).
        return self.min_train + 30

    def _new_model(self):
        try:
            from sklearn.ensemble import RandomForestClassifier
        except ImportError as exc:  # pragma: no cover - depends on env
            raise ImportError(
                "The 'ml' strategy requires scikit-learn. Install it with "
                "`pip install scikit-learn`."
            ) from exc
        return RandomForestClassifier(
            n_estimators=self.n_estimators,
            random_state=self.random_state,
            n_jobs=1,
            max_depth=5,
        )

    def fit(self, bars: pd.DataFrame) -> None:
        """Train the model on ``bars`` using next-bar direction as the label."""
        feats = build_features(bars)
        # Label: 1 if next bar's close return is positive, else 0.
        target = (bars["close"].shift(-1) > bars["close"]).astype(int)
        data = feats.copy()
        data["_y"] = target
        data = data.dropna()
        if data.empty:
            return
        self._feature_cols = [c for c in data.columns if c != "_y"]
        x = data[self._feature_cols].to_numpy()
        y = data["_y"].to_numpy()
        if len(np.unique(y)) < 2:
            # Degenerate window (all up or all down) — can't train a classifier.
            return
        model = self._new_model()
        model.fit(x, y)
        self._model = model
        self._last_fit_len = len(bars)

    def _maybe_refit(self, bars: pd.DataFrame) -> None:
        if self._model is None:
            self.fit(bars)
        elif len(bars) - self._last_fit_len >= self.refit_every:
            self.fit(bars)

    def generate_signal(self, bars: pd.DataFrame) -> Signal:
        self._validate(bars)
        if len(bars) < self.min_bars:
            return Signal.HOLD
        self._maybe_refit(bars)
        if self._model is None or self._feature_cols is None:
            return Signal.HOLD
        latest = build_features(bars).iloc[[-1]][self._feature_cols]
        if latest.isna().any(axis=None):
            return Signal.HOLD
        prob_up = float(self._model.predict_proba(latest.to_numpy())[0][1])
        if prob_up >= self.buy_threshold:
            return Signal.BUY
        if prob_up <= self.sell_threshold:
            return Signal.SELL
        return Signal.HOLD
