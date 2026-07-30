# Data sources

## The rule

> **Never fabricate market data, fundamentals, news, earnings, analyst estimates,
> or economic indicators.**

Everything below follows from that. When a provider has no answer, AegisQuant
records the absence and the affected code path degrades — it does not fill the
hole with an estimate. `MISSING` renders as `—` in the UI and as `None` in a
feature, and a feature that is `None` is listed in that snapshot's `missing` set
rather than defaulted to zero.

## What ships, and what it costs

| Layer | Default | Real options | Key needed |
|---|---|---|---|
| Prices / bars | `fixture` (simulator) | `yfinance`, `alpaca` | Alpaca only |
| Quotes | `fixture` | `alpaca` | yes |
| Corporate actions | `fixture` | `yfinance` (splits/dividends) | no |
| Fundamentals | `fixture` | `yfinance` | no |
| News | `fixture` | `alpaca` | yes |
| Macro | `fixture` | `fred` | free key |
| Calendar | `static` (US rules + holidays) | `alpaca` | yes |
| Broker | `mock` | `alpaca` | yes |

Switch a layer by changing one environment variable; the interfaces are
identical. Nothing else in the platform knows which provider answered.

### `fixture` — the market simulator

This is the default so the platform is fully runnable with no keys, no network
and no account, and so tests are reproducible. **It is simulated data and is
never presented as anything else:** every record carries
`data_quality=SYNTHETIC` and `is_synthetic=True`, the API exposes a
`using_synthetic_data` flag, and the UI shows a banner with no dismiss control.

It is not random noise. A three-factor model gives cross-sectional features real
structure:

- **Market factor** — a regime-switching drift/volatility process shared by all
  names, producing genuine bull / chop / bear stretches with occasional shock
  days. Regime classification and breadth features have something real to detect.
- **Sector factor** — mean-reverting (Ornstein–Uhlenbeck) sector rotation, so
  relative-strength and sector-leadership signals are meaningful. The *level* is
  persistent and the emitted series is its first difference; using a persistent
  level directly as a daily return compounds into a hundred-fold drift over a
  decade, which is how a simulator ends up quoting a $190,000 share price.
- **Idiosyncratic** — name-specific noise plus a slow fundamental-quality drift,
  so quality-growth ranking correlates with forward returns to a realistic
  (weak) degree.

It also simulates the things that break naive pipelines: splits with genuine
price discontinuities, dividends, a delisting, a symbol rename, holidays and
early closes, sparse news for small caps, and occasional gap days.

**Because the alpha is planted, backtest results on fixture data are not
evidence about real markets.** A backtest on this provider will look good. That
tells you the pipeline works, not that the strategy does. Every screen and every
acceptance decision says so.

Two consequences of the simulator being deliberately honest:

- The current session's bar does not exist until its close has passed. Asking for
  today's bar mid-session returns nothing, exactly as a real feed would.
- Prices are emitted **RAW** (unadjusted) whatever adjustment is requested, and
  labelled as such. See below.

### `yfinance` — free real historical data

Install with `pip install -e ".[providers]"` and set
`AEGIS_PRICE_PROVIDER=yfinance`. Good enough for research; do not run live on it.

**Limitations, stated plainly:** it is an unofficial scrape of a public endpoint.
No SLA, no support, aggressive rate limiting, occasional silent gaps, and
fundamentals coverage that thins out fast below large-cap. It can and does change
without notice. AegisQuant's validation layer catches the common failures
(missing bars, duplicates, unexplained jumps), but it cannot manufacture the data
yfinance did not return.

### `alpaca` — real data and the real broker

Set `AEGIS_ALPACA_KEY_ID` / `AEGIS_ALPACA_SECRET_KEY` and select `alpaca` for the
layers you want. Paper and live keys are different, and the base URL is chosen
from `AEGIS_MODE` rather than guessed — a paper key can never be pointed at the
live endpoint by accident.

### `fred` — macroeconomic series

Free key from the St. Louis Fed. Provides 10-year and 2-year Treasury yields,
CPI, high-yield credit spreads, VIX, and unemployment. **Release timestamps are
respected:** a macro value is invisible until its release time, not its
observation date, because CPI for March is not knowable in March.

## Provenance: what every stored record carries

Every externally-retrieved record, in every table, records:

| Field | Meaning |
|---|---|
| `provider` | which source answered |
| `retrieved_at` | when we asked |
| `ts` / `observed_at` | when the observation is *about* — a bar's close, a filing's publication, a headline's publication, a macro release |
| `adjustment` | `raw`, `split_only`, or `split_dividend` |
| `data_quality` | `ok`, `suspect`, `stale`, `missing`, `corrupt`, `synthetic` |
| `is_synthetic` | simulated data, never presentable as real |

