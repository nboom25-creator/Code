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

- **Rule-based strategies** — SMA crossover and RSI mean-reversion, easy to
  extend with your own.
- **Backtesting engine** — simulate a strategy over historical bars with
  realistic position sizing, commissions/slippage hooks, and performance metrics
  (total return, Sharpe, max drawdown, win rate).
- **Risk management** — per-trade risk sizing, max open positions, max position
  size, daily loss limit, and a global kill switch.
- **Paper/live gating** — paper trading is the default; live requires two
  independent confirmations.
- **Pure-Python core** — indicators, strategies, risk, and backtesting have no
  network dependency and are unit-tested.

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

# 5. Backtest on real historical data from Alpaca
python -m trading_bot backtest --symbols AAPL,MSFT --strategy rsi_reversion \
    --start 2022-01-01 --end 2023-01-01

# 6. Run live against the PAPER account
python -m trading_bot run
```

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
  strategy.py     # strategy base class + implementations
  risk.py         # risk manager / guardrails
  portfolio.py    # in-memory portfolio for backtesting
  backtest.py     # backtesting engine + metrics
  data.py         # historical/live data provider
  broker.py       # Alpaca broker wrapper (paper/live)
  engine.py       # live trading loop
  cli.py          # command-line entry point
tests/            # offline unit tests
```

## Disclaimer

This software is provided for educational purposes and as a starting point. It
comes with no warranty. You are solely responsible for any trades it places and
any losses incurred. Markets are risky; automated systems can fail in
unexpected ways. **Always start with paper trading.**
