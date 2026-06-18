import pytest

from trading_bot.config import RiskConfig
from trading_bot.risk import RiskManager


def make_manager(**overrides):
    cfg = RiskConfig(
        max_position_pct=0.20,
        risk_per_trade_pct=0.01,
        stop_loss_pct=0.05,
        max_open_positions=5,
        daily_loss_limit_pct=0.03,
    )
    for k, v in overrides.items():
        setattr(cfg, k, v)
    return RiskManager(cfg)


def test_position_size_risk_based():
    rm = make_manager()
    # equity 100k, risk 1% = $1000, stop distance = 5% of $100 = $5 -> 200 shares.
    # cap = 20% of 100k = $20k / $100 = 200 shares. Both give 200.
    assert rm.position_size(100_000, 100.0) == 200


def test_position_size_capped_by_max_position():
    rm = make_manager(stop_loss_pct=0.01)  # loosens risk sizing -> cap binds
    # risk-based: $1000 / (1% of 100) = $1000/$1 = 1000 shares.
    # cap: $20k / $100 = 200 shares -> min is 200.
    assert rm.position_size(100_000, 100.0) == 200


def test_position_size_zero_for_bad_inputs():
    rm = make_manager()
    assert rm.position_size(0, 100) == 0
    assert rm.position_size(100_000, 0) == 0


def test_evaluate_entry_approves():
    rm = make_manager()
    rm.start_day(100_000)
    d = rm.evaluate_entry(equity=100_000, price=100.0, open_positions=0)
    assert d.approved and d.quantity == 200


def test_evaluate_entry_blocks_on_max_positions():
    rm = make_manager(max_open_positions=2)
    d = rm.evaluate_entry(equity=100_000, price=100.0, open_positions=2)
    assert not d.approved
    assert "max open positions" in d.reason


def test_evaluate_entry_blocks_on_daily_loss():
    rm = make_manager(daily_loss_limit_pct=0.03)
    rm.start_day(100_000)
    # current equity down 4% -> breached.
    d = rm.evaluate_entry(
        equity=96_000, price=100.0, open_positions=0, current_equity=96_000
    )
    assert not d.approved
    assert "daily loss" in d.reason


def test_kill_switch_blocks_entry():
    rm = make_manager()
    rm.engage_kill_switch("test")
    d = rm.evaluate_entry(equity=100_000, price=100.0, open_positions=0)
    assert not d.approved
    assert "kill switch" in d.reason
    rm.reset_kill_switch()
    assert rm.evaluate_entry(equity=100_000, price=100.0, open_positions=0).approved


def test_daily_loss_not_breached_within_limit():
    rm = make_manager(daily_loss_limit_pct=0.05)
    rm.start_day(100_000)
    assert not rm.daily_loss_breached(98_000)  # down 2%, limit 5%
    assert rm.daily_loss_breached(94_000)  # down 6%
