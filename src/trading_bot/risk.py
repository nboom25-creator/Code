"""Risk management — the guardrails that keep an autonomous bot from blowing up.

Every proposed entry passes through :meth:`RiskManager.evaluate_entry`, which
both *sizes* the position and *vetoes* it if any limit would be breached:

* per-trade risk sizing from a stop-loss distance,
* a hard cap on position size as a fraction of equity,
* a cap on the number of concurrent open positions,
* a daily loss limit that halts new entries,
* a global kill switch.

The manager is deliberately conservative: when in doubt, it declines.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import RiskConfig


@dataclass
class RiskDecision:
    approved: bool
    quantity: int
    reason: str = ""


class RiskManager:
    def __init__(self, config: RiskConfig) -> None:
        self.config = config
        self._kill_switch = False
        # Equity recorded at the start of the trading day, for the daily-loss
        # limit. Set via :meth:`start_day`.
        self._day_start_equity: float | None = None

    # ------------------------------------------------------------------ #
    # Daily lifecycle / kill switch
    # ------------------------------------------------------------------ #
    def start_day(self, equity: float) -> None:
        """Record the day's opening equity. Call once at session start / rollover."""
        self._day_start_equity = equity

    def engage_kill_switch(self, reason: str = "manual") -> None:
        self._kill_switch = True
        self._kill_reason = reason

    def reset_kill_switch(self) -> None:
        self._kill_switch = False

    @property
    def kill_switch_engaged(self) -> bool:
        return self._kill_switch

    def daily_loss_breached(self, current_equity: float) -> bool:
        if self._day_start_equity is None or self._day_start_equity <= 0:
            return False
        drawdown = (self._day_start_equity - current_equity) / self._day_start_equity
        return drawdown >= self.config.daily_loss_limit_pct

    # ------------------------------------------------------------------ #
    # Position sizing + entry gating
    # ------------------------------------------------------------------ #
    def position_size(self, equity: float, price: float) -> int:
        """Whole-share quantity for a new long position.

        Size is the smaller of:
        * the risk-based size: ``equity * risk_per_trade_pct`` divided by the
          per-share stop distance (``price * stop_loss_pct``), and
        * the cap size: ``equity * max_position_pct`` divided by ``price``.
        """
        if price <= 0 or equity <= 0:
            return 0
        cap_dollars = equity * self.config.max_position_pct
        cap_qty = cap_dollars / price
        stop_distance = price * self.config.stop_loss_pct
        if stop_distance <= 0:
            # No stop configured: fall back to the position-size cap only.
            return int(cap_qty)
        risk_dollars = equity * self.config.risk_per_trade_pct
        risk_based_qty = risk_dollars / stop_distance
        return int(min(risk_based_qty, cap_qty))

    def evaluate_entry(
        self,
        *,
        equity: float,
        price: float,
        open_positions: int,
        current_equity: float | None = None,
    ) -> RiskDecision:
        """Decide whether to allow a new long entry and at what size."""
        current_equity = equity if current_equity is None else current_equity

        if self._kill_switch:
            return RiskDecision(False, 0, "kill switch engaged")
        if open_positions >= self.config.max_open_positions:
            return RiskDecision(
                False, 0, f"max open positions reached ({self.config.max_open_positions})"
            )
        if self.daily_loss_breached(current_equity):
            return RiskDecision(
                False, 0,
                f"daily loss limit hit ({self.config.daily_loss_limit_pct:.1%})",
            )
        qty = self.position_size(equity, price)
        if qty < 1:
            return RiskDecision(False, 0, "position size rounds to zero shares")
        return RiskDecision(True, qty, "approved")
