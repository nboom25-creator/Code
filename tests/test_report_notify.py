from trading_bot.backtest import Backtester, generate_synthetic_bars
from trading_bot.config import BacktestConfig, RiskConfig
from trading_bot.notify import Notifier
from trading_bot.report import render_html, write_report
from trading_bot.strategy import build_strategy


def _result():
    bars = generate_synthetic_bars(n=300, seed=4)
    strat = build_strategy("sma_crossover", {"fast_period": 10, "slow_period": 30})
    return Backtester(strat, RiskConfig(), BacktestConfig()).run("SYNTH", bars)


def test_render_html_contains_metrics_and_svg():
    html = render_html(_result())
    assert "<svg" in html
    assert "Total return" in html
    assert "Backtest report" in html


def test_write_report_creates_file(tmp_path):
    out = write_report(_result(), tmp_path / "report.html")
    assert out.exists()
    assert out.read_text().startswith("<!doctype html>")


def test_notifier_without_webhook_just_logs(caplog):
    n = Notifier(webhook_url=None)
    n.trade("buy", "AAPL", 10, 150.0)
    n.daily_summary(equity=101000, day_start_equity=100000, num_trades=3)
    # No exception, no webhook configured.
    assert n.webhook_url is None
