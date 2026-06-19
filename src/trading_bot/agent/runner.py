"""Daily / cron-style runner for the autonomous agent.

Wires the cognitive loop to the real broker, data provider, and Claude, then
drives one decision cycle per ticker in the watchlist. Designed to be invoked
once per scheduling tick (e.g. a daily cron) — it persists the day's opening
equity to ``logs/.day_state.json`` so the 2% drawdown circuit breaker is
consistent across invocations within the same day.

Order of operations each run:
  1. Resolve the day's opening equity (record it the first time today).
  2. Check the 2% daily-drawdown circuit breaker. If tripped → halt + alert.
  3. For each watchlist ticker, run the full Research-then-Decide cycle.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

from ..config import Config, load_config
from ..notify import Notifier
from .audit import AuditLog
from .cognition import CognitiveLoop
from .guardrails import Guardrails
from .llm import LLM, AnthropicLLM, HeuristicLLM
from .tools import AgentTools

log = logging.getLogger("trading_bot.agent")

DEFAULT_SYSTEM_MANUAL = Path("CLAUDE.md")


def load_system_manual(path: str | Path = DEFAULT_SYSTEM_MANUAL) -> str:
    """Load the agent's permanent manual (CLAUDE.md) as the system prompt."""
    path = Path(path)
    if path.exists():
        return path.read_text(encoding="utf-8")
    # Fallback so the agent still has its hard rules if the file is missing.
    return (
        "You are an autonomous equities agent. Protect capital first. Follow the "
        "Research-then-Decide loop. Never exceed 5% of equity per trade. Halt at a "
        "2% daily drawdown. Default to HOLD on missing or corrupted data."
    )


class DayState:
    """Persists the day's opening equity for the drawdown baseline."""

    def __init__(self, path: str | Path = "logs/.day_state.json") -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def opening_equity(self, current_equity: float) -> float:
        today = dt.date.today().isoformat()
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text())
                if data.get("date") == today:
                    return float(data["opening_equity"])
            except (json.JSONDecodeError, KeyError, ValueError):
                pass
        self.path.write_text(json.dumps({"date": today, "opening_equity": current_equity}))
        return current_equity


