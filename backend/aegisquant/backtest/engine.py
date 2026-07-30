"""Event-driven backtest engine.

Timing discipline (this is where most backtests quietly cheat):

* Signals for session *t* are computed from data visible **at the close of t**.
* The resulting orders are queued and executed against session **t+1**, arriving
  at its open. Nothing is ever filled at a price that was used to generate the
  signal.
* Protective stops are checked against session *t+1*'s low/high, and a gap
  through the stop fills at the open — not at the stop price.
* Corporate actions are applied on their ex-date, before any trading that day.
* A delisted name is force-closed at its last available price.

The engine reuses the *same* portfolio construction, sizing and risk engine as
paper and live trading, so a backtest is a replay of the real decision path
rather than a parallel implementation of it.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from aegisquant.backtest.costs import CostModel, simulate_fill
from aegisquant.backtest.metrics import (
    PerformanceMetrics,
    compute_metrics,
    regime_metrics,
)
from aegisquant.config import RiskLimits
from aegisquant.db.enums import OrderType, Regime, Side
from aegisquant.features.engine import FeatureBundle, compute_bundle
from aegisquant.features.market_view import MarketView
from aegisquant.logging_setup import get_logger
from aegisquant.portfolio.construction import construct_portfolio
from aegisquant.portfolio.sizing import quantity_from_weight, reduction_fraction
from aegisquant.risk.engine import (
    AccountSnapshot,
    OrderIntent,
    PositionSnapshot,
    RiskEngine,
    derive_risk_state,
)
from aegisquant.strategies import regime as regime_mod
from aegisquant.strategies.base import OpenPositionState, Strategy, StrategyContext
from aegisquant.strategies.ensemble import (
    AllocationConfig,
    SleevePerformance,
    allocate,
)
from aegisquant.strategies.registry import build_all, get_strategy
from aegisquant.utils.money import ZERO, D, safe_div

log = get_logger(__name__)


# ---------------------------------------------------------------------------
@dataclass(slots=True)
class BacktestConfig:
    start: date
    end: date
    starting_cash: Decimal = Decimal("100000")
    universe: list[str] = field(default_factory=list)
    strategy_keys: list[str] = field(default_factory=list)
    strategy_params: dict[str, dict[str, Any]] = field(default_factory=dict)
    benchmark: str = "SPY"
    label: str = "backtest"
    cost_model: CostModel = field(default_factory=CostModel)
    limits: RiskLimits = field(default_factory=RiskLimits)
    #: Sessions between full re-evaluations. 1 = every session.
    rebalance_interval_days: int = 5
    #: Sessions between thesis reviews of open positions. Protective and trailing
    #: stops are always checked every session regardless of this setting; this
    #: governs only the slower fundamental/relative-strength re-examination.
    review_interval_days: int = 1
    #: Sessions between ensemble weight updates.
    ensemble_update_days: int = 21
    order_type: OrderType = OrderType.LIMIT
    #: Limit orders are placed this far through the reference price.
    limit_slippage_pct: Decimal = Decimal("0.003")
    #: Cap on new positions opened per rebalance.
    max_new_positions_per_cycle: int = 3
    #: Warm-up sessions before the first trade (features need history).
    warmup_sessions: int = 260
    risk_free_annual: float = 0.0
    apply_trailing_stops: bool = True
    seed: int = 7

    def as_dict(self) -> dict[str, Any]:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "starting_cash": str(self.starting_cash),
            "universe": self.universe,
            "strategy_keys": self.strategy_keys,
            "strategy_params": self.strategy_params,
            "benchmark": self.benchmark,
            "rebalance_interval_days": self.rebalance_interval_days,
            "review_interval_days": self.review_interval_days,
            "ensemble_update_days": self.ensemble_update_days,
            "order_type": self.order_type.value,
            "limit_slippage_pct": str(self.limit_slippage_pct),
            "max_new_positions_per_cycle": self.max_new_positions_per_cycle,
            "warmup_sessions": self.warmup_sessions,
            "apply_trailing_stops": self.apply_trailing_stops,
            "seed": self.seed,
        }


@dataclass(slots=True)
class SimPosition:
    symbol: str
    quantity: Decimal = ZERO
    avg_price: Decimal = ZERO
    cost_basis: Decimal = ZERO
    entry_date: date | None = None
    peak_price: Decimal = ZERO
    trough_price: Decimal = ZERO
    strategy_key: str | None = None
    thesis: str = ""
    exit_criteria: dict[str, Any] = field(default_factory=dict)
    stop_price: Decimal | None = None
    trailing_stop_pct: Decimal | None = None
    target_weight: Decimal = ZERO
    realized_pnl: Decimal = ZERO
    total_costs: Decimal = ZERO
    holding_sessions: int = 0
    entry_price_first: Decimal = ZERO
    mae_pct: Decimal = ZERO
    mfe_pct: Decimal = ZERO

    def market_value(self, price: Decimal) -> Decimal:
        return self.quantity * price

    def unrealized_pct(self, price: Decimal) -> Decimal:
        if self.avg_price <= 0:
            return ZERO
        return safe_div(price - self.avg_price, self.avg_price)


@dataclass(slots=True)
class PendingOrder:
    symbol: str
    side: Side
    quantity: Decimal
    order_type: OrderType
    limit_price: Decimal | None
    stop_price: Decimal | None
    strategy_key: str | None
    reason: str
    reduce_only: bool = False
    reference_price: Decimal = ZERO
    thesis: str = ""
    exit_criteria: dict[str, Any] = field(default_factory=dict)
    trailing_stop_pct: Decimal | None = None
    target_weight: Decimal = ZERO
    risk_verdict: dict[str, Any] | None = None
    signal_inputs: dict[str, Any] = field(default_factory=dict)
    confidence: Decimal = ZERO
    expected_return: Decimal | None = None
    expected_holding_days: int = 60
    created_on: date | None = None


@dataclass(slots=True)
class BacktestResult:
    config: BacktestConfig
    dates: list[date] = field(default_factory=list)
    equity: list[float] = field(default_factory=list)
    cash: list[float] = field(default_factory=list)
    benchmark: list[float] = field(default_factory=list)
    gross_exposure: list[float] = field(default_factory=list)
    net_exposure: list[float] = field(default_factory=list)
    drawdown: list[float] = field(default_factory=list)
    position_counts: list[int] = field(default_factory=list)
    turnover: list[float] = field(default_factory=list)
    regimes: list[str | None] = field(default_factory=list)
    trades: list[dict[str, Any]] = field(default_factory=list)
    rejected_orders: list[dict[str, Any]] = field(default_factory=list)
    decisions: list[dict[str, Any]] = field(default_factory=list)
    metrics: PerformanceMetrics | None = None
    benchmark_metrics: PerformanceMetrics | None = None
    regime_breakdown: dict[str, Any] = field(default_factory=dict)
    diagnostics: dict[str, Any] = field(default_factory=dict)
    uses_synthetic_data: bool = False
    duration_ms: int = 0

    def summary(self) -> dict[str, Any]:
        return {
            "label": self.config.label,
            "start": self.config.start.isoformat(),
            "end": self.config.end.isoformat(),
            "sessions": len(self.dates),
            "trades": len(self.trades),
            "rejected_orders": len(self.rejected_orders),
            "metrics": self.metrics.as_dict() if self.metrics else None,
            "benchmark_metrics": self.benchmark_metrics.as_dict() if self.benchmark_metrics else None,
            "regime_breakdown": self.regime_breakdown,
            "diagnostics": self.diagnostics,
            "uses_synthetic_data": self.uses_synthetic_data,
            "duration_ms": self.duration_ms,
        }


# ---------------------------------------------------------------------------
class BacktestEngine:
    """Replays the full decision path over history, one session at a time."""

    def __init__(self, view: MarketView, config: BacktestConfig) -> None:
        self.view = view
        self.config = config
        self.risk_engine = RiskEngine(config.limits)
        keys = config.strategy_keys or None
        self.strategies: list[Strategy] = (
            [get_strategy(k, config.strategy_params.get(k)) for k in keys]
            if keys
            else build_all(config.strategy_params)
        )
        self.sizing_methods = {s.meta.key: s.meta.sizing_method for s in self.strategies}

        self.cash: Decimal = config.starting_cash
        self.positions: dict[str, SimPosition] = {}
        self.pending: list[PendingOrder] = []
        self.result = BacktestResult(config=config)
        self.high_water_mark: Decimal = config.starting_cash
        self.day_start_equity: Decimal = config.starting_cash
        self.week_start_equity: Decimal = config.starting_cash
        self.turnover_today: Decimal = ZERO
        self._strategy_weights: dict[str, Decimal] = {}
        self._last_ensemble_update: datetime | None = None
        self._sleeve_returns: dict[str, list[float]] = defaultdict(list)
        self._sleeve_trades: dict[str, list[float]] = defaultdict(list)
        self._prev_regime: Regime | None = None
        self._benchmark_shares: Decimal = ZERO
        self._feature_cache: dict[date, FeatureBundle] = {}

    # ------------------------------------------------------------------
    def run(self) -> BacktestResult:
        started = time.monotonic()
        sessions = [ts for ts in self.view.sessions() if self.config.start <= ts.date() <= self.config.end]
        if len(sessions) < 30:
            self.result.diagnostics["error"] = f"only {len(sessions)} sessions in range — not enough data to backtest"
            return self.result

        bench = self.config.benchmark.upper()
        self.result.uses_synthetic_data = any(s.synthetic for s in self.view.series.values())

        prev_equity = self.config.starting_cash
        last_rebalance_index = -(10**9)
        last_review_index = -(10**9)

        for index, ts in enumerate(sessions):
            session_date = ts.date()

            # ---- 1. corporate actions take effect before trading ----
            self._apply_corporate_actions(session_date)

            # ---- 2. execute orders queued at the previous close ----
            self._execute_pending(session_date)

            # ---- 3. protective stops against this session's range ----
            self._check_stops(session_date)

            # ---- 4. delistings force a close ----
            self._handle_delistings(session_date)

            # ---- 5. mark to market at the close ----
            prices = self._closes(session_date)
            equity = self._equity(prices)
            self.high_water_mark = max(self.high_water_mark, equity)
            drawdown = safe_div(equity - self.high_water_mark, self.high_water_mark)

            # ---- 6. decide (only after warm-up, on the rebalance cadence) ----
            pit = self.view.at(ts)
            regime_label: str | None = None
            warm = index >= 0 and pit.has(bench, min_bars=self.config.warmup_sessions)
            due = (index - last_rebalance_index) >= self.config.rebalance_interval_days
            review_due = (index - last_review_index) >= self.config.review_interval_days
            if warm and (due or review_due):
                bundle = self._features(session_date, ts)
                assessment = regime_mod.classify(bundle.market, self._prev_regime)
                self._prev_regime = assessment.regime
                regime_label = assessment.regime.value
                self._update_ensemble(ts, assessment.regime)

                ctx = self._context(ts, pit, bundle, assessment, equity, prices)
                if review_due and self.positions:
                    self._review_positions(ctx, prices, session_date)
                    last_review_index = index
                if due:
                    self._generate_entries(ctx, pit, bundle, assessment, equity, prices, session_date)
                    last_rebalance_index = index

            # ---- 7. record ----
            gross = sum(
                (abs(p.market_value(prices.get(p.symbol, p.avg_price))) for p in self.positions.values()),
                ZERO,
            )
            net = sum(
                (p.market_value(prices.get(p.symbol, p.avg_price)) for p in self.positions.values()),
                ZERO,
            )
            self.result.dates.append(session_date)
            self.result.equity.append(float(equity))
            self.result.cash.append(float(self.cash))
            self.result.gross_exposure.append(float(safe_div(gross, equity)))
            self.result.net_exposure.append(float(safe_div(net, equity)))
            self.result.drawdown.append(float(drawdown))
            self.result.position_counts.append(len(self.positions))
            self.result.turnover.append(float(safe_div(self.turnover_today, equity)))
            self.result.regimes.append(regime_label)
            self.result.benchmark.append(float(self._benchmark_value(session_date, prices)))

            # sleeve attribution: daily return contribution per strategy
            if prev_equity > 0:
                total_ret = float(safe_div(equity - prev_equity, prev_equity))
                by_sleeve = self._sleeve_weights(prices, equity)
                for key, weight in by_sleeve.items():
                    self._sleeve_returns[key].append(total_ret * float(weight))
            prev_equity = equity

            for p in self.positions.values():
                p.holding_sessions += 1
            self.turnover_today = ZERO
            if session_date.weekday() == 0:
                self.week_start_equity = equity
            self.day_start_equity = equity

        self._finalize()
        self.result.duration_ms = int((time.monotonic() - started) * 1000)
        return self.result

    # ------------------------------------------------------------------
    # market mechanics
    # ------------------------------------------------------------------
    def _bar(self, symbol: str, session_date: date) -> dict[str, Decimal] | None:
        series = self.view.series.get(symbol.upper())
        if series is None:
            return None
        import numpy as np

        target = np.datetime64(datetime.combine(session_date, datetime.max.time()))
        idx = int(np.searchsorted(series.ts, target, side="right")) - 1
        if idx < 0:
            return None
        bar_date = series.ts[idx].astype("datetime64[D]").astype(date)
        if bar_date != session_date:
            return None
        return {
            "open": D(series.open[idx]),
            "high": D(series.high[idx]),
            "low": D(series.low[idx]),
            "close": D(series.close[idx]),
            "volume": D(series.volume[idx]),
        }

    def _closes(self, session_date: date) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for symbol in set(list(self.positions) + [self.config.benchmark.upper()]):
            bar = self._bar(symbol, session_date)
            if bar:
                out[symbol] = bar["close"]
            elif symbol in self.positions:
                out[symbol] = self.positions[symbol].avg_price  # last known
        return out

    def _equity(self, prices: dict[str, Decimal]) -> Decimal:
        value = self.cash
        for pos in self.positions.values():
            price = prices.get(pos.symbol, pos.avg_price)
            value += pos.market_value(price)
        return value

    def _benchmark_value(self, session_date: date, prices: dict[str, Decimal]) -> Decimal:
        """Buy-and-hold benchmark starting from the same cash.

        Split-aware: the share count is multiplied on each split ex-date, exactly
        as a real holder's would be. Without this a 4:1 split would show up as a
        75% benchmark loss. Dividends are not reinvested, so this is a price
        index — stated in the documentation alongside the comparison.
        """
        bench = self.config.benchmark.upper()
        price = prices.get(bench) or (self._bar(bench, session_date) or {}).get("close")
        if price is None or price <= 0:
            return D(self.result.benchmark[-1]) if self.result.benchmark else self.config.starting_cash
        if self._benchmark_shares == 0:
            self._benchmark_shares = self.config.starting_cash / price
        else:
            adjustment = self.view.series[bench].adjustment if bench in self.view.series else "raw"
            if adjustment == "raw":
                for action in self.view.corporate_actions.get(bench, []):
                    if action["ex_date"] == session_date and action["action_type"] == "split" and action["ratio"]:
                        self._benchmark_shares *= D(action["ratio"])
        return self._benchmark_shares * price

    def _apply_corporate_actions(self, session_date: date) -> None:
        """Apply splits and dividends on their ex-date.

        Whether an action must be applied depends on how the price series is
        adjusted, and getting this wrong is a classic source of fictitious
        returns: applying a 4:1 split to positions while the price history is
        already back-adjusted quadruples the position's value out of nothing.

        ``raw``             apply splits to the position and credit dividends
        ``split_only``     splits already in the price; credit dividends only
        ``split_dividend`` both already in the price; apply neither
        """
        for symbol, pos in list(self.positions.items()):
            adjustment = self.view.series[symbol].adjustment if symbol in self.view.series else "raw"
            apply_splits = adjustment == "raw"
            apply_dividends = adjustment in ("raw", "split_only")
            for action in self.view.corporate_actions.get(symbol, []):
                if action["ex_date"] != session_date:
                    continue
                if action["action_type"] == "split" and action["ratio"] and apply_splits:
                    ratio = D(action["ratio"])
                    if ratio > 0:
                        pos.quantity *= ratio
                        pos.avg_price /= ratio
                        if pos.stop_price:
                            pos.stop_price /= ratio
                        pos.peak_price /= ratio
                        pos.entry_price_first /= ratio
                elif action["action_type"] == "dividend" and action["cash_amount"] and apply_dividends:
                    cash = D(action["cash_amount"]) * pos.quantity
                    self.cash += cash
                    pos.realized_pnl += cash

    def _handle_delistings(self, session_date: date) -> None:
        for symbol, pos in list(self.positions.items()):
            meta = self.view.instruments.get(symbol, {})
            delisted_on = meta.get("delisted_on")
            if delisted_on and delisted_on <= session_date and pos.quantity > 0:
                bar = self._bar(symbol, session_date)
                price = bar["close"] if bar else pos.avg_price
                self._close_position(symbol, price, session_date, "delisted", full=True)

    def _execute_pending(self, session_date: date) -> None:
        queued, self.pending = self.pending, []
        for order in queued:
            bar = self._bar(order.symbol, session_date)
            if bar is None:
                self.result.rejected_orders.append(
                    {
                        "date": session_date.isoformat(),
                        "symbol": order.symbol,
                        "side": order.side.value,
                        "quantity": str(order.quantity),
                        "reason": "no bar for the execution session (halt, holiday or missing data)",
                    }
                )
                continue

            instrument = self.view.instruments.get(order.symbol, {})
            fill = simulate_fill(
                side=order.side,
                order_type=order.order_type,
                quantity=order.quantity,
                bar_open=bar["open"],
                bar_high=bar["high"],
                bar_low=bar["low"],
                bar_close=bar["close"],
                bar_volume=bar["volume"],
                cost_model=self.config.cost_model,
                limit_price=order.limit_price,
                stop_price=order.stop_price,
                daily_vol=None,
                dollar_volume=bar["close"] * bar["volume"],
                shortable=bool(instrument.get("shortable")),
                reference_price=order.reference_price or bar["open"],
            )
            if not fill.filled:
                self.result.rejected_orders.append(
                    {
                        "date": session_date.isoformat(),
                        "symbol": order.symbol,
                        "side": order.side.value,
                        "quantity": str(order.quantity),
                        "reason": fill.reject_reason or "not filled",
                        "order_type": order.order_type.value,
                        "limit_price": str(order.limit_price) if order.limit_price else None,
                    }
                )
                continue

            if order.side is Side.BUY:
                cost = fill.notional + fill.commission
                if cost > self.cash:
                    # Never allow implicit leverage: shrink to affordable size.
                    affordable = ((self.cash - fill.commission) / fill.fill_price).quantize(
                        Decimal("1") if not self.config.cost_model.allow_fractional else Decimal("0.000001"),
                        rounding="ROUND_DOWN",
                    )
                    if affordable <= 0:
                        self.result.rejected_orders.append(
                            {
                                "date": session_date.isoformat(),
                                "symbol": order.symbol,
                                "side": "buy",
                                "quantity": str(order.quantity),
                                "reason": f"insufficient cash (${self.cash:,.2f})",
                            }
                        )
                        continue
                    fill.filled_quantity = affordable
                self._apply_buy(order, fill, session_date)
            else:
                self._apply_sell(order, fill, session_date)

            self.turnover_today += fill.notional

    def _apply_buy(self, order: PendingOrder, fill: Any, session_date: date) -> None:
        pos = self.positions.get(order.symbol)
        notional = fill.filled_quantity * fill.fill_price
        total_cost = notional + fill.commission
        self.cash -= total_cost
        if pos is None:
            pos = SimPosition(
                symbol=order.symbol,
                entry_date=session_date,
                strategy_key=order.strategy_key,
                thesis=order.thesis,
                exit_criteria=order.exit_criteria,
                trailing_stop_pct=order.trailing_stop_pct,
                target_weight=order.target_weight,
                entry_price_first=fill.fill_price,
                peak_price=fill.fill_price,
                trough_price=fill.fill_price,
            )
            self.positions[order.symbol] = pos
        new_qty = pos.quantity + fill.filled_quantity
        pos.avg_price = safe_div(pos.cost_basis + notional, new_qty) if new_qty else ZERO
        pos.cost_basis += notional
        pos.quantity = new_qty
        pos.total_costs += fill.commission + fill.spread_cost + fill.impact_cost
        pos.peak_price = max(pos.peak_price, fill.fill_price)
        stop_pct = order.exit_criteria.get("stop_loss_pct")
        if stop_pct:
            pos.stop_price = fill.fill_price * (Decimal(1) - D(stop_pct))
        self.result.decisions.append(
            {
                "date": session_date.isoformat(),
                "symbol": order.symbol,
                "action": "BUY",
                "quantity": str(fill.filled_quantity),
                "price": str(fill.fill_price),
                "strategy": order.strategy_key,
                "confidence": str(order.confidence),
                "reason": order.reason,
                "thesis": order.thesis,
                "partial": fill.partial,
                "slippage_bps": str(fill.slippage_bps),
                "costs": str(fill.total_cost),
                "risk_verdict": order.risk_verdict,
            }
        )

    def _apply_sell(self, order: PendingOrder, fill: Any, session_date: date) -> None:
        pos = self.positions.get(order.symbol)
        if pos is None or pos.quantity <= 0:
            return
        qty = min(fill.filled_quantity, pos.quantity)
        proceeds = qty * fill.fill_price - fill.commission
        self.cash += proceeds
        cost_share = safe_div(pos.cost_basis, pos.quantity) * qty
        gross_pnl = qty * fill.fill_price - cost_share
        costs = fill.commission + fill.spread_cost + fill.impact_cost
        pos.realized_pnl += gross_pnl - fill.commission
        pos.total_costs += costs
        pos.cost_basis -= cost_share
        pos.quantity -= qty

        holding_days = (session_date - pos.entry_date).days if pos.entry_date else 0
        self.result.trades.append(
            {
                "symbol": order.symbol,
                "strategy_key": pos.strategy_key,
                "side": "buy",  # the round trip was long
                "entry_at": pos.entry_date.isoformat() if pos.entry_date else None,
                "exit_at": session_date.isoformat(),
                "quantity": str(qty),
                "entry_price": str(pos.avg_price),
                "exit_price": str(fill.fill_price),
                "gross_pnl": float(gross_pnl),
                "costs": float(costs),
                "net_pnl": float(gross_pnl - fill.commission),
                "return_pct": float(safe_div(gross_pnl - fill.commission, cost_share)) if cost_share else 0.0,
                "holding_days": holding_days,
                "exit_reason": order.reason,
                "mae_pct": float(pos.mae_pct),
                "mfe_pct": float(pos.mfe_pct),
                "partial": fill.partial,
                "slippage_bps": float(fill.slippage_bps),
            }
        )
        if pos.strategy_key:
            self._sleeve_trades[pos.strategy_key].append(
                float(safe_div(gross_pnl - fill.commission, cost_share)) if cost_share else 0.0
            )
        self.result.decisions.append(
            {
                "date": session_date.isoformat(),
                "symbol": order.symbol,
                "action": "SELL",
                "quantity": str(qty),
                "price": str(fill.fill_price),
                "strategy": pos.strategy_key,
                "reason": order.reason,
                "net_pnl": float(gross_pnl - fill.commission),
                "slippage_bps": str(fill.slippage_bps),
                "risk_verdict": order.risk_verdict,
            }
        )
        if pos.quantity <= 0:
            self.positions.pop(order.symbol, None)

    def _close_position(self, symbol: str, price: Decimal, session_date: date, reason: str, full: bool = True) -> None:
        pos = self.positions.get(symbol)
        if pos is None or pos.quantity <= 0:
            return
        qty = pos.quantity if full else pos.quantity / Decimal(2)
        order = PendingOrder(
            symbol=symbol,
            side=Side.SELL,
            quantity=qty,
            order_type=OrderType.MARKET,
            limit_price=None,
            stop_price=None,
            strategy_key=pos.strategy_key,
            reason=reason,
            reduce_only=True,
            reference_price=price,
        )
        fill = type(
            "ImmediateFill",
            (),
            {
                "filled_quantity": qty,
                "fill_price": price,
                "commission": self.config.cost_model.commission(qty, qty * price, Side.SELL),
                "spread_cost": ZERO,
                "impact_cost": ZERO,
                "slippage_bps": ZERO,
                "partial": False,
                "notional": qty * price,
                "total_cost": ZERO,
            },
        )()
        self._apply_sell(order, fill, session_date)

    def _check_stops(self, session_date: date) -> None:
        for symbol, pos in list(self.positions.items()):
            bar = self._bar(symbol, session_date)
            if bar is None:
                continue
            # Track excursions for post-trade analysis.
            if pos.avg_price > 0:
                pos.mae_pct = min(pos.mae_pct, safe_div(bar["low"] - pos.avg_price, pos.avg_price))
                pos.mfe_pct = max(pos.mfe_pct, safe_div(bar["high"] - pos.avg_price, pos.avg_price))
            pos.peak_price = max(pos.peak_price, bar["high"])

            triggered: tuple[Decimal, str] | None = None
            if pos.stop_price and bar["low"] <= pos.stop_price:
                triggered = (pos.stop_price, f"protective stop at {pos.stop_price} triggered")
            if self.config.apply_trailing_stops and pos.trailing_stop_pct and pos.peak_price > 0:
                trail_level = pos.peak_price * (Decimal(1) - pos.trailing_stop_pct)
                if bar["low"] <= trail_level:
                    triggered = (
                        trail_level,
                        f"trailing stop {pos.trailing_stop_pct:.0%} below the {pos.peak_price} peak triggered",
                    )
            if triggered is None:
                continue
            level, reason = triggered
            # A stop is not a guaranteed price: if the bar opened below the
            # level, the fill happens at the open.
            fill_price = bar["open"] if bar["open"] <= level else level
            if bar["open"] <= level:
                reason += f" — gapped through the stop, filled at the {bar['open']} open"
            self._close_position(symbol, fill_price, session_date, reason, full=True)

    # ------------------------------------------------------------------
    # decision path
    # ------------------------------------------------------------------
    def _features(self, session_date: date, ts: datetime) -> FeatureBundle:
        cached = self._feature_cache.get(session_date)
        if cached is not None:
            return cached
        bundle = compute_bundle(
            self.view,
            ts,
            min_price=float(self.config.limits.min_price),
            min_adv_usd=float(self.config.limits.min_adv_usd),
        )
        self._feature_cache = {session_date: bundle}  # only the current day is needed
        return bundle

    def _sleeve_weights(self, prices: dict[str, Decimal], equity: Decimal) -> dict[str, Decimal]:
        out: dict[str, Decimal] = defaultdict(lambda: ZERO)
        if equity <= 0:
            return out
        for pos in self.positions.values():
            if not pos.strategy_key:
                continue
            price = prices.get(pos.symbol, pos.avg_price)
            out[pos.strategy_key] += safe_div(pos.market_value(price), equity)
        return out

    def _update_ensemble(self, ts: datetime, regime: Regime) -> None:
        import numpy as np

        if (
            self._last_ensemble_update is not None
            and (ts - self._last_ensemble_update).days < self.config.ensemble_update_days
        ):
            return
        performance = {}
        for strategy in self.strategies:
            key = strategy.meta.key
            rets = np.array(self._sleeve_returns.get(key, []), dtype=float)
            trades = self._sleeve_trades.get(key, [])
            perf = SleevePerformance(
                strategy_key=key,
                trades=len(trades),
                days_live=int(rets.size),
                net_return=float(np.prod(1 + rets) - 1) if rets.size else 0.0,
                avg_return_per_trade=float(np.mean(trades)) if trades else 0.0,
                daily_returns=rets,
            )
            if rets.size >= 20 and float(np.std(rets, ddof=1)) > 0:
                perf.sharpe = float(np.mean(rets) / np.std(rets, ddof=1) * np.sqrt(252))
                equity_curve = np.cumprod(1 + rets)
                peak = np.maximum.accumulate(equity_curve)
                perf.max_drawdown = float(np.min(equity_curve / peak - 1))
            performance[key] = perf

        allocation = allocate(
            ts,
            self.strategies,
            performance,
            regime,
            previous_weights=self._strategy_weights,
            last_update=self._last_ensemble_update,
            config=AllocationConfig(update_interval_days=self.config.ensemble_update_days),
        )
        if allocation.updated:
            self._strategy_weights = allocation.weights()
            self._last_ensemble_update = ts

    def _context(
        self,
        ts: datetime,
        pit: Any,
        bundle: FeatureBundle,
        assessment: Any,
        equity: Decimal,
        prices: dict[str, Decimal],
    ) -> StrategyContext:
        open_positions = {}
        for symbol, pos in self.positions.items():
            price = prices.get(symbol, pos.avg_price)
            open_positions[symbol] = OpenPositionState(
                symbol=symbol,
                quantity=float(pos.quantity),
                avg_entry_price=float(pos.avg_price),
                last_price=float(price),
                unrealized_pnl_pct=float(pos.unrealized_pct(price)),
                holding_days=(ts.date() - pos.entry_date).days if pos.entry_date else 0,
                peak_price=float(pos.peak_price),
                weight=float(safe_div(pos.market_value(price), equity)),
                strategy_key=pos.strategy_key,
                entry_thesis=pos.thesis,
                exit_criteria=pos.exit_criteria,
            )
        return StrategyContext(
            as_of=ts,
            pit=pit,
            features=bundle,
            regime=assessment.regime,
            regime_score=assessment.score,
            positions=open_positions,
            equity=float(equity),
            cash=float(self.cash),
        )

    def _review_positions(self, ctx: StrategyContext, prices: dict[str, Decimal], session_date: date) -> None:
        by_key = {s.meta.key: s for s in self.strategies}
        for symbol, pos in list(self.positions.items()):
            state = ctx.positions.get(symbol)
            if state is None:
                continue
            strategy = by_key.get(pos.strategy_key or "")
            if strategy is None:
                continue
            review = strategy.review(ctx, state)
            if review.action in ("hold", "add"):
                continue
            fraction, _ = reduction_fraction(review.thesis_status, D(1) - D(review.target_fraction))
            if review.action == "exit":
                qty = pos.quantity
            else:
                qty = (pos.quantity * (Decimal(1) - D(review.target_fraction))).quantize(
                    Decimal("1") if not self.config.cost_model.allow_fractional else Decimal("0.000001"),
                    rounding="ROUND_DOWN",
                )
            if qty <= 0:
                continue
            price = prices.get(symbol, pos.avg_price)
            self.pending.append(
                PendingOrder(
                    symbol=symbol,
                    side=Side.SELL,
                    quantity=qty,
                    order_type=OrderType.MARKET,  # exits do not wait for a limit
                    limit_price=None,
                    stop_price=None,
                    strategy_key=pos.strategy_key,
                    reason=review.reason,
                    reduce_only=True,
                    reference_price=price,
                    created_on=session_date,
                    signal_inputs=review.signal_inputs,
                )
            )

    def _generate_entries(
        self,
        ctx: StrategyContext,
        pit: Any,
        bundle: FeatureBundle,
        assessment: Any,
        equity: Decimal,
        prices: dict[str, Decimal],
        session_date: date,
    ) -> None:
        signals = []
        for strategy in self.strategies:
            if not strategy.supports_regime(assessment.regime):
                continue
            try:
                signals.extend(strategy.generate(ctx))
            except Exception:
                log.exception("strategy_generate_failed", strategy=strategy.meta.key)

        if not signals:
            return

        risk_state, _ = derive_risk_state(
            safe_div(equity - self.high_water_mark, self.high_water_mark), self.config.limits
        )
        target = construct_portfolio(
            as_of=ctx.as_of,
            pit=pit,
            features=bundle,
            signals=signals,
            positions=ctx.positions,
            limits=self.config.limits,
            regime=assessment.regime,
            regime_scale=assessment.new_entry_scale,
            concentration_scale=assessment.concentration_scale,
            min_confidence=assessment.min_confidence,
            strategy_weights=self._strategy_weights,
            sizing_methods=self.sizing_methods,
            current_drawdown=safe_div(equity - self.high_water_mark, self.high_water_mark),
            max_new_positions=self.config.max_new_positions_per_cycle,
        )

        account = self._account_snapshot(ctx.as_of, equity, prices, assessment.regime, risk_state)
        for tp in target.targets:
            if tp.delta_weight <= 0:
                continue
            price = prices.get(tp.symbol) or D((self._bar(tp.symbol, session_date) or {}).get("close", 0))
            if price <= 0:
                continue
            quantity = quantity_from_weight(tp.delta_weight, equity, price, self.config.cost_model.allow_fractional)
            if quantity <= 0:
                continue
            sf = bundle.symbols.get(tp.symbol)
            instrument = self.view.instruments.get(tp.symbol, {})
            adv_usd = sf.get("adv_usd_20") if sf else None
            intent = OrderIntent(
                symbol=tp.symbol,
                side=Side.BUY,
                quantity=quantity,
                order_type=self.config.order_type,
                reference_price=price,
                limit_price=(
                    price * (Decimal(1) + self.config.limit_slippage_pct)
                    if self.config.order_type is OrderType.LIMIT
                    else None
                ),
                strategy_key=tp.primary_strategy,
                sector=tp.sector or "Unclassified",
                adv_usd=D(adv_usd) if adv_usd else None,
                adv_shares=D(adv_usd) / price if adv_usd else None,
                asset_vol=tp.expected_vol,
                data_age_seconds=pit.data_age_seconds(tp.symbol) or 0.0,
                data_quality="synthetic" if pit.is_synthetic(tp.symbol) else "ok",
                correlation_to_book=tp.correlation_to_book,
                tradable=bool(instrument.get("tradable", True)),
                shortable=bool(instrument.get("shortable")),
                is_leveraged_etf=bool(instrument.get("is_leveraged_etf")),
                delisted=pit.is_delisted(tp.symbol),
                fractionable=self.config.cost_model.allow_fractional,
                confidence=tp.confidence,
            )
            verdict = self.risk_engine.evaluate(intent, account)
            if not verdict.approved:
                self.result.rejected_orders.append(
                    {
                        "date": session_date.isoformat(),
                        "symbol": tp.symbol,
                        "side": "buy",
                        "quantity": str(quantity),
                        "reason": "; ".join(verdict.rejections[:2]),
                        "stage": "risk_engine",
                    }
                )
                continue
            self.pending.append(
                PendingOrder(
                    symbol=tp.symbol,
                    side=Side.BUY,
                    quantity=verdict.approved_quantity,
                    order_type=self.config.order_type,
                    limit_price=intent.limit_price,
                    stop_price=None,
                    strategy_key=tp.primary_strategy,
                    reason=tp.reason or "new entry from portfolio construction",
                    reference_price=price,
                    thesis=tp.thesis,
                    exit_criteria=tp.exit_criteria,
                    trailing_stop_pct=tp.trailing_stop_pct,
                    target_weight=tp.target_weight,
                    risk_verdict={
                        "approved": True,
                        "resized_by": verdict.resized_by,
                        "warnings": verdict.warnings,
                    },
                    confidence=tp.confidence,
                    expected_return=tp.expected_return,
                    expected_holding_days=tp.expected_holding_days,
                    created_on=session_date,
                )
            )
            # Reflect the pending order in the snapshot so a single cycle cannot
            # approve several orders that each fit but collectively breach a limit.
            account.positions[tp.symbol] = PositionSnapshot(
                symbol=tp.symbol,
                quantity=verdict.approved_quantity
                + (self.positions[tp.symbol].quantity if tp.symbol in self.positions else ZERO),
                market_value=verdict.approved_quantity * price
                + (account.positions[tp.symbol].market_value if tp.symbol in account.positions else ZERO),
                avg_entry_price=price,
                last_price=price,
                sector=tp.sector or "Unclassified",
                strategy_key=tp.primary_strategy,
            )
            account.cash -= verdict.approved_quantity * price
            account.buying_power = account.cash
            account.turnover_today_notional += verdict.approved_quantity * price

    def _account_snapshot(
        self,
        ts: datetime,
        equity: Decimal,
        prices: dict[str, Decimal],
        regime: Regime,
        risk_state: Any,
    ) -> AccountSnapshot:
        positions = {}
        for symbol, pos in self.positions.items():
            price = prices.get(symbol, pos.avg_price)
            positions[symbol] = PositionSnapshot(
                symbol=symbol,
                quantity=pos.quantity,
                market_value=pos.market_value(price),
                avg_entry_price=pos.avg_price,
                last_price=price,
                sector=self.view.sectors.get(symbol, "Unclassified"),
                strategy_key=pos.strategy_key,
                unrealized_pnl=pos.market_value(price) - pos.cost_basis,
            )
        return AccountSnapshot(
            as_of=ts,
            equity=equity,
            cash=self.cash,
            buying_power=self.cash,
            positions=positions,
            day_start_equity=self.day_start_equity,
            week_start_equity=self.week_start_equity,
            high_water_mark=self.high_water_mark,
            turnover_today_notional=self.turnover_today,
            market_open=True,
            session_date=ts.date(),
            regime=regime,
            risk_state=risk_state,
            broker_connected=True,
        )

    # ------------------------------------------------------------------
    def _finalize(self) -> None:
        capacity = self._capacity_estimate()
        self.result.metrics = compute_metrics(
            self.result.dates,
            self.result.equity,
            trades=self.result.trades,
            benchmark_values=self.result.benchmark,
            exposures=self.result.gross_exposure,
            turnovers=self.result.turnover,
            risk_free_annual=self.config.risk_free_annual,
            capacity_estimate_usd=capacity,
            uses_synthetic_data=self.result.uses_synthetic_data,
        )
        self.result.benchmark_metrics = compute_metrics(
            self.result.dates,
            self.result.benchmark,
            uses_synthetic_data=self.result.uses_synthetic_data,
            estimate_drawdown_probabilities=False,
        )
        self.result.regime_breakdown = regime_metrics(self.result.dates, self.result.equity, self.result.regimes)
        by_strategy: dict[str, dict[str, Any]] = {}
        for trade in self.result.trades:
            key = trade.get("strategy_key") or "unattributed"
            entry = by_strategy.setdefault(key, {"trades": 0, "net_pnl": 0.0, "wins": 0, "avg_holding_days": 0.0})
            entry["trades"] += 1
            entry["net_pnl"] += float(trade["net_pnl"])
            entry["wins"] += 1 if float(trade["net_pnl"]) > 0 else 0
            entry["avg_holding_days"] += float(trade.get("holding_days") or 0)
        for entry in by_strategy.values():
            if entry["trades"]:
                entry["avg_holding_days"] /= entry["trades"]
                entry["win_rate"] = entry["wins"] / entry["trades"]

        reject_reasons: dict[str, int] = {}
        for row in self.result.rejected_orders:
            key = (row.get("reason") or "unknown")[:80]
            reject_reasons[key] = reject_reasons.get(key, 0) + 1

        self.result.diagnostics = {
            "strategy_attribution": by_strategy,
            "final_ensemble_weights": {k: str(v) for k, v in self._strategy_weights.items()},
            "rejected_order_reasons": dict(sorted(reject_reasons.items(), key=lambda kv: kv[1], reverse=True)[:15]),
            "final_positions": len(self.positions),
            "final_cash": float(self.cash),
            "sessions": len(self.result.dates),
            "cost_model": self.config.cost_model.as_dict(),
        }

    def _capacity_estimate(self) -> float | None:
        """Deployable capital implied by the ADV participation limit.

        Estimated as: the smallest traded name's dollar volume, times the
        participation cap, divided by the largest single-position weight. It is
        an order-of-magnitude figure, and labelled as such.
        """
        traded = {t["symbol"] for t in self.result.trades}
        if not traded:
            return None
        import numpy as np

        min_adv = None
        for symbol in traded:
            series = self.view.series.get(symbol)
            if series is None or series.close.size < 20:
                continue
            adv = float(np.mean(series.close[-20:] * series.volume[-20:]))
            min_adv = adv if min_adv is None else min(min_adv, adv)
        if not min_adv:
            return None
        participation = float(self.config.cost_model.max_participation)
        max_weight = float(self.config.limits.max_position_pct)
        if max_weight <= 0:
            return None
        return min_adv * participation / max_weight
