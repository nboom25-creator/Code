# Theatre — a war simulator built on real force structures

Pick two countries and a scenario. The model fights the war week by week — air
superiority, ground manoeuvre, sea control, magazines, industrial replacement,
fuel, casualties and political will all feeding back into each other — a few
thousand times, and reports the distribution of outcomes rather than a single
answer.

74 countries. Order of battle, economy, demography, logistics, energy, industry,
geography, munitions stocks, nuclear forces, and a set of qualitative indices.

**It is graded.** Fifteen historical wars with known outcomes run through the same
simulation, in the app or from a terminal, on demand. Current score: **9 of 15
outcomes called correctly, 5 of 15 durations within 3x, 2 of 15 casualty counts
within 4x**, with a mean 60% of probability mass on what actually happened. Six
of the fifteen are held out from coefficient fitting and scored separately. The
failures are listed below rather than hidden — as is the case where the backtest
was, until recently, marking its own homework.

## Running it

No build step, no dependencies, no network calls. Open the file:

```bash
open war-sim/index.html          # macOS
xdg-open war-sim/index.html      # Linux
```

Or serve it if you prefer a real origin:

```bash
python3 -m http.server -d war-sim 8000   # then visit http://localhost:8000
```

The backtest and the coefficient fitter also run headlessly, with no browser and
no dependencies — `tools/harness.js` gives the three model files a `window` to
hang themselves off and everything else runs in-process:

```bash
node war-sim/tools/backtest.js            # the fifteen wars, scored, ~10s
node war-sim/tools/backtest.js --json     # machine-readable, for diffing runs
node war-sim/tools/fit.js --quick         # coefficient search
```

## What the model does

**There is no single "power score."** Wars are resolved as a week-by-week
campaign. Each tick the model contests the air, contests the sea if the sea
matters, fights on the ground, burns ammunition, applies attrition, regenerates
what industry can replace, spends money, kills people, and updates each side's
willingness to keep going. A side can win every battle and still lose the war.

The mechanics that carry most of the weight:

**Distance is a combatant.** A projection index built from carriers, amphibious
shipping, tankers, sealift and overseas basing yields a *reach* — the distance at
which a country can still bring half its deployable force to bear. The United
States reaches ~8,800 km; Russia ~1,900 km; Poland ~850 km. Force is discounted
by `1 / (1 + (distance/reach)²)`, and it *closes* over months rather than
appearing: Desert Shield took six before Desert Storm.

**Magazines.** The constraint that decides modern wars and appears in none of the
headline force comparisons. Artillery ammunition, precision munitions and
interceptors are tracked as stocks with production rates. Artillery burns ~0.30
thousand rounds per thousand engaged troops per month at full intensity; a side
that runs dry loses most of its firepower. Precision munitions are the first
thing an air campaign exhausts and the slowest to replace, and when they run out
the civilian death rate climbs sharply. An integrated air defence with an empty
interceptor magazine is scrap metal — which is exactly what cheap drones are for.

**Force-to-space.** The same force ratio produces breakthrough on an empty front
and deadlock on a full one. Above roughly 0.7 thousand defenders per kilometre a
continuous, mutually supporting line exists and there are no flanks; below about
0.12 the front is a screen with holes and armies move at the speed of their fuel
trucks. This is the difference between 1916 and 1940 at similar odds.

**Two wills, not one.** A society's capacity to absorb loss and a regime's
willingness to keep spending it are different variables. Society exhausts on
casualties; the regime decides; how much of the first reaches the second is set
by how far the government depends on consent. This is why Iran and Iraq could
spend eight years on a war neither population chose, and why the United States
left Vietnam having won almost every engagement.

**Wars end by decision, not only by exhaustion.** Every other termination test
here is a stock crossing a floor — will ground down by cumulative casualties,
cohesion by cumulative losses, the objective reached by cumulative advance. All
three are integrals over elapsed time, so by construction none of them can fire
early, and the model was systematically too slow on exactly the wars that ended
quickly. A defender therefore also runs a forward-looking test each week: at the
rate the attacker is actually moving, how many weeks until it gets what it came
for, and is there anything — an uncalled reserve, an industry replacing more than
the front is losing, a patron still shipping, a population that will keep
fighting whatever the state signs — that could still turn it round. A government
holding none of those concedes, with an army still in the field. Egypt and Jordan
had armies in June 1967; Iraq had one in February 1991. What it costs to concede
gates the whole thing: a border province is a bad afternoon, and a war of
conquest is the end of the state, which is why those get fought past the point
where quitting was rational.

