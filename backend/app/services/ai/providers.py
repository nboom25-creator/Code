"""Concrete AI providers.

RulesProvider: deterministic, always available, no network.
MockProvider: fixed strings for tests.
OpenAIProvider / AnthropicProvider: optional, enabled by API keys; their JSON
output is schema-validated and treated as a DRAFT for user confirmation.
"""
from __future__ import annotations

import json

from .base import LoadCaseProposal, ProposedBC, validate_proposal

_SYSTEM = (
    "You convert a user's plain-language description of how a mechanical part is used into a "
    "STRUCTURED load-case draft. Use ONLY quantities the user stated; if a magnitude, direction or "
    "unit is missing, leave it null and add a question to open_questions. Never invent numbers. "
    "Respond with JSON matching: {name, rationale, boundary_conditions:[{bc_type(fixed|pinned|roller|"
    "force|pressure|torque|gravity), description, magnitude, units, direction:[x,y,z], region_hint}], "
    "open_questions:[...]}"
)


class RulesProvider:
    name = "rules"

    def explain_recommendations(self, recommendations: list[dict], context: dict) -> str:
        if not recommendations:
            return ("No rule-based findings. This does not certify the design — it means none of the "
                    "implemented checks fired with the information provided.")
        parts = [f"{len(recommendations)} findings, ordered by severity:"]
        for r in recommendations:
            parts.append(
                f"- [{r.get('severity', '?').upper()}] {r.get('title')}: {r.get('problem')} "
                f"Suggested action: {r.get('proposed_change')} "
                f"(rule {r.get('rule_id')}, confidence {r.get('confidence')})")
        parts.append("Each finding lists its evidence and assumptions in the details panel; verify "
                     "assumptions before acting on high-impact changes.")
        return "\n".join(parts)

    def propose_load_case(self, free_text: str, context: dict) -> LoadCaseProposal:
        """Keyword-based deterministic draft: extracts only numbers the user wrote."""
        import re
        text = free_text.lower()
        bcs: list[ProposedBC] = []
        questions: list[str] = []
        m = re.search(r"(\d+(?:\.\d+)?)\s*(n|kn|lbf|kgf)\b", text)
        if m:
            unit_map = {"n": "N", "kn": "kN", "lbf": "lbf", "kgf": "kgf"}
            bcs.append(ProposedBC(
                bc_type="force", magnitude=float(m.group(1)), units=unit_map[m.group(2)],
                direction=[0, 0, -1] if ("down" in text or "weight" in text or "hang" in text) else None,
                description="Force mentioned in description",
                region_hint="select the loaded surface in the editor"))
            if bcs[-1].direction is None:
                questions.append("Which direction does the force act in?")
        m = re.search(r"(\d+(?:\.\d+)?)\s*(mpa|kpa|bar|psi)\b", text)
        if m:
            bcs.append(ProposedBC(
                bc_type="pressure", magnitude=float(m.group(1)), units=m.group(2).replace("mpa", "MPa").replace("kpa", "kPa"),
                description="Pressure mentioned in description",
                region_hint="select the pressurized surface"))
        if any(w in text for w in ("bolt", "screw", "mount", "fixed", "clamp")):
            bcs.append(ProposedBC(bc_type="fixed", description="Mounting interface inferred from description",
                                  region_hint="select the bolted/clamped faces"))
        else:
            questions.append("How is the part held in place (bolted, clamped, resting)?")
        if not any(b.bc_type == "force" or b.bc_type == "pressure" for b in bcs):
            questions.append("What load (force/pressure/torque) with magnitude and units applies?")
        if "gravity" in text or "weight" in text:
            bcs.append(ProposedBC(bc_type="gravity", description="Self-weight", direction=[0, 0, -1]))
        return LoadCaseProposal(
            name="Draft from description (rules provider)",
            rationale="Deterministic keyword extraction; only values present in your text were used.",
            boundary_conditions=bcs, open_questions=questions)


class MockProvider:
    name = "mock"

    def explain_recommendations(self, recommendations: list[dict], context: dict) -> str:
        return f"[mock provider] {len(recommendations)} recommendations."

    def propose_load_case(self, free_text: str, context: dict) -> LoadCaseProposal:
        return LoadCaseProposal(name="Mock proposal", boundary_conditions=[],
                                open_questions=["mock provider: no analysis performed"])


class _HttpLLMProvider:
    """Shared plumbing for OpenAI-compatible and Anthropic APIs via httpx."""

    def _proposal_from_text(self, content: str) -> LoadCaseProposal:
        start = content.find("{")
        end = content.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("LLM response contained no JSON object")
        raw = json.loads(content[start:end + 1])
        return validate_proposal(raw)


class OpenAIProvider(_HttpLLMProvider):
    name = "openai"

    def __init__(self, settings):
        self.settings = settings

    def _chat(self, system: str, user: str) -> str:
        import httpx
        r = httpx.post(
            f"{self.settings.openai_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
            json={"model": self.settings.openai_model,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": user}],
                  "temperature": 0},
            timeout=60)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

    def explain_recommendations(self, recommendations: list[dict], context: dict) -> str:
        return self._chat(
            "You explain engineering-analysis findings. Use ONLY the numbers provided; do not invent "
            "values or claim certainty beyond the stated confidence.",
            json.dumps({"recommendations": recommendations, "context": context})[:60000])

    def propose_load_case(self, free_text: str, context: dict) -> LoadCaseProposal:
        return self._proposal_from_text(self._chat(_SYSTEM, free_text[:8000]))


class AnthropicProvider(_HttpLLMProvider):
    name = "anthropic"

    def __init__(self, settings):
        self.settings = settings

    def _chat(self, system: str, user: str) -> str:
        import httpx
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": self.settings.anthropic_api_key,
                     "anthropic-version": "2023-06-01"},
            json={"model": self.settings.anthropic_model, "max_tokens": 2000,
                  "system": system,
                  "messages": [{"role": "user", "content": user}]},
            timeout=60)
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json()["content"])

    def explain_recommendations(self, recommendations: list[dict], context: dict) -> str:
        return self._chat(
            "You explain engineering-analysis findings. Use ONLY the numbers provided; do not invent "
            "values or claim certainty beyond the stated confidence.",
            json.dumps({"recommendations": recommendations, "context": context})[:60000])

    def propose_load_case(self, free_text: str, context: dict) -> LoadCaseProposal:
        return self._proposal_from_text(self._chat(_SYSTEM, free_text[:8000]))
