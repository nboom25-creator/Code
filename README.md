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
  agent/          # autonomous LLM agent (Research-then-Decide loop)
    schemas.py    #   structured outputs per cognitive phase (Pydantic)
    tools.py      #   perception + deep-research tools; driver-only execute_order
    guardrails.py #   hardcoded 5% sizing / 2% drawdown / bracket stops
    llm.py        #   Claude (Opus 4.8) + offline HeuristicLLM (same interface)
    cognition.py  #   five-phase driver + entry & position-review loops
    research.py   #   screener + SEC EDGAR + Firecrawl + sim providers
    sentiment.py  #   local lexicon sentiment scorer
    regime.py     #   market risk-on/off filter (scales new-entry exposure)
    portfolio_risk.py # account-wide caps (cash buffer / sector / # positions)
    account_rules.py  # limit-order cost model + PDT + wash-sale rules
    backtest_agent.py # point-in-time backtest of the whole agent over history
    ledger.py     #   persistent trade ledger (FIFO closed-trade matching)
    performance.py#   realized P&L metrics + attribution by profile/confidence
    paper_sim.py  #   in-memory simulated paper broker
    audit.py      #   logs/YYYY-MM-DD.md transparency trail
    runner.py     #   daily / cron runner + drawdown circuit breaker
CLAUDE.md         # the agent's permanent system manual
tests/            # offline unit tests
.github/workflows/ci.yml  # CI: pytest on Python 3.10–3.12
```

## Autonomous LLM agent (Research-then-Decide)

On top of the rule-based engine there's an optional **agentic layer** driven by
Claude (`claude-opus-4-8`) that runs a strict, multi-step cognitive loop:

```
Perception → Cognitive Planning → Reflection (bull/bear) → Action → Memory/Audit
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # required for the agent
python -m trading_bot agent           # runs one daily cycle per watchlist symbol
```

**Design principle — the LLM proposes, deterministic code disposes.** The model
gets three *read-only* tools (`get_market_bars`, `get_company_news`,
`get_portfolio_state`) to drive Perception, and emits a *structured* decision at
each phase (validated by Pydantic via the Structured Outputs API). It is **never**
given the `execute_order` tool. Every proposed trade is then run through a
hardcoded guardrail layer before the harness — not the model — executes:

- **5% max position size** — buys are resized down to ≤5% of equity, rejected
  if that rounds below one share.
- **1% ADV liquidity cap** — a buy is also capped at 1% of average daily volume so
  the position can be exited; if that rounds below one share the name is too
  illiquid and the trade is rejected. Often binds tighter than the 5% cap on
  thin small/micro-caps.
- **2% daily drawdown circuit breaker** — trading halts for the day and alerts.
- **HOLD on bad data** — if perception fails/returns empty data, the cycle
  short-circuits to HOLD and logs a system exception (no LLM call to decide).

No amount of prompt injection or hallucinated reasoning can place an unsafe or
oversized trade, because the limits live in `agent/guardrails.py`, not the prompt.

Every cycle is written to `logs/YYYY-MM-DD.md` — data seen, reasoning, both the
bull and bear case, the decision, the guardrail verdict, and the action taken —
for complete transparency. The agent's permanent operating manual is
[`CLAUDE.md`](CLAUDE.md), loaded as its system prompt.

To run it nightly, wire `python -m trading_bot agent` into cron or the project's
session-start hook. The agent layer is fully unit-tested offline (no API key
needed) via a scripted LLM and in-memory broker/data fakes.

### Execution quality + account rules

How orders are actually placed and tracked (configurable under `execution:` in
`config.yaml`):

- **Limit orders** — entries/exits are price-protected limit orders ("buy now but
  never pay more than X"), not blind market orders. The limit reaches at most
  `limit_slippage_pct` through the current price. Buys still attach the bracket
  stop/take-profit.
- **Cost model** — recorded (dry-run) fills assume a little adverse slippage
  (`est_slippage_pct`) so the performance ledger isn't optimistic.
- **Pattern Day Trader (PDT) rule** — on a sub-$25k account the bot blocks a 4th
  same-day round trip in a rolling window, which would otherwise restrict the
  account.
- **Wash-sale avoidance** — it won't rebuy a name it sold at a loss within the
  last `wash_sale_days` (default 30), preserving the tax loss.

Both account rules read the trade ledger and are enforced in code before any
order is placed; each can be toggled off in config.

### Portfolio-level risk caps

Per-trade caps aren't enough — ten small longs in the same sector are really one
big bet. Account-wide limits (configurable under `portfolio:` in `config.yaml`)
prevent that:

- **Cash buffer** — stay at most `max_invested_pct` invested (default 90%).
- **Sector cap** — at most `max_sector_pct` of equity in any one sector (30%).
- **Max positions** — hold at most `max_positions` names at once (10).

Each run the agent snapshots current holdings (with sectors from the research
layer), and every new buy is capped by the remaining sector/total headroom — or
skipped entirely when a sector or the cash buffer is full, or the position count
is maxed. Sectors are only enforced when the research layer is configured;
otherwise the cash-buffer and position-count caps still apply.

### Conviction + volatility position sizing

Instead of a flat 5% on every trade, the harness sizes each entry by **how
confident the agent is** and **how volatile the stock is**:

```
target = 5% cap  ×  confidence (0–1)  ×  calmness (referenceATR / stockATR, ≤1)
```

A high-conviction idea in a calm stock approaches the full cap; a low-conviction
idea in a jumpy stock gets a small slice — so positions carry more even risk.
Volatility comes from **ATR** (now reported by `get_market_bars`). The model only
chooses direction + conviction; the **code decides the dollar size**, and that
size is still clamped by every hard cap (5% / 1% ADV / regime) afterward — it can
only shrink a position, never grow it past the limits. The audit log shows the
math (model proposal vs risk-sized target).

### Market regime filter (risk-on / risk-off)

Before taking *new* exposure, the agent assesses the broad market (a benchmark vs
its long-term trend, plus volatility) and scales new-entry size accordingly:

```bash
python -m trading_bot regime            # live (yfinance)
python -m trading_bot regime --sim      # offline demo
```

- **risk_on** (clearly above trend, calm) → full size (×1.0)
- **neutral** (near trend, or elevated vol) → half size (×0.5)
- **risk_off** (below trend) → **no new entries** (×0.0) — manage-only mode

The multiplier scales the position-size cap for entries and ADDs; **exits and
trims always run** so the agent can de-risk in bad tape. Set the benchmark with
`benchmark:` in `config.yaml` (default `SPY`).

### Position management + performance attribution

The agent doesn't just open positions — each run it **reviews what it holds**
first (HOLD / TRIM / EXIT / ADD), then considers new entries. Every fill is
written to a persistent **trade ledger** (`logs/ledger.jsonl`) with the cap
profile and the agent's stated confidence, so outcomes can be measured:

```bash
python -m trading_bot performance              # all modes
python -m trading_bot performance --mode paper # paper account only
```

The report gives realized P&L, win rate, expectancy, profit factor, and max
drawdown — **broken down by cap profile and by confidence bucket**, so you can
see whether the small-cap engine adds value and whether the agent's conviction
actually predicts winners. This is the feedback loop that makes the bot a
learning system instead of a black box.

### Backtesting the agent

Beyond backtesting individual rule strategies, you can backtest the **whole
agent** — its regime gate, research, reviews, sizing, and every guardrail — over
historical days:

```bash
# Synthetic data (offline, deterministic — proves the machinery):
python -m trading_bot backtest-agent --symbols AAA,BBB,CCC --days 400 --cadence 5

