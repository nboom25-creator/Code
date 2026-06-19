"""Configuration and environment loading.

Trading parameters come from ``config.yaml``; secrets come from the environment
(``.env``). Keeping them separate means the config file can be committed safely
while API keys never touch version control.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

try:  # optional; tests and CI don't require it
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    def load_dotenv(*_args: Any, **_kwargs: Any) -> bool:
        return False


LIVE_CONFIRM_VALUE = "I_UNDERSTAND_THE_RISK"


@dataclass
class StrategyConfig:
    name: str = "sma_crossover"
    params: dict[str, Any] = field(default_factory=dict)


@dataclass
class RiskConfig:
    max_position_pct: float = 0.20
    risk_per_trade_pct: float = 0.01
    stop_loss_pct: float = 0.05
    # Take-profit distance as a fraction of entry price. 0 disables it.
    take_profit_pct: float = 0.10
    max_open_positions: int = 5
    daily_loss_limit_pct: float = 0.03


@dataclass
class PortfolioConfig:
    max_invested_pct: float = 0.90  # keep >=10% cash
    max_sector_pct: float = 0.30    # <=30% of equity in any one sector
    max_positions: int = 10


@dataclass
class AgentRiskConfig:
    """The autonomous agent's hard per-trade caps (operator-set rules)."""
    max_position_pct: float = 0.05        # most of the account one trade may use
    daily_drawdown_limit_pct: float = 0.02  # halt the day at this loss
    stop_loss_pct: float = 0.05           # protective stop below entry
    take_profit_pct: float = 0.10         # take-profit above entry (0 disables)
    max_adv_participation_pct: float = 0.01  # max % of avg daily volume per buy
    reference_atr_pct: float = 0.03       # "calm" volatility baseline for sizing
    trailing_stop_pct: float = 0.0        # exit if price falls this far from its peak (0 = off)


@dataclass
class TradingRulesConfig:
    """Extra operator filters on new buys (0 / empty = rule off)."""
    min_price: float = 0.0              # skip buys below this share price
    min_confidence: float = 0.0         # only act when at least this confident (0-1)
    max_new_buys_per_run: int = 0       # cap new positions opened per run (0 = no cap)


@dataclass
class DiscoveryConfig:
    """Auto-discovery of small/micro-cap candidates during the agent's run."""
    enabled: bool = False
    sectors: list[str] = field(default_factory=list)
    market_cap_max: float = 2_000_000_000.0
    min_volume: float = 100_000.0
    max_candidates: int = 5


@dataclass
class ExecutionConfig:
    # Order placement
    order_type: str = "limit"          # "limit" (marketable) or "market"
    limit_slippage_pct: float = 0.003  # how far through the price a limit may reach
    # Autonomy: auto-execute a BUY only when at least this confident (0 = always
    # auto-execute). Risk-reducing SELLs/exits always auto-execute. BUYs below the
    # threshold are proposed and held for the operator's approval, not placed.
    auto_execute_confidence: float = 0.0
    # Cost model (used to estimate dry-run fills realistically)
    est_slippage_pct: float = 0.0005   # assumed adverse slippage per fill
    commission: float = 0.0            # per-order commission ($)
    # Account rules
    enforce_pdt: bool = True           # block the 4th day trade on a <$25k account
    pdt_equity_threshold: float = 25_000.0
    pdt_max_day_trades: int = 3
    avoid_wash_sales: bool = True      # don't rebuy a loser within the window
    wash_sale_days: int = 30


@dataclass
class BacktestConfig:
    starting_cash: float = 100_000.0
    commission: float = 0.0
    slippage_pct: float = 0.0005


@dataclass
class Credentials:
    api_key: str | None = None
    api_secret: str | None = None
    live_confirm: str | None = None
    base_url: str | None = None
    # Robinhood agentic-trading MCP (only used when broker == "robinhood").
    rh_mcp_url: str | None = None
    rh_mcp_token: str | None = None


