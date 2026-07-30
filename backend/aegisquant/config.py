"""Environment-validated application settings.

All configuration enters the process here. Secrets are held as
:class:`~pydantic.SecretStr` so they cannot be accidentally serialised into an
API response or a log line, and :func:`Settings.public_dict` is the only
sanctioned way to hand configuration to the frontend.
"""

from __future__ import annotations

import enum
from decimal import Decimal
from functools import lru_cache
from typing import Any, Literal

from pydantic import Field, SecretStr, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Mode(str, enum.Enum):
    """Platform operating mode."""

    BACKTEST = "BACKTEST"
    PAPER = "PAPER"
    LIVE = "LIVE"


class RiskLimits(BaseSettings):
    """Deterministic risk limits.

    These are defaults; the persisted :class:`aegisquant.db.models.RiskConfig`
    row overrides them at runtime so an operator can tune limits without a
    redeploy. Every value is a *hard* ceiling unless its name says ``soft``.
    """

    model_config = SettingsConfigDict(env_prefix="AEGIS_RISK_", extra="ignore")

    # --- per-trade ---
    max_risk_per_trade_pct: Decimal = Decimal("0.010")  # equity at risk to stop
    max_position_pct: Decimal = Decimal("0.150")  # single-name weight ceiling
    max_order_notional_pct: Decimal = Decimal("0.150")
    min_order_notional: Decimal = Decimal("50")

    # --- portfolio ---
    max_gross_exposure_pct: Decimal = Decimal("1.000")  # no leverage in v1
    max_net_exposure_pct: Decimal = Decimal("1.000")
    max_sector_exposure_pct: Decimal = Decimal("0.350")
    max_strategy_exposure_pct: Decimal = Decimal("0.500")
    max_correlated_exposure_pct: Decimal = Decimal("0.450")
    correlation_threshold: Decimal = Decimal("0.700")
    max_open_positions: int = 15
    min_cash_buffer_pct: Decimal = Decimal("0.020")

    # --- loss / drawdown ---
    max_daily_loss_pct: Decimal = Decimal("0.030")
    max_weekly_loss_pct: Decimal = Decimal("0.070")
    max_portfolio_drawdown_pct: Decimal = Decimal("0.200")
    drawdown_warning_pct: Decimal = Decimal("0.070")
    defensive_stage_1_pct: Decimal = Decimal("0.100")
    defensive_stage_2_pct: Decimal = Decimal("0.150")
    emergency_stage_pct: Decimal = Decimal("0.200")
    loss_cooldown_hours: int = 24

    # --- execution / microstructure ---
    max_turnover_daily_pct: Decimal = Decimal("0.500")
    min_adv_usd: Decimal = Decimal("5000000")
    max_adv_participation_pct: Decimal = Decimal("0.010")
    max_estimated_impact_bps: Decimal = Decimal("50")
    max_spread_bps: Decimal = Decimal("50")
    min_price: Decimal = Decimal("5")
    max_data_age_seconds: int = 900
    max_open_order_seconds: int = 3600

    # --- sizing ---
    kelly_fraction: Decimal = Decimal("0.250")  # never full Kelly
    target_portfolio_vol_pct: Decimal = Decimal("0.180")
    conviction_size_floor: Decimal = Decimal("0.250")

    @field_validator("kelly_fraction")
    @classmethod
    def _kelly_must_be_fractional(cls, v: Decimal) -> Decimal:
        if not (Decimal(0) < v <= Decimal("0.5")):
            raise ValueError("kelly_fraction must be in (0, 0.5]; full Kelly is forbidden")
        return v

    @model_validator(mode="after")
    def _stages_must_be_ordered(self) -> RiskLimits:
        stages = [
            self.drawdown_warning_pct,
            self.defensive_stage_1_pct,
            self.defensive_stage_2_pct,
            self.emergency_stage_pct,
        ]
        if stages != sorted(stages):
            raise ValueError("drawdown stages must be monotonically increasing")
        return self


class PromotionThresholds(BaseSettings):
    """Governance thresholds for the paper-to-live promotion gate.

    These are *governance* checks, not proof of future profitability.
    """

    model_config = SettingsConfigDict(env_prefix="AEGIS_PROMO_", extra="ignore")

    min_oos_days: int = 365
    min_trades: int = 50
    min_net_sharpe: Decimal = Decimal("0.60")
    min_net_cagr: Decimal = Decimal("0.00")
    max_drawdown_pct: Decimal = Decimal("0.250")
    max_param_sensitivity_cv: Decimal = Decimal("0.600")
    min_walkforward_pass_rate: Decimal = Decimal("0.600")
    min_stress_survival_pct: Decimal = Decimal("-0.350")
    min_paper_days: int = 30
    min_paper_trades: int = 20
    max_paper_sim_tracking_error: Decimal = Decimal("0.500")
    require_zero_open_data_issues: bool = True
    require_zero_open_recon_breaks: bool = True