**The population's stance is a variable.** India did not garrison East Pakistan
in 1971 — it handed the territory to a government the population had just voted
for. Treating every population as hostile makes wars of liberation come out as
occupations.

**Mobilisation is slow and equipment-limited.** Reserves are called up over
months and can only be armed from what is in storage. A country with three
million reservists and equipment for four hundred thousand fields an army the
size of its equipment park.

**Invasions culminate.** What stops most offensives is not the enemy's remaining
divisions but the attacker's own supply lines outrunning its logistics while a
growing share of the army garrisons what it already took.

**Taking ground is not holding it.** Occupation is tested against the ~20 troops
per 1,000 inhabitants counter-insurgency ratio, weighted by urbanisation, with an
expeditionary rotation penalty of about three troops in the base for every one
standing in the country. This is why the model reports US invasions of Iraq and
Iran as military victories that fail as occupations, and a US invasion of Canada
as one that (barely) does not.

**Also modelled:** drones as their own air-power and counter-battery layer;
urban warfare; seasonal tempo by climate (rasputitsa, monsoon, desert summer);
airbase vulnerability to missile attack; maritime chokepoints; multi-front border
commitments weighted by what the neighbour could actually do; killed vs wounded
vs captured, with most of the wounded returning to duty; unit cohesion collapse
distinct from national will; and nuclear escalation checked against each
state's doctrinal threshold.

Every parameter a planner would be uncertain about — leadership competence,
surprise, intelligence, alliance entry, industrial output, casualty tolerance —
is sampled per run. The output is a distribution.

### Scenario levers

| Lever | Effect |
|---|---|
| **War aim** | Total conquest / regime change / seize a border region / punitive air campaign / blockade. Sets the territorial threshold, the share of force committed, and whether the occupation test applies. |
| **Mobilisation** | Per side. Governs how much of the reserve is called up and how far the economy goes onto a war footing. |
| **Foreign materiel support** | Shells, vehicles, interceptors and intelligence from a patron who does not send troops. Modern wars are shaped by this more than by formal alliances. |
| **Alliances** | Treaty partners drawn in probabilistically, weighted per pact (NATO 0.82, CSTO 0.45, GCC 0.38). |
| **Local population** | Whether the people on the ground resist the attacker, are divided, or welcome them. Sets how much of the army the captured ground ties down, and whether an occupation is feasible at all. |
| **Season** | Which month the war starts in. Matters more than it sounds. |
| **Nuclear escalation** | Toggle off to see the conventional result — a fiction wherever a nuclear state faces defeat. |
| **Surprise** | A first-month strike that also destroys aircraft on the ground. |

The report ends with a sensitivity table that re-fights the matchup with one
assumption changed at a time, so you can see which of them the answer rests on.

## What the report draws

Nine chart forms, all inline SVG, no libraries, every one with a hover layer
and most with a table view.

- **Range and bearing** — deliberately *not* a map. The model has no coastlines
  and drawing some would imply knowledge it does not have. An azimuthal plot
  centred on the attacker shows what it actually uses: true distance as radius,
  true bearing as angle, each side's reach as a circle, and any strait that
  gates the approach.
- **Force-ratio waterfall** — every multiplier applied to the attacker's ground
  forces, in order, as a floating bar from the running value to the new one,
  against the defender's committed strength as a threshold line. The step that
  killed an offensive is the long bar rather than a number in the fifth row of
  the fourth table.
- **Monte Carlo scatter** — one mark per simulated war, by duration and cost.
  The probability bar at the top of the report says how *often* each side
  prevails; this says whether that means reliably in four months or a coin flip
  between a rout and a five-year grind.
- **Small multiples** — seven indicators on one shared timeline, read downward:
  the magazine empties, firepower falls, the front stops moving, and only then
  does will start to go. Three separate charts made that sequence something you
  had to reconstruct by eye.
- **Front-line strip** — a Hovmöller diagram, one row per week. A grind reads as
  a slow diagonal, a rout as a cliff, a counter-offensive as the boundary moving
  back.
- **Where the army went** — stacked area of still fighting / wounded and out /
  captured / killed. Ordered parts of one whole, so steps of a single hue rather
  than categorical colours.