# Real historical prices (needs network access to the data host):
python -m trading_bot backtest-agent --real --symbols AAPL,MSFT,NVDA \
    --start 2022-01-01 --end 2023-12-31

# Real prices from local CSV files (no network — works in locked-down envs):
#   put AAPL.csv, MSFT.csv, NVDA.csv, SPY.csv (date,open,high,low,close,volume) in data/
python -m trading_bot backtest-agent --csv data/ --symbols AAPL,MSFT,NVDA
```

**Real-data backtests turn the research layer OFF by default.** Fundamentals and
news are only available as *today's* snapshot — using them for a past decision is
look-ahead bias. Historical prices are point-in-time clean, so the real backtest
trades on price/volume/regime only. (`--research` re-enables it but the results
are then optimistic; the CLI warns you.)

It replays history one bar at a time with a **point-in-time** data feed (the
agent only ever sees data up to "now" — no look-ahead), fills orders through a
simulated broker that honors the bracket stops and marks the account to market
each day, and runs the real cognitive loop on a configurable cadence. The output
is an equity curve (total return, Sharpe, max drawdown) plus the full trade
attribution from the ledger — including the by-confidence breakdown, so you can
see whether the agent's conviction actually predicts winners. Uses the offline
`HeuristicLLM` brain so a multi-year backtest runs in seconds with no API cost;
swap in Claude for a (slower, paid) LLM-driven backtest.

### Safe dry-run (`run_dry_run.py`)

Triggers the entire research loop **exactly once** and **intercepts the final
`execute_order`** — no trade is ever sent. The proposed trade and its Bull/Bear
reasoning are written to `logs/YYYY-MM-DD.md`.

```bash
# Fully offline — synthetic data + local heuristic analyst, zero credentials:
python run_dry_run.py --offline --sim-data --symbols AAPL,MSFT

