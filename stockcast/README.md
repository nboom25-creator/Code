# 📊 StockCast

**Evidence-based stock-price forecasting — a research tool, not financial advice.**

StockCast analyzes publicly traded companies using **real market data** and produces
defensible, uncertainty-aware forecasts, a transparent research rating, technical &
fundamental analysis, risk metrics and walk-forward backtests.

> ⚠️ **StockCast is a research and educational tool. It does not provide personalised
> financial advice, does not recommend buying or selling any security, and never claims a
> forecast is certain. Past performance does not guarantee future results.**

---

## What it does

- **Live price** with source and "as of" timestamp + data-delay note
- **Interactive price/volume charts** (1M, 3M, 6M, YTD, 1Y, 5Y, MAX) with optional S&P 500 overlay
- **Forecasts** for 1 day, 1 week, 1 month, 3 months, 6 months, 1 year with **shaded prediction intervals**
- **Bull / Base / Bear** scenario cards
- **Transparent research rating** (Buy → Sell) with every component's weight and contribution shown
- **"Why this rating?"** plain-English explanation, catalysts, risks, and invalidation conditions
- **Technical, fundamental, news-sentiment and risk** analysis
- **Model performance & validation** table (MAE / RMSE / MAPE / directional accuracy / skill vs naive)
- **Backtesting page** with equity curve, predicted-vs-actual, drawdown, Sharpe, costs
- **Watchlist**, recently-analyzed, ticker autocomplete, **Random Stock**, light/dark themes, tooltips
- Loading / empty / invalid-ticker / rate-limit / API-error states

---

## Architecture

```
stockcast/
├── backend/                    # FastAPI + Python analytics
│   └── app/
│       ├── providers/          # Data-source abstraction (swap without touching analysis)
│       │   ├── base.py         #   MarketDataProvider ABC + errors
│       │   ├── stooq.py        #   Stooq — keyless real EOD data (default)
│       │   ├── alphavantage.py #   Alpha Vantage — price + fundamentals + news
│       │   ├── finnhub.py      #   Finnhub — quotes/fundamentals/news
│       │   ├── demo.py         #   DEMO DATA — synthetic, clearly labelled
│       │   └── factory.py      #   provider selection + graceful fallback
│       ├── analysis/           # indicators → features → forecasting → rating → backtest
│       │   ├── indicators.py   #   RSI, MACD, Bollinger, SMA/EMA, momentum, volatility
│       │   ├── features.py     #   leak-free feature engineering (forward-return target)
│       │   ├── forecasting.py  #   models + walk-forward validation + intervals
│       │   ├── rating.py       #   transparent multi-component research score
│       │   ├── risk.py         #   volatility, drawdown, VaR, beta, Sharpe
│       │   ├── backtest.py     #   walk-forward strategy simulation
│       │   ├── sentiment.py    #   lexicon news sentiment fallback
│       │   └── technical.py    #   technical-analysis assembly
│       ├── routers/stocks.py   # /api endpoints
│       ├── service.py          # orchestration (data + analysis + caching)
│       ├── cache.py            # SQLite TTL cache
│       ├── schemas.py          # strongly-typed API contracts
│       ├── config.py           # env-driven settings (keys stay server-side)
│       └── main.py             # FastAPI app
│   └── tests/                  # 28 unit tests (indicators, leakage, rating, backtest, providers)
├── frontend/                   # Next.js 14 + React + TypeScript + Tailwind + Recharts
│   └── src/
│       ├── app/                # dashboard (/) and backtest (/backtest) pages
│       ├── components/         # charts, cards, sections, states, theme
│       └── lib/                # typed API client, formatters, chart helpers, storage
└── docker-compose.yml
```

### Why this stack
The recommended **Next.js + FastAPI** split keeps the data-science code in Python
(pandas / NumPy / scikit-learn) and the interactive dashboard in a modern typed React app.
The Next server proxies `/api/*` to FastAPI so **API keys never reach the browser**.

---

## Data-provider strategy

A single `MarketDataProvider` interface backs every source, so you can switch providers
with one env var and no code changes.

| Provider       | Key needed | History | Quote | Fundamentals | News | Notes |
|----------------|:---------:|:-------:|:-----:|:------------:|:----:|-------|
| **twelvedata** | Yes (free) | ✅ | ✅ **real-time** | ✅ | — | Recommended for live data; one key does everything |
| **stooq** (default) | No | ✅ | ✅ (EOD) | — | — | Real end-of-day data, works out of the box |
| **alphavantage** | Yes (free) | ✅ | ✅ | ✅ | ✅ | Free tier ~25 req/day, 5/min |
| **finnhub** | Yes (free) | paid* | ✅ | ✅ | ✅ | *free tier lacks candles → history falls back to Stooq |
| **demo** | No | ✅ | ✅ | ✅ | ✅ | **Synthetic DEMO DATA**, clearly labelled, fully offline |

**Every displayed value carries its `source` and `as of` timestamp.** Real data is never
silently replaced by fabricated data. If a keyed provider is unconfigured/unreachable, you
either get a clear **setup message** (`ALLOW_DEMO_FALLBACK=false`) or clearly-labelled
**DEMO DATA** with the reason shown (`ALLOW_DEMO_FALLBACK=true`, the default).