- **When it ended, and how** — cumulative share of runs decided by each week,
  stacked by what ended them, so the top edge of the stack is a survival curve
  read upside down. The three shapes are distinct on sight: a shallow ramp that
  never reaches the top is a grind nobody wins, a fast S-curve is a rout, and a
  flat stretch followed by a cliff is a war that took months to become possible
  and then took days. Runs that hit the model's horizon are *not* a band — they
  all terminate on the same week and stacking them draws a wall at the right
  edge that reads as a collapse. They are the empty space above the stack,
  which is the honest statement: this share was still being fought.
- **What the answer rests on** — a tornado over the nine unknowns resampled on
  every run, each bar running from the attacker's win rate in the lowest third
  of that assumption's draws to the rate in the highest third, sorted by swing.
  The report has always shown a distribution without saying what the
  distribution was made of; this says which guess to go and argue about, and
  it is usually leadership by a wide margin. The shaded strip through the middle
  is what that many runs could produce from sampling noise alone, so a
  three-point bar is visibly not a finding.
- **Tug-of-war bars** — share of combined strength by domain, ratio direct-
  labelled on every row.

On colour: the palette is validated for two series plus a critical red, and the
marks stay inside it. Where a chart needs more than two bands they are ordered
parts of a single whole and take steps of one blue ramp, which is the correct
encoding for that regardless.

## The backtest

`js/backtest.js` holds fifteen wars with period-accurate force data and
documented outcomes, run through the same `simulate()` the live app uses. Two
conventions matter: expeditionary forces are placed at their staging base rather
than their capital (the 1991 coalition is modelled as the force in Saudi Arabia),
and the model ticks weekly.

| War | Model | Actual | |
|---|---|---|---|
| Gulf War 1991 | attacker, 3.1 mo | attacker, 1.5 mo | outcome ✓ duration ✓ |
| Invasion of Iraq 2003 | attacker, 3.7 mo | attacker, 1.5 mo | outcome ✓ duration ✓, occupation correctly fails |
| Falklands 1982 | attacker, 18.7 mo | attacker, 2.5 mo | outcome ✓ |
| Yom Kippur 1973 | defender, 29.4 mo | defender, 0.7 mo | outcome ✓ |
| Six-Day War 1967 | defender | attacker, 0.2 mo | ✗ |
| Iran–Iraq 1980–88 | defender, 24.4 mo | stalemate, 96 mo | ✗ |
| Nagorno-Karabakh 2020 | attacker, 9.1 mo | attacker, 1.5 mo | outcome ✓ casualties ✓ |
| Winter War 1939–40 | attacker, 1.2 mo | attacker, 3.5 mo | outcome ✓ |
| Vietnam 1965–73 | attacker, 5.9 mo | defender, 96 mo | ✗ |
| Korea 1950–53 | defender, 83.7 mo | stalemate, 37 mo | ✗ duration ✓ |
| Indo-Pakistani 1971 | attacker, 12.6 mo | attacker, 0.45 mo | outcome ✓ |
| Kosovo 1999 | unresolved, 35.6 mo | attacker, 2.6 mo | ✗ |
| Russo-Georgian 2008 | attacker, 0.5 mo | attacker, 0.17 mo | outcome ✓ duration ✓ |
| Kargil 1999 | defender, 49.2 mo | defender, 2.5 mo | outcome ✓ |
| Russia–Ukraine 2022– | attacker, 18.7 mo | stalemate, 48 mo | duration ✓ casualties ✓ |

**What the failures say.** The model calls the *outcome* of most of these wars
and remains poor at how long they take and how many they kill. The error is
systematic and in one direction — short decisive campaigns run too long, and
because casualties accumulate per week the casualty counts inherit it.

Part of that is now diagnosed, and the diagnosis was structural rather than a
coefficient. Every way this model could end a war was an integral over elapsed
time, so no war could end quickly however lopsided it got: the Gulf War needed
4.9 months to grind Iraq's will down to a threshold it crossed in reality in
days. Adding the forward-looking defender capitulation described above moved
the Gulf War to 3.1 months and the 2003 invasion from 15.9 to 3.7, taking
durations from 4/15 to 5/15 and casualties from 1/15 to 2/15 with no outcome
lost and the holdout unchanged. The gain is flat across a 3x range of the new
rate coefficient, which is the main reason to think it is a mechanism and not a
fit. It also cost one case honestly: Finland now folds in 1.2 months against an
actual 3.5, because a hopeless position is exactly what Finland's was and the
model has no way to represent holding one anyway for a winter.

