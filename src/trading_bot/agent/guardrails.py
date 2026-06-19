"""Hard guardrails — enforced in code, not entrusted to the model.

These three constraints from the agent's manual are validated here, after the
model has produced a TradeDecision and before any order is placed:

1. **5% max position size** — a BUY is resized down to at most 5% of portfolio
   equity, and rejected if that rounds to less than one share.
2. **2% daily drawdown circuit breaker** — if equity is >= 2% below the day's
   opening equity, trading halts for the day.
3. **HOLD on bad data** — handled upstream in the cognitive loop, but the
   validator also forces HOLD if it is handed obviously invalid inputs.

The thresholds are hardcoded constants (overridable only by explicit construction)
so a prompt-injected or hallucinated decision cannot widen them.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

MAX_POSITION_PCT = 0.05  # 5% of equity per single trade
DAILY_DRAWDOWN_LIMIT_PCT = 0.02  # halt the day at a 2% drawdown
STOP_LOSS_PCT = 0.05  # protective stop, 5% below entry
TAKE_PROFIT_PCT = 0.10  # take-profit, 10% above entry (0 disables)
MAX_ADV_PARTICIPATION_PCT = 0.01  # a BUY may be at most 1% of avg daily volume


@dataclass
class GuardrailVerdict:
    approved: bool
    action: str  # final action after guardrails: BUY / SELL / HOLD
    quantity: int
    notes: list[str]


class Guardrails:
    def __init__(
        self,
        *,
        max_position_pct: float = MAX_POSITION_PCT,
        daily_drawdown_limit_pct: float = DAILY_DRAWDOWN_LIMIT_PCT,
        stop_loss_pct: float = STOP_LOSS_PCT,
        take_profit_pct: float = TAKE_PROFIT_PCT,
        max_adv_participation_pct: float = MAX_ADV_PARTICIPATION_PCT,
    ) -> None:
        self.max_position_pct = max_position_pct
        self.daily_drawdown_limit_pct = daily_drawdown_limit_pct
        self.stop_loss_pct = stop_loss_pct
        self.take_profit_pct = take_profit_pct
        self.max_adv_participation_pct = max_adv_participation_pct

    # ------------------------------------------------------------------ #
    def bracket_prices(self, entry_price: float) -> tuple[float, float | None]:
        """Return (stop_loss_price, take_profit_price) for a long entry.

        take_profit_price is None when take-profit is disabled (pct == 0).
        """
        stop = round(entry_price * (1 - self.stop_loss_pct), 2)
        take = round(entry_price * (1 + self.take_profit_pct), 2) \
            if self.take_profit_pct else None
        return stop, take

    # ------------------------------------------------------------------ #
    def drawdown_breached(self, day_start_equity: float, current_equity: float) -> bool:
        """True if the 2% daily-drawdown circuit breaker has tripped."""
        if day_start_equity <= 0:
            return False
        drawdown = (day_start_equity - current_equity) / day_start_equity
        return drawdown >= self.daily_drawdown_limit_pct

    def validate_decision(
        self,
        *,
        action: str,
        ticker: str,
        target_notional_usd: float,
        equity: float,
        price: float,
        current_position_qty: float,
        avg_daily_volume: float = 0.0,
        exposure_scale: float = 1.0,
    ) -> GuardrailVerdict:
        """Resize/veto a proposed decision against the hard limits."""
        notes: list[str] = []
        action = action.upper()

        if action == "HOLD":
            return GuardrailVerdict(False, "HOLD", 0, ["HOLD — no order."])

        if action == "SELL":
            qty = int(current_position_qty)
            if qty <= 0:
                return GuardrailVerdict(
                    False, "HOLD", 0, ["SELL proposed but no open position — forcing HOLD."]
                )
            return GuardrailVerdict(True, "SELL", qty, [f"SELL approved: closing {qty} shares."])

        # action == "BUY"
        if equity <= 0 or price <= 0:
            return GuardrailVerdict(
                False, "HOLD", 0, ["Invalid equity/price for sizing — forcing HOLD."]
            )

        # Regime gate: scale the equity cap by the market exposure multiplier.
        exposure_scale = max(0.0, min(1.0, exposure_scale))
        if exposure_scale <= 0:
            return GuardrailVerdict(
                False, "HOLD", 0,
                ["Risk-off regime (exposure x0) — no new exposure; forcing HOLD."])
        cap_notional = equity * self.max_position_pct * exposure_scale
        if exposure_scale < 1.0:
            notes.append(
                f"Regime exposure scaled to {exposure_scale:.0%}: effective cap "
                f"${cap_notional:,.0f} ({self.max_position_pct:.0%} x {exposure_scale:.0%}).")
        notional = max(0.0, float(target_notional_usd))
        if notional > cap_notional:
            label = (f"{self.max_position_pct:.0%} cap" if exposure_scale >= 1.0
                     else "regime-scaled cap")
            notes.append(
                f"Proposed ${notional:,.0f} exceeds the {label} "
                f"(${cap_notional:,.0f}); resized to the cap."
            )
            notional = cap_notional
        qty = int(math.floor(notional / price))
        if qty < 1:
            return GuardrailVerdict(
                False, "HOLD", 0,
                notes + [f"Sized to {qty} shares (< 1) under the 5% cap — forcing HOLD."],
            )

        # Liquidity cap — never take more than a small slice of average daily
        # volume, so the position can actually be exited. Critical for illiquid
        # small/micro-caps where the 5% equity cap alone is not enough.
        if avg_daily_volume and avg_daily_volume > 0:
            adv_cap_qty = int(math.floor(avg_daily_volume * self.max_adv_participation_pct))
            if qty > adv_cap_qty:
                notes.append(
                    f"Liquidity cap: {self.max_adv_participation_pct:.1%} of ADV "
                    f"({avg_daily_volume:,.0f} sh) = {adv_cap_qty} shares; "
                    f"resized from {qty}."
                )
                qty = adv_cap_qty
            if qty < 1:
                return GuardrailVerdict(
                    False, "HOLD", 0,
                    notes + ["Liquidity cap rounds to < 1 share — too illiquid; "
                             "forcing HOLD."],
                )

        notes.append(
            f"BUY approved: {qty} shares (~${qty * price:,.0f}, "
            f"{qty * price / equity:.1%} of equity)."
        )
        return GuardrailVerdict(True, "BUY", qty, notes)