### Where to put API keys
Server-side only, in `backend/.env` (copy from `backend/.env.example`):
```
PROVIDER=alphavantage
ALPHAVANTAGE_API_KEY=your_key_here
```
Get free keys: [Alpha Vantage](https://www.alphavantage.co/support/#api-key) ·
[Finnhub](https://finnhub.io/register).

---

## Forecasting & validation methodology

1. **Forecast returns, not prices.** Models predict the forward **log-return** over each
   horizon; prices are reconstructed as `P₀ · exp(return)`. No arbitrary trend lines.
2. **Models compared:** naive random-walk baseline · EWMA drift · Ridge regression on
   engineered features · gradient boosting (scikit-learn `HistGradientBoostingRegressor`).
3. **Features:** lagged returns, rolling volatility, moving-average distances, RSI, MACD,
   Bollinger %B, momentum, volume change, relative strength vs the S&P 500 — all computed
   from information available **at or before** each row (verified leak-free by a unit test).
4. **Walk-forward validation only.** Expanding-window folds, time order never shuffled, no
   look-ahead. Scored by **MAE, RMSE, MAPE, directional accuracy** and **skill vs naive**.
5. **Baseline-anchored selection.** A model is chosen over the naive baseline **only if it
   beats it out-of-sample**. If nothing does, the baseline is used and the UI says so.
6. **Honest uncertainty.** Prediction intervals come from the empirical distribution of
   walk-forward residuals — not an assumption that the model is right. Bull/base/bear
   scenarios are ±1σ bands.

The **research rating** is a weighted sum of nine independently-scored components (trend,
financial health, growth, valuation, estimate revisions, news sentiment, downside risk,
model forecast, model reliability). The forecast is capped at **10% of the score by design**
— a predicted price move alone can never produce a Buy.

---

## Quick start

### Prerequisites
- Python 3.11+
- Node.js 20+

### 1) Backend (terminal 1)
```bash
cd stockcast/backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # default PROVIDER=stooq (real, no key)
uvicorn app.main:app --reload --port 8000
```

### 2) Frontend (terminal 2)
```bash
cd stockcast/frontend
npm install
cp .env.example .env                                   # BACKEND_URL=http://127.0.0.1:8000
npm run dev
```

Open **http://localhost:3000**, type a ticker (e.g. `AAPL`) and click **Analyze**, or press
**🎲 Random**.

### Run fully offline (synthetic DEMO DATA)
Set `PROVIDER=demo` in `backend/.env`. Everything works without network or keys and is
clearly labelled **DEMO DATA** throughout.

---

## Enabling live / real-time data

StockCast is built to run online with real data — you just need (1) a provider that serves
it and (2) network access to that provider's host.

### 1) Pick a provider and add its key (`backend/.env`)

For **real-time quotes**, use **Twelve Data** — one free key covers real-time price, 5y of
history and fundamentals:
```
PROVIDER=twelvedata
TWELVEDATA_API_KEY=your_free_key      # https://twelvedata.com/pricing (Basic/free)
```
Restart the backend. The dashboard's **price card shows a pulsing “LIVE” badge** and
**auto-refreshes every 20 seconds** while the market is open. Other options:
`stooq` (real, keyless, end-of-day — not real-time), `alphavantage`, `finnhub`.

### 2) Make sure the provider host is reachable

Click **“Test live connection”** on the dashboard (or `GET /api/diagnostics`). It performs a
real quote fetch and tells you exactly what's happening:
- ✅ *Live data is flowing* — you're done.
- ❌ *host likely blocked* — the network is refusing the outbound request.

**If you run StockCast locally**, a blocked host means a local firewall/proxy — allow the
provider domain (e.g. `api.twelvedata.com`).

**If you run StockCast inside a Claude Code (web) environment**, outbound access is governed
by the **environment's network policy**, and market-data hosts are blocked by default. To
enable live data, set that environment's network policy to allow the provider host(s) you
use — e.g. `api.twelvedata.com`, `finnhub.io`, `www.alphavantage.co`, or `stooq.com`. See the
network-policy docs: https://code.claude.com/docs/en/claude-code-on-the-web. Until the host
is allowed, StockCast falls back to clearly-labelled **DEMO DATA** (with the reason shown) so
the app still runs — it never presents synthetic data as real.

> Provider hosts to allow-list, by provider:
> `twelvedata` → `api.twelvedata.com` · `stooq` → `stooq.com` ·
> `alphavantage` → `www.alphavantage.co` · `finnhub` → `finnhub.io`
> (S&P 500 benchmark uses the `SPY` ETF via the same host, or `^spx` on Stooq.)

### Tests
```bash
cd stockcast/backend && source .venv/bin/activate
pytest -q          # 28 tests: indicators, feature-leakage, forecasting, rating, backtest, providers
```

---

## Docker

```bash
cd stockcast
cp backend/.env.example backend/.env    # optionally add keys
docker compose up --build
```
- Backend → http://localhost:8000
- Frontend → http://localhost:3000

---

## API (selected)

| Method | Path | Description |
|-------|------|-------------|
| GET | `/api/health` | Active provider, demo/configured status |
| GET | `/api/search?q=` | Ticker/company autocomplete |
| GET | `/api/quote/{ticker}` | Latest price snapshot |
| GET | `/api/random` | A valid random ticker |
| GET | `/api/analyze/{ticker}` | Full analysis (quote, history, forecast, rating, risk, news) |
| POST | `/api/backtest` | Walk-forward backtest |

---

## Honest limitations

- **Sandbox note:** the environment this was built in blocks all market-data hosts, so the
  full pipeline was verified end-to-end against **DEMO DATA**. On a machine with normal
  network access, `PROVIDER=stooq` returns **real** end-of-day data with no key.
- Short-horizon equity returns are close to a random walk; point forecasts are inherently
  noisy, and on synthetic/efficient data the naive baseline often wins — StockCast reports
  this rather than hiding it.
- News sentiment uses a simple lexicon unless the provider supplies scores.
- Backtests avoid look-ahead (expanding-window training) and use adjusted prices, but
  **survivorship bias** remains (only currently-listed tickers can be tested) and fills are
  modelled at the daily close with a fixed per-trade cost (no slippage/market impact).
- Nothing here is personalised investment advice.
