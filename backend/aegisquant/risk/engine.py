"""The deterministic risk engine — final authority over every order.

Properties that make this trustworthy:

* **Deterministic.** Pure functions over an explicit snapshot. No network, no
  clock reads beyond what is passed in, no randomness. The same inputs always
  produce the same verdict, which is what makes the audit trail meaningful.
* **No dependency on the model layer.** It does not know what a strategy is. It
  sees a quantity, a price, an account state, and a rule set.
* **Fail closed.** Missing data, an unmeasurable limit or an unexpected error all
  produce a rejection, never an approval.
* **Reduce-only escape hatch.** Risk-reducing orders (closing or trimming a
  position) are evaluated against a deliberately narrower rule set, because
  blocking an exit is itself a risk. They still cannot run while the kill switch
  is engaged in read-only mode.

Nothing else in the platform may place an order. The language model can propose,
explain and critique; it cannot approve.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any

from aegisquant.config import RiskLimits
from aegisquant.db.enums import (
    OrderType,
    Regime,
    RiskCheckResult,
    RiskState,
    Side,
)
from aegisquant.logging_setup import get_logger
from aegisquant.utils.money import D, ZERO, safe_div

log = get_logger(__name__)


# ---------------------------------------------------------------------------
@dataclass(slots=True)
class PositionSnapshot:
    symbol: str
    quantity: Decimal
    market_value: Decimal
    avg_entry_price: Decimal
    last_price: Decimal
    sector: str = "Unclassified"
    strategy_key: str | None = None
    unrealized_pnl: Decimal = ZERO

    @property
    def is_long(self) -> bool:
        return self.quantity > 0


@dataclass(slots=True)
class AccountSnapshot:
    """Everything the engine needs to know about the account, right now."""

    as_of: datetime
    equity: Decimal
    cash: Decimal
    buying_power: Decimal
    positions: dict[str, PositionSnapshot] = field(default_factory=dict)
    open_order_notional: Decimal = ZERO
    open_order_count: int = 0
    oldest_open_order_age_seconds: float | None = None
    day_start_equity: Decimal | None = None
    week_start_equity: Decimal | None = None
    high_water_mark: Decimal | None = None
    realized_pnl_today: Decimal = ZERO
    turnover_today_notional: Decimal = ZERO
    market_open: bool = True
    session_date: date | None = None
    regime: Regime = Regime.NEUTRAL
    risk_state: RiskState = RiskState.NORMAL
    kill_switch: bool = False
    read_only: bool = False
    cooldown_until: datetime | None = None
    trading_halted: bool = False
    halt_reason: str | None = None
    quarantined_symbols: set[str] = field(default_factory=set)
    paused_strategies: set[str] = field(default_factory=set)
    open_data_issues: int = 0
    unresolved_recon_breaks: int = 0
    broker_connected: bool = True

    @property
    def gross_exposure(self) -> Decimal:
        total = sum((abs(p.market_value) for p in self.positions.values()), ZERO)
        return safe_div(total, self.equity)

    @property
    def net_exposure(self) -> Decimal:
        total = sum((p.market_value for p in self.positions.values()), ZERO)
        return safe_div(total, self.equity)

    @property
    def day_pnl_pct(self) -> Decimal:
        if not self.day_start_equity or self.day_start_equity <= 0:
            return ZERO
        return safe_div(self.equity - self.day_start_equity, self.day_start_equity)

    @property
    def week_pnl_pct(self) -> Decimal:
        if not self.week_start_equity or self.week_start_equity <= 0:
            return ZERO
        return safe_div(self.equity - self.week_start_equity, self.week_start_equity)

    @property
    def drawdown_pct(self) -> Decimal:
        if not self.high_water_mark or self.high_water_mark <= 0:
            return ZERO
        return safe_div(self.equity - self.high_water_mark, self.high_water_mark)

    def sector_exposure(self, sector: str) -> Decimal:
        total = sum(
            (abs(p.market_value) for p in self.positions.values() if p.sector == sector), ZERO
        )
        return safe_div(total, self.equity)

    def strategy_exposure(self, strategy_key: str) -> Decimal:
        total = sum(
            (abs(p.market_value) for p in self.positions.values() if p.strategy_key == strategy_key),
            ZERO,
        )
        return safe_div(total, self.equity)


@dataclass(slots=True)
class OrderIntent:
    """A proposed order, before the risk engine has ruled on it."""

    symbol: str
    side: Side
    quantity: Decimal
    order_type: OrderType
    reference_price: Decimal
    limit_price: Decimal | None = None
    stop_price: Decimal | None = None
    strategy_key: str | None = None
    sector: str = "Unclassified"
    reduce_only: bool = False
    #: Market microstructure at decision time.
    adv_usd: Decimal | None = None
    adv_shares: Decimal | None = None
    spread_bps: Decimal | None = None
    estimated_impact_bps: Decimal | None = None
    estimated_total_cost_bps: Decimal | None = None
    asset_vol: Decimal | None = None
    data_age_seconds: float | None = None
    data_quality: str = "ok"
    #: Correlation of this name to the existing book.
    correlation_to_book: Decimal | None = None
    #: Whether the instrument may be traded at all.
    tradable: bool = True
    shortable: bool = False
    is_leveraged_etf: bool = False
    delisted: bool = False
    fractionable: bool = False
    confidence: Decimal = Decimal("0.5")

    @property
    def notional(self) -> Decimal:
        return self.quantity * self.reference_price


@dataclass(slots=True)
class CheckOutcome:
    name: str
    result: RiskCheckResult
    message: str
    observed: Decimal | None = None
    limit_value: Decimal | None = None
    utilization: Decimal | None = None
    detail: dict[str, Any] = field(default_factory=dict)
    #: When RESIZE, the maximum quantity this check permits.
    max_quantity: Decimal | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "result": self.result.value,
            "message": self.message,
            "observed": None if self.observed is None else str(self.observed),
            "limit": None if self.limit_value is None else str(self.limit_value),
            "utilization": None if self.utilization is None else str(self.utilization),
            "detail": self.detail,
            "max_quantity": None if self.max_quantity is None else str(self.max_quantity),
        }


@dataclass(slots=True)
class RiskVerdict:
    approved: bool
    original_quantity: Decimal
    approved_quantity: Decimal
    checks: list[CheckOutcome] = field(default_factory=list)
    rejections: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    resized_by: list[str] = field(default_factory=list)
    explanation: str = ""

    @property
    def was_resized(self) -> bool:
        return self.approved and self.approved_quantity < self.original_quantity

    def as_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "original_quantity": str(self.original_quantity),
            "approved_quantity": str(self.approved_quantity),
            "was_resized": self.was_resized,
            "rejections": self.rejections,
            "warnings": self.warnings,
            "resized_by": self.resized_by,
            "checks": [c.as_dict() for c in self.checks],
            "explanation": self.explanation,
        }

    def utilization_map(self) -> dict[str, str]:
        return {
            c.name: str(c.utilization) for c in self.checks if c.utilization is not None
        }


# ---------------------------------------------------------------------------
class RiskEngine:
    """Evaluates order intents against the configured limits."""

    def __init__(self, limits: RiskLimits | None = None) -> None:
        self.limits = limits or RiskLimits()

    # -- public API ----------------------------------------------------------
    def evaluate(self, intent: OrderIntent, account: AccountSnapshot) -> RiskVerdict:
        """Rule on one order intent. Never raises."""
        try:
            return self._evaluate(intent, account)
        except Exception as exc:  # fail closed on any unexpected error
            log.exception("risk_engine_error", symbol=intent.symbol)
            return RiskVerdict(
                approved=False,
                original_quantity=intent.quantity,
                approved_quantity=ZERO,
                checks=[
                    CheckOutcome(
                        "engine_error",
                        RiskCheckResult.REJECT,
                        f"risk engine raised {type(exc).__name__}: {exc}",
                    )
                ],
                rejections=[f"risk engine error ({type(exc).__name__}) — failing closed"],
                explanation=(
                    "The order was rejected because the risk engine could not complete its "
                    "checks. An unevaluated order is never approved."
                ),
            )

    # -- implementation ------------------------------------------------------
    def _evaluate(self, intent: OrderIntent, account: AccountSnapshot) -> RiskVerdict:
        L = self.limits
        checks: list[CheckOutcome] = []
        max_quantity = intent.quantity

        def add(outcome: CheckOutcome) -> None:
            checks.append(outcome)

        def ok(name: str, message: str, observed: Decimal | None = None,
               limit: Decimal | None = None) -> None:
            util = safe_div(observed, limit) if (observed is not None and limit) else None
            add(CheckOutcome(name, RiskCheckResult.PASS, message, observed, limit, util))

        def reject(name: str, message: str, observed: Decimal | None = None,
                   limit: Decimal | None = None, detail: dict[str, Any] | None = None) -> None:
            util = safe_div(observed, limit) if (observed is not None and limit) else None
            add(CheckOutcome(name, RiskCheckResult.REJECT, message, observed, limit, util, detail or {}))

        def warn(name: str, message: str, observed: Decimal | None = None,
                 limit: Decimal | None = None) -> None:
            util = safe_div(observed, limit) if (observed is not None and limit) else None
            add(CheckOutcome(name, RiskCheckResult.WARN, message, observed, limit, util))

        def resize(name: str, message: str, allowed: Decimal, observed: Decimal | None = None,
                   limit: Decimal | None = None) -> None:
            nonlocal max_quantity
            util = safe_div(observed, limit) if (observed is not None and limit) else None
            add(
                CheckOutcome(
                    name, RiskCheckResult.RESIZE, message, observed, limit, util,
                    max_quantity=allowed,
                )
            )
            max_quantity = min(max_quantity, allowed)

        # =================================================================
        # Gate 1: system state. Applies to every order without exception.
        # =================================================================
        if account.kill_switch:
            reject("kill_switch", "the global kill switch is engaged — all order flow is blocked")
        else:
            ok("kill_switch", "kill switch is not engaged")

        if account.read_only:
            reject("read_only_mode", "the system is in read-only emergency mode")
        else:
            ok("read_only_mode", "system is not read-only")

        if not account.broker_connected:
            reject("broker_connectivity", "the broker connection is down — cannot verify state")
        else:
            ok("broker_connectivity", "broker is connected")

        if intent.symbol.upper() in account.quarantined_symbols:
            reject("symbol_quarantine", f"{intent.symbol} is quarantined")
        else:
            ok("symbol_quarantine", "symbol is not quarantined")

        if intent.strategy_key and intent.strategy_key in account.paused_strategies:
            reject("strategy_paused", f"strategy '{intent.strategy_key}' is paused")
        else:
            ok("strategy_paused", "strategy is active")

        if not account.market_open:
            reject("market_status", "the market is closed")
        else:
            ok("market_status", "market is open")

        # =================================================================
        # Gate 2: instrument eligibility.
        # =================================================================
        if intent.delisted:
            reject("instrument_delisted", f"{intent.symbol} is delisted")
        elif not intent.tradable:
            reject("instrument_tradable", f"{intent.symbol} is not tradable at the broker")
        elif intent.is_leveraged_etf:
            reject(
                "asset_class_allowed",
                f"{intent.symbol} is a leveraged or inverse ETF, which is disabled in version 1",
            )
        else:
            ok("instrument_eligibility", "instrument is tradable and permitted")

        if intent.side is Side.SELL and not intent.reduce_only:
            held = account.positions.get(intent.symbol.upper())
            selling_more_than_held = held is None or intent.quantity > held.quantity
            if selling_more_than_held and not intent.shortable:
                reject(
                    "short_selling",
                    "unrestricted short selling is disabled in version 1 and this order would "
                    "open or extend a short position",
                )
            else:
                ok("short_selling", "order does not open an unpermitted short")

        if intent.quantity <= 0:
            reject("quantity_positive", "order quantity is not positive")
        else:
            ok("quantity_positive", f"quantity {intent.quantity} is positive")

        if not intent.fractionable and intent.quantity != intent.quantity.to_integral_value():
            resize(
                "fractional_shares",
                f"{intent.symbol} does not support fractional shares — rounded down to whole shares",
                intent.quantity.to_integral_value(rounding="ROUND_DOWN"),
            )
        else:
            ok("fractional_shares", "quantity is compatible with the instrument")

        # =================================================================
        # Gate 3: data quality and freshness.
        # =================================================================
        if intent.data_quality in ("corrupt", "missing"):
            reject(
                "data_quality",
                f"market data for {intent.symbol} is flagged '{intent.data_quality}' — "
                "trading on unreliable data is not permitted",
            )
        elif intent.data_quality in ("suspect", "stale"):
            warn("data_quality", f"market data for {intent.symbol} is flagged '{intent.data_quality}'")
        else:
            ok("data_quality", "market data quality is acceptable")

        if intent.data_age_seconds is None:
            reject("data_age", "the age of the price data is unknown — cannot verify freshness")
        elif intent.data_age_seconds > L.max_data_age_seconds:
            reject(
                "data_age",
                f"price data is {intent.data_age_seconds:.0f}s old, beyond the "
                f"{L.max_data_age_seconds}s budget",
                D(intent.data_age_seconds),
                D(L.max_data_age_seconds),
            )
        else:
            ok(
                "data_age",
                f"price data is {intent.data_age_seconds:.0f}s old",
                D(intent.data_age_seconds),
                D(L.max_data_age_seconds),
            )

        if account.open_data_issues > 0:
            warn(
                "open_data_issues",
                f"{account.open_data_issues} unresolved data-quality issue(s) are open",
                D(account.open_data_issues),
            )
        else:
            ok("open_data_issues", "no unresolved data-quality issues")

        if account.unresolved_recon_breaks > 0:
            reject(
                "reconciliation",
                f"{account.unresolved_recon_breaks} unresolved reconciliation break(s) — "
                "local and broker state disagree",
                D(account.unresolved_recon_breaks),
            )
        else:
            ok("reconciliation", "local and broker state agree")

        # =================================================================
        # Gate 4: loss limits and drawdown. Exits stay permitted.
        # =================================================================
        day_pnl = account.day_pnl_pct
        if day_pnl <= -L.max_daily_loss_pct:
            outcome = (
                RiskCheckResult.WARN if intent.reduce_only else RiskCheckResult.REJECT
            )
            add(
                CheckOutcome(
                    "max_daily_loss",
                    outcome,
                    (
                        f"the account is down {day_pnl:.2%} today, at or beyond the "
                        f"{L.max_daily_loss_pct:.2%} limit"
                        + (" — risk-reducing orders remain permitted" if intent.reduce_only else "")
                    ),
                    abs(day_pnl),
                    L.max_daily_loss_pct,
                    safe_div(abs(day_pnl), L.max_daily_loss_pct),
                )
            )
        else:
            ok("max_daily_loss", f"day P&L {day_pnl:.2%}", abs(day_pnl), L.max_daily_loss_pct)

        week_pnl = account.week_pnl_pct
        if week_pnl <= -L.max_weekly_loss_pct and not intent.reduce_only:
            reject(
                "max_weekly_loss",
                f"the account is down {week_pnl:.2%} this week, beyond the "
                f"{L.max_weekly_loss_pct:.2%} limit",
                abs(week_pnl),
                L.max_weekly_loss_pct,
            )
        else:
            ok("max_weekly_loss", f"week P&L {week_pnl:.2%}", abs(week_pnl), L.max_weekly_loss_pct)

        dd = account.drawdown_pct
        if dd <= -L.max_portfolio_drawdown_pct and not intent.reduce_only:
            reject(
                "max_drawdown",
                f"portfolio drawdown {dd:.2%} is at or beyond the "
                f"{L.max_portfolio_drawdown_pct:.2%} limit",
                abs(dd),
                L.max_portfolio_drawdown_pct,
            )
        else:
            ok("max_drawdown", f"drawdown {dd:.2%}", abs(dd), L.max_portfolio_drawdown_pct)

        if account.trading_halted and not intent.reduce_only:
            reject(
                "trading_halt",
                f"trading is halted for the session: {account.halt_reason or 'no reason recorded'}",
            )
        else:
            ok("trading_halt", "no trading halt in force")

        if account.cooldown_until and account.as_of < account.cooldown_until and not intent.reduce_only:
            remaining = (account.cooldown_until - account.as_of).total_seconds() / 3600
            reject(
                "loss_cooldown",
                f"a post-loss cooldown is active for another {remaining:.1f} hours",
            )
        else:
            ok("loss_cooldown", "no cooldown active")

        if account.risk_state in (RiskState.EMERGENCY, RiskState.READ_ONLY) and not intent.reduce_only:
            reject(
                "risk_state",
                f"the account is in the {account.risk_state.value} risk state — "
                "new risk may not be added",
            )
        elif account.risk_state is RiskState.DEFENSIVE_2 and not intent.reduce_only:
            reject(
                "risk_state",
                "the account is in defensive stage two — closing weak positions only, no new entries",
            )
        elif account.risk_state is RiskState.DEFENSIVE_1 and not intent.reduce_only:
            resize(
                "risk_state",
                "defensive stage one — new position sizes are halved",
                (intent.quantity / Decimal(2)).quantize(Decimal("0.000001")),
            )
        elif account.risk_state is RiskState.WARNING and not intent.reduce_only:
            resize(
                "risk_state",
                "drawdown warning state — new position sizes are reduced by a quarter",
                (intent.quantity * Decimal("0.75")).quantize(Decimal("0.000001")),
            )
        else:
            ok("risk_state", f"risk state is {account.risk_state.value}")

        if account.regime is Regime.RISK_OFF and not intent.reduce_only and intent.side is Side.BUY:
            reject(
                "market_regime",
                "the market regime is risk-off — no new long entries are permitted",
            )
        else:
            ok("market_regime", f"regime is {account.regime.value}")

        # =================================================================
        # Gate 5: sizing and exposure. Only applies to risk-increasing orders.
        # =================================================================
        equity = account.equity
        if equity <= 0:
            reject("account_equity", "account equity is not positive")
            return self._finalize(intent, checks, max_quantity)

        existing = account.positions.get(intent.symbol.upper())
        existing_value = abs(existing.market_value) if existing else ZERO

        if intent.reduce_only or intent.side is Side.SELL:
            ok("position_size", "risk-reducing order — position-size limits do not apply")
            ok("gross_exposure", "risk-reducing order — exposure limits do not apply")
            ok("sector_exposure", "risk-reducing order — sector limits do not apply")
            ok("buying_power", "risk-reducing order — buying power is not consumed")
            if existing is not None and intent.quantity > existing.quantity:
                resize(
                    "reduce_only_bound",
                    f"cannot sell {intent.quantity} of a {existing.quantity}-share position",
                    existing.quantity,
                )
            else:
                ok("reduce_only_bound", "quantity does not exceed the held position")
        else:
            notional = intent.notional
            # --- min notional ---
            if notional < L.min_order_notional:
                reject(
                    "min_order_notional",
                    f"order notional ${notional:,.2f} is below the ${L.min_order_notional} minimum "
                    "— costs would dominate",
                    notional,
                    L.min_order_notional,
                )
            else:
                ok("min_order_notional", f"notional ${notional:,.2f}", notional, L.min_order_notional)

            # --- max order notional ---
            max_order_value = L.max_order_notional_pct * equity
            if notional > max_order_value:
                allowed = (max_order_value / intent.reference_price).quantize(Decimal("0.000001"))
                resize(
                    "max_order_notional",
                    f"order notional ${notional:,.2f} exceeds the "
                    f"{L.max_order_notional_pct:.1%} of equity cap (${max_order_value:,.2f})",
                    allowed,
                    notional,
                    max_order_value,
                )
            else:
                ok("max_order_notional", f"notional within cap", notional, max_order_value)

            # --- position size ---
            projected_value = existing_value + notional
            max_position_value = L.max_position_pct * equity
            if projected_value > max_position_value:
                headroom = max_position_value - existing_value
                if headroom <= 0:
                    reject(
                        "max_position_pct",
                        f"{intent.symbol} is already at the {L.max_position_pct:.1%} single-name "
                        f"limit (${existing_value:,.2f} of ${max_position_value:,.2f})",
                        safe_div(existing_value, equity),
                        L.max_position_pct,
                    )
                else:
                    allowed = (headroom / intent.reference_price).quantize(Decimal("0.000001"))
                    resize(
                        "max_position_pct",
                        f"the position would reach {safe_div(projected_value, equity):.2%} of equity, "
                        f"above the {L.max_position_pct:.1%} single-name limit",
                        allowed,
                        safe_div(projected_value, equity),
                        L.max_position_pct,
                    )
            else:
                ok(
                    "max_position_pct",
                    f"position would be {safe_div(projected_value, equity):.2%} of equity",
                    safe_div(projected_value, equity),
                    L.max_position_pct,
                )

            # --- risk per trade (to the stop) ---
            stop_distance = None
            if intent.stop_price and intent.reference_price > 0:
                stop_distance = abs(
                    safe_div(intent.reference_price - intent.stop_price, intent.reference_price)
                )
            elif intent.asset_vol:
                stop_distance = intent.asset_vol / Decimal(4)  # ~one-quarter of annual vol
            if stop_distance and stop_distance > 0:
                risk_amount = notional * stop_distance
                max_risk = L.max_risk_per_trade_pct * equity
                if risk_amount > max_risk:
                    allowed = (
                        max_risk / (stop_distance * intent.reference_price)
                    ).quantize(Decimal("0.000001"))
                    resize(
                        "max_risk_per_trade",
                        f"risking ${risk_amount:,.2f} to the stop exceeds the "
                        f"{L.max_risk_per_trade_pct:.2%} of equity budget (${max_risk:,.2f})",
                        allowed,
                        safe_div(risk_amount, equity),
                        L.max_risk_per_trade_pct,
                    )
                else:
                    ok(
                        "max_risk_per_trade",
                        f"risking ${risk_amount:,.2f} to the stop",
                        safe_div(risk_amount, equity),
                        L.max_risk_per_trade_pct,
                    )
            else:
                warn(
                    "max_risk_per_trade",
                    "no stop distance or volatility estimate — per-trade risk could not be measured",
                )

            # --- gross / net exposure ---
            projected_gross = safe_div(
                sum((abs(p.market_value) for p in account.positions.values()), ZERO) + notional,
                equity,
            )
            if projected_gross > L.max_gross_exposure_pct:
                headroom_value = (L.max_gross_exposure_pct * equity) - sum(
                    (abs(p.market_value) for p in account.positions.values()), ZERO
                )
                if headroom_value <= 0:
                    reject(
                        "max_gross_exposure",
                        f"gross exposure is already at the {L.max_gross_exposure_pct:.0%} limit",
                        account.gross_exposure,
                        L.max_gross_exposure_pct,
                    )
                else:
                    resize(
                        "max_gross_exposure",
                        f"gross exposure would reach {projected_gross:.1%}, above the "
                        f"{L.max_gross_exposure_pct:.0%} limit (no leverage in version 1)",
                        (headroom_value / intent.reference_price).quantize(Decimal("0.000001")),
                        projected_gross,
                        L.max_gross_exposure_pct,
                    )
            else:
                ok(
                    "max_gross_exposure",
                    f"gross exposure would be {projected_gross:.1%}",
                    projected_gross,
                    L.max_gross_exposure_pct,
                )

            projected_net = safe_div(
                sum((p.market_value for p in account.positions.values()), ZERO) + notional, equity
            )
            if projected_net > L.max_net_exposure_pct:
                reject(
                    "max_net_exposure",
                    f"net exposure would reach {projected_net:.1%}, above the "
                    f"{L.max_net_exposure_pct:.0%} limit",
                    projected_net,
                    L.max_net_exposure_pct,
                )
            else:
                ok("max_net_exposure", f"net exposure would be {projected_net:.1%}", projected_net, L.max_net_exposure_pct)

            # --- cash buffer ---
            projected_cash = account.cash - notional
            min_cash = L.min_cash_buffer_pct * equity
            if projected_cash < min_cash:
                headroom = account.cash - min_cash
                if headroom <= 0:
                    reject(
                        "cash_buffer",
                        f"cash ${account.cash:,.2f} is already at or below the "
                        f"{L.min_cash_buffer_pct:.1%} buffer (${min_cash:,.2f})",
                        safe_div(account.cash, equity),
                        L.min_cash_buffer_pct,
                    )
                else:
                    resize(
                        "cash_buffer",
                        f"the order would leave ${projected_cash:,.2f} in cash, below the "
                        f"${min_cash:,.2f} buffer",
                        (headroom / intent.reference_price).quantize(Decimal("0.000001")),
                        safe_div(projected_cash, equity),
                        L.min_cash_buffer_pct,
                    )
            else:
                ok("cash_buffer", f"cash after the order would be ${projected_cash:,.2f}")

            # --- buying power ---
            if notional > account.buying_power:
                if account.buying_power <= 0:
                    reject(
                        "buying_power",
                        f"no buying power available (${account.buying_power:,.2f})",
                        notional,
                        account.buying_power,
                    )
                else:
                    resize(
                        "buying_power",
                        f"order notional ${notional:,.2f} exceeds buying power "
                        f"${account.buying_power:,.2f}",
                        (account.buying_power / intent.reference_price).quantize(Decimal("0.000001")),
                        notional,
                        account.buying_power,
                    )
            else:
                ok("buying_power", f"buying power ${account.buying_power:,.2f} covers the order")

            # --- sector concentration ---
            sector_value = sum(
                (abs(p.market_value) for p in account.positions.values() if p.sector == intent.sector),
                ZERO,
            )
            projected_sector = safe_div(sector_value + notional, equity)
            if projected_sector > L.max_sector_exposure_pct:
                headroom_value = (L.max_sector_exposure_pct * equity) - sector_value
                if headroom_value <= 0:
                    reject(
                        "max_sector_exposure",
                        f"the {intent.sector} sector is at its {L.max_sector_exposure_pct:.0%} limit",
                        safe_div(sector_value, equity),
                        L.max_sector_exposure_pct,
                    )
                else:
                    resize(
                        "max_sector_exposure",
                        f"{intent.sector} exposure would reach {projected_sector:.1%}, above the "
                        f"{L.max_sector_exposure_pct:.0%} limit",
                        (headroom_value / intent.reference_price).quantize(Decimal("0.000001")),
                        projected_sector,
                        L.max_sector_exposure_pct,
                    )
            else:
                ok(
                    "max_sector_exposure",
                    f"{intent.sector} exposure would be {projected_sector:.1%}",
                    projected_sector,
                    L.max_sector_exposure_pct,
                )

            # --- strategy concentration ---
            if intent.strategy_key:
                strat_value = sum(
                    (
                        abs(p.market_value)
                        for p in account.positions.values()
                        if p.strategy_key == intent.strategy_key
                    ),
                    ZERO,
                )
                projected_strat = safe_div(strat_value + notional, equity)
                if projected_strat > L.max_strategy_exposure_pct:
                    headroom_value = (L.max_strategy_exposure_pct * equity) - strat_value
                    if headroom_value <= 0:
                        reject(
                            "max_strategy_exposure",
                            f"strategy '{intent.strategy_key}' is at its "
                            f"{L.max_strategy_exposure_pct:.0%} exposure limit",
                            safe_div(strat_value, equity),
                            L.max_strategy_exposure_pct,
                        )
                    else:
                        resize(
                            "max_strategy_exposure",
                            f"strategy exposure would reach {projected_strat:.1%}, above the "
                            f"{L.max_strategy_exposure_pct:.0%} limit",
                            (headroom_value / intent.reference_price).quantize(Decimal("0.000001")),
                            projected_strat,
                            L.max_strategy_exposure_pct,
                        )
                else:
                    ok(
                        "max_strategy_exposure",
                        f"strategy exposure would be {projected_strat:.1%}",
                        projected_strat,
                        L.max_strategy_exposure_pct,
                    )

            # --- correlated exposure ---
            if intent.correlation_to_book is not None and intent.correlation_to_book > L.correlation_threshold:
                correlated_value = sum(
                    (abs(p.market_value) for p in account.positions.values()), ZERO
                )
                projected_corr = safe_div(correlated_value + notional, equity)
                if projected_corr > L.max_correlated_exposure_pct:
                    headroom_value = (L.max_correlated_exposure_pct * equity) - correlated_value
                    if headroom_value <= 0:
                        reject(
                            "max_correlated_exposure",
                            f"{intent.symbol} correlates {intent.correlation_to_book:.2f} with the "
                            f"book, which is already at the {L.max_correlated_exposure_pct:.0%} "
                            "correlated-exposure limit",
                            projected_corr,
                            L.max_correlated_exposure_pct,
                        )
                    else:
                        resize(
                            "max_correlated_exposure",
                            f"{intent.symbol} correlates {intent.correlation_to_book:.2f} with the "
                            f"existing book; correlated exposure would reach {projected_corr:.1%}",
                            (headroom_value / intent.reference_price).quantize(Decimal("0.000001")),
                            projected_corr,
                            L.max_correlated_exposure_pct,
                        )
                else:
                    warn(
                        "max_correlated_exposure",
                        f"correlation to the book is {intent.correlation_to_book:.2f}, above the "
                        f"{L.correlation_threshold} threshold — diversification benefit is limited",
                        intent.correlation_to_book,
                        L.correlation_threshold,
                    )
            else:
                ok("max_correlated_exposure", "correlation to the existing book is within tolerance")

            # --- position count ---
            if intent.symbol.upper() not in account.positions:
                if len(account.positions) >= L.max_open_positions:
                    reject(
                        "max_open_positions",
                        f"already holding {len(account.positions)} positions, at the "
                        f"{L.max_open_positions} limit",
                        D(len(account.positions)),
                        D(L.max_open_positions),
                    )
                else:
                    ok(
                        "max_open_positions",
                        f"{len(account.positions)} of {L.max_open_positions} positions held",
                        D(len(account.positions)),
                        D(L.max_open_positions),
                    )

            # --- turnover ---
            projected_turnover = safe_div(account.turnover_today_notional + notional, equity)
            if projected_turnover > L.max_turnover_daily_pct:
                reject(
                    "max_daily_turnover",
                    f"today's turnover would reach {projected_turnover:.1%} of equity, above the "
                    f"{L.max_turnover_daily_pct:.0%} limit",
                    projected_turnover,
                    L.max_turnover_daily_pct,
                )
            else:
                ok(
                    "max_daily_turnover",
                    f"turnover would be {projected_turnover:.1%} of equity",
                    projected_turnover,
                    L.max_turnover_daily_pct,
                )

            # --- price floor ---
            if intent.reference_price < L.min_price:
                reject(
                    "min_price",
                    f"{intent.symbol} at ${intent.reference_price} is below the ${L.min_price} floor",
                    intent.reference_price,
                    L.min_price,
                )
            else:
                ok("min_price", f"price ${intent.reference_price} is above the floor")

            # --- liquidity ---
            if intent.adv_usd is None:
                reject("min_liquidity", "average daily dollar volume is unknown — cannot size safely")
            elif intent.adv_usd < L.min_adv_usd:
                reject(
                    "min_liquidity",
                    f"{intent.symbol} trades ${intent.adv_usd:,.0f}/day, below the "
                    f"${L.min_adv_usd:,.0f} minimum",
                    intent.adv_usd,
                    L.min_adv_usd,
                )
            else:
                ok(
                    "min_liquidity",
                    f"average daily dollar volume ${intent.adv_usd:,.0f}",
                    intent.adv_usd,
                    L.min_adv_usd,
                )

            if intent.adv_shares and intent.adv_shares > 0:
                max_shares = intent.adv_shares * L.max_adv_participation_pct
                if intent.quantity > max_shares:
                    resize(
                        "adv_participation",
                        f"{intent.quantity} shares is more than "
                        f"{L.max_adv_participation_pct:.1%} of the {intent.adv_shares:,.0f}-share "
                        "average daily volume — the position could not be exited cleanly",
                        max_shares.quantize(Decimal("0.000001")),
                        safe_div(intent.quantity, intent.adv_shares),
                        L.max_adv_participation_pct,
                    )
                else:
                    ok(
                        "adv_participation",
                        f"{safe_div(intent.quantity, intent.adv_shares):.3%} of average daily volume",
                        safe_div(intent.quantity, intent.adv_shares),
                        L.max_adv_participation_pct,
                    )
            elif intent.adv_usd:
                max_notional = intent.adv_usd * L.max_adv_participation_pct
                if notional > max_notional:
                    resize(
                        "adv_participation",
                        f"order notional ${notional:,.0f} exceeds "
                        f"{L.max_adv_participation_pct:.1%} of ${intent.adv_usd:,.0f} daily volume",
                        (max_notional / intent.reference_price).quantize(Decimal("0.000001")),
                        safe_div(notional, intent.adv_usd),
                        L.max_adv_participation_pct,
                    )
                else:
                    ok("adv_participation", "participation within the limit")

            # --- spread and impact ---
            if intent.spread_bps is not None and intent.spread_bps > L.max_spread_bps:
                reject(
                    "max_spread",
                    f"the quoted spread is {intent.spread_bps:.0f}bps, above the "
                    f"{L.max_spread_bps:.0f}bps limit",
                    intent.spread_bps,
                    L.max_spread_bps,
                )
            else:
                ok("max_spread", "spread within tolerance", intent.spread_bps, L.max_spread_bps)

            if intent.estimated_impact_bps is not None and intent.estimated_impact_bps > L.max_estimated_impact_bps:
                reject(
                    "max_market_impact",
                    f"estimated market impact of {intent.estimated_impact_bps:.0f}bps exceeds the "
                    f"{L.max_estimated_impact_bps:.0f}bps limit",
                    intent.estimated_impact_bps,
                    L.max_estimated_impact_bps,
                )
            else:
                ok(
                    "max_market_impact",
                    "estimated impact within tolerance",
                    intent.estimated_impact_bps,
                    L.max_estimated_impact_bps,
                )

        # --- open-order hygiene (applies to all orders) ---
        if (
            account.oldest_open_order_age_seconds is not None
            and account.oldest_open_order_age_seconds > L.max_open_order_seconds
        ):
            warn(
                "max_open_order_duration",
                f"an open order has been live for {account.oldest_open_order_age_seconds:.0f}s, "
                f"beyond the {L.max_open_order_seconds}s budget — it should be cancelled or replaced",
                D(account.oldest_open_order_age_seconds),
                D(L.max_open_order_seconds),
            )
        else:
            ok("max_open_order_duration", "no stale open orders")

        return self._finalize(intent, checks, max_quantity)

    # ------------------------------------------------------------------
    def _finalize(
        self, intent: OrderIntent, checks: list[CheckOutcome], max_quantity: Decimal
    ) -> RiskVerdict:
        rejections = [c.message for c in checks if c.result is RiskCheckResult.REJECT]
        warnings = [c.message for c in checks if c.result is RiskCheckResult.WARN]
        resized_by = [c.name for c in checks if c.result is RiskCheckResult.RESIZE]

        approved_qty = ZERO if rejections else max(ZERO, max_quantity)
        if not intent.fractionable:
            approved_qty = approved_qty.quantize(Decimal("1"), rounding="ROUND_DOWN")
        else:
            approved_qty = approved_qty.quantize(Decimal("0.000001"), rounding="ROUND_DOWN")

        if not rejections and approved_qty <= 0:
            rejections.append(
                "after applying every limit the permitted quantity rounds to zero — "
                "the order is too small to place"
            )
            checks.append(
                CheckOutcome(
                    "final_quantity",
                    RiskCheckResult.REJECT,
                    "permitted quantity rounded down to zero",
                )
            )

        approved = not rejections and approved_qty > 0
        verdict = RiskVerdict(
            approved=approved,
            original_quantity=intent.quantity,
            approved_quantity=approved_qty if approved else ZERO,
            checks=checks,
            rejections=rejections,
            warnings=warnings,
            resized_by=resized_by,
        )
        verdict.explanation = self._explain(intent, verdict)
        return verdict

    @staticmethod
    def _explain(intent: OrderIntent, verdict: RiskVerdict) -> str:
        side = intent.side.value.upper()
        if not verdict.approved:
            reasons = "; ".join(verdict.rejections[:3])
            return (
                f"REJECTED: {side} {intent.quantity} {intent.symbol}. "
                f"{len(verdict.rejections)} risk check(s) failed — {reasons}."
            )
        parts = [
            f"APPROVED: {side} {verdict.approved_quantity} {intent.symbol} "
            f"at a reference price of ${intent.reference_price}."
        ]
        if verdict.was_resized:
            parts.append(
                f"Quantity was reduced from {verdict.original_quantity} by "
                f"{', '.join(verdict.resized_by)}."
            )
        passed = sum(1 for c in verdict.checks if c.result is RiskCheckResult.PASS)
        parts.append(f"{passed} of {len(verdict.checks)} checks passed cleanly.")
        if verdict.warnings:
            parts.append(f"Warnings: {'; '.join(verdict.warnings[:2])}.")
        return " ".join(parts)


# ---------------------------------------------------------------------------
def derive_risk_state(
    drawdown_pct: Decimal, limits: RiskLimits, current: RiskState = RiskState.NORMAL
) -> tuple[RiskState, str]:
    """Map drawdown onto the defensive-stage ladder.

    ``drawdown_pct`` is negative. Escalation is immediate; de-escalation requires
    recovering past the *next lower* threshold, so the state does not flicker.
    """
    depth = abs(drawdown_pct)
    if depth >= limits.emergency_stage_pct:
        return RiskState.EMERGENCY, (
            f"drawdown {depth:.1%} has reached the emergency threshold "
            f"({limits.emergency_stage_pct:.1%}): open orders are cancelled, new entries are "
            "disabled, and a human review is required before trading resumes"
        )
    if depth >= limits.defensive_stage_2_pct:
        return RiskState.DEFENSIVE_2, (
            f"drawdown {depth:.1%} has reached defensive stage two "
            f"({limits.defensive_stage_2_pct:.1%}): weak positions are closed and cash is raised"
        )
    if depth >= limits.defensive_stage_1_pct:
        return RiskState.DEFENSIVE_1, (
            f"drawdown {depth:.1%} has reached defensive stage one "
            f"({limits.defensive_stage_1_pct:.1%}): gross exposure is reduced and new position "
            "sizes are halved"
        )
    if depth >= limits.drawdown_warning_pct:
        return RiskState.WARNING, (
            f"drawdown {depth:.1%} has reached the warning threshold "
            f"({limits.drawdown_warning_pct:.1%}): new position sizing is reduced"
        )
    # De-escalate only once well clear of the warning line (hysteresis).
    if current in (RiskState.WARNING, RiskState.DEFENSIVE_1, RiskState.DEFENSIVE_2) and depth > (
        limits.drawdown_warning_pct * Decimal("0.6")
    ):
        return current, f"drawdown {depth:.1%} — holding the {current.value} state until it clears"
    return RiskState.NORMAL, f"drawdown {depth:.1%} is within normal tolerance"


def cooldown_expiry(now: datetime, limits: RiskLimits) -> datetime:
    return now + timedelta(hours=limits.loss_cooldown_hours)
