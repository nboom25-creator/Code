"""The Research-then-Decide cognitive loop (the driver).

Forces every cycle through the five mandatory phases in order:

    Perception -> Cognitive Planning -> Reflection -> Action -> Memory/Audit

The driver is deterministic Python. The model is consulted at each cognitive
phase, but sizing, the hard guardrails, and execution all happen here, in code
the model cannot reach. If perception degrades (a data tool fails or returns
empty/corrupted data), the loop short-circuits to HOLD and logs an exception
before ever asking the model to plan or decide.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from .audit import AuditLog
from .guardrails import Guardrails
from .llm import LLM
from .schemas import AdversarialCheck, ReasoningState, TradeDecision
from .tools import PERCEPTION_TOOL_SCHEMAS, AgentTools, ToolCall


@dataclass
class CycleResult:
    ticker: str
    final_action: str
    quantity: int
    degraded: bool
    executed: bool


class CognitiveLoop:
    def __init__(
        self,
        *,
        llm: LLM,
        tools: AgentTools,
        guardrails: Guardrails,
        audit: AuditLog,
        system_prompt: str,
        dry_run: bool = False,
    ) -> None:
        self.llm = llm
        self.tools = tools
        self.guardrails = guardrails
        self.audit = audit
        self.system_prompt = system_prompt
        # In dry-run mode, the final execute_order call is intercepted: the
        # proposed trade and its reasoning are logged, but no order is sent.
        self.dry_run = dry_run

    # ------------------------------------------------------------------ #
    def run_for_ticker(self, ticker: str, *, equity: float) -> CycleResult:
        # --- Phase 1: Perception -------------------------------------- #
        instruction = (
            f"Begin the Perception phase for {ticker}. Use the read-only tools to "
            f"gather (1) recent price bars, (2) recent company news, and (3) the "
            f"current portfolio state. Then briefly state what you found. Do not "
            f"decide anything yet."
        )
        perception_text, calls = self.llm.run_tool_loop(
            system=self.system_prompt,
            instruction=instruction,
            tools=self.tools,
            schemas=PERCEPTION_TOOL_SCHEMAS,
        )

        price = self._latest_price(ticker, calls)
        position_qty = self._position_qty(ticker, calls)
        degraded = self._is_degraded(calls, price)

        # --- HOLD-on-bad-data short circuit --------------------------- #
        if degraded:
            self.audit.system_event(
                f"{ticker}: degraded perception (no valid market data) — defaulting to HOLD."
            )
            self.audit.write_cycle(
                ticker=ticker, perception=calls, perception_text=perception_text,
                reasoning=None, adversarial=None, decision=None, verdict=None,
                action_result="No order — HOLD (degraded perception).", degraded=True,
            )
            return CycleResult(ticker, "HOLD", 0, degraded=True, executed=False)

        context = self._context_text(perception_text, calls)

        # --- Phase 2: Cognitive Planning ------------------------------ #
        reasoning = self.llm.parse(
            system=self.system_prompt,
            prompt=(
                f"Cognitive Planning phase for {ticker}. Based ONLY on the gathered "
                f"data below, produce the structured Reasoning State.\n\n{context}"
            ),
            schema=ReasoningState,
        )
        self.audit.write_reasoning_state(ticker, reasoning)

        # --- Phase 3: Reflection (adversarial) ------------------------ #
        adversarial = self.llm.parse(
            system=self.system_prompt,
            prompt=(
                f"Reflection phase for {ticker}. Construct a genuine bull case AND a "
                f"genuine bear case. Steel-man both. Data and plan:\n\n{context}\n\n"
                f"Plan summary: {reasoning.summary}"
            ),
            schema=AdversarialCheck,
        )

        # --- Phase 4: Action (proposed decision) ---------------------- #
        decision = self.llm.parse(
            system=self.system_prompt,
            prompt=(
                f"Action phase for {ticker}. Weighing both cases, propose a single "
                f"decision (BUY/SELL/HOLD). Remember the 5% position cap. "
                f"Bull: {adversarial.bull_case}\nBear: {adversarial.bear_case}\n"
                f"Net: {adversarial.net_assessment}"
            ),
            schema=TradeDecision,
        )

        # --- Guardrails (hard limits, in code) ------------------------ #
        verdict = self.guardrails.validate_decision(
            action=decision.action,
            ticker=ticker,
            target_notional_usd=decision.target_notional_usd,
            equity=equity,
            price=price,
            current_position_qty=position_qty,
        )

        # --- Execution (driver only) ---------------------------------- #
        # A BUY is placed as a bracket order: a protective stop-loss (and optional
        # take-profit) are attached at entry so they hold even if the agent is
        # offline. Levels come from the guardrails, not the model.
        executed = False
        stop_price = take_profit_price = None
        if verdict.action == "BUY":
            stop_price, take_profit_price = self.guardrails.bracket_prices(price)
        bracket_desc = (
            f" with stop ${stop_price:,.2f}"
            + (f" / take-profit ${take_profit_price:,.2f}" if take_profit_price else "")
            if stop_price else ""
        )

        if verdict.approved and verdict.action in ("BUY", "SELL"):
            if self.dry_run:
                # Intercept: do NOT send the order. Log the proposed trade only.
                action_result = (
                    f"DRY RUN — would have executed {verdict.action} "
                    f"{verdict.quantity} {ticker} (~${verdict.quantity * price:,.0f})"
                    f"{bracket_desc}. No order sent to the broker."
                )
            else:
                try:
                    self.tools.execute_order(
                        ticker, verdict.quantity, verdict.action.lower(), "market",
                        stop_loss_price=stop_price,
                        take_profit_price=take_profit_price,
                    )
                    action_result = (
                        f"Executed {verdict.action} {verdict.quantity} {ticker}"
                        f"{bracket_desc}."
                    )
                    executed = True
                except Exception as exc:  # noqa: BLE001
                    action_result = f"Execution FAILED: {exc}"
                    self.audit.system_event(f"{ticker}: order execution failed: {exc}")
        else:
            action_result = f"No order placed ({verdict.action})."

        # --- Phase 5: Memory / Audit ---------------------------------- #
        self.audit.write_cycle(
            ticker=ticker, perception=calls, perception_text=perception_text,
            reasoning=reasoning, adversarial=adversarial, decision=decision,
            verdict=verdict, action_result=action_result, degraded=False,
        )
        return CycleResult(ticker, verdict.action, verdict.quantity, False, executed)

    # ------------------------------------------------------------------ #
    # Helpers — interpret the perception tool outputs.
    # ------------------------------------------------------------------ #
    @staticmethod
    def _latest_price(ticker: str, calls: list[ToolCall]) -> float:
        for call in calls:
            if call.name == "get_market_bars" and not call.is_error \
                    and call.input.get("ticker") == ticker:
                try:
                    return float(json.loads(call.output)["latest_close"])
                except (json.JSONDecodeError, KeyError, TypeError, ValueError):
                    continue
        return 0.0

    @staticmethod
    def _position_qty(ticker: str, calls: list[ToolCall]) -> float:
        for call in calls:
            if call.name == "get_portfolio_state" and not call.is_error:
                try:
                    state = json.loads(call.output)
                    for pos in state.get("positions", []):
                        if pos.get("symbol") == ticker:
                            return float(pos.get("qty", 0))
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
        return 0.0

    @staticmethod
    def _is_degraded(calls: list[ToolCall], price: float) -> bool:
        """Degraded if no successful market-bars call produced a usable price."""
        got_bars = any(
            c.name == "get_market_bars" and not c.is_error for c in calls
        )
        return not got_bars or price <= 0

    @staticmethod
    def _context_text(perception_text: str, calls: list[ToolCall]) -> str:
        parts = ["Gathered data (tool results):"]
        for call in calls:
            status = "ERROR" if call.is_error else "ok"
            parts.append(f"- {call.name} [{status}]: {call.output}")
        if perception_text:
            parts.append(f"\nAgent's own summary: {perception_text}")
        return "\n".join(parts)
