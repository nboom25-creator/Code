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

import logging
import time

from .broker import AlpacaBroker
from .config import Config
from .data import DataProvider
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
        self._day_started = False

    # ------------------------------------------------------------------ #
    def _ensure_day_started(self) -> None:
        if not self._day_started:
            account = self.broker.get_account()
            self.risk.start_day(account.equity)
            self._day_started = True
            log.info("Trading day started. Opening equity: $%.2f", account.equity)

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
            log.info("%s: BUY %d shares @ ~$%.2f", symbol, decision.quantity, price)
            self.broker.submit_market_order(symbol, decision.quantity, "buy")
            held.add(symbol)
        elif signal is Signal.SELL and holding:
            log.info("%s: SELL signal — closing position", symbol)
            self.broker.close_position(symbol)
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
