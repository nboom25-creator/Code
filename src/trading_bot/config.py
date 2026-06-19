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


@dataclass
class Config:
    mode: str = "paper"
    symbols: list[str] = field(default_factory=list)
    timeframe: str = "1Day"
    poll_interval_seconds: int = 60
    benchmark: str = "SPY"  # market-regime benchmark
    strategy: StrategyConfig = field(default_factory=StrategyConfig)
    risk: RiskConfig = field(default_factory=RiskConfig)
    portfolio: PortfolioConfig = field(default_factory=PortfolioConfig)
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
        backtest=BacktestConfig(**(raw.get("backtest", {}) or {})),
        credentials=Credentials(
            api_key=os.getenv("ALPACA_API_KEY"),
            api_secret=os.getenv("ALPACA_API_SECRET"),
            live_confirm=os.getenv("LIVE_TRADING_CONFIRM"),
            base_url=os.getenv("ALPACA_API_BASE_URL"),
        ),
    )
    return cfg
