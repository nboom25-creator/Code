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


class MACDCrossover(Strategy):
    """Buy when the MACD line crosses above its signal line; sell on the
    opposite cross. A momentum rule that reacts faster than raw SMA crossovers."""

    name = "macd_crossover"

    def __init__(
        self,
        fast: int = 12,
        slow: int = 26,
        signal: int = 9,
        **_: Any,
    ) -> None:
        if fast >= slow:
            raise ValueError("fast must be < slow")
        super().__init__(fast=fast, slow=slow, signal=signal)
        self.fast = fast
        self.slow = slow
        self.signal = signal

    @property
    def min_bars(self) -> int:
        return self.slow + self.signal + 1

    def generate_signal(self, bars: pd.DataFrame) -> Signal:
        self._validate(bars)
        if len(bars) < self.min_bars:
            return Signal.HOLD
        macd_df = indicators.macd(bars["close"], self.fast, self.slow, self.signal)
        line = macd_df["macd"]
        sig = macd_df["signal"]
        if pd.isna(line.iloc[-2]) or pd.isna(sig.iloc[-2]):
            return Signal.HOLD
        prev = line.iloc[-2] - sig.iloc[-2]
        curr = line.iloc[-1] - sig.iloc[-1]
        if prev <= 0 < curr:
            return Signal.BUY
        if prev >= 0 > curr:
            return Signal.SELL
        return Signal.HOLD


class BollingerBreakout(Strategy):
    """Buy when price breaks out above the upper Bollinger band; exit when it
    falls back below the middle band. A volatility-breakout momentum rule."""

    name = "bollinger_breakout"

    def __init__(self, period: int = 20, num_std: float = 2.0, **_: Any) -> None:
        if period < 2:
            raise ValueError("period must be >= 2")
        super().__init__(period=period, num_std=num_std)
        self.period = period
        self.num_std = num_std

    @property
    def min_bars(self) -> int:
        return self.period + 1

    def generate_signal(self, bars: pd.DataFrame) -> Signal:
        self._validate(bars)
        if len(bars) < self.min_bars:
            return Signal.HOLD
        bands = indicators.bollinger_bands(bars["close"], self.period, self.num_std)
        close = bars["close"]
        if pd.isna(bands["upper"].iloc[-2]):
            return Signal.HOLD
        prev_close, curr_close = close.iloc[-2], close.iloc[-1]
        prev_upper, curr_upper = bands["upper"].iloc[-2], bands["upper"].iloc[-1]
        prev_mid, curr_mid = bands["mid"].iloc[-2], bands["mid"].iloc[-1]
        # Breakout up: close crosses above the upper band.
        if prev_close <= prev_upper and curr_close > curr_upper:
            return Signal.BUY
        # Exit: close crosses back below the middle band.
        if prev_close >= prev_mid and curr_close < curr_mid:
            return Signal.SELL
        return Signal.HOLD


STRATEGIES: dict[str, type[Strategy]] = {
    SMACrossover.name: SMACrossover,
    RSIMeanReversion.name: RSIMeanReversion,
    MACDCrossover.name: MACDCrossover,
    BollingerBreakout.name: BollingerBreakout,
}


def register_strategy(cls: type[Strategy]) -> type[Strategy]:
    """Register a strategy subclass so it can be built by name. Usable as a
    decorator. Lets optional strategies (e.g. the ML layer) opt in without a
    hard import dependency in this module."""
    STRATEGIES[cls.name] = cls
    return cls


def build_strategy(name: str, params: dict[str, Any] | None = None) -> Strategy:
    """Instantiate a registered strategy by name."""
    if name not in STRATEGIES and name == "ml":
        # The ML strategy lives in an optional module that self-registers on
        # import (so scikit-learn stays an optional dependency).
        from . import ml_strategy  # noqa: F401
    try:
        cls = STRATEGIES[name]
    except KeyError:
        raise ValueError(
            f"unknown strategy {name!r}; available: {sorted(STRATEGIES)}"
        ) from None
    return cls(**(params or {}))
