# Operator runbook

For the person on the hook when something looks wrong. Every action here is
audited with your identity and the reason you type.

## First principle

> When uncertain, choose the safer behaviour: reject the trade, reduce exposure,
> pause the affected strategy, and record why.

Standing down costs a missed opportunity. Guessing can cost the account.

## Daily check, in order

1. **Overview** — mode, equity, day P&L, drawdown, risk state. A risk state other
   than `normal` is the first thing to explain.
2. **Risk Centre** — limit utilisation. Anything above ~80% is where the next
   binding constraint will come from.
3. **Execution Monitor** — open orders, recent fills, reconciliation status. A
   reconciliation break blocks all new orders until cleared.
4. **Journal** — read the last cycle's decisions, including the HOLDs. The base
   rate of "no good trade today" is high and that is fine; a cycle that suddenly
   wants to buy everything is a signal about the *system*, not the market.
5. **Data quality** (Risk Centre) — blocking issues halt the loop at step 1.

## Emergency: something is actively wrong

**Stop everything.**

```
Execution Monitor → "Engage kill switch"  (reason required)
```
or

```bash
curl -X POST $API/api/controls/kill-switch \
  -H "x-csrf-token: $CSRF" -b cookies.txt \
  -d '{"engage": true, "reason": "why you are doing this"}'
```

The kill switch blocks **all** order flow, including exits. That is deliberate:
when you do not yet know what is happening, the safest action is no action.

Then, in order:

1. **Cancel all orders** — clears anything resting.
2. Diagnose (below). Do not release the switch to "see what happens".
3. If you need to be flat: **Flatten positions** (admin, typed confirmation).
   Market orders, irreversible.
4. Releasing the kill switch is a separate audited action. Run
   `aegisquant reconcile` first and confirm it is clean.

## Diagnosis by symptom

### The loop is not trading

Read the last `LoopRun` — `GET /api/loops` or the Overview panel — and find the
step that stopped it. Step 1 halts on:

| Cause | Fix |
|---|---|
| Kill switch engaged | Release it (audited) once you know why it was on |
| Read-only mode | Leave read-only mode |
| Broker disconnected | Check `GET /api/broker/health`; fix credentials or connectivity |
| Blocking data-quality issues | Resolve them in the Risk Centre after checking each is genuinely benign |
| Unresolved reconciliation break | See below |

If step 1 passed and no order was placed, that is very often **correct**. Check:

- **Regime is `risk_off`** → new entries are disabled by design. Exits still run.
- **Risk state is `defensive_2` or worse** → no new entries until the drawdown
  recovers.
- **A daily or weekly loss limit tripped** → trading is halted for the session and
  a cooldown may be active.
- **Every candidate was disqualified** → open the Opportunity Centre and read the
  disqualifiers. Below the ADV floor, spread too wide, an accounting flag: all
  legitimate reasons to pass.

### Reconciliation break

Local state and the broker disagree. New orders are blocked until it clears —
correctly, because the engine cannot reason about exposure it cannot measure.

```bash
aegisquant reconcile            # heal toward the broker (the authoritative record)
aegisquant reconcile --no-heal   # inspect without changing anything
```

Break kinds and what they mean:

| Kind | Meaning | Auto-healed? |
|---|---|---|
| `position_quantity` | Quantities differ | Yes — the broker wins |
| `order_status` | Local status is stale | Yes — adopt the broker's view |
| `order_missing_at_broker` | We think it is open; the broker does not have it | Yes — adopt the terminal state, or mark rejected |
| `unknown_broker_order` | An order at the broker with **no local record** | **No** — needs a human |

`unknown_broker_order` is never adopted. It could be a manual trade, another
system on the same account, or a bug in ours. Find out which before clearing it.

### An order is stuck open

```bash
GET /api/orders?status=open
```

Orders past `max_open_order_seconds` (default 1h) are cancelled automatically by
step 12. To act now: cancel it, or cancel-and-replace with a better limit. Both
are audited; the replacement is linked to the original so the chain stays
readable.

### Drawdown is escalating

The ladder is automatic — sizes are already reduced or entries already disabled.
Your job is to decide whether the *cause* is market conditions or a defect.

- **Market**: let the ladder work. It de-escalates on its own once the drawdown
  recovers well clear of the warning line.
- **Defect**: kill switch, then pause the offending strategy
  (`POST /api/controls/quarantine` with `scope: "strategy"`), then release the
  kill switch so the remaining sleeves can manage their positions.