The residual error is still large and the remaining failures are specific:

- **Two cases are wrong at the input, not the mechanism.** The Iran–Iraq war is
  modelled with the defender committing about seven times the attacker's ground
  power, and the Six-Day War gives Israel almost no air control in a war decided
  by destroying the Egyptian air force on the ground on the first morning. Any
  mechanism that resolves lopsided positions faster makes these worse, correctly.
- **Kosovo still runs the clock out.** A coercive air campaign the loser
  conceded in ten weeks; the model reaches its horizon with nothing decided,
  because the punitive aim's own success metric — the defender's air force —
  never falls far enough for anyone to concede against. It is the one case where
  "unresolved" is the model's actual answer rather than an artefact of a short
  clock, and it is still wrong.
- **Vietnam and Korea continued because a third party made them continue.**
  China entered Korea; Iran refused the terms Iraq offered in 1982. Withdrawal
  is not a decision one side takes, it is an offer the other side has to accept,
  and there is no representation of the second half of that here — which is why
  the attacker-side version of this mechanism is switched off (below).

Treat durations and casualty figures as much weaker than the outcome verdict.

### The horizon was doing the work, and one case was marking its own homework

Drawing the endings chart made something visible that four years of tables had
not: for some matchups most runs never finished. They hit the simulation's
horizon and were reported as **stalemates**. There is exactly one line in the
model that assigns that outcome, and it fires when the loop runs out — so every
"stalemate" this model has ever reported meant "the clock stopped", and the app
was labelling it "Stalemate or negotiated settlement", an outcome the model
cannot produce.

How much that mattered depends entirely on the matchup, which is why it went
unnoticed. Four of six test cases were completely insensitive to the horizon —
they finish long before it. Two were not:

| Matchup | at the shipped horizon | at 4x the horizon |
|---|---|---|
| Russia → Poland, border region | 77% stalemate, 23% attacker | 3% stalemate, **97% attacker** |
| North Korea → South Korea | 61% stalemate, 39% defender | 0% stalemate, **100% defender** |

Neither of those is a stalemate. Both are wars the model was resolving slowly
and got interrupted in the middle of. The war-aim horizons — 30 months for a
border seizure, 60 for conquest — were nominally a display limit and were in
practice deciding headline verdicts.

They are now 90 and 120, high enough that truncation is the exception; the
outcome is renamed `unresolved`; and wherever it appears the report names the
horizon it is relative to, because "23% stalemate" is a different claim at 30
months than at 120.

**And then the same question of the backtest.** Seven of the fifteen cases set
their own horizon, and four set it to the war's actual duration. The Korean War
had a horizon of 37 months against an actual 37, ran **100% of its runs into
that clock**, and was scored correct on both outcome and duration. The model had
not predicted a 37-month stalemate. It had been told to stop at 37 months and
had done so. One of nine outcome passes and one of five duration passes were
circular, in both the current model and the baseline it was measured against.

Every case now uses the same war-aim horizon the live app uses. Two verdicts
change and the headline does not:

- **Korea** was fake and is now wrong: given an honest clock the model says the
  defender wins in 84 months. It is a worse answer and a real one.
- **Kargil** was being wrongly failed. A 12-month cap truncated it into a
  "stalemate" it never reached on its own; allowed to run, the model gets the
  outcome right.

Net 9 of 15 either way, with mean probability mass up from 57% to 60%. The score
did not move. What it measures did.

### What did not work, and is switched off

Two mechanisms were built alongside the one that shipped, measured on the same
fifteen wars, and left in the code with their rate coefficients set to zero.
They are documented here rather than deleted because the measurement is the
useful part, and both are one number away from being re-run.

**Envelopment** (`envRate`, model section 7b). Armies are usually destroyed by
being cut off rather than worn down, and a front with gaps plus a decisive local
ratio should produce a pocket in a week. It behaves correctly where it can be
checked — the dense Korean front suppresses it exactly as force-to-space says it
should, the open ones let it run — and it improves nothing: the aggregate score
is unchanged and the Iran–Iraq war drops from 24.5 months to 8.1 against an
actual 96, because that case's force ratio is wrong and the mechanism faithfully
converts a wrong ratio into a fast collapse. Fixing the input is the honest
repair.

