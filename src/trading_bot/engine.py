"""Live (paper/live) trading engine.

The autonomous loop: on each poll it refreshes the account, checks global
guardrails (kill switch, daily loss limit, market hours), then for every symbol
fetches recent bars, asks the strategy for a signal, and routes entries through
the :class:`~trading_bot.risk.RiskManager` before submitting an order.

By design the engine only ever submits market orders for whole shares and only
opens a position when flat in that symbol, mirroring the backtester so live
behaviour matches what you validated.
"""

from __future__ import annotations

import datetime as dt
import logging
import time

from .broker import AlpacaBroker
from .config import Config
from .data import DataProvider
from .notify import Notifier
from .risk import RiskManager
from .strategy import Signal, build_strategy

log = logging.getLogger("trading_bot.engine")


class TradingEngine:
    def __init__(self, config: Config) -> None:
        config.validate()
        self.config = config
        self.broker = AlpacaBroker(config)
        self.data = DataProvider(config.credentials)
        self.strategy = build_strategy(config.strategy.name, config.strategy.params)
        self.risk = RiskManager(config.risk)
        self.notifier = Notifier()
        self._day = None  # current trading date
        self._day_start_equity = 0.0
        self._trades_today = 0

    # ------------------------------------------------------------------ #
    def _ensure_day_started(self) -> None:
        today = dt.date.today()
        if self._day is None:
            account = self.broker.get_account()
            self._start_day(today, account.equity)
        elif today != self._day:
            # Day rolled over: summarise yesterday, then reset for the new day.
            account = self.broker.get_account()
            self.notifier.daily_summary(
                equity=account.equity,
                day_start_equity=self._day_start_equity,
                num_trades=self._trades_today,
            )
            self.risk.reset_kill_switch()
            self._start_day(today, account.equity)

    def _start_day(self, day: dt.date, equity: float) -> None:
        self._day = day
        self._day_start_equity = equity
        self._trades_today = 0
        self.risk.start_day(equity)
        log.info("Trading day %s started. Opening equity: $%.2f", day, equity)

    def run_once(self) -> None:
        """Execute a single decision cycle across all configured symbols."""
        self._ensure_day_started()

        if self.risk.kill_switch_engaged:
            log.warning("Kill switch engaged — skipping cycle.")
            return

        if not self.broker.is_market_open():
            log.info("Market closed — skipping cycle.")
            return

        account = self.broker.get_account()
        if self.risk.daily_loss_breached(account.equity):
            log.warning(
                "Daily loss limit breached (equity $%.2f). Halting new entries "
                "and engaging kill switch.",
                account.equity,
            )
            self.risk.engage_kill_switch("daily loss limit")
            return

        held = {p.symbol for p in self.broker.get_positions()}

        for symbol in self.config.symbols:
            try:
                self._process_symbol(symbol, account=account, held=held)
            except Exception:  # noqa: BLE001 — one bad symbol shouldn't kill the loop
                log.exception("Error processing %s", symbol)

    def _process_symbol(self, symbol: str, *, account, held: set[str]) -> None:
        bars = self.data.get_bars(
            symbol,
            timeframe=self.config.timeframe,
            limit=max(self.strategy.min_bars + 5, 60),
        )
        if len(bars) < self.strategy.min_bars:
            log.debug("%s: not enough bars (%d) for a signal", symbol, len(bars))
            return

        signal = self.strategy.generate_signal(bars)
        price = float(bars["close"].iloc[-1])
        holding = symbol in held

        if signal is Signal.BUY and not holding:
            decision = self.risk.evaluate_entry(
                equity=account.equity,
                price=price,
                open_positions=len(held),
                current_equity=account.equity,
            )
            if not decision.approved:
                log.info("%s: BUY vetoed by risk manager: %s", symbol, decision.reason)
                return
            stop_price = price * (1 - self.config.risk.stop_loss_pct)
            tp_pct = self.config.risk.take_profit_pct
            tp_price = price * (1 + tp_pct) if tp_pct else None
            log.info(
                "%s: BUY %d shares @ ~$%.2f (stop $%.2f, tp %s)",
                symbol, decision.quantity, price, stop_price,
                f"${tp_price:.2f}" if tp_price else "none",
            )
            self.broker.submit_bracket_order(
                symbol, decision.quantity,
                stop_loss_price=stop_price, take_profit_price=tp_price,
            )
            self.notifier.trade("buy", symbol, decision.quantity, price)
            self._trades_today += 1
            held.add(symbol)
        elif signal is Signal.SELL and holding:
            log.info("%s: SELL signal — closing position", symbol)
            self.broker.close_position(symbol)
            self.notifier.trade("sell", symbol, 0, price)
            self._trades_today += 1
            held.discard(symbol)
        else:
            log.debug("%s: %s (holding=%s) — no action", symbol, signal.value, holding)

    def run_forever(self) -> None:
        mode = "LIVE" if self.config.is_live else "PAPER"
        log.info(
            "Starting trading engine [%s] strategy=%s symbols=%s interval=%ds",
            mode, self.config.strategy.name, self.config.symbols,
            self.config.poll_interval_seconds,
        )
        if self.config.is_live:
            log.warning("LIVE MODE: this bot is trading REAL MONEY.")
        try:
            while True:
                self.run_once()
                time.sleep(self.config.poll_interval_seconds)
        except KeyboardInterrupt:
            log.info("Interrupted — shutting down. Open positions are left intact.")
