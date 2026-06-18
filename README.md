# Autonomous Trading Bot

A rule-based, autonomous trading bot for US stocks/ETFs built on
[Alpaca](https://alpaca.markets/). It runs technical strategies (moving-average
crossover, RSI mean-reversion) through a risk-managed execution engine, and
ships with an offline backtester so you can validate a strategy on historical
data before risking a cent.

> **⚠️ Safety first.** The bot trades **paper money by default**. Live trading
> with real funds is gated behind an explicit `mode: live` config flag *and* a
> `LIVE_TRADING_CONFIRM=I_UNDERSTAND_THE_RISK` environment variable. Algorithmic
> trading can lose money quickly. Nothing here is financial advice. Start on
> paper, understand the code, and only risk money you can afford to lose.

## Features

- **Strategies** — rule-based SMA crossover, RSI mean-reversion, MACD crossover,
  Bollinger breakout, plus an optional **ML signal layer** (scikit-learn
  random-forest on engineered features). All behind one registry for easy
  extension.
- **Backtesting engine** — simulate a strategy over historical bars with no
  look-ahead, realistic position sizing, commission/slippage hooks, intrabar
  **stop-loss / take-profit** exits, and metrics (total return, Sharpe, max
  drawdown, win rate).
- **Optimization & validation** — grid-search strategy parameters and run
  **walk-forward (out-of-sample) validation** to catch over-fitting before it
  costs you.
- **Risk management** — per-trade risk sizing, max open positions, max position
  size, daily loss limit, stop-loss/take-profit, and a global kill switch.
- **Live execution** — autonomous loop with broker-managed **bracket orders**
  (stop + take-profit attached at entry) so protective exits hold even if the
  bot goes offline.
- **Notifications & dashboard** — log/Slack/Discord webhook alerts on trades and
  daily P&L, plus a self-contained **HTML report** with an inline equity curve.
- **Paper/live gating** — paper trading is the default; live requires two
  independent confirmations.
- **Tested + CI** — 58 offline unit tests; GitHub Actions runs them on Python
  3.10–3.12 on every push.

## Quick start

```bash
# 1. Install
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# 2. Configure credentials (paper keys from https://alpaca.markets/)
cp .env.example .env
# edit .env with your Alpaca paper API key/secret

# 3. Run the test suite (no network needed)
pytest

# 4. Backtest a strategy on synthetic data (no network needed)
python -m trading_bot backtest --synthetic --strategy sma_crossover

# 5. Backtest on real data + write an HTML dashboard
python -m trading_bot backtest --symbols AAPL,MSFT --strategy rsi_reversion \
    --start 2022-01-01 --end 2023-01-01 --report report.html

# 6. Optimize parameters, then validate out-of-sample
python -m trading_bot optimize --synthetic --strategy macd_crossover --top 5
python -m trading_bot walkforward --synthetic --strategy sma_crossover

# 7. Run live against the PAPER account
python -m trading_bot run
```

## Commands

| Command       | What it does                                                  |
| ------------- | ------------------------------------------------------------ |
| `backtest`    | Backtest a strategy (`--synthetic` or real data); `--report` |
| `optimize`    | Grid-search strategy parameters, ranked by a metric          |
| `walkforward` | Walk-forward out-of-sample validation across folds           |
| `run`         | Run the autonomous engine (`--once` for a single cycle)      |
| `status`      | Show account equity and open positions                       |

### Strategies

`sma_crossover`, `rsi_reversion`, `macd_crossover`, `bollinger_breakout`, and
`ml` (requires `pip install scikit-learn`).

### Notifications

Set `NOTIFY_WEBHOOK_URL` in `.env` to a Slack or Discord incoming-webhook URL to
receive trade and daily-P&L alerts. Unset, alerts just go to the log.

## Configuration

Edit `config.yaml`. Key fields:

| Field                       | Meaning                                              |
| --------------------------- | ---------------------------------------------------- |
| `mode`                      | `paper` (default) or `live`                          |
| `symbols`                   | List of tickers to trade                             |
| `strategy.name`             | `sma_crossover` or `rsi_reversion`                   |
| `risk.max_position_pct`     | Max % of equity in a single position                 |
| `risk.risk_per_trade_pct`   | % of equity risked per trade (drives position size)  |
| `risk.max_open_positions`   | Cap on concurrent positions                          |
| `risk.daily_loss_limit_pct` | Halt trading after this daily drawdown               |

Secrets (API keys) live in `.env`, never in `config.yaml`.

## Project layout

```
src/trading_bot/
  config.py       # config + env loading
  indicators.py   # technical indicators (pure pandas/numpy)
  strategy.py     # strategy base class + rule-based implementations
  ml_strategy.py  # optional ML signal layer (scikit-learn, self-registering)
  risk.py         # risk manager / guardrails
  portfolio.py    # in-memory portfolio for backtesting
  backtest.py     # backtesting engine + metrics + stop/take-profit
  optimize.py     # grid search + walk-forward validation
  data.py         # historical/live data provider
  broker.py       # Alpaca broker wrapper (paper/live, bracket orders)
  engine.py       # live trading loop
  notify.py       # log / webhook notifications
  report.py       # HTML dashboard generation
  cli.py          # command-line entry point
tests/            # offline unit tests
.github/workflows/ci.yml  # CI: pytest on Python 3.10–3.12
```

## Disclaimer

This software is provided for educational purposes and as a starting point. It
comes with no warranty. You are solely responsible for any trades it places and
any losses incurred. Markets are risky; automated systems can fail in
unexpected ways. **Always start with paper trading.**
