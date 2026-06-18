"""Structured outputs for each cognitive phase.

Each phase of the Research-then-Decide loop emits one of these Pydantic models.
Using structured outputs (validated against the schema by the Claude API) makes
the cognitive steps deterministic in shape — the agent cannot "skip" a phase by
returning prose, and the audit log always has the same fields to record.

Schema note: the Structured Outputs feature does not support numeric range
constraints, so fields like ``confidence`` are clamped in the guardrail layer
rather than in the schema.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ReasoningState(BaseModel):
    """Phase 2 — Cognitive Planning. What was found and what must be verified."""

    summary: str = Field(description="One-paragraph summary of what the gathered data shows.")
    data_found: list[str] = Field(
        description="Concrete facts pulled from tools this cycle (prices, indicators, headlines)."
    )
    subtasks_to_verify: list[str] = Field(
        description="Specific open questions that must be answered before acting."
    )
    key_risks: list[str] = Field(description="The main risks to any position in this name right now.")


class AdversarialCheck(BaseModel):
    """Phase 3 — Reflection. A genuine bull case and a genuine bear case."""

    bull_case: str = Field(description="The strongest honest argument FOR taking/holding a long.")
    bull_points: list[str] = Field(description="Bullet evidence supporting the bull case.")
    bear_case: str = Field(description="The strongest honest argument AGAINST it / for the downside.")
    bear_points: list[str] = Field(description="Bullet evidence supporting the bear case.")
    net_assessment: str = Field(
        description="After weighing both sides, the balanced conclusion. May favour caution."
    )


class TradeDecision(BaseModel):
    """Phase 4 — Action. A proposed decision. The harness sizes and validates it."""

    action: Literal["BUY", "SELL", "HOLD"] = Field(description="The proposed action.")
    ticker: str = Field(description="The ticker the decision applies to.")
    target_notional_usd: float = Field(
        description=(
            "Proposed dollar amount to allocate for a BUY (0 for SELL/HOLD). The "
            "harness caps this at 5% of portfolio value and converts to whole shares."
        )
    )
    confidence: float = Field(description="Confidence in the decision, 0.0 to 1.0.")
    rationale: str = Field(description="Why this action, grounded in the data and the adversarial check.")
