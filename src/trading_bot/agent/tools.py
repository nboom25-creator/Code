"""Tool abstractions exposed to / used by the agent.

The four tools from the agent's manual:

* ``get_market_bars`` / ``get_company_news`` / ``get_portfolio_state`` are the
  **read-only perception tools**. Their JSON schemas are handed to Claude, and
  Claude calls them during the Perception phase via the tool-use loop.
* ``execute_order`` is **driver-only**. Its schema is deliberately NOT exposed to
  the model — the agent expresses intent through a structured TradeDecision, and
  only the guardrail-validated harness invokes execution. This is the boundary
  that makes the hard limits unbypassable.

``AgentTools`` is constructed from anything implementing the small broker/data
ports below, so tests can pass in fakes with no network.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Protocol


class BrokerPort(Protocol):
    def get_account(self) -> Any: ...
    def get_positions(self) -> list[Any]: ...
    def submit_market_order(self, symbol: str, quantity: int, side: str) -> Any: ...
    def close_position(self, symbol: str) -> Any: ...


class DataPort(Protocol):
    def get_bars(self, symbol: str, *, timeframe: str = ..., limit: int | None = ...) -> Any: ...
    def get_news(self, symbol: str, *, limit: int = ...) -> list[dict]: ...


# Read-only tool schemas given to Claude. execute_order is intentionally absent.
PERCEPTION_TOOL_SCHEMAS: list[dict] = [
    {
        "name": "get_market_bars",
        "description": (
            "Fetch recent OHLCV price history for a ticker. Use this to ground any "
            "view in current prices, trend, and volume."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {"type": "string", "description": "Stock/ETF symbol, e.g. AAPL"},
                "timeframe": {
                    "type": "string",
                    "description": "Bar size: 1Day, 1Hour, 15Min, 5Min, or 1Min.",
                },
                "limit": {"type": "integer", "description": "Number of most-recent bars."},
            },
            "required": ["ticker"],
        },
    },
    {
        "name": "get_company_news",
        "description": "Fetch recent news headlines and sentiment metadata for a ticker.",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {"type": "string", "description": "Stock/ETF symbol."},
            },
            "required": ["ticker"],
        },
    },
    {
        "name": "get_portfolio_state",
        "description": "Get current cash balance, total equity, and open positions.",
        "input_schema": {"type": "object", "properties": {}},
    },
]


@dataclass
class ToolCall:
    """Record of one tool invocation, for perception analysis and the audit log."""

    name: str
    input: dict
    output: str
    is_error: bool


class AgentTools:
    def __init__(self, broker: BrokerPort, data: DataPort, *, default_timeframe: str = "1Day") -> None:
        self.broker = broker
        self.data = data
        self.default_timeframe = default_timeframe

    # ------------------------------------------------------------------ #
    # Read-only perception tools (callable by the LLM, via dispatch)
    # ------------------------------------------------------------------ #
    def get_market_bars(self, ticker: str, timeframe: str | None = None,
                        limit: int = 30) -> str:
        bars = self.data.get_bars(
            ticker, timeframe=timeframe or self.default_timeframe, limit=limit
        )
        if bars is None or len(bars) == 0:
            raise ValueError(f"no bars returned for {ticker}")
        tail = bars.tail(min(limit, len(bars)))
        latest = tail.iloc[-1]
        return json.dumps({
            "ticker": ticker,
            "bars_returned": int(len(bars)),
            "latest_close": round(float(latest["close"]), 4),
            "latest_volume": int(latest["volume"]),
            "window_high": round(float(tail["high"].max()), 4),
            "window_low": round(float(tail["low"].min()), 4),
            "first_close": round(float(tail.iloc[0]["close"]), 4),
            "pct_change_window": round(
                float(tail.iloc[-1]["close"] / tail.iloc[0]["close"] - 1) * 100, 2
            ),
        })

    def get_company_news(self, ticker: str) -> str:
        news = self.data.get_news(ticker, limit=10)
        return json.dumps({"ticker": ticker, "count": len(news), "items": news[:10]})

    def get_portfolio_state(self) -> str:
        account = self.broker.get_account()
        positions = self.broker.get_positions()
        return json.dumps({
            "equity": round(float(account.equity), 2),
            "cash": round(float(account.cash), 2),
            "buying_power": round(float(account.buying_power), 2),
            "positions": [
                {
                    "symbol": p.symbol,
                    "qty": float(p.quantity),
                    "avg_price": round(float(p.avg_price), 2),
                    "market_value": round(float(p.market_value), 2),
                }
                for p in positions
            ],
        })

    def dispatch(self, name: str, tool_input: dict) -> ToolCall:
        """Execute a read-only tool by name and capture the result (never raises)."""
        try:
            if name == "get_market_bars":
                out = self.get_market_bars(
                    tool_input["ticker"],
                    tool_input.get("timeframe"),
                    int(tool_input.get("limit", 30)),
                )
            elif name == "get_company_news":
                out = self.get_company_news(tool_input["ticker"])
            elif name == "get_portfolio_state":
                out = self.get_portfolio_state()
            else:
                return ToolCall(name, tool_input, f"unknown tool {name!r}", True)
            return ToolCall(name, tool_input, out, False)
        except Exception as exc:  # noqa: BLE001 — surfaced to the agent as a tool error
            return ToolCall(name, tool_input, f"ERROR: {exc}", True)

    # ------------------------------------------------------------------ #
    # Execution — DRIVER ONLY. Never exposed to the model.
    # ------------------------------------------------------------------ #
    def execute_order(self, ticker: str, qty: int, side: str, order_type: str = "market") -> Any:
        """Place an order. Called only by the harness after guardrail validation."""
        if order_type != "market":
            raise ValueError("only market orders are supported by this harness")
        if side == "sell" and qty <= 0:
            return self.broker.close_position(ticker)
        return self.broker.submit_market_order(ticker, qty, side)