# Free live data (yfinance) + offline analyst:
python run_dry_run.py --offline --symbols AAPL

# Real research with Claude (needs ANTHROPIC_API_KEY in .env):
python run_dry_run.py --symbols AAPL
```

Providers are auto-selected from `.env`, and each is independent:

| Layer        | With keys in `.env`            | Without (default)                 |
| ------------ | ------------------------------ | --------------------------------- |
| Market data  | `yfinance` (free, keyless)     | `--sim-data` for synthetic        |
| News + sentiment | yfinance headlines + local lexicon scorer | synthetic headlines           |
| Portfolio    | Alpaca **paper** account       | simulated in-memory $100k account |
| Reasoning    | Claude (`ANTHROPIC_API_KEY`)   | offline `HeuristicLLM`            |

All keys, secrets, and base URLs load strictly from `.env` via `python-dotenv`
(see [`.env.example`](.env.example)) — nothing is hardcoded.

### Small/micro-cap research

Thinly-covered names get an alternative, high-density research pipeline and a
discovery mechanism:

```bash
# Screen for small-caps in a sector (FMP_API_KEY for live, or --sim offline):
python -m trading_bot discover --sector technology

# Run the agent on screened small-caps (dry-run, fully offline):
python run_dry_run.py --offline --sim-data --discover healthcare
```

**Discovery** — `discover_small_caps(sector, market_cap_max=2e9, min_volume=1e5)`
screens via Financial Modeling Prep (or the simulated screener offline).

**Multi-tiered research fallback** — when generic news returns **fewer than 3
items**, the harness automatically enriches perception:
- *Tier 1 — alternative financial data:* SEC EDGAR 10-Q/10-K filings and Form 4
  insider activity (free; set `SEC_EDGAR_USER_AGENT`), plus fundamentals.
- *Tier 2 — deep web search:* a developer scraping API (Firecrawl) runs
  `"{TICKER} stock analysis {Company} earnings guidance"` against niche investor
  blogs / regional outlets and returns markdown.

**Asymmetric information processing** — each name is classified large- vs
small-cap (by market cap, or sparse coverage as a proxy). Large-caps weigh macro
trends + high-volume news sentiment; small-caps **heavily weigh raw fundamentals
(cash, debt/equity, current ratio, growth) and unusual volume**. If news
sentiment is empty, the agent does **not** fail — it relies 100% on fundamentals.

Every external provider degrades gracefully to empty on failure, and a full set
of offline `Sim` providers makes the whole pipeline testable and demonstrable
with no network or keys.

## Disclaimer

This software is provided for educational purposes and as a starting point. It
comes with no warranty. You are solely responsible for any trades it places and
any losses incurred. Markets are risky; automated systems can fail in
unexpected ways. **Always start with paper trading.**
