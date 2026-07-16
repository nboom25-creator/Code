"""AI provider interface.

Providers may EXPLAIN deterministic results and TRANSLATE free-text into a
proposed structured load case (which the user must review and confirm). They
never produce numerical analysis results: every number shown in the app comes
from the geometry/FEA code, and load-case proposals are drafts validated
against a strict schema, applied only after user confirmation.
"""
from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field, ValidationError


class ProposedBC(BaseModel):
    bc_type: str = Field(pattern="^(fixed|pinned|roller|force|pressure|torque|gravity)$")
    description: str = ""
    magnitude: float | None = None
    units: str | None = None
    direction: list[float] | None = None
    region_hint: str = ""   # human-readable: "the two mounting holes" — user must map to a region


class LoadCaseProposal(BaseModel):
    name: str = "Proposed load case"
    rationale: str = ""
    boundary_conditions: list[ProposedBC] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)


class AIProvider(Protocol):
    name: str

    def explain_recommendations(self, recommendations: list[dict], context: dict) -> str: ...

    def propose_load_case(self, free_text: str, context: dict) -> LoadCaseProposal: ...


def validate_proposal(raw: dict) -> LoadCaseProposal:
    try:
        return LoadCaseProposal.model_validate(raw)
    except ValidationError as exc:
        raise ValueError(f"AI proposal failed schema validation: {exc}") from exc


def get_provider(settings) -> AIProvider:
    from .providers import AnthropicProvider, MockProvider, OpenAIProvider, RulesProvider
    kind = settings.ai_provider.lower()
    if kind == "openai" and settings.openai_api_key:
        return OpenAIProvider(settings)
    if kind == "anthropic" and settings.anthropic_api_key:
        return AnthropicProvider(settings)
    if kind == "mock":
        return MockProvider()
    return RulesProvider()