class Settings(BaseSettings):
    """Top-level settings object. Instantiated once via :func:`get_settings`."""

    model_config = SettingsConfigDict(
        env_prefix="AEGIS_",
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- core ---
    mode: Mode = Mode.PAPER
    env_name: str = "development"
    debug: bool = False
    timezone: str = "America/New_York"  # display only; storage is always UTC
    base_currency: str = "USD"

    # --- persistence ---
    database_url: str = "postgresql+psycopg2://aegis:aegis@localhost:5432/aegisquant"
    redis_url: str = "redis://localhost:6379/0"
    sql_echo: bool = False

    # --- security ---
    secret_key: SecretStr = SecretStr("dev-only-insecure-change-me")
    access_token_ttl_minutes: int = 720
    bootstrap_admin_email: str = "admin@aegisquant.local"
    bootstrap_admin_password: SecretStr = SecretStr("aegis-dev-password")
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    rate_limit_per_minute: int = 240
    cookie_secure: bool = False
    cookie_name: str = "aegis_session"
    csrf_cookie_name: str = "aegis_csrf"

    # --- data providers ---
    price_provider: Literal["fixture", "yfinance", "alpaca"] = "fixture"
    fundamentals_provider: Literal["fixture", "yfinance"] = "fixture"
    news_provider: Literal["fixture", "alpaca"] = "fixture"
    macro_provider: Literal["fixture", "fred"] = "fixture"
    calendar_provider: Literal["static", "alpaca"] = "static"
    fixture_seed: int = 20240101
    provider_timeout_seconds: float = 20.0
    provider_max_retries: int = 4
    provider_cache_ttl_seconds: int = 300

    alpaca_key_id: SecretStr | None = None
    alpaca_secret_key: SecretStr | None = None
    alpaca_paper_base_url: str = "https://paper-api.alpaca.markets"
    alpaca_live_base_url: str = "https://api.alpaca.markets"
    alpaca_data_base_url: str = "https://data.alpaca.markets"
    fred_api_key: SecretStr | None = None

    # --- broker ---
    broker: Literal["mock", "alpaca"] = "mock"

    # --- live-trading gate (all must line up; see aegisquant.live_gate) ---
    live_trading_enabled: bool = False
    live_confirmation_phrase: SecretStr = SecretStr("I AUTHORIZE LIVE TRADING")
    live_max_allocation_usd: Decimal = Decimal("1000")
    live_require_promotion_gate: bool = True

    # --- autonomous loop ---
    loop_enabled: bool = True
    loop_interval_seconds: int = 300
    universe_max_symbols: int = 250
    benchmark_symbol: str = "SPY"
    max_candidates_per_cycle: int = 40
    llm_enabled: bool = False  # narration is deterministic unless explicitly enabled
    anthropic_api_key: SecretStr | None = None
    anthropic_model: str = "claude-sonnet-4-6"

    # --- nested ---
    risk: RiskLimits = Field(default_factory=RiskLimits)
    promotion: PromotionThresholds = Field(default_factory=PromotionThresholds)

    # ------------------------------------------------------------------
    @field_validator("mode", mode="before")
    @classmethod
    def _upper_mode(cls, v: Any) -> Any:
        return v.upper() if isinstance(v, str) else v

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: Any) -> Any:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @field_validator("live_max_allocation_usd")
    @classmethod
    def _positive_allocation(cls, v: Decimal, info: ValidationInfo) -> Decimal:
        if v <= 0:
            raise ValueError("live_max_allocation_usd must be positive")
        return v

    @model_validator(mode="after")
    def _validate_live_and_secrets(self) -> Settings:
        # LIVE mode can never be reached by config drift alone.
        if self.mode is Mode.LIVE and not self.live_trading_enabled:
            raise ValueError(
                "AEGIS_MODE=LIVE requires AEGIS_LIVE_TRADING_ENABLED=true. "
                "Refusing to start; the platform never silently trades real money."
            )
        if self.mode is Mode.LIVE and self.broker == "mock":
            raise ValueError("LIVE mode cannot use the mock broker")
        if self.broker == "alpaca" and not (self.alpaca_key_id and self.alpaca_secret_key):
            raise ValueError("broker=alpaca requires AEGIS_ALPACA_KEY_ID and AEGIS_ALPACA_SECRET_KEY")
        insecure = self.secret_key.get_secret_value().startswith("dev-only")
        if insecure and self.env_name not in ("development", "test", "ci"):
            raise ValueError("AEGIS_SECRET_KEY must be set outside development")
        if self.mode is Mode.LIVE and insecure:
            raise ValueError("AEGIS_SECRET_KEY must be a real secret in LIVE mode")
        return self

    # ------------------------------------------------------------------
    @property
    def is_live(self) -> bool:
        return self.mode is Mode.LIVE

    @property
    def alpaca_trading_base_url(self) -> str:
        return self.alpaca_live_base_url if self.is_live else self.alpaca_paper_base_url

    def public_dict(self) -> dict[str, Any]:
        """Configuration safe to serialise to a browser. No secrets, ever."""
        return {
            "mode": self.mode.value,
            "env_name": self.env_name,
            "timezone": self.timezone,
            "base_currency": self.base_currency,
            "broker": self.broker,
            "price_provider": self.price_provider,
            "fundamentals_provider": self.fundamentals_provider,
            "news_provider": self.news_provider,
            "macro_provider": self.macro_provider,
            "calendar_provider": self.calendar_provider,
            "live_trading_enabled": self.live_trading_enabled,
            "live_max_allocation_usd": str(self.live_max_allocation_usd),
            "loop_enabled": self.loop_enabled,
            "loop_interval_seconds": self.loop_interval_seconds,
            "benchmark_symbol": self.benchmark_symbol,
            "llm_enabled": self.llm_enabled,
            "using_synthetic_data": self.price_provider == "fixture",
            "version": __import__("aegisquant").__version__,
        }

    def secret_values(self) -> list[str]:
        """Every secret string, for log redaction."""
        out: list[str] = []
        for name in (
            "secret_key",
            "bootstrap_admin_password",
            "alpaca_key_id",
            "alpaca_secret_key",
            "fred_api_key",
            "anthropic_api_key",
            "live_confirmation_phrase",
        ):
            val = getattr(self, name, None)
            if isinstance(val, SecretStr):
                sv = val.get_secret_value()
                if sv and len(sv) >= 6:
                    out.append(sv)
        return out


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    """Test helper — forget the memoised settings object."""
    get_settings.cache_clear()
