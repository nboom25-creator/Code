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

import json
import re
from typing import Protocol, TypeVar

from pydantic import BaseModel

from .schemas import AdversarialCheck, ReasoningState, TradeDecision
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


class HeuristicLLM:
    """A deterministic, offline 'analyst' that implements the same interface as
    :class:`AnthropicLLM` without any API key.

    It drives the perception tools, then derives a grounded Reasoning State,
    adversarial check, and trade decision from real numbers — price momentum over
    the bar window and aggregated news sentiment. It is not as nuanced as Claude,
    but it exercises the full data → reasoning → guardrail → audit pipeline so the
    dry-run is runnable anywhere. Flip to ``AnthropicLLM`` by setting
    ``ANTHROPIC_API_KEY``.
    """

    # Thresholds for turning signals into actions.
    MOMENTUM_BUY = 1.5   # % change over the window
    MOMENTUM_SELL = -1.5

    def __init__(self) -> None:
        self._momentum = 0.0
        self._price = 0.0
        self._sentiment = {"net": 0.0, "positive": 0, "negative": 0, "neutral": 0}
        self._ticker = ""

    def run_tool_loop(self, *, system, instruction, tools, schemas):
        match = re.search(r"for (\w+)", instruction)
        self._ticker = match.group(1) if match else ""
        calls = [
            tools.dispatch("get_market_bars", {"ticker": self._ticker, "limit": 30}),
            tools.dispatch("get_company_news", {"ticker": self._ticker}),
            tools.dispatch("get_portfolio_state", {}),
        ]
        self._extract(calls)
        summary = (
            f"{self._ticker}: window momentum {self._momentum:+.2f}%, "
            f"news sentiment net {self._sentiment['net']:+.2f} "
            f"({self._sentiment['positive']}+/{self._sentiment['negative']}-)."
        )
        return summary, calls

    def _extract(self, calls: list[ToolCall]) -> None:
        for call in calls:
            if call.is_error:
                continue
            if call.name == "get_market_bars":
                try:
                    data = json.loads(call.output)
                    self._momentum = float(data.get("pct_change_window", 0.0))
                    self._price = float(data.get("latest_close", 0.0))
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass
            elif call.name == "get_company_news":
                try:
                    self._sentiment = json.loads(call.output).get("sentiment", self._sentiment)
                except (json.JSONDecodeError, ValueError, TypeError):
                    pass

    def _signal(self) -> float:
        """Combined signal: momentum (scaled) + sentiment net, roughly in [-3, 3]."""
        return self._momentum / 3.0 + float(self._sentiment.get("net", 0.0))

    def parse(self, *, system, prompt, schema):
        if schema is ReasoningState:
            return ReasoningState(
                summary=(
                    f"{self._ticker} shows {self._momentum:+.2f}% price change over the "
                    f"window with net news sentiment {self._sentiment['net']:+.2f}."
                ),
                data_found=[
                    f"Latest close ~{self._price:.2f}",
                    f"Window momentum {self._momentum:+.2f}%",
                    f"News sentiment net {self._sentiment['net']:+.2f} "
                    f"({self._sentiment['positive']} pos / {self._sentiment['negative']} neg)",
                ],
                subtasks_to_verify=[
                    "Is the momentum supported by volume, or a thin-liquidity move?",
                    "Do the headlines reflect a durable change or a one-off?",
                ],
                key_risks=["Trend could reverse", "Sentiment may already be priced in"],
            )
        if schema is AdversarialCheck:
            bullish = self._signal() > 0
            return AdversarialCheck(
                bull_case=(
                    f"Positive momentum ({self._momentum:+.2f}%) and/or constructive news "
                    f"suggest continuation."
                ),
                bull_points=[
                    f"Momentum {self._momentum:+.2f}%",
                    f"Sentiment net {self._sentiment['net']:+.2f}",
                ],
                bear_case=(
                    "The move may be exhausted or already reflect the news; mean reversion "
                    "and broad-market risk argue for caution."
                ),
                bear_points=["Possible exhaustion", "Sentiment can reverse quickly"],
                net_assessment=(
                    "Signals lean " + ("bullish" if bullish else "bearish/neutral")
                    + "; size conservatively and respect the 5% cap."
                ),
            )
        if schema is TradeDecision:
            signal = self._signal()
            if self._momentum >= self.MOMENTUM_BUY and signal > 0:
                confidence = min(0.85, 0.5 + signal / 6.0)
                # Propose an aggressive notional on purpose; guardrails cap to 5%.
                return TradeDecision(
                    action="BUY", ticker=self._ticker,
                    target_notional_usd=round(10_000 * confidence, 2),
                    confidence=round(confidence, 2),
                    rationale=(
                        f"Positive momentum {self._momentum:+.2f}% with sentiment "
                        f"{self._sentiment['net']:+.2f}; proposing a capped long."
                    ),
                )
            if self._momentum <= self.MOMENTUM_SELL or signal < -0.8:
                return TradeDecision(
                    action="SELL", ticker=self._ticker, target_notional_usd=0.0,
                    confidence=0.6,
                    rationale=(
                        f"Negative momentum {self._momentum:+.2f}% / weak sentiment "
                        f"{self._sentiment['net']:+.2f}; exit if held."
                    ),
                )
            return TradeDecision(
                action="HOLD", ticker=self._ticker, target_notional_usd=0.0,
                confidence=0.5,
                rationale="No decisive edge from momentum or sentiment; standing down.",
            )
        raise AssertionError(f"unexpected schema {schema}")
