"""The Research-then-Decide cognitive loop (the driver).

Forces every cycle through the five mandatory phases in order:

    Perception -> Cognitive Planning -> Reflection -> Action -> Memory/Audit

The driver is deterministic Python. The model is consulted at each cognitive
phase, but sizing, the hard guardrails, and execution all happen here, in code
the model cannot reach. If perception degrades (a data tool fails or returns
empty/corrupted data), the loop short-circuits to HOLD and logs an exception
before ever asking the model to plan or decide.

Two entry points share the same perception/enrichment machinery:
* ``run_for_ticker`` — consider a NEW position (BUY/SELL/HOLD).
* ``review_position`` — manage an OPEN position (HOLD/TRIM/EXIT/ADD).

Every executed (or dry-run) fill is recorded to the trade ledger so outcomes can
be measured and attributed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from .audit import AuditLog
from .guardrails import Guardrails
from .ledger import Fill, TradeLedger
from .llm import LLM
from .schemas import AdversarialCheck, PositionReview, ReasoningState, TradeDecision
from .tools import PERCEPTION_TOOL_SCHEMAS, AgentTools, ToolCall


@dataclass
class CycleResult:
    ticker: str
    final_action: str
    quantity: int
    degraded: bool
    executed: bool


@dataclass
class Perception:
    ticker: str
    calls: list[ToolCall]
    text: str
    price: float
    avg_volume: float
    position_qty: float
    avg_entry: float
    profile: str
    directive: str
    degraded: bool
    context: str


class CognitiveLoop:
    SMALL_CAP_MAX = 2_000_000_000  # $2B — boundary for small/micro-cap handling
    MIN_NEWS_ITEMS = 3             # trigger the deep-research fallback below this

    def __init__(
        self,
        *,
        llm: LLM,
        tools: AgentTools,
        guardrails: Guardrails,
        audit: AuditLog,
        system_prompt: str,
        dry_run: bool = False,
        ledger: TradeLedger | None = None,
        mode: str | None = None,
    ) -> None:
        self.llm = llm
        self.tools = tools
        self.guardrails = guardrails
        self.audit = audit
        self.system_prompt = system_prompt
        # In dry-run mode, the final execute_order call is intercepted: the
        # proposed trade and its reasoning are logged, but no order is sent.
        self.dry_run = dry_run
        self.ledger = ledger
        self.mode = mode or ("dry_run" if dry_run else "paper")

    # ================================================================== #
    # Perception (shared by entry and review)
    # ================================================================== #
    def _perceive(self, ticker: str) -> Perception:
        instruction = (
            f"Begin the Perception phase for {ticker}. Use the read-only tools to "
            f"gather (1) recent price bars, (2) recent company news, and (3) the "
            f"current portfolio state. Then briefly state what you found. Do not "
            f"decide anything yet."
        )
        text, calls = self.llm.run_tool_loop(
            system=self.system_prompt, instruction=instruction,
            tools=self.tools, schemas=PERCEPTION_TOOL_SCHEMAS,
        )
        price = self._latest_price(ticker, calls)
        degraded = self._is_degraded(calls, price)
        if degraded:
            return Perception(ticker, calls, text, price, 0.0, 0.0, 0.0,
                              "", "", True, "")

        profile, directive = self._enrich_and_classify(ticker, calls)
        observe = getattr(self.llm, "observe", None)
        if callable(observe):
            observe(calls, profile=profile)
        return Perception(
            ticker=ticker, calls=calls, text=text, price=price,
            avg_volume=self._avg_volume(ticker, calls),
            position_qty=self._position_qty(ticker, calls),
            avg_entry=self._avg_entry(ticker, calls),
            profile=profile, directive=directive, degraded=False,
            context=self._context_text(text, calls),
        )

    # ================================================================== #
    # Entry: consider a new position
    # ================================================================== #
    def run_for_ticker(self, ticker: str, *, equity: float,
                       exposure_scale: float = 1.0) -> CycleResult:
        p = self._perceive(ticker)
        if p.degraded:
            return self._log_degraded(ticker, p)

        reasoning = self._plan(ticker, p)
        adversarial = self._reflect(ticker, p, reasoning)
        decision = self.llm.parse(
            system=self.system_prompt,
            prompt=(
                f"Action phase for {ticker} [{p.profile}]. {p.directive}\n\n"
                f"Weighing both cases, propose a single decision (BUY/SELL/HOLD). "
                f"Remember the 5% position cap. "
                f"Bull: {adversarial.bull_case}\nBear: {adversarial.bear_case}\n"
                f"Net: {adversarial.net_assessment}"
            ),
            schema=TradeDecision,
        )

        verdict = self.guardrails.validate_decision(
            action=decision.action, ticker=ticker,
            target_notional_usd=decision.target_notional_usd,
            equity=equity, price=p.price, current_position_qty=p.position_qty,
            avg_daily_volume=p.avg_volume, exposure_scale=exposure_scale,
        )

        executed, action_result = self._execute(
            ticker, verdict.action, verdict.quantity, p.price,
            confidence=decision.confidence, profile=p.profile,
            rationale=decision.rationale, approved=verdict.approved,
        )

        self.audit.write_cycle(
            ticker=ticker, perception=p.calls, perception_text=p.text,
            reasoning=reasoning, adversarial=adversarial, decision=decision,
            verdict=verdict, action_result=action_result, degraded=False,
            profile=p.profile,
        )
        return CycleResult(ticker, verdict.action, verdict.quantity, False, executed)

    # ================================================================== #
    # Manage: review an open position
    # ================================================================== #
    def review_position(self, ticker: str, *, equity: float,
                        exposure_scale: float = 1.0) -> CycleResult:
        p = self._perceive(ticker)
        if p.degraded:
            return self._log_degraded(ticker, p, review=True)

        qty_held = int(p.position_qty)
        if qty_held <= 0:  # nothing to manage
            return CycleResult(ticker, "HOLD", 0, False, False)

        unrealized_pct = ((p.price / p.avg_entry - 1) * 100) if p.avg_entry else 0.0
        note = getattr(self.llm, "note_position", None)
        if callable(note):
            note(unrealized_pct)

        reasoning = self._plan(ticker, p)
        adversarial = self._reflect(ticker, p, reasoning)
        review = self.llm.parse(
            system=self.system_prompt,
            prompt=(
                f"Position review for {ticker} [{p.profile}]. {p.directive}\n\n"
                f"You HOLD {qty_held} shares; entry ~${p.avg_entry:.2f}, now "
                f"~${p.price:.2f} ({unrealized_pct:+.1f}% unrealized). Decide "
                f"HOLD / TRIM / EXIT / ADD. Bull (hold/add): {adversarial.bull_case}\n"
                f"Bear (exit): {adversarial.bear_case}\nNet: {adversarial.net_assessment}"
            ),
            schema=PositionReview,
        )

        verdict, executed, action_result = self._apply_review(
            ticker, review, qty_held, equity, p, exposure_scale=exposure_scale)

        self.audit.write_review(
            ticker=ticker, perception=p.calls, perception_text=p.text,
            reasoning=reasoning, adversarial=adversarial, review=review,
            verdict_notes=verdict, action_result=action_result,
            profile=p.profile, unrealized_pct=unrealized_pct, qty_held=qty_held,
        )
        return CycleResult(ticker, review.action, executed[1], False, executed[0])

    def _apply_review(self, ticker, review, qty_held, equity, p, *, exposure_scale=1.0):
        """Translate a PositionReview into a guarded, executed order."""
        notes: list[str] = []
        action = review.action.upper()
        frac = max(0.0, min(1.0, review.fraction))

        if action == "EXIT":
            qty, side = qty_held, "sell"
            notes.append(f"EXIT: closing all {qty_held} shares.")
        elif action == "TRIM":
            qty = int(qty_held * frac)
            side = "sell"
            if qty < 1:
                notes.append(f"TRIM fraction {frac:.0%} rounds to 0 shares — HOLD instead.")
                return notes, (False, 0), "No order (TRIM too small)."
            notes.append(f"TRIM: selling {qty} of {qty_held} shares ({frac:.0%}).")
        elif action == "ADD":
            notional = equity * self.guardrails.max_position_pct * frac
            v = self.guardrails.validate_decision(
                action="BUY", ticker=ticker, target_notional_usd=notional,
                equity=equity, price=p.price, current_position_qty=qty_held,
                avg_daily_volume=p.avg_volume, exposure_scale=exposure_scale)
            notes += v.notes
            if not v.approved:
                return notes, (False, 0), f"No order (ADD vetoed: {v.action})."
            ex, res = self._execute(ticker, "BUY", v.quantity, p.price,
                                    confidence=review.confidence, profile=p.profile,
                                    rationale=review.rationale, approved=True)
            return notes, (ex, v.quantity), res
        else:  # HOLD
            return notes, (False, 0), "HOLD — keeping the position unchanged."

        ex, res = self._execute(ticker, side.upper(), qty, p.price,
                                confidence=review.confidence, profile=p.profile,
                                rationale=review.rationale, approved=True)
        return notes, (ex, qty), res

    # ================================================================== #
    # Shared cognitive phases
    # ================================================================== #
    def _plan(self, ticker: str, p: Perception) -> ReasoningState:
        reasoning = self.llm.parse(
            system=self.system_prompt,
            prompt=(
                f"Cognitive Planning phase for {ticker} [{p.profile}]. {p.directive}\n\n"
                f"Based ONLY on the gathered data below, produce the structured "
                f"Reasoning State.\n\n{p.context}"
            ),
            schema=ReasoningState,
        )
        self.audit.write_reasoning_state(ticker, reasoning)
        return reasoning

    def _reflect(self, ticker: str, p: Perception, reasoning: ReasoningState) -> AdversarialCheck:
        return self.llm.parse(
            system=self.system_prompt,
            prompt=(
                f"Reflection phase for {ticker} [{p.profile}]. {p.directive}\n\n"
                f"Construct a genuine bull case AND a genuine bear case. Steel-man "
                f"both. Data and plan:\n\n{p.context}\n\nPlan summary: {reasoning.summary}"
            ),
            schema=AdversarialCheck,
        )

    # ================================================================== #
    # Execution + ledger (driver only)
    # ================================================================== #
    def _execute(self, ticker, action, qty, price, *, confidence, profile,
                 rationale, approved) -> tuple[bool, str]:
        action = action.upper()
        if not approved or action not in ("BUY", "SELL") or qty < 1:
            return False, f"No order placed ({action})."

        stop_price = take_profit_price = None
        bracket_desc = ""
        if action == "BUY":
            stop_price, take_profit_price = self.guardrails.bracket_prices(price)
            bracket_desc = (f" with stop ${stop_price:,.2f}"
                            + (f" / take-profit ${take_profit_price:,.2f}"
                               if take_profit_price else ""))

        if self.dry_run:
            result = (f"DRY RUN — would have executed {action} {qty} {ticker} "
                      f"(~${qty * price:,.0f}){bracket_desc}. No order sent.")
            self._record_fill(ticker, action.lower(), qty, price, profile,
                              confidence, rationale)
            return False, result
        try:
            self.tools.execute_order(
                ticker, qty, action.lower(), "market",
                stop_loss_price=stop_price, take_profit_price=take_profit_price)
            self._record_fill(ticker, action.lower(), qty, price, profile,
                              confidence, rationale)
            return True, f"Executed {action} {qty} {ticker}{bracket_desc}."
        except Exception as exc:  # noqa: BLE001
            self.audit.system_event(f"{ticker}: order execution failed: {exc}")
            return False, f"Execution FAILED: {exc}"

    def _record_fill(self, ticker, side, qty, price, profile, confidence, rationale):
        if self.ledger is None or qty < 1:
            return
        self.ledger.record(Fill(
            ticker=ticker, side=side, qty=int(qty), price=float(price),
            mode=self.mode, profile=profile, confidence=float(confidence),
            rationale=(rationale or "")[:200],
        ))

    def _log_degraded(self, ticker: str, p: Perception, *, review: bool = False) -> CycleResult:
        kind = "review" if review else "entry"
        self.audit.system_event(
            f"{ticker}: degraded perception (no valid market data) during {kind} "
            f"— defaulting to HOLD.")
        self.audit.write_cycle(
            ticker=ticker, perception=p.calls, perception_text=p.text,
            reasoning=None, adversarial=None, decision=None, verdict=None,
            action_result="No order — HOLD (degraded perception).", degraded=True,
        )
        return CycleResult(ticker, "HOLD", 0, degraded=True, executed=False)

    # ================================================================== #
    # Multi-tiered research fallback + small/large-cap classification.
    # ================================================================== #
    def _enrich_and_classify(self, ticker: str, calls: list[ToolCall]) -> tuple[str, str]:
        """Run the deep-research fallback when news is sparse, classify the name as
        small- or large-cap, and return (profile, asymmetric_directive)."""
        news_count = self._news_count(calls)
        has_research = self.tools.research is not None

        market_cap = None
        company_name = ticker
        if has_research:
            fcall = self.tools.dispatch("get_fundamentals", {"ticker": ticker})
            calls.append(fcall)
            market_cap, company_name = self._fundamentals_facts(fcall, ticker)

        if news_count < self.MIN_NEWS_ITEMS and has_research:
            self.audit.system_event(
                f"{ticker}: sparse news ({news_count} items) — invoking deep-research "
                f"fallback (SEC filings, insider activity, web research).")
            calls.append(self.tools.dispatch("get_sec_filings", {"ticker": ticker}))
            calls.append(self.tools.dispatch("get_insider_activity", {"ticker": ticker}))
            calls.append(self.tools.dispatch(
                "web_research", {"ticker": ticker, "company_name": company_name}))

        if market_cap is not None:
            is_small = market_cap <= self.SMALL_CAP_MAX
        else:
            is_small = news_count < self.MIN_NEWS_ITEMS

        if is_small:
            profile = "small-cap"
            directive = (
                "This is a thinly-covered small/micro-cap. Heavily weigh raw "
                "FUNDAMENTALS (cash runway, debt-to-equity, current ratio, revenue "
                "growth) and UNUSUAL VOLUME changes. Mainstream news sentiment is "
                "expected to be sparse or empty — do NOT treat missing sentiment as a "
                "reason to fail or to default bearish. If sentiment is empty, rely "
                "100% on the fundamentals and volume evidence above.")
        else:
            profile = "large-cap"
            directive = (
                "This is a large-cap with dense coverage. Prioritize broad macro "
                "trends and high-volume news sentiment, corroborated by price action.")
        return profile, directive

    # ------------------------------------------------------------------ #
    # Helpers — interpret the perception tool outputs.
    # ------------------------------------------------------------------ #
    @staticmethod
    def _news_count(calls: list[ToolCall]) -> int:
        for call in calls:
            if call.name == "get_company_news" and not call.is_error:
                try:
                    return int(json.loads(call.output).get("count", 0))
                except (json.JSONDecodeError, ValueError, TypeError):
                    return 0
        return 0

    @staticmethod
    def _fundamentals_facts(call: ToolCall, ticker: str) -> tuple[float | None, str]:
        if call.is_error:
            return None, ticker
        try:
            f = json.loads(call.output).get("fundamentals") or {}
            return f.get("market_cap"), (f.get("name") or ticker)
        except (json.JSONDecodeError, ValueError, TypeError):
            return None, ticker

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
    def _avg_volume(ticker: str, calls: list[ToolCall]) -> float:
        for call in calls:
            if call.name == "get_market_bars" and not call.is_error \
                    and call.input.get("ticker") == ticker:
                try:
                    return float(json.loads(call.output).get("avg_volume", 0.0))
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
    def _avg_entry(ticker: str, calls: list[ToolCall]) -> float:
        for call in calls:
            if call.name == "get_portfolio_state" and not call.is_error:
                try:
                    state = json.loads(call.output)
                    for pos in state.get("positions", []):
                        if pos.get("symbol") == ticker:
                            return float(pos.get("avg_price", 0))
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
        return 0.0

    @staticmethod
    def _is_degraded(calls: list[ToolCall], price: float) -> bool:
        got_bars = any(c.name == "get_market_bars" and not c.is_error for c in calls)
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
