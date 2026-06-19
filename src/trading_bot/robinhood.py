"""Robinhood agentic-trading broker, over their MCP server.

This adapter implements the same broker contract the rest of the bot already
uses (see ``AlpacaBroker``): account + positions reads, and market / limit /
bracket order placement, plus ``close_position``. The autonomous loop, the
guardrails (8% cap, stop-loss, etc.), sizing and the audit trail are all broker
agnostic, so switching here keeps every safety rule we built.

IMPORTANT — not yet wired to real orders. Robinhood's agentic trading is Beta
and its MCP tool names / argument shapes / response fields are not encoded here
yet. Rather than guess an API that moves real money, every method that would
touch the account raises ``NotImplementedError`` until the ``_TOOLS`` mapping
and the response parsers below are filled in from Robinhood's MCP docs (the
"Connect your agent" flow). The MCP transport plumbing is in place; only the
Robinhood-specific specifics are missing.
"""

from __future__ import annotations

from .broker import AccountSnapshot, PositionSnapshot
from .config import Config

# === Robinhood MCP tool names — FILL IN from Robinhood's agent/MCP docs ====== #
# Map each capability the bot needs to the real MCP tool name Robinhood exposes.
# They are ``None`` until known; any method that needs an unset one refuses to
# run (see ``_tool``), so the bot can never fire an order at a guessed endpoint.
_TOOLS: dict[str, str | None] = {
    "get_account": None,    # e.g. "get_account" / "account_details"
    "get_positions": None,  # e.g. "list_positions"
    "place_order": None,    # e.g. "place_equity_order"
    "close_position": None,
    "market_clock": None,
}


class RobinhoodMCPBroker:
    def __init__(self, config: Config) -> None:
        self.config = config
        creds = config.credentials
        if not creds.rh_mcp_url or not creds.rh_mcp_token:
            raise ValueError(
                "Robinhood MCP credentials are required. Set ROBINHOOD_MCP_URL "
                "and ROBINHOOD_MCP_TOKEN in your environment/.env (from the "
                "'Connect your agent' flow in the Robinhood app)."
            )
        self._url = creds.rh_mcp_url
        self._token = creds.rh_mcp_token

    @property
    def is_paper(self) -> bool:
        # Robinhood agentic trading uses a dedicated *real-money* account; there
        # is no paper sandbox. Reported as not-paper so the harness treats fills
        # as live and the operator is never lulled into thinking it's practice.
        return False

    # ------------------------------------------------------------------ #
    # MCP transport (generic; verify against your `mcp` version + RH docs)
    # ------------------------------------------------------------------ #
    def _tool(self, key: str) -> str:
        name = _TOOLS.get(key)
        if not name:
            raise NotImplementedError(
                f"Robinhood MCP tool for '{key}' is not configured yet. Set it in "
                "trading_bot.robinhood._TOOLS (and map the response fields) using "
                "Robinhood's MCP docs before trading. Refusing to call a guessed "
                "endpoint with real money."
            )
        return name

    def _call_tool(self, name: str, arguments: dict) -> dict:
        """Open an MCP session, call ``name`` with ``arguments``, return the result.

        Uses the streamable-HTTP transport with a bearer token. Robinhood's exact
        transport (HTTP/SSE vs streamable) should be confirmed from their docs.
        """
        import asyncio

        async def _run() -> dict:
            try:
                from mcp.client.session import ClientSession
                from mcp.client.streamable_http import streamablehttp_client
            except ImportError as exc:  # pragma: no cover - env-dependent
                raise RuntimeError(
                    "The Robinhood broker needs the MCP client. Install it with "
                    "`pip install mcp`."
                ) from exc

            headers = {"Authorization": f"Bearer {self._token}"}
            async with streamablehttp_client(self._url, headers=headers) as (r, w, _):
                async with ClientSession(r, w) as session:
                    await session.initialize()
                    result = await session.call_tool(name, arguments)
                    return _content_to_dict(result)

        return asyncio.run(_run())

    # ------------------------------------------------------------------ #
    # Account / positions
    # ------------------------------------------------------------------ #
    def get_account(self) -> AccountSnapshot:
        raw = self._call_tool(self._tool("get_account"), {})
        # TODO(spec): map Robinhood's response fields to these three numbers.
        return AccountSnapshot(
            equity=float(raw["equity"]),
            cash=float(raw["cash"]),
            buying_power=float(raw["buying_power"]),
        )

    def get_positions(self) -> list[PositionSnapshot]:
        raw = self._call_tool(self._tool("get_positions"), {})
        # TODO(spec): map each Robinhood position to PositionSnapshot.
        return [
            PositionSnapshot(
                symbol=p["symbol"],
                quantity=float(p["quantity"]),
                avg_price=float(p["average_price"]),
                market_value=float(p["market_value"]),
            )
            for p in raw["positions"]
        ]

    def get_position(self, symbol: str) -> PositionSnapshot | None:
        for pos in self.get_positions():
            if pos.symbol == symbol:
                return pos
        return None

    # ------------------------------------------------------------------ #
    # Orders
    # ------------------------------------------------------------------ #
    def submit_market_order(self, symbol: str, quantity: int, side: str):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        # TODO(spec): map to Robinhood's place_order argument schema.
        return self._call_tool(self._tool("place_order"), {
            "symbol": symbol, "quantity": quantity, "side": side, "type": "market"})

    def submit_limit_order(self, symbol: str, quantity: int, side: str,
                           limit_price: float):
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        return self._call_tool(self._tool("place_order"), {
            "symbol": symbol, "quantity": quantity, "side": side,
            "type": "limit", "limit_price": round(limit_price, 2)})

    def submit_bracket_order(self, symbol: str, quantity: int, *,
                             stop_loss_price: float,
                             take_profit_price: float | None = None,
                             limit_price: float | None = None):
        # NOTE: our autonomous-safety model relies on the broker holding the
        # stop-loss even while the bot is offline. Confirm Robinhood's MCP can
        # attach a broker-managed stop/bracket; if it only supports plain orders,
        # downside protection between runs would be weaker. (See chat.)
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        if stop_loss_price <= 0:
            raise ValueError("stop_loss_price must be positive")
        args = {"symbol": symbol, "quantity": quantity, "side": "buy",
                "stop_loss_price": round(stop_loss_price, 2)}
        if take_profit_price and take_profit_price > 0:
            args["take_profit_price"] = round(take_profit_price, 2)
        if limit_price and limit_price > 0:
            args["limit_price"] = round(limit_price, 2)
        return self._call_tool(self._tool("place_order"), args)

    def close_position(self, symbol: str):
        return self._call_tool(self._tool("close_position"), {"symbol": symbol})

    def is_market_open(self) -> bool:
        raw = self._call_tool(self._tool("market_clock"), {})
        return bool(raw["is_open"])


def _content_to_dict(result) -> dict:
    """Best-effort extraction of a JSON dict from an MCP CallToolResult.

    Verify against Robinhood's actual response envelope once available.
    """
    import json

    data = getattr(result, "structuredContent", None)
    if isinstance(data, dict):
        return data
    content = getattr(result, "content", None) or []
    for block in content:
        text = getattr(block, "text", None)
        if text:
            return json.loads(text)
    raise RuntimeError(f"Could not parse MCP tool result: {result!r}")
