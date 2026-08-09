# Theatre — a war simulator built on real force structures

Pick two countries and a scenario. The model fights the war month by month — air
superiority, ground manoeuvre, sea control, magazines, industrial replacement,
fuel, casualties and political will all feeding back into each other — a few
thousand times, and reports the distribution of outcomes rather than a single
answer.

74 countries. Order of battle, economy, demography, logistics, energy, industry,
geography, munitions stocks, nuclear forces, and a set of qualitative indices.

**It is graded.** Nine historical wars with known outcomes run through the same
simulation, in the app, on demand. Current score: **6 of 9 outcomes called
correctly, 4 of 9 durations within 3×, 4 of 9 casualty counts within 4×**, with
a mean 67% of probability mass on what actually happened. The failures are
listed below rather than hidden.

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

## What the model does

**There is no single "power score."** Wars are resolved as a month-by-month
campaign. Each month the model contests the air, contests the sea if the sea
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
distinct from national will; and nuclear escalation checked monthly against each
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
| **Season** | Which month the war starts in. Matters more than it sounds. |
| **Nuclear escalation** | Toggle off to see the conventional result — a fiction wherever a nuclear state faces defeat. |
| **Surprise** | A first-month strike that also destroys aircraft on the ground. |

The report ends with a sensitivity table that re-fights the matchup with one
assumption changed at a time, so you can see which of them the answer rests on.

## The backtest

`js/backtest.js` holds nine wars with period-accurate force data and documented
outcomes, run through the same `simulate()` the live app uses. Two conventions
matter for reading it: expeditionary forces are placed at their staging base
rather than their capital (the 1991 coalition is modelled as the force in Saudi
Arabia), and the model's resolution is one month.

| War | Model | Actual | Notes |
|---|---|---|---|
| Gulf War 1991 | attacker, 1.9 mo | attacker, 1.5 mo | ✓ outcome ✓ duration ✓ casualties |
| Invasion of Iraq 2003 | attacker, 3.5 mo | attacker, 1.5 mo | ✓ ✓ — occupation correctly flagged as failing |
| Falklands 1982 | attacker, 10.4 mo | attacker, 2.5 mo | ✓ outcome, far too slow |
| Yom Kippur 1973 | defender | defender, 0.7 mo | ✓ outcome; below time resolution |
| Six-Day War 1967 | defender | attacker, 0.2 mo | ✗ — six days is below the model's floor |
| Iran–Iraq 1980–88 | defender, 7.3 mo | stalemate, 96 mo | ✗ — see below |
| Nagorno-Karabakh 2020 | attacker, 9.7 mo | attacker, 1.5 mo | ✓ outcome ✓ casualties |
| Winter War 1939–40 | attacker, 1.6 mo | attacker, 3.5 mo | ✓ ✓; Soviet casualties far too low |
| Russia–Ukraine 2022– | attacker | stalemate | ✗ — see below |

**What the failures are telling you.** The Six-Day War lasted six days; a model
working in whole months cannot be right about it, and it is included to show the
floor rather than hidden. Iran–Iraq and Russia–Ukraine share one structural
failure: **the model cannot sustain a multi-year attritional war.** It has a
single political-will mechanism, and any setting of it that keeps an eight-year
war going also makes every short decisive war too long. That was tested
directly — a saturating will function moved Iran–Iraq from 7 months to 10 against
an actual 96, while pushing the 2003 invasion from 3.5 months to 14 and dropping
casualty accuracy from 4/9 to 1/9. It was reverted, and the attempt is documented
in the code. Treat long attritional matchups as the model's weakest ground.

Building the backtest immediately found several real bugs that eyeballing had
missed, including a theatre-deployment fraction that was never applied to combat
power (attackers were fighting with 100% of their army at any distance) and an
equipment ceiling that let Finland field 45,000 men in 1939.

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

**Long attritional wars are the weak ground** — see the backtest section.

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
js/backtest.js    nine historical wars, period force data, and the scoring
js/charts.js      two SVG chart forms with hover layers and table fallbacks
js/app.js         controls and the report
```

Chart colours were checked with a palette validator against this exact surface
rather than chosen by eye: attacker `#3987e5`, defender `#c98500`, critical
`#d03b3b` — worst all-pairs normal-vision ΔE 16.9, worst colour-vision-deficient
ΔE 10.2, both above the floors. "Won the war but cannot hold the ground" is drawn
in the attacker's colour with a hatch rather than a fifth hue, which would have
failed those floors. Every chart has a table view.