At the emergency stage, resuming requires an explicit
`POST /api/controls/recover`. That is intentional friction.

### A single symbol is behaving strangely

Quarantine it. Blocks new orders in that name while leaving the rest of the book
working:

```bash
curl -X POST $API/api/controls/quarantine \
  -H "x-csrf-token: $CSRF" -b cookies.txt \
  -d '{"scope": "symbol", "key": "XYZ", "active": true, "reason": "prices look wrong"}'
```

### The explanation for a trade does not match what happened

This should be impossible and is worth escalating. Narration is rendered from the
persisted record and there is a test asserting a re-render is character-identical.
If they diverge, either the record is incomplete or something wrote prose that was
not derived from it. Capture the decision id and the stored explanation before
anything else.

### A backtest result looks too good

Check, in this order:

1. **Is the price provider `fixture`?** The simulator has planted alpha. Results
   on it are evidence the pipeline works, not that the strategy does. Every
   screen labels this.
2. **Acceptance decision** — Strategy Lab shows the screen's verdict and reasons.
   Too few trades, one favourable year, a single winner carrying everything,
   turnover that eats the edge, fills that could not have happened: all rejected.
3. **Out-of-sample vs in-sample** — they are stored and displayed separately. If
   only the in-sample result is good, there is nothing there.
4. **Walk-forward pass rate** — below 50% of folds holding up is a rejection.
5. **Monte Carlo drawdown spread** — if the 5th-percentile trade ordering has an
   unacceptable drawdown, the realised path was favourably ordered, not robust.

## Changing a risk limit

Settings → Risk (admin only). Requires a reason. Writes a **new version** and
deactivates the old one; the history stays readable.

Validation rejects an incoherent set — Kelly above 0.5, out-of-order drawdown
stages, a position cap above the gross cap. An unknown limit name is rejected
rather than silently ignored, so a typo cannot leave you believing a control is in
place when it is not.

Loosening a limit is the highest-consequence routine action in the system. Write a
reason your successor can evaluate.

## Enabling live trading

Do not do this until paper has run long enough to be boring.

Check what stands in the way:

```bash
aegisquant live-preflight        # exits non-zero while anything is unmet
```

Then all seven conditions, in order:

1. `AEGIS_LIVE_TRADING_ENABLED=true` in the server environment
2. `AEGIS_MODE=LIVE`, then restart the backend
3. `AEGIS_BROKER=alpaca` with **live** credentials
4. At least one strategy past the promotion gate (Strategy Lab shows each check)
5. Every preflight check green
6. Settings → confirm in the UI and re-type the confirmation phrase
7. Acknowledge the account identifier shown on screen

Refusals return `409` listing every unmet requirement, and the attempt is
recorded whether granted or not.

Start with `AEGIS_LIVE_MAX_ALLOCATION_USD` small. It is a bound on your worst
case, not a target.

**Disabling live is never gated.** If you are unsure, disable it and investigate.

## Alerting

Alerts land in the Risk Centre and via `GET /api/alerts`.

| Severity | Response |
|---|---|
| `critical` | Look now. Kill switch, broker disconnect, reconciliation mismatch, unknown order state. |
| `warning` | Same day. Data quality, stale orders, drift, strategy paused. |
| `info` | Read in the daily check. Submissions, fills, promotions. |

Acknowledging an alert records who did it and when. It does not resolve the
underlying condition.

## Useful commands

```bash
aegisquant loop-once --no-ingest     # one cycle without re-fetching data
aegisquant reconcile                 # broker vs local
aegisquant metrics --prometheus      # operational metrics
aegisquant live-preflight            # what stands between here and live
aegisquant promote-check             # promotion gate for every strategy
aegisquant backtest --start 2021-01-01 --end 2024-12-31 --validate
aegisquant validate --purged-cv --sensitivity
```

## What never to do

- **Never release the kill switch to find out what happens.** Diagnose first.
- **Never resubmit an order by hand after an uncertain submission.** The OMS looks
  the id up at the broker and adopts what it finds; a manual retry is how you get
  a double position.
- **Never clear a data-quality issue you have not read.** The promotion gate
  depends on that list meaning something.
- **Never raise a limit to make a trade fit.** The limit was the answer.
- **Never present simulated or backtested results as a track record.** Nobody
  outside the system knows which is which unless you tell them.