**Attacker withdrawal** (`wdrRate`, model section 11b). The mirror of
capitulation: an expeditionary army that is going nowhere at a cost it can
project gets brought home. This one is measurably wrong. Every long war in the
set is a stalled war, and a stalled war is exactly what the test reads as
futile, so at any rate above zero it ends Korea at 17 months instead of 37 and
the Iran–Iraq war at 5 instead of 96, while never improving a single duration.
Gating it on `transmission` — the regime's exposure to what the war costs, which
is the right variable, and which does separate the United States in Vietnam from
Iraq in 1982 — softened the damage without fixing it.

An air-supremacy gate on capitulation was also tried and dropped. The argument
is good, and air control does separate these fifteen wars cleanly (Gulf 0.85,
Korea 0.03): a position has to be legibly hopeless before anyone concedes it,
and losing the sky is the most legible form of that. It changed nothing at low
capitulation rates and cost two outcomes at high ones, because the long wars it
was meant to protect are shortened by attacker withdrawal, which it does not
touch. A term that sounds right and does nothing is worse than no term.

### Fitting used not to help. Closing a structural gap changed that.

`tools/fit.js` searches the genuinely free coefficients (`K` in `js/model.js`)
by coordinate descent against a continuous objective — log-ratio error on
duration and casualties plus probability mass on the true outcome. It is bounded
to physically defensible ranges, regularised toward the hand-set priors, and
scored on nine cases while six are held back.

```
node tools/fit.js --sweeps 3 --iters 250 --reg 0.35
```

The standing result here used to be that fitting improved the in-sample score
and made the held-out score *worse* — the signature of a model whose remaining
error is structural, where the optimiser can only buy in-sample accuracy by
memorising. That was the stated reason the hand-set values shipped, and it was
the headline methodological claim of this project.

**It does not survive fixing the backtest.** The Korean War was in the holdout
set, pinned to a horizon equal to its own duration, with every run terminating
on that clock. Its contribution to the held-out score was therefore nearly
inert — no coefficient could move a case whose answer was set in its
configuration. With one of six holdout cases anchored, the holdout score was
measuring less than it appeared to.

Re-run after removing the pins, as a clean A/B on identical scoring:

| | fit | holdout |
|---|---|---|
| Model without capitulation | −15.9% | **−8.4% better** |
| Model with capitulation | −15.9% | **−13.6% better** |

Fitting now generalises in both, so "fitting does not help" was, in part, an
artefact of a case that had been handed its answer. The capitulation mechanism
still earns its place — it lowers the un-fitted holdout score outright and it
roughly doubles what fitting can recover out-of-sample — but the dramatic
version of that claim, that adding it flipped the sign of the response to
fitting, was measured against the broken backtest and is withdrawn.

What follows is an open question rather than a conclusion. Nine cases against
seventeen coefficients is still a poor ratio and these gains are within the
range a different holdout split could move, so the hand-set values still ship.
But the old justification for shipping them no longer holds, and "should the
fitted values be adopted" is now a live question that wants a better validation
scheme than six held-out wars to answer.

Coefficients belonging to a mechanism that has been measured and switched off
are frozen rather than searched. The regulariser's squared log-distance is
undefined at a prior of zero, and a fitter that quietly switches a disabled
mechanism back on because it shaves a little off nine cases would be committing
the exact failure this script exists to demonstrate.

Two things worth stealing from this even if you disagree with the model:

- The first holdout split was picked by hand and turned out to contain almost
  every short war, leaving all four multi-year conflicts in the fitting half.
  That alone produced a large apparent overfitting gap. Stratify the split.
- Unbounded, the search drove unit cohesion to "an army breaks after losing 9%
  of its strength" because it shaved a little off the objective. Bounds are not
  bureaucracy; a coefficient outside what you could defend in words is the
  optimiser exploiting your loss function.

Building the backtest, and then fitting against it, found several real bugs that
eyeballing had missed: a theatre-deployment fraction that was never applied to
combat power (attackers fought with 100% of their army at any distance), an
equipment ceiling that let Finland field 45,000 men in 1939, materiel attrition
that let a routed army keep its equipment, and a fragile-state clause keyed to a
field name that did not exist.

## Data

