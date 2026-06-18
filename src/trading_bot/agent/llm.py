"""LLM abstraction for the cognitive loop.

The cognitive loop needs two primitives from the model:

* ``run_tool_loop`` — a manual agentic tool-use loop for the Perception phase,
  where the model calls the read-only tools and the harness dispatches them.
* ``parse`` — a single structured-output call returning a validated Pydantic
  object, used for the Planning, Reflection, and Action phases.

``AnthropicLLM`` implements both against Claude (``claude-opus-4-8`` with adaptive
thinking). The ``anthropic`` SDK is imported lazily so the rest of the package
(and the offline tests, which use ``ScriptedLLM``) need no API key or dependency.
"""

from __future__ import annotations

from typing import Protocol, TypeVar

from pydantic import BaseModel

from .tools import AgentTools, ToolCall

T = TypeVar("T", bound=BaseModel)

# Per the loaded Claude API reference: default to Opus 4.8 with adaptive thinking.
DEFAULT_MODEL = "claude-opus-4-8"


class LLM(Protocol):
    def run_tool_loop(
        self, *, system: str, instruction: str, tools: AgentTools, schemas: list[dict]
    ) -> tuple[str, list[ToolCall]]:
        """Run the perception tool-use loop. Returns (final_text, tool_calls)."""
        ...

    def parse(self, *, system: str, prompt: str, schema: type[T]) -> T:
        """Single structured-output call returning a validated ``schema`` instance."""
        ...


class AnthropicLLM:
    """Real implementation backed by the Claude Messages API."""

    def __init__(self, *, api_key: str | None = None, model: str = DEFAULT_MODEL,
                 max_tokens: int = 8000, max_tool_iterations: int = 8) -> None:
        self.model = model
        self.max_tokens = max_tokens
        self.max_tool_iterations = max_tool_iterations
        self._api_key = api_key
        self._client = None  # lazy

    def _get_client(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(api_key=self._api_key) if self._api_key \
                else anthropic.Anthropic()
        return self._client

    def run_tool_loop(
        self, *, system: str, instruction: str, tools: AgentTools, schemas: list[dict]
    ) -> tuple[str, list[ToolCall]]:
        client = self._get_client()
        messages: list[dict] = [{"role": "user", "content": instruction}]
        tool_calls: list[ToolCall] = []

        for _ in range(self.max_tool_iterations):
            response = client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                system=system,
                tools=schemas,
                thinking={"type": "adaptive"},
                messages=messages,
            )
            if response.stop_reason != "tool_use":
                final = next((b.text for b in response.content if b.type == "text"), "")
                return final, tool_calls

            messages.append({"role": "assistant", "content": response.content})
            results = []
            for block in response.content:
                if block.type != "tool_use":
                    continue
                call = tools.dispatch(block.name, dict(block.input))
                tool_calls.append(call)
                results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": call.output,
                    "is_error": call.is_error,
                })
            messages.append({"role": "user", "content": results})

        # Ran out of iterations — return whatever was gathered.
        return "(perception loop reached iteration limit)", tool_calls

    def parse(self, *, system: str, prompt: str, schema: type[T]) -> T:
        client = self._get_client()
        response = client.messages.parse(
            model=self.model,
            max_tokens=self.max_tokens,
            system=system,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": prompt}],
            output_format=schema,
        )
        return response.parsed_output
