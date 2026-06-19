"""Backtest the *agent* (not just rule strategies) over historical days.

A time machine: it walks history one bar at a time, and on each step the agent
sees only data up to that point (no look-ahead), makes its full Research-then-
Decide decisions, and a simulated broker fills the orders at that day's prices,
honors the bracket stops, and marks the account to market. The output is an
equity curve plus the usual performance stats — so you can judge the agent's
logic, not just a moving-average rule.

It reuses the real CognitiveLoop end to end (regime gate, position reviews,
entries, every guardrail, execution) by swapping in:
  * PointInTimeData  — returns history only up to the current cursor, and
  * BacktestBroker    — fills at the current price, manages stops, tracks equity.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from types import SimpleNamespace

import pandas as pd

from ..config import ExecutionConfig, PortfolioConfig
from .cognition import CognitiveLoop
from .guardrails import Guardrails
from .ledger import Fill, TradeLedger
from .llm import HeuristicLLM
from .regime import assess_regime
from .tools import AgentTools


# --------------------------------------------------------------------------- #
# Point-in-time data feed (no look-ahead)
# --------------------------------------------------------------------------- #
class PointInTimeData:
    def __init__(self, history: dict[str, pd.DataFrame], *, news_per_symbol=None):
        self.history = history
        self.cursor = 0
        self.news_per_symbol = news_per_symbol or {}

    def set_cursor(self, i: int) -> None:
        self.cursor = i

    def get_bars(self, symbol, *, timeframe="1Day", limit=None):
        df = self.history.get(symbol)
        if df is None or df.empty:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
        upto = df.iloc[: self.cursor + 1]   # only data up to "now"
        return upto.tail(limit) if limit else upto

    def get_news(self, symbol, *, limit=10):
        return list(self.news_per_symbol.get(symbol, []))[:limit]


# --------------------------------------------------------------------------- #
# Simulated broker that fills, manages stops, and marks to market
# --------------------------------------------------------------------------- #
@dataclass
class _Pos:
    qty: int
    avg_price: float
    stop: float | None = None
    take_profit: float | None = None


class BacktestBroker:
    def __init__(self, cash: float, ledger: TradeLedger, *, slippage_pct=0.0005,
                 mode="backtest"):
        self.cash = cash
        self.ledger = ledger
        self.slippage_pct = slippage_pct
        self.mode = mode
        self.positions: dict[str, _Pos] = {}
        self.prices: dict[str, float] = {}

    # --- pricing / marking ------------------------------------------- #
    def set_prices(self, prices: dict[str, float]) -> None:
        self.prices.update(prices)

    def _fill(self, price: float, side: str) -> float:
        f = (1 + self.slippage_pct) if side == "buy" else (1 - self.slippage_pct)
        return price * f

    def equity(self) -> float:
        held = sum(p.qty * self.prices.get(s, p.avg_price)
                   for s, p in self.positions.items())
        return self.cash + held

    def get_account(self):
        eq = self.equity()
        return SimpleNamespace(equity=eq, cash=self.cash, buying_power=self.cash)

    def get_positions(self):
        return [SimpleNamespace(symbol=s, quantity=p.qty, avg_price=p.avg_price,
                                market_value=p.qty * self.prices.get(s, p.avg_price))
                for s, p in self.positions.items() if p.qty > 0]

    # --- order entry (called by the agent via tools.execute_order) ---- #
    def _buy(self, symbol, qty, price, stop=None, take_profit=None):
        fill = self._fill(price, "buy")
        affordable = int(self.cash // fill)
        qty = min(qty, affordable)
        if qty < 1:
            return SimpleNamespace(id="bt-skip")
        self.cash -= qty * fill
        pos = self.positions.get(symbol)
        if pos:
            total = pos.qty + qty
            pos.avg_price = (pos.avg_price * pos.qty + fill * qty) / total
            pos.qty = total
        else:
            pos = self.positions[symbol] = _Pos(qty, fill)
        if stop:
            pos.stop = stop
        if take_profit:
            pos.take_profit = take_profit
        return SimpleNamespace(id="bt-buy", qty=qty)

    def _sell(self, symbol, qty, price):
        pos = self.positions.get(symbol)
        if not pos:
            return SimpleNamespace(id="bt-noop")
        qty = min(qty, pos.qty)
        self.cash += qty * self._fill(price, "sell")
        pos.qty -= qty
        if pos.qty == 0:
            del self.positions[symbol]
        return SimpleNamespace(id="bt-sell", qty=qty)

    def submit_market_order(self, symbol, qty, side):
        price = self.prices.get(symbol, 0)
        return self._buy(symbol, qty, price) if side == "buy" else self._sell(symbol, qty, price)

    def submit_limit_order(self, symbol, qty, side, limit_price):
        # Marketable limit: at this cadence, fill at the current price.
        return self.submit_market_order(symbol, qty, side)

    def submit_bracket_order(self, symbol, qty, *, stop_loss_price,
                             take_profit_price=None, limit_price=None):
        return self._buy(symbol, qty, self.prices.get(symbol, 0),
                         stop=stop_loss_price, take_profit=take_profit_price)

    def close_position(self, symbol):
        pos = self.positions.get(symbol)
        return self._sell(symbol, pos.qty, self.prices.get(symbol, 0)) if pos else None

    # --- stop / take-profit management (broker-side) ------------------ #
    def check_stops(self, ohlc: dict[str, tuple[float, float]], *, profile_of=None):
        """Close positions whose stop or take-profit was hit during the day.
        ``ohlc`` maps symbol -> (high, low). Records the exit to the ledger."""
        for symbol in list(self.positions):
            pos = self.positions[symbol]
            hi, lo = ohlc.get(symbol, (None, None))
            if hi is None:
                continue
            exit_price = None
            if pos.stop and lo is not None and lo <= pos.stop:
                exit_price = pos.stop                 # stop-loss hit
            elif pos.take_profit and hi is not None and hi >= pos.take_profit:
                exit_price = pos.take_profit          # take-profit hit
            if exit_price is None:
                continue
            qty = pos.qty
            self.cash += qty * exit_price
            del self.positions[symbol]
            self.ledger.record(Fill(symbol, "sell", qty, float(exit_price),
                                    mode=self.mode, rationale="bracket stop/take-profit"))


# --------------------------------------------------------------------------- #
# Silent audit (a full markdown trail per step would be enormous)
# --------------------------------------------------------------------------- #
class _SilentAudit:
    def day_header(self, **k): pass
    def system_event(self, *a, **k): pass
    def write_cycle(self, **k): pass
    def write_review(self, **k): pass
    def write_reasoning_state(self, *a, **k): pass


# --------------------------------------------------------------------------- #
# Result
# --------------------------------------------------------------------------- #
@dataclass
class AgentBacktestResult:
    equity_curve: pd.Series
    ledger: TradeLedger
    metrics: dict
    mode: str = "backtest"

    def summary(self) -> str:
        from .performance import format_report

        m = self.metrics
        lines = [
            "Agent backtest",
            f"  Period:        {m['start_date']} → {m['end_date']} ({m['days']} bars)",
            f"  Start equity:  ${m['start_equity']:,.0f}",
            f"  End equity:    ${m['end_equity']:,.0f}",
            f"  Total return:  {m['total_return']:+.2%}",
            f"  Max drawdown:  {m['max_drawdown']:.2%}",
            f"  Sharpe (ann.): {m['sharpe']:.2f}",
            "",
            format_report(self.ledger, mode=self.mode),
        ]
        return "\n".join(lines)


# --------------------------------------------------------------------------- #
# The backtester
# --------------------------------------------------------------------------- #
class AgentBacktester:
    def __init__(
        self,
        *,
        history: dict[str, pd.DataFrame],
        benchmark: pd.DataFrame,
        research=None,
        llm=None,
        starting_cash: float = 100_000.0,
        cadence: int = 5,           # run the agent every N bars (weekly-ish)
        warmup: int = 60,           # bars needed before the first decision
        ledger_path: str = "logs/backtest_ledger.jsonl",
        portfolio_config: PortfolioConfig | None = None,
        execution_config: ExecutionConfig | None = None,
        guardrails: Guardrails | None = None,
        rules_config=None,
        benchmark_symbol: str = "SPY",
    ) -> None:
        self.history = history
        self.benchmark = benchmark
        self.cadence = cadence
        self.warmup = warmup
        self.benchmark_symbol = benchmark_symbol
        self.portfolio_config = portfolio_config or PortfolioConfig()

        # Fresh ledger for this run.
        from pathlib import Path
        Path(ledger_path).parent.mkdir(parents=True, exist_ok=True)
        Path(ledger_path).unlink(missing_ok=True)
        self.ledger = TradeLedger(ledger_path)

        execution = execution_config or ExecutionConfig()
        self.broker = BacktestBroker(starting_cash, self.ledger,
                                     slippage_pct=execution.est_slippage_pct)
        # Point-in-time feed includes the benchmark so regime is also as-of-now.
        feed = dict(history)
        feed[benchmark_symbol] = benchmark
        self.data = PointInTimeData(feed)
        self.tools = AgentTools(self.broker, self.data, research=research)
        self.loop = CognitiveLoop(
            llm=llm or HeuristicLLM(), tools=self.tools,
            guardrails=guardrails or Guardrails(),
            audit=_SilentAudit(), system_prompt="(backtest)", dry_run=False,
            ledger=self.ledger, mode="backtest", execution=execution,
            rules=rules_config,
        )
        self.starting_cash = starting_cash

    # ------------------------------------------------------------------ #
    def run(self) -> AgentBacktestResult:
        # Common date axis from the first symbol (all aligned by construction).
        any_df = next(iter(self.history.values()))
        dates = any_df.index
        n = len(dates)
        equity_points: list[float] = []
        curve_dates: list = []

        for i in range(self.warmup, n):
            # Mark prices for this bar and run broker-side stop/take-profit checks.
            prices, ohlc = {}, {}
            for sym, df in self.history.items():
                if i < len(df):
                    row = df.iloc[i]
                    prices[sym] = float(row["close"])
                    ohlc[sym] = (float(row["high"]), float(row["low"]))
            self.broker.set_prices(prices)
            self.broker.check_stops(ohlc)

            equity_points.append(self.broker.equity())
            curve_dates.append(dates[i])

            # The agent acts on the configured cadence.
            if (i - self.warmup) % self.cadence == 0:
                self.data.set_cursor(i)
                self._agent_step(equity=self.broker.equity())

        equity = pd.Series(equity_points, index=curve_dates, name="equity")
        return AgentBacktestResult(equity, self.ledger, self._metrics(equity))

    # ------------------------------------------------------------------ #
    def _agent_step(self, *, equity: float) -> None:
        # Regime gate (as-of-now benchmark).
        regime = assess_regime(self.data, benchmark=self.benchmark_symbol)
        portfolio = self._portfolio_risk(equity)
        held = set(self.broker.positions)

        # Phase A — review/manage held positions (runs in every regime).
        for ticker in sorted(held):
            try:
                self.loop.review_position(ticker, equity=equity,
                                          exposure_scale=regime.exposure_scale,
                                          portfolio=portfolio)
            except Exception:  # noqa: BLE001 — keep the backtest going
                pass

        # Phase B — new entries, gated by regime + portfolio caps.
        if regime.exposure_scale <= 0:
            return
        for ticker in self.history:
            if ticker in self.broker.positions or not portfolio.can_open_new(ticker):
                continue
            try:
                r = self.loop.run_for_ticker(ticker, equity=equity,
                                             exposure_scale=regime.exposure_scale,
                                             portfolio=portfolio)
                if r.final_action == "BUY" and r.notional > 0:
                    portfolio.add(ticker, r.notional, r.sector)
            except Exception:  # noqa: BLE001
                pass

    def _portfolio_risk(self, equity: float):
        from .portfolio_risk import Holding, PortfolioRisk

        research = self.tools.research
        holdings = []
        for sym, pos in self.broker.positions.items():
            sector = ""
            if research is not None:
                f = research.get_fundamentals(sym)
                sector = (f.sector if f else "") or ""
            holdings.append(Holding(sym, pos.qty * self.broker.prices.get(sym, pos.avg_price),
                                    sector))
        pc = self.portfolio_config
        return PortfolioRisk(equity=equity, holdings=holdings,
                             max_invested_pct=pc.max_invested_pct,
                             max_sector_pct=pc.max_sector_pct,
                             max_positions=pc.max_positions,
                             use_sector=research is not None)

    # ------------------------------------------------------------------ #
    @staticmethod
    def fetch_history(symbols, *, benchmark_symbol="SPY", start=None, end=None,
                      timeframe="1Day", provider=None):
        """Fetch real historical bars for ``symbols`` + the benchmark and align
        them on a common set of dates (so there's no look-ahead from gaps).

        Returns (history, benchmark). Symbols with no data are dropped (with a
        note). ``provider`` defaults to the free, keyless yfinance provider.
        """
        if provider is None:
            from ..data import YFinanceDataProvider

            provider = YFinanceDataProvider()

        frames: dict[str, pd.DataFrame] = {}
        for sym in [*symbols, benchmark_symbol]:
            df = provider.get_bars(sym, timeframe=timeframe, start=start, end=end)
            if df is None or df.empty:
                print(f"  (no data for {sym} — skipping)")
                continue
            frames[sym] = df.sort_index()

        return AgentBacktester._align_frames(frames, benchmark_symbol)

    @staticmethod
    def load_csv_history(symbols, *, directory, benchmark_symbol="SPY"):
        """Load historical bars from local CSV files — one per symbol, named
        ``{SYMBOL}.csv`` (plus the benchmark) in ``directory``.

        Each CSV needs a date column and open/high/low/close/volume columns
        (case-insensitive). No network required, so this is the way to backtest
        on real data in a locked-down environment: export prices anywhere, drop
        the CSVs in, and run.
        """
        from pathlib import Path

        directory = Path(directory)
        frames: dict[str, pd.DataFrame] = {}
        for sym in [*symbols, benchmark_symbol]:
            path = directory / f"{sym}.csv"
            if not path.exists():
                print(f"  (no CSV for {sym} at {path} — skipping)")
                continue
            df = pd.read_csv(path)
            df.columns = [c.strip().lower() for c in df.columns]
            date_col = next((c for c in ("date", "timestamp", "time", "datetime")
                             if c in df.columns), None)
            if date_col is None:
                raise ValueError(f"{path}: no date column found")
            df[date_col] = pd.to_datetime(df[date_col])
            df = df.set_index(date_col).sort_index()
            missing = {"open", "high", "low", "close", "volume"} - set(df.columns)
            if missing:
                raise ValueError(f"{path}: missing columns {sorted(missing)}")
            frames[sym] = df[["open", "high", "low", "close", "volume"]]
        return AgentBacktester._align_frames(frames, benchmark_symbol)

    @staticmethod
    def _align_frames(frames: dict[str, pd.DataFrame], benchmark_symbol: str):
        """Align all frames to the dates they share; split off the benchmark."""
        if benchmark_symbol not in frames:
            raise ValueError(f"no data for benchmark {benchmark_symbol}; cannot run")
        common = None
        for df in frames.values():
            common = df.index if common is None else common.intersection(df.index)
        if common is None or len(common) == 0:
            raise ValueError("symbols share no common trading dates")
        aligned = {sym: df.reindex(common) for sym, df in frames.items()}
        benchmark = aligned.pop(benchmark_symbol)
        return aligned, benchmark

    @staticmethod
    def build_synthetic_history(symbols, *, days=400, seed=11):
        """Generate aligned synthetic OHLCV per symbol + a benchmark, for an
        offline, deterministic agent backtest (no network needed)."""
        from ..backtest import generate_synthetic_bars

        history = {}
        for k, sym in enumerate(symbols):
            s = seed + (sum(ord(c) for c in sym) % 50)
            trend = 0.0006 if k % 2 == 0 else 0.0001  # vary winners/laggards
            history[sym] = generate_synthetic_bars(n=days, seed=s, trend=trend)
        benchmark = generate_synthetic_bars(n=days, seed=seed + 999,
                                            trend=0.0004, volatility=0.01)
        return history, benchmark

    def _metrics(self, equity: pd.Series) -> dict:
        start = float(equity.iloc[0]) if len(equity) else self.starting_cash
        end = float(equity.iloc[-1]) if len(equity) else start
        returns = equity.pct_change().dropna()
        sharpe = (float(returns.mean() / returns.std() * math.sqrt(252))
                  if len(returns) > 1 and returns.std() > 0 else 0.0)
        running_max = equity.cummax()
        dd = ((equity - running_max) / running_max)
        return {
            "start_date": str(equity.index[0].date()) if len(equity) else "",
            "end_date": str(equity.index[-1].date()) if len(equity) else "",
            "days": len(equity),
            "start_equity": start,
            "end_equity": end,
            "total_return": (end / self.starting_cash) - 1.0,
            "max_drawdown": float(dd.min()) if len(dd) else 0.0,
            "sharpe": sharpe,
        }
