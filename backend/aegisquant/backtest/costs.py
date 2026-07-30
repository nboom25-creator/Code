"""Transaction-cost and fill modelling.

A backtest that fills at the close with no spread, no impact and unlimited size
is a fiction. This module makes the pessimistic assumption at every fork:

* **Spread** is estimated from volatility and dollar volume when no quote exists,
  and the trade always pays the half-spread.
* **Impact** follows a square-root law in participation rate — the standard
  empirical form — so demanding size in a thin name is expensive.
* **Partial fills** happen whenever the order exceeds the per-bar participation
  cap; the remainder does *not* silently complete.
* **Limit orders** only fill if the bar actually traded through the limit, and a
  fill at the limit price is never assumed to be better than the limit.
* **Shorts** pay a borrow fee and can be rejected outright when the name is not
  easy to borrow.
* **Stops** are modelled as triggering a market order, which can and does fill
  worse than the stop price — including gapping straight through it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from aegisquant.db.enums import OrderType, Side
from aegisquant.utils.money import ZERO, D, safe_div
from aegisquant.utils.money import price as q_price

BPS = Decimal("0.0001")


@dataclass(slots=True)
class CostModel:
    """Configurable execution-cost assumptions."""

    #: Per-share commission (US equities are typically zero at retail brokers).
    commission_per_share: Decimal = Decimal("0")
    #: Flat commission per order.
    commission_per_order: Decimal = Decimal("0")
    #: Minimum commission per order.
    min_commission: Decimal = Decimal("0")
    #: Regulatory fees on sales (SEC + TAF), as a fraction of notional.
    sec_fee_rate: Decimal = Decimal("0.0000278")
    #: Floor on the estimated half-spread, in basis points.
    min_half_spread_bps: Decimal = Decimal("1.0")
    #: Ceiling on the estimated half-spread, in basis points.
    max_half_spread_bps: Decimal = Decimal("150")
    #: Coefficient of the square-root impact law.
    impact_coefficient: Decimal = Decimal("0.10")
    #: Fraction of a bar's volume the strategy may take.
    max_participation: Decimal = Decimal("0.01")
    #: Extra slippage applied to market orders, in basis points.
    market_order_slippage_bps: Decimal = Decimal("2.0")
    #: Annualised stock-borrow cost for shorts.
    borrow_rate_annual: Decimal = Decimal("0.03")
    #: Borrow cost for hard-to-borrow names.
    hard_to_borrow_rate_annual: Decimal = Decimal("0.25")
    #: Allow shorting at all (disabled in v1).
    allow_shorts: bool = False
    #: Fractional shares supported.
    allow_fractional: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "commission_per_share": str(self.commission_per_share),
            "commission_per_order": str(self.commission_per_order),
            "min_commission": str(self.min_commission),
            "sec_fee_rate": str(self.sec_fee_rate),
            "min_half_spread_bps": str(self.min_half_spread_bps),
            "max_half_spread_bps": str(self.max_half_spread_bps),
            "impact_coefficient": str(self.impact_coefficient),
            "max_participation": str(self.max_participation),
            "market_order_slippage_bps": str(self.market_order_slippage_bps),
            "borrow_rate_annual": str(self.borrow_rate_annual),
            "allow_shorts": self.allow_shorts,
            "allow_fractional": self.allow_fractional,
        }

    # ------------------------------------------------------------------
    def half_spread_bps(
        self,
        price: Decimal,
        daily_vol: Decimal | None,
        dollar_volume: Decimal | None,
        quoted_spread_bps: Decimal | None = None,
    ) -> Decimal:
        """Estimate the half-spread in basis points.

        Uses the quoted spread when one is available. Otherwise it is inferred
        from volatility and dollar volume — both robustly related to spread —
        and floored so a cost is always charged.
        """
        if quoted_spread_bps is not None and quoted_spread_bps > 0:
            return max(self.min_half_spread_bps, quoted_spread_bps / 2)

        # Base: 1bp, widened by volatility and narrowed by liquidity.
        est = Decimal("1.0")
        if daily_vol is not None and daily_vol > 0:
            est += D(daily_vol) * Decimal("400")  # 2% daily vol -> +8bps
        if dollar_volume is not None and dollar_volume > 0:
            if dollar_volume < Decimal("1000000"):
                est *= Decimal("6")
            elif dollar_volume < Decimal("10000000"):
                est *= Decimal("3")
            elif dollar_volume < Decimal("100000000"):
                est *= Decimal("1.5")
        if price < Decimal("5"):
            est *= Decimal("3")  # sub-$5 names have structurally wider spreads
        return max(self.min_half_spread_bps, min(self.max_half_spread_bps, est / 2))

    def impact_bps(self, quantity: Decimal, bar_volume: Decimal | None) -> Decimal:
        """Square-root market impact in basis points."""
        if not bar_volume or bar_volume <= 0 or quantity <= 0:
            return ZERO
        participation = safe_div(quantity, bar_volume)
        if participation <= 0:
            return ZERO
        root = D(float(participation) ** 0.5)
        return self.impact_coefficient * root * Decimal("10000")

    def commission(self, quantity: Decimal, notional: Decimal, side: Side) -> Decimal:
        fee = self.commission_per_order + self.commission_per_share * abs(quantity)
        fee = max(fee, self.min_commission) if self.min_commission else fee
        if side is Side.SELL:  # regulatory fees apply to sales only
            fee += abs(notional) * self.sec_fee_rate
        return fee.quantize(Decimal("0.0001"))

    def borrow_cost(self, notional: Decimal, days: int, easy_to_borrow: bool = True) -> Decimal:
        rate = self.borrow_rate_annual if easy_to_borrow else self.hard_to_borrow_rate_annual
        return (abs(notional) * rate * D(days) / D(365)).quantize(Decimal("0.0001"))

    def max_fillable(self, bar_volume: Decimal | None) -> Decimal | None:
        if not bar_volume or bar_volume <= 0:
            return ZERO
        return (D(bar_volume) * self.max_participation).quantize(Decimal("0.000001"))


@dataclass(slots=True)
class FillResult:
    """Outcome of simulating one order against one bar."""

    filled_quantity: Decimal = ZERO
    fill_price: Decimal = ZERO
    commission: Decimal = ZERO
    spread_cost: Decimal = ZERO
    impact_cost: Decimal = ZERO
    slippage_bps: Decimal = ZERO
    rejected: bool = False
    reject_reason: str | None = None
    partial: bool = False
    remaining_quantity: Decimal = ZERO
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def filled(self) -> bool:
        return self.filled_quantity > 0

    @property
    def total_cost(self) -> Decimal:
        return self.commission + self.spread_cost + self.impact_cost

    @property
    def notional(self) -> Decimal:
        return self.filled_quantity * self.fill_price


def simulate_fill(
    *,
    side: Side,
    order_type: OrderType,
    quantity: Decimal,
    bar_open: Decimal,
    bar_high: Decimal,
    bar_low: Decimal,
    bar_close: Decimal,
    bar_volume: Decimal,
    cost_model: CostModel,
    limit_price: Decimal | None = None,
    stop_price: Decimal | None = None,
    daily_vol: Decimal | None = None,
    dollar_volume: Decimal | None = None,
    quoted_spread_bps: Decimal | None = None,
    shortable: bool = False,
    reference_price: Decimal | None = None,
) -> FillResult:
    """Simulate one order against one bar.

    Orders are assumed to arrive at the **open** of the bar following the signal,
    which is the earliest moment a decision made on a close could be acted on.
    """
    result = FillResult(remaining_quantity=quantity)
    if quantity <= 0:
        result.rejected = True
        result.reject_reason = "non-positive quantity"
        return result

    if side is Side.BUY and cost_model.allow_shorts is False and quantity <= 0:
        result.rejected = True
        result.reject_reason = "invalid quantity"
        return result

    if side is Side.SELL and not shortable and cost_model.allow_shorts:
        # Only relevant for opening a short; closing a long is handled by the caller.
        result.rejected = True
        result.reject_reason = "security is not shortable"
        return result

    if bar_volume is None or bar_volume <= 0:
        result.rejected = True
        result.reject_reason = "no volume traded in the bar (halted or no data)"
        return result

    # --- liquidity cap -> partial fill ---
    cap = cost_model.max_fillable(bar_volume)
    fillable = quantity if cap is None else min(quantity, cap)
    if fillable <= 0:
        result.rejected = True
        result.reject_reason = (
            f"bar volume {bar_volume} allows no fill at the {cost_model.max_participation} participation cap"
        )
        return result
    if not cost_model.allow_fractional:
        fillable = fillable.quantize(Decimal("1"))
        if fillable <= 0:
            result.rejected = True
            result.reject_reason = "participation cap rounds to less than one share"
            return result

    # --- determine the reference execution price ---
    arrival = bar_open
    if order_type is OrderType.MARKET:
        base = arrival
    elif order_type is OrderType.LIMIT:
        if limit_price is None:
            result.rejected = True
            result.reject_reason = "limit order without a limit price"
            return result
        if side is Side.BUY:
            if bar_open <= limit_price:
                base = bar_open  # opened through the limit: fill at the open
            elif bar_low <= limit_price:
                base = limit_price  # traded down to the limit during the bar
            else:
                result.rejected = True
                result.reject_reason = f"limit {limit_price} never reached (bar low {bar_low})"
                return result
        else:
            if bar_open >= limit_price:
                base = bar_open
            elif bar_high >= limit_price:
                base = limit_price
            else:
                result.rejected = True
                result.reject_reason = f"limit {limit_price} never reached (bar high {bar_high})"
                return result
    elif order_type in (OrderType.STOP, OrderType.STOP_LIMIT):
        if stop_price is None:
            result.rejected = True
            result.reject_reason = "stop order without a stop price"
            return result
        if side is Side.SELL:
            if bar_open <= stop_price:
                # Gapped through the stop: fill at the open, not at the stop.
                base = bar_open
                result.detail["gapped_through_stop"] = True
            elif bar_low <= stop_price:
                base = stop_price
            else:
                result.rejected = True
                result.reject_reason = "stop not triggered in this bar"
                return result
        else:
            if bar_open >= stop_price:
                base = bar_open
                result.detail["gapped_through_stop"] = True
            elif bar_high >= stop_price:
                base = stop_price
            else:
                result.rejected = True
                result.reject_reason = "stop not triggered in this bar"
                return result
        if order_type is OrderType.STOP_LIMIT and limit_price is not None:
            if side is Side.SELL and base < limit_price:
                result.rejected = True
                result.reject_reason = "stop-limit: triggered but price below the limit"
                return result
            if side is Side.BUY and base > limit_price:
                result.rejected = True
                result.reject_reason = "stop-limit: triggered but price above the limit"
                return result
    else:  # pragma: no cover - exhaustive
        result.rejected = True
        result.reject_reason = f"unsupported order type {order_type}"
        return result

    # --- costs: half spread, then impact, always against the trade ---
    half_spread = cost_model.half_spread_bps(base, daily_vol, dollar_volume, quoted_spread_bps)
    impact = cost_model.impact_bps(fillable, bar_volume)
    extra = cost_model.market_order_slippage_bps if order_type is OrderType.MARKET else ZERO
    total_bps = half_spread + impact + extra
    direction = Decimal(1) if side is Side.BUY else Decimal(-1)
    fill_price = base * (Decimal(1) + direction * total_bps * BPS)

    # A limit order can never fill worse than its limit.
    if order_type is OrderType.LIMIT and limit_price is not None:
        fill_price = min(fill_price, limit_price) if side is Side.BUY else max(fill_price, limit_price)

    # Nor outside the bar's actual range.
    fill_price = max(min(fill_price, bar_high), bar_low)
    fill_price = q_price(fill_price)

    notional = fillable * fill_price
    result.filled_quantity = fillable
    result.fill_price = fill_price
    result.commission = cost_model.commission(fillable, notional, side)
    result.spread_cost = (notional * half_spread * BPS).quantize(Decimal("0.0001"))
    result.impact_cost = (notional * impact * BPS).quantize(Decimal("0.0001"))
    result.partial = fillable < quantity
    result.remaining_quantity = quantity - fillable
    ref = reference_price or base
    result.slippage_bps = (safe_div(fill_price - ref, ref) * Decimal(10000) * direction).quantize(Decimal("0.01"))
    result.detail.update(
        {
            "arrival_price": str(arrival),
            "base_price": str(base),
            "half_spread_bps": str(half_spread),
            "impact_bps": str(impact),
            "extra_bps": str(extra),
            "participation": str(safe_div(fillable, bar_volume)),
        }
    )
    return result


def estimate_total_cost_bps(
    *,
    quantity: Decimal,
    price: Decimal,
    bar_volume: Decimal | None,
    cost_model: CostModel,
    daily_vol: Decimal | None = None,
    dollar_volume: Decimal | None = None,
    quoted_spread_bps: Decimal | None = None,
    order_type: OrderType = OrderType.LIMIT,
) -> dict[str, Decimal]:
    """Pre-trade cost estimate, shown to the operator before submission."""
    half = cost_model.half_spread_bps(price, daily_vol, dollar_volume, quoted_spread_bps)
    impact = cost_model.impact_bps(quantity, bar_volume)
    extra = cost_model.market_order_slippage_bps if order_type is OrderType.MARKET else ZERO
    notional = quantity * price
    commission = cost_model.commission(quantity, notional, Side.BUY)
    commission_bps = safe_div(commission, notional) * Decimal(10000) if notional else ZERO
    total = half + impact + extra + commission_bps
    return {
        "spread_bps": half * 2,
        "half_spread_bps": half,
        "impact_bps": impact,
        "slippage_bps": extra,
        "commission_bps": commission_bps.quantize(Decimal("0.01")),
        "total_cost_bps": total.quantize(Decimal("0.01")),
        "total_cost_usd": (notional * total * BPS + ZERO).quantize(Decimal("0.01")),
    }
