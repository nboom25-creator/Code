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
            "view in current prices, trend, and volume (incl. unusual volume)."
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

# Deep-research tools for thinly-covered small/micro-caps. Used by the harness's
# deterministic fallback when generic news is sparse, and available to the model.
DEEP_RESEARCH_TOOL_SCHEMAS: list[dict] = [
    {
        "name": "get_fundamentals",
        "description": (
            "Fetch fundamental metrics (market cap, debt-to-equity, current ratio, "
            "cash, revenue growth). Essential for small-caps where news is sparse."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "get_sec_filings",
        "description": "Fetch recent SEC 10-Q / 10-K filings for a ticker from EDGAR.",
        "input_schema": {
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "get_insider_activity",
        "description": "Fetch recent insider (Form 4) activity for a ticker from EDGAR.",
        "input_schema": {
            "type": "object",
            "properties": {"ticker": {"type": "string"}},
            "required": ["ticker"],
        },
    },
    {
        "name": "web_research",
        "description": (
            "Targeted web search/scrape (markdown) for niche investor blogs and "
            "regional outlets — for small-caps with no mainstream coverage."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "company_name": {"type": "string"},
            },
            "required": ["ticker"],
        },
    },
    {
        "name": "discover_small_caps",
        "description": (
            "Screen for small/micro-cap companies in a sector meeting liquidity "
            "thresholds. Returns candidate tickers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "sector": {"type": "string"},
                "market_cap_max": {"type": "number"},
                "min_volume": {"type": "number"},
            },
            "required": ["sector"],
        },
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
    def __init__(self, broker: BrokerPort, data: DataPort, *,
                 research=None, default_timeframe: str = "1Day") -> None:
        self.broker = broker
        self.data = data
        self.research = research  # ResearchBundle or None
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
        avg_volume = float(tail["volume"].mean()) or 1.0
        latest_volume = float(latest["volume"])
        latest_close = float(latest["close"])
        # ATR — typical daily $ move — and ATR% (volatility relative to price),
        # used by the risk-sizer to make jumpy stocks get smaller positions.
        atr = atr_pct = 0.0
        if len(tail) >= 3:
            from .. import indicators

            atr_series = indicators.atr(
                tail["high"], tail["low"], tail["close"],
                period=min(14, len(tail) - 1)).dropna()
            if len(atr_series) and latest_close:
                atr = float(atr_series.iloc[-1])
                atr_pct = atr / latest_close
        return json.dumps({
            "ticker": ticker,
            "bars_returned": int(len(bars)),
            "latest_close": round(latest_close, 4),
            "latest_volume": int(latest_volume),
            "avg_volume": int(avg_volume),
            # Unusual-volume signal — small-cap moves often start with a volume spike.
            "volume_ratio": round(latest_volume / avg_volume, 2),
            "atr": round(atr, 4),
            "atr_pct": round(atr_pct, 4),
            "window_high": round(float(tail["high"].max()), 4),
            "window_low": round(float(tail["low"].min()), 4),
            "first_close": round(float(tail.iloc[0]["close"]), 4),
            "pct_change_window": round(
                float(tail.iloc[-1]["close"] / tail.iloc[0]["close"] - 1) * 100, 2
            ),
        })

    def get_company_news(self, ticker: str) -> str:
        from .sentiment import aggregate, tag_news

        news = self.data.get_news(ticker, limit=10)
        tagged = tag_news(news)
        return json.dumps({
            "ticker": ticker,
            "count": len(tagged),
            "sentiment": aggregate(tagged),
            "items": tagged[:10],
        })

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

    # ------------------------------------------------------------------ #
    # Deep-research tools (small/micro-cap fallbacks)
    # ------------------------------------------------------------------ #
    def _require_research(self):
        if self.research is None:
            raise ValueError("no research provider configured")
        return self.research

    def get_fundamentals(self, ticker: str) -> str:
        f = self._require_research().get_fundamentals(ticker)
        return json.dumps({"ticker": ticker, "fundamentals": f.as_dict() if f else None})

    def get_sec_filings(self, ticker: str) -> str:
        filings = self._require_research().get_sec_filings(ticker)
        return json.dumps({
            "ticker": ticker, "count": len(filings),
            "filings": [vars(f) for f in filings],
        })

    def get_insider_activity(self, ticker: str) -> str:
        trades = self._require_research().get_insider_activity(ticker)
        return json.dumps({
            "ticker": ticker, "count": len(trades),
            "insider_trades": [vars(t) for t in trades],
        })

    def web_research(self, ticker: str, company_name: str = "") -> str:
        name = company_name or ticker
        query = f"{ticker} stock analysis {name} earnings guidance"
        results = self._require_research().web_research(query)
        return json.dumps({"ticker": ticker, "query": query,
                           "count": len(results), "results": results})

    def discover_small_caps(self, sector: str, market_cap_max: float = 2_000_000_000,
                            min_volume: float = 100_000) -> str:
        results = self._require_research().discover_small_caps(
            sector, market_cap_max, min_volume)
        return json.dumps({
            "sector": sector, "market_cap_max": market_cap_max,
            "min_volume": min_volume, "count": len(results),
            "candidates": [vars(r) for r in results],
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
            elif name == "get_fundamentals":
                out = self.get_fundamentals(tool_input["ticker"])
            elif name == "get_sec_filings":
                out = self.get_sec_filings(tool_input["ticker"])
            elif name == "get_insider_activity":
                out = self.get_insider_activity(tool_input["ticker"])
            elif name == "web_research":
                out = self.web_research(tool_input["ticker"],
                                        tool_input.get("company_name", ""))
            elif name == "discover_small_caps":
                out = self.discover_small_caps(
                    tool_input["sector"],
                    float(tool_input.get("market_cap_max", 2_000_000_000)),
                    float(tool_input.get("min_volume", 100_000)),
                )
            else:
                return ToolCall(name, tool_input, f"unknown tool {name!r}", True)
            return ToolCall(name, tool_input, out, False)
        except Exception as exc:  # noqa: BLE001 — surfaced to the agent as a tool error
            return ToolCall(name, tool_input, f"ERROR: {exc}", True)

    # ------------------------------------------------------------------ #
    # Execution — DRIVER ONLY. Never exposed to the model.
    # ------------------------------------------------------------------ #
    def execute_order(
        self,
        ticker: str,
        qty: int,
        side: str,
        order_type: str = "market",
        *,
        stop_loss_price: float | None = None,
        take_profit_price: float | None = None,
        limit_price: float | None = None,
    ) -> Any:
        """Place an order. Called only by the harness after guardrail validation.

        A BUY with a ``stop_loss_price`` is a **bracket order** (protective stop +
        optional take-profit attached at entry, held broker-side). When
        ``order_type == "limit"`` and a ``limit_price`` is given, orders are
        price-protected limit orders; otherwise they fall back to market orders.
        """
        use_limit = order_type == "limit" and limit_price and limit_price > 0
        if side == "sell":
            if qty <= 0:
                return self.broker.close_position(ticker)
            if use_limit and hasattr(self.broker, "submit_limit_order"):
                return self.broker.submit_limit_order(ticker, qty, "sell", limit_price)
            return self.broker.submit_market_order(ticker, qty, "sell")
        # side == "buy"
        if stop_loss_price and hasattr(self.broker, "submit_bracket_order"):
            return self.broker.submit_bracket_order(
                ticker, qty, stop_loss_price=stop_loss_price,
                take_profit_price=take_profit_price,
                limit_price=limit_price if use_limit else None,
            )
        if use_limit and hasattr(self.broker, "submit_limit_order"):
            return self.broker.submit_limit_order(ticker, qty, "buy", limit_price)
        return self.broker.submit_market_order(ticker, qty, "buy")