class AgentRunner:
    def __init__(
        self,
        *,
        config: Config,
        llm: LLM,
        tools: AgentTools,
        broker,
        guardrails: Guardrails | None = None,
        audit: AuditLog | None = None,
        notifier: Notifier | None = None,
        day_state: DayState | None = None,
        watchlist: list[str] | None = None,
        dry_run: bool = False,
        ledger: "TradeLedger | None" = None,
    ) -> None:
        self.config = config
        self.broker = broker
        from .guardrails import build_guardrails

        self.guardrails = guardrails or build_guardrails(config.agent_risk)
        self.audit = audit or AuditLog()
        self.notifier = notifier or Notifier()
        self.day_state = day_state or DayState()
        self.watchlist = watchlist or config.symbols
        self.dry_run = dry_run
        from .ledger import TradeLedger

        self.ledger = ledger or TradeLedger()
        mode = "dry_run" if dry_run else config.mode
        self.loop = CognitiveLoop(
            llm=llm, tools=tools, guardrails=self.guardrails,
            audit=self.audit, system_prompt=load_system_manual(),
            dry_run=dry_run, ledger=self.ledger, mode=mode,
            execution=config.execution, rules=config.rules,
        )

    def run_day(self) -> dict:
        account = self.broker.get_account()
        equity = float(account.equity)
        opening = self.day_state.opening_equity(equity)
        self.audit.day_header(equity=opening)

        # 2% daily-drawdown circuit breaker — portfolio-level halt.
        if self.guardrails.drawdown_breached(opening, equity):
            msg = (
                f"Daily drawdown circuit breaker TRIPPED: equity ${equity:,.2f} is "
                f">= 2% below the day's open ${opening:,.2f}. Halting all trading for "
                f"the day."
            )
            log.warning(msg)
            self.audit.system_event(msg)
            self.notifier.send(f"🛑 {msg}")
            return {"halted": True, "reason": "daily_drawdown", "results": []}

        # Market regime gate — scales (or zeroes) NEW exposure; reviews still run.
        from .regime import assess_regime

        regime = assess_regime(self.loop.tools.data, benchmark=self.config.benchmark)
        self.audit.system_event(
            f"Market regime: **{regime.regime}** (exposure x{regime.exposure_scale:.2f}). "
            f"{regime.reason}")
        log.info("Regime: %s (x%.2f) — %s", regime.regime, regime.exposure_scale,
                 regime.reason)

        # Portfolio picture — account-wide caps (cash buffer, sector, # positions).
        portfolio = self._build_portfolio_risk(equity)
        self.audit.system_event(
            f"Portfolio caps: invested {portfolio.invested_value() / equity:.0%}/"
            f"{portfolio.max_invested_pct:.0%}, "
            f"{portfolio.position_count()}/{portfolio.max_positions} positions, "
            f"sector cap {portfolio.max_sector_pct:.0%}"
            + ("" if portfolio.use_sector else " (sector cap off — no research)"))

        results = []
        reviews = []

        # Phase A — manage what we already hold (exits/trims/adds come first).
        # These run in every regime: in bad tape you especially want to de-risk.
        held = {p.symbol for p in self.broker.get_positions()}
        for ticker in sorted(held):
            log.info("Reviewing open position %s", ticker)
            try:
                r = self.loop.review_position(ticker, equity=equity,
                                             exposure_scale=regime.exposure_scale,
                                             portfolio=portfolio)
                reviews.append(r)
                if r.executed:
                    self.notifier.send(f"🤖 review {r.final_action} {ticker} (agent)")
            except Exception:  # noqa: BLE001
                log.exception("Review failed for %s", ticker)
                self.audit.system_event(f"{ticker}: review raised an exception — skipped.")

        # Phase B — new entries, gated by the regime AND the portfolio caps. In
        # risk-off (scale 0) we skip entries entirely — manage-only mode.
        if regime.exposure_scale <= 0:
            self.audit.system_event(
                "Risk-off regime — skipping all new entries; managing existing "
                "positions only.")
        else:
            new_buys = 0
            max_new = getattr(self.config.rules, "max_new_buys_per_run", 0)
            for ticker in self._entry_universe():
                if ticker in held:
                    continue
                if max_new and new_buys >= max_new:
                    self.audit.system_event(
                        f"Max new buys per run ({max_new}) reached — stopping entries.")
                    break
                if not portfolio.can_open_new(ticker):
                    self.audit.system_event(
                        f"{ticker}: max positions ({portfolio.max_positions}) reached "
                        f"— skipping new entry.")
                    continue
                log.info("Running cognitive cycle for %s", ticker)
                try:
                    result = self.loop.run_for_ticker(
                        ticker, equity=equity, exposure_scale=regime.exposure_scale,
                        portfolio=portfolio)
                    results.append(result)
                    # Reflect an auto-executing buy so the next candidate sees the
                    # reduced headroom within this same run. Buys held for the
                    # operator's approval did not trade, so they don't consume a slot.
                    if (result.final_action == "BUY" and result.notional > 0
                            and not result.pending_approval):
                        new_buys += 1
                        portfolio.add(ticker, result.notional, result.sector)
                    if result.executed:
                        self.notifier.send(
                            f"🤖 {result.final_action} {result.quantity} {ticker} (agent)")
                except Exception:  # noqa: BLE001 — one ticker must not kill the run
                    log.exception("Cycle failed for %s", ticker)
                    self.audit.system_event(f"{ticker}: cycle raised an exception — skipped.")
        return {"halted": False, "results": results, "reviews": reviews,
                "regime": regime, "portfolio": portfolio}

    def _entry_universe(self) -> list[str]:
        """The watchlist, optionally extended with freshly-screened small-caps."""
        universe = list(self.watchlist)
        disc = getattr(self.config, "discovery", None)
        research = self.loop.tools.research
        if disc and disc.enabled and research is not None:
            found = []
            for sector in disc.sectors:
                for c in research.discover_small_caps(
                        sector, disc.market_cap_max, disc.min_volume)[:disc.max_candidates]:
                    if c.ticker not in universe and c.ticker not in found:
                        found.append(c.ticker)
            if found:
                universe += found
                self.audit.system_event(
                    f"Discovery: added {len(found)} small-cap candidate(s) "
                    f"{found} across sectors {disc.sectors}.")
        return universe

    def _build_portfolio_risk(self, equity: float):
        """Snapshot current holdings (with sectors, if research is available)."""
        from .portfolio_risk import Holding, PortfolioRisk

        research = self.loop.tools.research
        holdings = []
        for pos in self.broker.get_positions():
            sector = ""
            if research is not None:
                call = self.loop.tools.dispatch("get_fundamentals", {"ticker": pos.symbol})
                if not call.is_error:
                    import json
                    try:
                        f = json.loads(call.output).get("fundamentals") or {}
                        sector = f.get("sector", "") or ""
                    except (json.JSONDecodeError, TypeError, ValueError):
                        sector = ""
            holdings.append(Holding(pos.symbol, float(pos.market_value), sector))
        pc = self.config.portfolio
        return PortfolioRisk(
            equity=equity, holdings=holdings,
            max_invested_pct=pc.max_invested_pct, max_sector_pct=pc.max_sector_pct,
            max_positions=pc.max_positions, use_sector=research is not None,
        )