| Field group | Source |
|---|---|
| Military spending | SIPRI, *Trends in World Military Expenditure, 2025* (April 2026) |
| Order of battle | IISS *Military Balance*; Janes; national defence white papers |
| Nuclear forces | FAS, *Status of World Nuclear Forces* (2026) — ~12,187 warheads globally |
| Economy, demography | IMF *World Economic Outlook*, World Bank, UN *World Population Prospects* |
| Urbanisation | UN *World Urbanization Prospects* |
| Infrastructure, energy | CIA *World Factbook*, EIA, World Steel Association |

Military budgets are carried both nominal and PPP-adjusted, because a dollar of
Russian, Chinese or Iranian defence spending buys considerably more domestic
output than a dollar of American.

Munitions stocks, mobilisation rates and equipment storage are **derived** from
sourced figures (steel output, arms-industry tier, PPP budget, technology) with
explicit per-country overrides where the derivation is known to be wrong — shell
production in particular is not a function of GDP, and North Korea out-produces
most of NATO. All units are documented at the top of `js/data.js`.

## What this cannot do

**It is a model, and wars are not.** Every armed conflict of the last century
turned on things no spreadsheet holds: a decision taken badly at 3am, an alliance
that held when nobody expected it to, a population that would not stop fighting
after its army was gone. The Monte Carlo spread is an admission of that, not a
measurement of it.

**The qualitative indices are judgement calls.** Technology, training, combat
experience, C4ISR, air defence, cyber, morale and stability are 0–100 numbers I
assigned, not measurements, and the four force-quality multipliers compound.
Change them and the answer changes. They are all exposed in the side-by-side
table and in "show your work."

**Several constants are fitted, not derived.** Casualty tolerance in particular
is calibrated against the backtest rather than measured, and the code says so
where that is true.

**Durations and casualty counts are much weaker than the outcome verdict.**
Short decisive wars still run too long and the casualty figures inherit that
error. One structural cause was found and closed — every termination test was an
integral over elapsed time, so no war could end quickly — which bought two
scoring passes and left most of the gap in place. See the backtest section for
what is left and where it is.

**There is no negotiated peace.** A war here ends because someone achieves an
objective, collapses, or concedes a position they can see is lost. Nothing in
the model represents two governments arriving at terms neither of them wanted,
which is how a great many wars actually end. When the simulation reports a war
as `unresolved` it means it reached its horizon still running — not that it
found a settlement. Korea and the Iran–Iraq War, the two genuine armistices in
the backtest, are both scored against that substitute, and both are failures.

**The nuclear module is deliberately crude.** It exists so the model refuses to
report a tidy conventional victory over a nuclear-armed state facing collapse —
the single most misleading thing a simulator like this can do. It is not an
estimate of what a nuclear war would be like.

## Layout

```
index.html        page shell and the scenario controls
css/styles.css    dark theme; the three series colours are validated (see below)
js/data.js        the dataset — 74 countries, alliances, chokepoints, stocks
js/model.js       the model: force quality, projection, magazines, the campaign
                  loop, geometry, attrition, occupation, escalation, Monte Carlo
js/backtest.js    fifteen historical wars, period force data, and the scoring
js/charts.js      the SVG chart forms, with hover layers and table fallbacks
js/app.js         controls and the report
tools/harness.js  loads the model outside a browser, for the two tools below
tools/backtest.js the fifteen wars, scored, from a terminal
tools/fit.js      coefficient search with a held-out validation set
```

Chart colours were checked with a palette validator against this exact surface
rather than chosen by eye: attacker `#3987e5`, defender `#c98500`, critical
`#d03b3b` — worst all-pairs normal-vision ΔE 16.9, worst colour-vision-deficient
ΔE 10.2, both above the floors. "Won the war but cannot hold the ground" is drawn
in the attacker's colour with a hatch rather than a fifth hue, which would have
failed those floors. Every chart has a table view.

The endings chart needed two more slots and both were checked the same way. Its
second attacker step is `#8fc0f5`, at ΔE 18.5 from the base — a step of one hue,
because "won by force" and "won by concession" are parts of one whole rather than
two identities. The neutral moved from `#898781` to `#7d8288`: the old value sat
at ΔE 14.2 from the defender amber, under the 15 floor, which had gone unnoticed
because no chart had previously put those two bands next to each other. The new
one clears both its neighbours at a worst pair of 16.7. It is still deliberately
below the chroma floor a categorical slot has to clear, because it means
"neither side" and should read as grey.
