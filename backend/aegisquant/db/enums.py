"""Domain enumerations shared by the ORM, services and API schemas."""

from __future__ import annotations

import enum


class StrEnum(str, enum.Enum):
    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.value


class Role(StrEnum):
    ADMIN = "admin"
    OPERATOR = "operator"
    VIEWER = "viewer"
    READONLY = "readonly"


class AssetClass(StrEnum):
    EQUITY = "equity"
    ETF = "etf"
    # Interfaces exist but these are disabled in v1.
    OPTION = "option"
    FUTURE = "future"
    CRYPTO = "crypto"


class Side(StrEnum):
    BUY = "buy"
    SELL = "sell"


class OrderType(StrEnum):
    MARKET = "market"
    LIMIT = "limit"
    STOP = "stop"
    STOP_LIMIT = "stop_limit"


class TimeInForce(StrEnum):
    DAY = "day"
    GTC = "gtc"
    IOC = "ioc"
    FOK = "fok"
    OPG = "opg"
    CLS = "cls"


class OrderStatus(StrEnum):
    """Local order lifecycle. Terminal states: FILLED/CANCELED/REJECTED/EXPIRED."""

    PENDING_NEW = "pending_new"
    NEW = "new"
    PARTIALLY_FILLED = "partially_filled"
    FILLED = "filled"
    PENDING_CANCEL = "pending_cancel"
    CANCELED = "canceled"
    PENDING_REPLACE = "pending_replace"
    REPLACED = "replaced"
    REJECTED = "rejected"
    EXPIRED = "expired"

    @property
    def is_terminal(self) -> bool:
        return self in _TERMINAL

    @property
    def is_open(self) -> bool:
        return self in _OPEN


_TERMINAL = {
    OrderStatus.FILLED,
    OrderStatus.CANCELED,
    OrderStatus.REJECTED,
    OrderStatus.EXPIRED,
    OrderStatus.REPLACED,
}
_OPEN = {
    OrderStatus.PENDING_NEW,
    OrderStatus.NEW,
    OrderStatus.PARTIALLY_FILLED,
    OrderStatus.PENDING_CANCEL,
    OrderStatus.PENDING_REPLACE,
}


class Mode(StrEnum):
    BACKTEST = "BACKTEST"
    PAPER = "PAPER"
    LIVE = "LIVE"


class DecisionAction(StrEnum):
    BUY = "BUY"
    SELL = "SELL"
    HOLD = "HOLD"
    TRIM = "TRIM"
    ADD = "ADD"
    EXIT = "EXIT"


class ApprovalState(StrEnum):
    AUTO_APPROVED = "auto_approved"
    PENDING_HUMAN = "pending_human"
    APPROVED = "approved"
    REJECTED_BY_RISK = "rejected_by_risk"
    REJECTED_BY_HUMAN = "rejected_by_human"
    EXPIRED = "expired"


class RiskState(StrEnum):
    """Portfolio-level defensive posture; escalates with drawdown."""

    NORMAL = "normal"
    WARNING = "warning"
    DEFENSIVE_1 = "defensive_1"
    DEFENSIVE_2 = "defensive_2"
    EMERGENCY = "emergency"
    READ_ONLY = "read_only"


class RiskCheckResult(StrEnum):
    PASS = "pass"
    WARN = "warn"
    RESIZE = "resize"
    REJECT = "reject"


class Regime(StrEnum):
    RISK_ON = "risk_on"
    NEUTRAL = "neutral"
    RISK_OFF = "risk_off"


class DataQuality(StrEnum):
    OK = "ok"
    SUSPECT = "suspect"
    STALE = "stale"
    MISSING = "missing"
    CORRUPT = "corrupt"
    SYNTHETIC = "synthetic"  # generated fixture data — never presented as real


class Adjustment(StrEnum):
    RAW = "raw"
    SPLIT_ONLY = "split_only"
    SPLIT_DIVIDEND = "split_dividend"


class IssueSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"


class IssueKind(StrEnum):
    MISSING_BAR = "missing_bar"
    DUPLICATE_RECORD = "duplicate_record"
    STALE_QUOTE = "stale_quote"
    TIMESTAMP_INCONSISTENCY = "timestamp_inconsistency"
    ADJUSTMENT_ERROR = "adjustment_error"
    EXTREME_OUTLIER = "extreme_outlier"
    SYMBOL_CHANGE = "symbol_change"
    DELISTED = "delisted"
    PROVIDER_DISAGREEMENT = "provider_disagreement"
    MARKET_CLOSED = "market_closed"
    OHLC_INCONSISTENT = "ohlc_inconsistent"
    NEGATIVE_OR_ZERO_PRICE = "non_positive_price"
    PROVIDER_ERROR = "provider_error"


class StrategyStatus(StrEnum):
    RESEARCH = "research"
    QUARANTINED = "quarantined"
    VALIDATED = "validated"
    PAPER = "paper"
    LIVE_ELIGIBLE = "live_eligible"
    LIVE = "live"
    PAUSED = "paused"
    RETIRED = "retired"


class BacktestPhase(StrEnum):
    IN_SAMPLE = "in_sample"
    VALIDATION = "validation"
    OUT_OF_SAMPLE = "out_of_sample"
    PAPER = "paper"
    LIVE = "live"


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AlertSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class AlertKind(StrEnum):
    ORDER_SUBMITTED = "order_submitted"
    ORDER_FILLED = "order_filled"
    ORDER_REJECTED = "order_rejected"
    BROKER_DISCONNECT = "broker_disconnect"
    STALE_DATA = "stale_data"
    DAILY_LOSS = "daily_loss"
    DRAWDOWN = "drawdown"
    RISK_VIOLATION = "risk_violation"
    STRATEGY_PAUSED = "strategy_paused"
    RECONCILIATION_MISMATCH = "reconciliation_mismatch"
    APPLICATION_FAILURE = "application_failure"
    KILL_SWITCH = "kill_switch"
    LIVE_MODE_CHANGE = "live_mode_change"
    PROMOTION = "promotion"


class ReconStatus(StrEnum):
    CLEAN = "clean"
    BREAKS_FOUND = "breaks_found"
    FAILED = "failed"
