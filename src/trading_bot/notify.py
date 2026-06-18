"""Notifications.

Sends trade and status messages to the log always, and optionally to a webhook
(Slack or Discord incoming-webhook URL) if ``NOTIFY_WEBHOOK_URL`` is set. The
webhook call uses the standard library (``urllib``) so there's no extra
dependency, and failures never interrupt trading — they're logged and swallowed.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger("trading_bot.notify")


class Notifier:
    def __init__(self, webhook_url: str | None = None, timeout: float = 5.0) -> None:
        self.webhook_url = webhook_url or os.getenv("NOTIFY_WEBHOOK_URL")
        self.timeout = timeout

    def send(self, message: str) -> None:
        """Log the message and, if configured, post it to the webhook."""
        log.info("NOTIFY: %s", message)
        if not self.webhook_url:
            return
        try:
            # Both Slack and Discord accept a JSON body with a text field;
            # Slack uses "text", Discord uses "content". Send both keys.
            payload = json.dumps({"text": message, "content": message}).encode()
            req = urllib.request.Request(
                self.webhook_url,
                data=payload,
                headers={"Content-Type": "application/json"},
            )
            urllib.request.urlopen(req, timeout=self.timeout)  # noqa: S310
        except (urllib.error.URLError, OSError) as exc:  # pragma: no cover - network
            log.warning("Notification webhook failed: %s", exc)

    def trade(self, side: str, symbol: str, qty: int, price: float) -> None:
        emoji = "🟢" if side == "buy" else "🔴"
        self.send(f"{emoji} {side.upper()} {qty} {symbol} @ ~${price:.2f}")

    def daily_summary(
        self, *, equity: float, day_start_equity: float, num_trades: int
    ) -> None:
        pnl = equity - day_start_equity
        pct = (pnl / day_start_equity) if day_start_equity else 0.0
        arrow = "📈" if pnl >= 0 else "📉"
        self.send(
            f"{arrow} Daily summary — equity ${equity:,.2f} "
            f"(P&L ${pnl:+,.2f}, {pct:+.2%}) over {num_trades} trades"
        )
