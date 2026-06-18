"""Trading strategies.

A strategy maps a window of OHLCV bars to a discrete signal for the most recent
bar. Strategies are stateless and deterministic, which makes them trivial to
backtest and unit-test.

Add a new strategy by subclassing :class:`Strategy`, implementing
``generate_signal``, and registering it in :data:`STRATEGIES`.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any

import pandas as pd

from . import indicators


class Signal(Enum):
    BUY = "buy"
    SELL = "sell"
    HOLD = "hold"


REQUIRED_COLUMNS = {"open", "high", "low", "close", "volume"}


class Strategy(ABC):
    """Base class. Subclasses implement :meth:`generate_signal`."""

    name: str = "base"

    def __init__(self, **params: Any) -> None:
        self.params = params

    @property
    @abstractmethod
    def min_bars(self) -> int:
        """Minimum number of bars required before a signal is meaningful."""

    @abstractmethod
    def generate_signal(self, bars: pd.DataFrame) -> Signal:
        """Return the signal for the *latest* bar in ``bars``."""

    @staticmethod
    def _validate(bars: pd.DataFrame) -> None:
        missing = REQUIRED_COLUMNS - set(bars.columns)
        if missing:
            raise ValueError(f"bars missing required columns: {sorted(missing)}")


class SMACrossover(Strategy):
    """Go long when the fast SMA crosses above the slow SMA; exit on the
    opposite cross. A classic trend-following rule."""

    name = "sma_crossover"

    def __init__(self, fast_period: int = 20, slow_period: int = 50, **_: Any) -> None:
        if fast_period >= slow_period:
            raise ValueError("fast_period must be < slow_period")
        super().__init__(fast_period=fast_period, slow_period=slow_period)
        self.fast_period = fast_period
        self.slow_period = slow_period

    @property
    def min_bars(self) -> int:
        return self.slow_period + 1

    def generate_signal(self, bars: pd.DataFrame) -> Signal:
        self._validate(bars)
        if len(bars) < self.min_bars:
            return Signal.HOLD
        close = bars["close"]
        fast = indicators.sma(close, self.fast_period)
        slow = indicators.sma(close, self.slow_period)
        # Need two valid points to detect a cross.
        if pd.isna(fast.iloc[-2]) or pd.isna(slow.iloc[-2]):
            return Signal.HOLD
        prev_diff = fast.iloc[-2] - slow.iloc[-2]
        curr_diff = fast.iloc[-1] - slow.iloc[-1]
        if prev_diff <= 0 < curr_diff:
            return Signal.BUY
        if prev_diff >= 0 > curr_diff:
            return Signal.SELL
        return Signal.HOLD


class RSIMeanReversion(Strategy):
    """Buy when RSI crosses up out of oversold; sell when it crosses down out of
    overbought. A mean-reversion rule that fades extremes."""

    name = "rsi_reversion"

    def __init__(
        self,
        rsi_period: int = 14,
        oversold: float = 30.0,
        overbought: float = 70.0,
        **_: Any,
    ) -> None:
        if not 0 < oversold < overbought < 100:
            raise ValueError("require 0 < oversold < overbought < 100")
        super().__init__(rsi_period=rsi_period, oversold=oversold, overbought=overbought)
        self.rsi_period = rsi_period
        self.oversold = oversold
        self.overbought = overbought

    @property
    def min_bars(self) -> int:
        return self.rsi_period + 2

    def generate_signal(self, bars: pd.DataFrame) -> Signal:
        self._validate(bars)
        if len(bars) < self.min_bars:
            return Signal.HOLD
        rsi = indicators.rsi(bars["close"], self.rsi_period)
        if pd.isna(rsi.iloc[-2]) or pd.isna(rsi.iloc[-1]):
            return Signal.HOLD
        prev, curr = rsi.iloc[-2], rsi.iloc[-1]
        if prev <= self.oversold < curr:
            return Signal.BUY
        if prev >= self.overbought > curr:
            return Signal.SELL
        return Signal.HOLD


STRATEGIES: dict[str, type[Strategy]] = {
    SMACrossover.name: SMACrossover,
    RSIMeanReversion.name: RSIMeanReversion,
}


def build_strategy(name: str, params: dict[str, Any] | None = None) -> Strategy:
    """Instantiate a registered strategy by name."""
    try:
        cls = STRATEGIES[name]
    except KeyError:
        raise ValueError(
            f"unknown strategy {name!r}; available: {sorted(STRATEGIES)}"
        ) from None
    return cls(**(params or {}))
