# Intentionally deferred

Everything here was a deliberate decision, not an oversight. Each entry says what
exists, what does not, and what it would take.

## Markets and instruments — interface exists, disabled

The specification asks for extensible interfaces with these switched off in v1.
They are off in more than one place, so no single mistake enables them.

| Feature | State | To enable |
|---|---|---|
| **Options** | `AssetClass.OPTION` exists; nothing prices, sizes or risks them | Greeks, an options chain provider, assignment handling, margin. Its own risk model — the equity limits are meaningless for options. |
| **Futures** | `AssetClass.FUTURE` exists | Contract rolls, initial/maintenance margin, a continuous-contract series, near-24h sessions. |
| **Crypto** | `AssetClass.CRYPTO` exists | 24/7 calendar (the whole "session close" model assumes one), custody, very different liquidity assumptions. |
| **Leveraged / inverse ETFs** | Detected, and **rejected by the risk engine** | Decay modelling and a hold-period constraint. Excluded because compounding decay makes a multi-day hold behave nothing like its stated multiple. |
| **Margin borrowing** | Not implemented; `max_gross_exposure_pct` defaults to 100% | Margin-requirement tracking, maintenance calls, borrow-cost accrual. |
| **Unrestricted short selling** | Rejected by the risk engine; `CostModel.allow_shorts` exists and defaults false | Locate/borrow availability, borrow-rate accrual (the cost model has the fields), hard-to-borrow handling, buy-in risk. |

## Data and features

| Deferred | Why | Notes |
|---|---|---|
| **Intraday bars** | Daily is what the strategies need | Interfaces take a `timeframe`; only `1Day` is exercised. Intraday needs a different point-in-time model — a partial session is not a bar. |
| **Level-2 / order-book data** | Nothing in v1 consumes it | The cost model uses ADV and volatility, which is the right granularity for a daily system. |
| **Alternative data** (card spend, web traffic, satellite) | Cost and licensing | The provider interface would accept it; the feature registry would need availability delays per vendor. |
| **Transcript / filing NLP** | Real work, weak signal-to-noise | News features use lexical sentiment plus event tags. A transcript model is a project, not a feature. |
| **Analyst estimates and revisions** | No free source that is point-in-time correct | This matters: a non-PIT estimates feed silently leaks revisions backwards. Better absent than wrong. |
| **Multi-provider consensus pricing** | `compare_providers()` exists and detects disagreement, but nothing arbitrates | Needs a policy: which provider wins, and what to do when neither is obviously right. |

## Modelling

| Deferred | Why |
|---|---|
| **Deep learning (PyTorch)** | The specification says "only where genuinely useful". On daily cross-sectional equity features with a few thousand names, gradient boosting and linear models are competitive and auditable. A network here would add opacity, not accuracy. |
| **Reinforcement learning for execution** | Needs intraday data and a fill simulator far better than a daily bar can support. |
| **Regime detection by HMM** | The current classifier is benchmark-trend plus volatility with hysteresis — explainable and hard to break. An HMM would be less explainable for a modest gain. |
| **Full covariance optimisation (Black-Litterman etc.)** | Correlation-aware sizing already haircuts duplicated risk. A full optimiser on estimated covariance concentrates estimation error, which is the opposite of the goal. |
| **Automated strategy discovery** | The specification requires AI-generated modifications to enter a *quarantined* research pipeline. The `StrategyStatus.QUARANTINED` state and the promotion gate exist; automated generation does not. Deliberately. |

## Execution

| Deferred | Why |
|---|---|
| **Smart order routing** | The broker routes. Adding a layer needs venue-level data we do not have. |
| **Algorithmic execution (VWAP/TWAP slicing)** | The participation cap keeps orders small enough that slicing adds little. At larger size this is the first thing to build. |
| **Bracket / OCO orders at the broker** | Stops are managed by the loop, which means a protective exit needs the loop to be running. A broker-side bracket survives our downtime, and is the highest-value item on this list. |
| **Multi-account / multi-strategy allocation** | One account, one book. Multi-account needs allocation, per-account limits and separate reconciliation. |

## Platform

| Deferred | Why |
|---|---|
| **SSO / OAuth / MFA** | Local accounts with bcrypt, RBAC and lockout. MFA is the natural next security step. |
| **Per-tenant isolation** | Single-tenant by design. |
| **Real-time push (WebSocket)** | The UI polls, visibility-aware, at intervals matched to a daily system. A daily loop does not need a socket. |
| **Mobile app** | The dashboard is responsive; a native app is a separate product. |
| **Email / SMS alerting** | Alerts persist and surface in the UI and API; a webhook is straightforward to add. |
| **Distributed tracing** | Structured logs carry a request id and a loop-run id, which is enough to follow a cycle. |

## Testing

| Deferred | Why |
|---|---|
| **Property-based testing (Hypothesis)** | The risk engine is the obvious candidate — its invariants are stated as properties already. Currently covered by parameterised cases and adversarial constructions. |
| **Load / soak testing** | The system does daily work at human scale. Worth doing before any intraday move. |
| **Chaos testing** | Broker failure injection exists in the mock (disconnect, reject, uncertain submission). Infrastructure-level chaos does not. |
| **Visual regression** | The UI is verified by driving all eight pages in headless Chromium and asserting no page errors, plus 17 component tests. Pixel diffing is not set up. |

## The honest summary

The parts that decide, size, gate and record are complete and tested. The parts
that are deferred are:

1. **asset classes whose risk model is genuinely different** (options, futures,
   crypto) — where a shallow implementation would be worse than none, because the
   equity risk limits do not mean anything for them;
2. **modelling sophistication** whose marginal value is smaller than the opacity
   it adds;
3. **execution refinement** that only matters at size the participation cap will
   not allow yet;
4. **operational polish** that a single-operator deployment does not need.

The one deferred item that is a real gap rather than a scope decision is
**broker-side bracket orders**. Protective stops currently depend on the loop
running. Until that changes, treat scheduler downtime as unprotected exposure and
size accordingly.