def build_runner(config: Config | None = None) -> AgentRunner:
    """Wire the agent to the real Alpaca broker, data provider, Claude, and the
    real research pipeline (FMP/EDGAR/Firecrawl per the keys present)."""
    from ..broker import AlpacaBroker
    from ..data import DataProvider
    from .research import build_research_bundle

    config = config or load_config()
    config.validate()
    broker = AlpacaBroker(config)
    data = DataProvider(config.credentials)
    research = build_research_bundle(sim=False)
    tools = AgentTools(broker, data, research=research, default_timeframe=config.timeframe)
    llm = AnthropicLLM()
    return AgentRunner(config=config, llm=llm, tools=tools, broker=broker)


def build_dry_run_runner(
    config: Config | None = None,
    *,
    offline: bool = False,
    sim_data: bool = False,
    watchlist: list[str] | None = None,
    discover_sector: str | None = None,
    discover_limit: int = 3,
    sim_equity: float = 100_000.0,
) -> tuple[AgentRunner, dict]:
    """Wire a dry-run runner, auto-selecting providers from what's in ``.env``.

    * Market data: free, keyless yfinance (no credentials required).
    * Broker: Alpaca **paper** if ALPACA keys are present, else a simulated
      in-memory paper account.
    * Brain: Claude if ``ANTHROPIC_API_KEY`` is set and ``offline`` is False,
      else the deterministic :class:`HeuristicLLM`.

    Returns ``(runner, selections)`` where ``selections`` describes what was
    wired, for transparent logging.
    """
    import os

    from .research import build_research_bundle

    config = config or load_config()
    research = build_research_bundle(sim=sim_data)

    if sim_data:
        from ..data import SyntheticDataProvider

        data = SyntheticDataProvider()
        data_kind = "synthetic (offline demo)"
    else:
        from ..data import YFinanceDataProvider

        data = YFinanceDataProvider()
        data_kind = "yfinance"

    # Optional discovery: build the watchlist from the small-cap screener.
    discovered: list[str] = []
    if discover_sector:
        candidates = research.discover_small_caps(discover_sector, 2_000_000_000, 100_000)
        discovered = [c.ticker for c in candidates][:discover_limit]
        if discovered:
            watchlist = discovered

    # Broker selection.
    if config.credentials.api_key and config.credentials.api_secret:
        from ..broker import AlpacaBroker

        broker = AlpacaBroker(config)
        broker_kind = "Alpaca paper" if broker.is_paper else "Alpaca LIVE"
    else:
        from .paper_sim import SimPaperBroker

        broker = SimPaperBroker(equity=sim_equity, cash=sim_equity)
        broker_kind = f"simulated paper (${sim_equity:,.0f})"

    # Brain selection.
    if offline or not os.getenv("ANTHROPIC_API_KEY"):
        llm: LLM = HeuristicLLM()
        brain = "HeuristicLLM (offline)"
    else:
        llm = AnthropicLLM()
        brain = "Claude (claude-opus-4-8)"

    tools = AgentTools(broker, data, research=research,
                       default_timeframe=config.timeframe)
    runner = AgentRunner(
        config=config, llm=llm, tools=tools, broker=broker,
        watchlist=watchlist or config.symbols, dry_run=True,
    )
    selections = {"data": data_kind, "broker": broker_kind, "brain": brain,
                  "research": ", ".join(research.capabilities) or "none",
                  "discovered": discovered, "watchlist": runner.watchlist}
    return runner, selections