@dataclass
class Config:
    mode: str = "paper"
    broker: str = "alpaca"  # which execution venue: "alpaca" or "robinhood"
    symbols: list[str] = field(default_factory=list)
    timeframe: str = "1Day"
    poll_interval_seconds: int = 60
    benchmark: str = "SPY"  # market-regime benchmark
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    portfolio: PortfolioConfig = field(default_factory=PortfolioConfig)
    agent_risk: AgentRiskConfig = field(default_factory=AgentRiskConfig)
    rules: TradingRulesConfig = field(default_factory=TradingRulesConfig)
    discovery: DiscoveryConfig = field(default_factory=DiscoveryConfig)
    execution: ExecutionConfig = field(default_factory=ExecutionConfig)
    backtest: BacktestConfig = field(default_factory=BacktestConfig)
    credentials: Credentials = field(default_factory=Credentials)

    @property
    def is_live(self) -> bool:
        return self.mode.lower() == "live"

    def validate(self) -> None:
        """Raise ``ValueError`` if the config is internally inconsistent or if a
        live-trading request is missing its required confirmations."""
        if self.mode.lower() not in {"paper", "live"}:
            raise ValueError(f"mode must be 'paper' or 'live', got {self.mode!r}")
        if self.broker.lower() not in {"alpaca", "robinhood"}:
            raise ValueError(
                f"broker must be 'alpaca' or 'robinhood', got {self.broker!r}")
        if not self.symbols:
            raise ValueError("at least one symbol must be configured")
        if self.is_live and self.credentials.live_confirm != LIVE_CONFIRM_VALUE:
            raise ValueError(
                "Live trading requested (mode: live) but the environment "
                "variable LIVE_TRADING_CONFIRM is not set to "
                f"'{LIVE_CONFIRM_VALUE}'. Refusing to trade real money without "
                "explicit confirmation. Set it in your environment to proceed, "
                "or switch back to mode: paper."
            )
        if not 0 < self.risk.max_position_pct <= 1:
            raise ValueError("risk.max_position_pct must be in (0, 1]")
        if not 0 < self.risk.risk_per_trade_pct <= 1:
            raise ValueError("risk.risk_per_trade_pct must be in (0, 1]")


def load_config(path: str | Path = "config.yaml", *, load_env: bool = True) -> Config:
    """Load configuration from ``path`` and credentials from the environment."""
    if load_env:
        load_dotenv()

    path = Path(path)
    raw: dict[str, Any] = {}
    if path.exists():
        with path.open() as fh:
            raw = yaml.safe_load(fh) or {}

    cfg = Config(
        mode=raw.get("mode", "paper"),
        broker=str(raw.get("broker", "alpaca")).lower(),
        symbols=list(raw.get("symbols", [])),
        timeframe=raw.get("timeframe", "1Day"),
        poll_interval_seconds=int(raw.get("poll_interval_seconds", 60)),
        benchmark=raw.get("benchmark", "SPY"),
        strategy=StrategyConfig(**{
            "name": raw.get("strategy", {}).get("name", "sma_crossover"),
            "params": raw.get("strategy", {}).get("params", {}),
        }),
        risk=RiskConfig(**(raw.get("risk", {}) or {})),
        portfolio=PortfolioConfig(**(raw.get("portfolio", {}) or {})),
        agent_risk=AgentRiskConfig(**(raw.get("agent_risk", {}) or {})),
        rules=TradingRulesConfig(**(raw.get("rules", {}) or {})),
        discovery=DiscoveryConfig(**(raw.get("discovery", {}) or {})),
        execution=ExecutionConfig(**(raw.get("execution", {}) or {})),
        backtest=BacktestConfig(**(raw.get("backtest", {}) or {})),
        credentials=Credentials(
            api_key=os.getenv("ALPACA_API_KEY"),
            api_secret=os.getenv("ALPACA_API_SECRET"),
            live_confirm=os.getenv("LIVE_TRADING_CONFIRM"),
            base_url=os.getenv("ALPACA_API_BASE_URL"),
            rh_mcp_url=os.getenv("ROBINHOOD_MCP_URL"),
            rh_mcp_token=os.getenv("ROBINHOOD_MCP_TOKEN"),
        ),
    )
    return cfg
