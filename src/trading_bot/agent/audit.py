"""Audit trail — the Memory phase.

Writes a human-readable markdown record of each cognitive cycle to
``logs/YYYY-MM-DD.md`` (appended, so a day accumulates every ticker considered),
plus a structured JSON sidecar of the reasoning state for machine consumption.
Full transparency is the point: anyone can read exactly what the agent saw,
how it reasoned, both cases it argued, and what the guardrails did.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import asdict
from pathlib import Path

from .guardrails import GuardrailVerdict
from .schemas import AdversarialCheck, PositionReview, ReasoningState, TradeDecision
from .tools import ToolCall


class AuditLog:
    def __init__(self, log_dir: str | Path = "logs") -> None:
        self.log_dir = Path(log_dir)
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def _today(self) -> str:
        return dt.date.today().isoformat()

    def _md_path(self) -> Path:
        return self.log_dir / f"{self._today()}.md"

    def _append(self, text: str) -> None:
        with self._md_path().open("a", encoding="utf-8") as fh:
            fh.write(text)

    # ------------------------------------------------------------------ #
    def day_header(self, *, equity: float) -> None:
        if self._md_path().exists():
            return  # header already written for today
        self._append(
            f"# Trading agent audit — {self._today()}\n\n"
            f"Opening equity: ${equity:,.2f}\n\n"
            f"---\n\n"
        )

    def system_event(self, message: str) -> None:
        ts = dt.datetime.now().strftime("%H:%M:%S")
        self._append(f"> **[{ts}] SYSTEM:** {message}\n\n")

    def write_cycle(
        self,
        *,
        ticker: str,
        perception: list[ToolCall],
        perception_text: str,
        reasoning: ReasoningState | None,
        adversarial: AdversarialCheck | None,
        decision: TradeDecision | None,
        verdict: GuardrailVerdict | None,
        action_result: str,
        degraded: bool,
        profile: str = "",
    ) -> None:
        ts = dt.datetime.now().strftime("%H:%M:%S")
        lines = [f"## {ticker} — {ts}\n"]
        if profile:
            lines.append(f"_Profile: **{profile}**_\n")

        lines.append("### 1. Perception\n")
        for call in perception:
            flag = "⚠️ ERROR" if call.is_error else "ok"
            lines.append(f"- `{call.name}({json.dumps(call.input)})` → {flag}: `{call.output}`")
        if perception_text:
            lines.append(f"\n_Agent perception summary:_ {perception_text}\n")

        if degraded:
            lines.append(
                "\n### ⛔ Degraded perception — forcing HOLD\n"
                "Data fetching failed or returned empty/corrupted data. "
                "Per policy, the agent defaults to HOLD and logs a system exception.\n"
            )

        if reasoning is not None:
            lines.append("\n### 2. Cognitive plan\n")
            lines.append(f"{reasoning.summary}\n")
            lines.append("**Data found:**")
            lines += [f"- {d}" for d in reasoning.data_found]
            lines.append("\n**To verify:**")
            lines += [f"- {s}" for s in reasoning.subtasks_to_verify]
            lines.append("\n**Key risks:**")
            lines += [f"- {r}" for r in reasoning.key_risks]

        if adversarial is not None:
            lines.append("\n### 3. Reflection — adversarial check\n")
            lines.append(f"**Bull case.** {adversarial.bull_case}")
            lines += [f"- 🐂 {p}" for p in adversarial.bull_points]
            lines.append(f"\n**Bear case.** {adversarial.bear_case}")
            lines += [f"- 🐻 {p}" for p in adversarial.bear_points]
            lines.append(f"\n**Net assessment.** {adversarial.net_assessment}")

        if decision is not None:
            lines.append("\n### 4. Decision (proposed)\n")
            lines.append(
                f"- **{decision.action}** {decision.ticker} · "
                f"proposed ${decision.target_notional_usd:,.0f} · "
                f"confidence {decision.confidence:.0%}"
            )
            lines.append(f"- _Rationale:_ {decision.rationale}")

        if verdict is not None:
            lines.append("\n### 5. Guardrails & action\n")
            for note in verdict.notes:
                lines.append(f"- {note}")
            lines.append(f"- **Final action:** {verdict.action} · qty={verdict.quantity}")
        lines.append(f"- **Execution:** {action_result}\n")

        lines.append("\n---\n\n")
        self._append("\n".join(lines))

    def write_review(
        self,
        *,
        ticker: str,
        perception: list[ToolCall],
        perception_text: str,
        reasoning: ReasoningState,
        adversarial: AdversarialCheck,
        review: PositionReview,
        verdict_notes: list[str],
        action_result: str,
        profile: str,
        unrealized_pct: float,
        qty_held: int,
    ) -> None:
        ts = dt.datetime.now().strftime("%H:%M:%S")
        lines = [
            f"## {ticker} — POSITION REVIEW — {ts}\n",
            f"_Profile: **{profile}** · holding {qty_held} shares · "
            f"unrealized {unrealized_pct:+.1f}%_\n",
            "### 1. Perception\n",
        ]
        for call in perception:
            flag = "⚠️ ERROR" if call.is_error else "ok"
            lines.append(f"- `{call.name}({json.dumps(call.input)})` → {flag}: `{call.output}`")

        lines.append("\n### 2. Cognitive plan\n")
        lines.append(reasoning.summary)

        lines.append("\n### 3. Reflection — hold vs exit\n")
        lines.append(f"**Hold/add case.** {adversarial.bull_case}")
        lines.append(f"\n**Exit case.** {adversarial.bear_case}")
        lines.append(f"\n**Net.** {adversarial.net_assessment}")

        lines.append("\n### 4. Review decision\n")
        lines.append(f"- **{review.action}** "
                     + (f"(fraction {review.fraction:.0%}) " if review.action in ("TRIM", "ADD") else "")
                     + f"· confidence {review.confidence:.0%}")
        lines.append(f"- _Rationale:_ {review.rationale}")

        lines.append("\n### 5. Guardrails & action\n")
        for note in verdict_notes:
            lines.append(f"- {note}")
        lines.append(f"- **Execution:** {action_result}\n")
        lines.append("\n---\n\n")
        self._append("\n".join(lines))

    def write_reasoning_state(self, ticker: str, reasoning: ReasoningState) -> None:
        """Structured JSON sidecar of the reasoning state."""
        path = self.log_dir / f"reasoning_{self._today()}_{ticker}.json"
        path.write_text(json.dumps(reasoning.model_dump(), indent=2), encoding="utf-8")
