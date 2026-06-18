"""Backtesting engine.

Replays historical bars one at a time, feeding each strategy only the data it
would have had at that moment (no look-ahead), routing entries through the same
:class:`~trading_bot.risk.RiskManager` used live, and marking the portfolio to
market each bar. Produces an equity curve and summary performance metrics.

The engine is single-symbol for clarity; run it per symbol and aggregate, or
extend :meth:`Backtester.run` to iterate symbols against a shared portfolio.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

from .config import BacktestConfig, RiskConfig
from .portfolio import Portfolio
from .risk import RiskManager
from .strategy import Signal, Strategy


@dataclass
class BacktestResult:
    symbol: str
    equity_curve: pd.Series
    trades: list
    metrics: dict[str, float]

    def summary(self) -> str:
        m = self.metrics
        lines = [
            f"Backtest results for {self.symbol}",
            f"  Total return:    {m['total_return']:.2%}",
            f"  Final equity:    ${m['final_equity']:,.2f}",
            f"  Max drawdown:    {m['max_drawdown']:.2%}",
            f"  Sharpe (ann.):   {m['sharpe']:.2f}",
            f"  Trades:          {int(m['num_trades'])}",
            f"  Win rate:        {m['win_rate']:.2%}",
        ]
        return "\n".join(lines)


def _apply_slippage(price: float, side: str, slippage_pct: float) -> float:
    """Move the fill price against us: pay more to buy, receive less to sell."""
    if side == "buy":
        return price * (1 + slippage_pct)
    return price * (1 - slippage_pct)


class Backtester:
    def __init__(
        self,
        strategy: Strategy,
        risk_config: RiskConfig,
        backtest_config: BacktestConfig,
    ) -> None:
        self.strategy = strategy
        self.risk = RiskManager(risk_config)
        self.bt = backtest_config

    def run(self, symbol: str, bars: pd.DataFrame) -> BacktestResult:
        """Backtest ``strategy`` on ``bars`` (a DataFrame with OHLCV columns,
        indexed by timestamp, sorted ascending)."""
        if bars.empty:
            raise ValueError("no bars to backtest")
        bars = bars.sort_index()
        portfolio = Portfolio(cash=self.bt.starting_cash)
        self.risk.start_day(self.bt.starting_cash)

        equity_points: list[float] = []
        index = bars.index

        for i in range(len(bars)):
            window = bars.iloc[: i + 1]
            price = float(bars["close"].iloc[i])
            signal = self.strategy.generate_signal(window)
            equity = portfolio.equity({symbol: price})

            if signal is Signal.BUY and not portfolio.has_position(symbol):
                decision = self.risk.evaluate_entry(
                    equity=equity,
                    price=price,
                    open_positions=len(portfolio.positions),
                    current_equity=equity,
                )
                if decision.approved:
                    fill = _apply_slippage(price, "buy", self.bt.slippage_pct)
                    affordable = int((portfolio.cash - self.bt.commission) // fill)
                    qty = min(decision.quantity, affordable)
                    if qty >= 1:
                        portfolio.buy(symbol, qty, fill,
                                      commission=self.bt.commission,
                                      timestamp=index[i])
            elif signal is Signal.SELL and portfolio.has_position(symbol):
                fill = _apply_slippage(price, "sell", self.bt.slippage_pct)
                qty = portfolio.positions[symbol].quantity
                portfolio.sell(symbol, qty, fill,
                               commission=self.bt.commission,
                               timestamp=index[i])

            equity_points.append(portfolio.equity({symbol: price}))

        equity_curve = pd.Series(equity_points, index=index, name="equity")
        metrics = self._compute_metrics(equity_curve, portfolio)
        return BacktestResult(symbol, equity_curve, portfolio.trades, metrics)

    def _compute_metrics(self, equity: pd.Series, portfolio: Portfolio) -> dict[str, float]:
        start = float(equity.iloc[0]) if len(equity) else self.bt.starting_cash
        final = float(equity.iloc[-1]) if len(equity) else start
        total_return = (final / self.bt.starting_cash) - 1.0

        # Max drawdown.
        running_max = equity.cummax()
        drawdown = (equity - running_max) / running_max
        max_drawdown = float(drawdown.min()) if len(drawdown) else 0.0

        # Annualized Sharpe from per-bar returns. Assumes daily bars (~252/yr);
        # treat as a rough comparative metric, not a precise figure.
        returns = equity.pct_change().dropna()
        if len(returns) > 1 and returns.std() > 0:
            sharpe = float(returns.mean() / returns.std() * math.sqrt(252))
        else:
            sharpe = 0.0

        # Win rate over closing (sell) trades that realized P&L.
        closing = [t for t in portfolio.trades if t.side == "sell"]
        wins = sum(1 for t in closing if t.pnl > 0)
        win_rate = wins / len(closing) if closing else 0.0

        return {
            "total_return": total_return,
            "final_equity": final,
            "max_drawdown": max_drawdown,
            "sharpe": sharpe,
            "num_trades": float(len(portfolio.trades)),
            "win_rate": win_rate,
        }


def generate_synthetic_bars(
    n: int = 500,
    *,
    start_price: float = 100.0,
    seed: int = 42,
    trend: float = 0.0003,
    volatility: float = 0.015,
) -> pd.DataFrame:
    """Generate a synthetic OHLCV series via geometric brownian motion.

    Useful for testing and for ``backtest --synthetic`` (no network needed).
    """
    rng = np.random.default_rng(seed)
    returns = rng.normal(loc=trend, scale=volatility, size=n)
    close = start_price * np.exp(np.cumsum(returns))
    # Build plausible OHLC around the close path.
    open_ = np.concatenate([[start_price], close[:-1]])
    high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.003, n)))
    low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.003, n)))
    volume = rng.integers(1_000_000, 5_000_000, n)
    index = pd.date_range("2020-01-01", periods=n, freq="B")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=index,
    )
