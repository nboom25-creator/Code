"""Daily / cron-style runner for the autonomous agent.

Wires the cognitive loop to the real broker, data provider, and Claude, then
drives one decision cycle per ticker in the watchlist. Designed to be invoked
once per scheduling tick (e.g. a daily cron) — it persists the day's opening
equity to ``logs/.day_state.json`` so the 2% drawdown circuit breaker is
consistent across invocations within the same day.

Order of operations each run:
  1. Resolve the day's opening equity (record it the first time today).
  2. Check the 2% daily-drawdown circuit breaker. If tripped → halt + alert.
  3. For each watchlist ticker, run the full Research-then-Decide cycle.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from ..config import Config, load_config
from ..notify import Notifier
from .audit import AuditLog
from .cognition import CognitiveLoop
from .guardrails import Guardrails
from .llm import LLM, AnthropicLLM
from .tools import AgentTools

log = logging.getLogger("trading_bot.agent")

DEFAULT_SYSTEM_MANUAL = Path("CLAUDE.md")


def load_system_manual(path: str | Path = DEFAULT_SYSTEM_MANUAL) -> str:
    """Load the agent's permanent manual (CLAUDE.md) as the system prompt."""
    path = Path(path)
    if path.exists():
        return path.read_text(encoding="utf-8")
    # Fallback so the agent still has its hard rules if the file is missing.
    return (
        "You are an autonomous equities agent. Protect capital first. Follow the "
        "Research-then-Decide loop. Never exceed 5% of equity per trade. Halt at a "
        "2% daily drawdown. Default to HOLD on missing or corrupted data."
    )


class DayState:
    """Persists the day's opening equity for the drawdown baseline."""

    def __init__(self, path: str | Path = "logs/.day_state.json") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def opening_equity(self, current_equity: float) -> float:
        today = dt.date.today().isoformat()
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text())
                if data.get("date") == today:
                    return float(data["opening_equity"])
            except (json.JSONDecodeError, KeyError, ValueError):
                pass
        self.path.write_text(json.dumps({"date": today, "opening_equity": current_equity}))
        return current_equity


class AgentRunner:
    def __init__(
        self,
        *,
        config: Config,
        llm: LLM,
        tools: AgentTools,
        broker,
        guardrails: Guardrails | None = None,
        audit: AuditLog | None = None,
        notifier: Notifier | None = None,
        day_state: DayState | None = None,
        watchlist: list[str] | None = None,
    ) -> None:
        self.config = config
        self.broker = broker
        self.guardrails = guardrails or Guardrails()
        self.audit = audit or AuditLog()
        self.notifier = notifier or Notifier()
        self.day_state = day_state or DayState()
        self.watchlist = watchlist or config.symbols
        self.loop = CognitiveLoop(
            llm=llm, tools=tools, guardrails=self.guardrails,
            audit=self.audit, system_prompt=load_system_manual(),
        )

    def run_day(self) -> dict:
        account = self.broker.get_account()
        equity = float(account.equity)
        opening = self.day_state.opening_equity(equity)
        self.audit.day_header(equity=opening)

        # 2% daily-drawdown circuit breaker — portfolio-level halt.
        if self.guardrails.drawdown_breached(opening, equity):
            msg = (
                f"Daily drawdown circuit breaker TRIPPED: equity ${equity:,.2f} is "
                f">= 2% below the day's open ${opening:,.2f}. Halting all trading for "
                f"the day."
            )
            log.warning(msg)
            self.audit.system_event(msg)
            self.notifier.send(f"🛑 {msg}")
            return {"halted": True, "reason": "daily_drawdown", "results": []}

        results = []
        for ticker in self.watchlist:
            log.info("Running cognitive cycle for %s", ticker)
            try:
                result = self.loop.run_for_ticker(ticker, equity=equity)
                results.append(result)
                if result.executed:
                    self.notifier.send(
                        f"🤖 {result.final_action} {result.quantity} {ticker} (agent)"
                    )
            except Exception:  # noqa: BLE001 — one ticker must not kill the run
                log.exception("Cycle failed for %s", ticker)
                self.audit.system_event(f"{ticker}: cycle raised an exception — skipped.")
        return {"halted": False, "results": results}


def build_runner(config: Config | None = None) -> AgentRunner:
    """Wire the agent to the real Alpaca broker, data provider, and Claude."""
    from ..broker import AlpacaBroker
    from ..data import DataProvider

    config = config or load_config()
    config.validate()
    broker = AlpacaBroker(config)
    data = DataProvider(config.credentials)
    tools = AgentTools(broker, data, default_timeframe=config.timeframe)
    llm = AnthropicLLM()
    return AgentRunner(config=config, llm=llm, tools=tools, broker=broker)