`retrieved_at` and `observed_at` are separate on purpose. The first is an
operational fact; the second is what point-in-time correctness depends on.

## Adjustment policy: why prices are stored RAW

A vendor's back-adjusted price series is *itself* a form of look-ahead: the price
it shows for 2022 already reflects a split that happened in 2024. Evaluate a
strategy on that series and it has quietly seen the future.

AegisQuant therefore ingests **raw** prices by default and applies only the
splits that were public at the evaluation instant
(`SymbolSeries.adjusted_to`). Three consequences:

1. A backtest sees the price a trader would have seen on the screen.
2. The backtester must handle splits on positions itself — so a bug in that
   handling produces a visibly wrong result instead of hiding inside pre-adjusted
   data. (This is not hypothetical: an early version applied splits to positions
   while prices were already adjusted, and reported a 3,449% return.)
3. Adjustment is tracked per symbol, so a mixed universe cannot be
   double-adjusted. `_apply_corporate_actions` keys its behaviour off the stored
   `adjustment` value.

## Validation: 13 checks, on everything ingested

`aegisquant/data/quality.py`. The contract is **detect and report, never repair
by invention.** A structurally impossible bar is dropped and recorded; nothing is
ever synthesised to fill a gap.

| Check | Severity | Notes |
|---|---|---|
| `missing_bar` | warning / error | Trailing gaps are "not published yet", not errors. More than two missing mid-window sessions escalates. |
| `duplicate_record` | warning | The first bar for a timestamp survives; the duplicate is dropped, never merged. |
| `stale_quote` | error | Age beyond the configured freshness budget. |
| `timestamp_inconsistency` | warning / error | Future-dated bars are rejected; non-monotonic ones are flagged. |
| `ohlc_inconsistent` | error | `high < low`, close outside the range: structurally impossible, dropped. |
| `non_positive_price` | error | Zero/negative price or volume, dropped. |
| `adjustment_error` | error | A single-session move ≥35% with no corporate action to explain it. |
| `extreme_outlier` | warning | Robust-z (median/MAD) ≥12σ in log returns. |
| `symbol_change` | info | Rename recorded in corporate actions. |
| `delisted` | warning | Recorded delisting, or data that simply stopped arriving for ≥5 sessions. |
| `provider_disagreement` | warning / error | Two providers differ on a close beyond 2%; ≥6% escalates. |
| `market_closed` | warning | Data returned for a day the calendar says was closed. |
| `provider_error` | error | The fetch itself failed. |

Two calibration decisions worth knowing about:

- **The corporate-action exemption is a window, not an exact date match.**
  Providers disagree by a day or two on where an ex-date falls, a holiday shifts
  the first session that can print the gap, and some feeds date an action to a
  weekend. Requiring exact equality reports an ordinary 3:1 split as an
  unexplained 67% collapse — and since the promotion gate demands zero open
  blocking issues, that false positive would block a strategy for no reason. The
  window is the session date, one day before, and four days after.
- **Warnings do not reject data.** They surface in the Risk Centre for an
  operator to resolve. Only errors and criticals block promotion, and only
  structurally impossible records are dropped.

### Where validation results go

- Issues are written to `data_quality_issues`, de-duplicated against unresolved
  rows for the same `(kind, symbol, session_date)` so a recurring problem does
  not flood the queue.
- Affected bars are marked `data_quality=SUSPECT` for the dates involved.
- The risk engine **rejects any order** whose instrument has `corrupt` or
  `missing` data, and warns on `suspect` or `stale`.
- Blocking issues halt the autonomous loop at step 1 and block promotion to
  live-eligible.

## Network behaviour

`aegisquant/data/net.py`:

- **TTL cache** keyed on the full request, so a loop that asks twice in a cycle
  pays once.
- **Rate limiter** per provider, sliding-window.
- **Retry** with exponential backoff and jitter on timeouts, 5xx and 429,
  honouring `Retry-After`. Never retries a 4xx that will not change.
- **Fetch log** buffered in memory and flushed at the end of ingestion. It was
  originally a write-per-call, which opened a nested transaction inside an open
  one and cost five seconds of SQLite lock timeout per provider call — ingestion
  took over a minute. Buffering brought it to under three seconds.

## Credentials

Server-side only, always:

- Every key is read from the environment into a `SecretStr`.
- `Settings.public_dict()` is the *only* thing serialised toward a browser, and
  it contains no secret. `Settings.secret_values()` enumerates every secret so
  the log redactor can strip them.
- No API response returns a credential, and there is a test that scans every
  endpoint's payload for credential material and bcrypt hashes.
- The Settings screen shows `configured` / `not set` per provider, never a value.
- The browser holds no token: the session is an `HttpOnly` cookie. A test asserts
  `localStorage` and `sessionStorage` are empty after login.
