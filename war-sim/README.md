# Theatre — a war simulator built on real force structures

Pick two countries and a scenario. The model fights the war month by month — air
superiority, ground manoeuvre, sea control, industrial replacement, fuel,
casualties and political will all feeding back into each other — a few thousand
times, and reports the distribution of outcomes rather than a single answer.

74 countries, ~55 fields each: order of battle, economy, demography, logistics,
energy, industry, geography, nuclear forces, and a set of qualitative indices.

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

## What the model actually does

Six ideas do most of the work.

**1. There is no single "power score."** Wars are resolved as a month-by-month
campaign. Each month the model contests the air, contests the sea if the sea
matters, fights on the ground, applies attrition, regenerates what industry can
replace, spends money, kills people, and updates each side's willingness to keep
going. A side can win every battle and still lose the war.

**2. Distance is a combatant.** Every country is formidable at home and close to
helpless far away. A projection index built from carriers, amphibious shipping,
aerial tankers, transport aircraft, sealift and overseas basing yields a *reach*
— the distance at which a country can still bring half its deployable force to
bear. The United States reaches ~8,800 km; Russia ~1,900 km; Poland ~850 km.
Force is discounted by `1 / (1 + (distance/reach)²)`.

**3. Defence is cheaper than offence.** Terrain, prepared positions and interior
lines give the defender a multiplier of 1.30 × (1 + 0.55 × terrain index). The
defender also gets +0.28 on its political-will base for fighting on its own
soil — the largest single intangible in the model, and the one with the
strongest historical support.

**4. Invasions culminate.** The mechanic that stops most offensives is not the
enemy's remaining divisions but the attacker's own supply lines stretching past
what its logistics can carry, while an ever-larger share of the army is tied
down garrisoning what it already took. Both are modelled explicitly, scaled by
the size of the country being invaded.

**5. Taking ground is not holding it.** Occupation is tested against the
counter-insurgency ratio that keeps being rediscovered — roughly 20 troops per
1,000 inhabitants — with an expeditionary rotation penalty of about three troops
in the base for every one standing in the country. This is why the model reports
US invasions of Iraq and Iran as military victories that fail as occupations,
and a US invasion of Canada as one that does not.

**6. Nuclear weapons are not a bigger tank.** Escalation is checked every month
against each nuclear state's doctrinal threshold, driven by how close it is to
losing its territory, its army or its government. Thresholds differ: Pakistan and
North Korea escalate early by declared doctrine, China and India declare no first
use. If it fires, there is no winner and the model says so.

Every parameter a planner would be uncertain about — leadership competence,
surprise, intelligence, alliance entry, industrial output, casualty tolerance —
is sampled per run. The output is a distribution.

### Scenario levers

| Lever | Effect |
|---|---|
| **War aim** | Total conquest / regime change / seize a border region / punitive air campaign / blockade. Sets the territorial threshold for victory, the share of force committed, and whether the occupation test applies. |
| **Mobilisation** | Per side. Governs how much of the reserve is called up and how far the economy is put on a war footing. |
| **Foreign materiel support** | Shells, vehicles, interceptors and intelligence from a patron who does not send troops. Modern wars are shaped by this more than by formal alliances. |
| **Alliances** | Treaty partners are drawn in probabilistically, weighted by a reliability estimate per pact (NATO 0.82, CSTO 0.45, GCC 0.38). |
| **Nuclear escalation** | Toggle off to see the conventional result — which is a fiction wherever a nuclear state faces defeat. |
| **Surprise** | A first-month multiplier on the opening air and missile campaign. |

The report ends with a sensitivity table that re-fights the same matchup with
one assumption changed at a time, so you can see which of them the answer
actually rests on.

## Data

| Field group | Source |
|---|---|
| Military spending | SIPRI, *Trends in World Military Expenditure, 2025* (April 2026) |
| Order of battle | IISS *Military Balance*; Janes; national defence white papers |
| Nuclear forces | FAS, *Status of World Nuclear Forces* (2026) — ~12,187 warheads globally |
| Economy, demography | IMF *World Economic Outlook*, World Bank, UN *World Population Prospects* |
| Infrastructure, energy | CIA *World Factbook*, EIA, World Steel Association |

Military budgets are carried both nominal and PPP-adjusted, because a dollar of
Russian, Chinese or Iranian defence spending buys considerably more domestic
output than a dollar of American, and the nominal figures badly understate those
countries' real military weight.

All units are documented at the top of `js/data.js`. Counts are approximate and
drift constantly; several states publish nothing reliable.

## What this cannot do

**It is a model, and wars are not.** Every armed conflict of the last century
turned on things no spreadsheet holds: a decision taken badly at 3am, an alliance
that held when nobody expected it to, a population that would not stop fighting
after its army was gone. The Monte Carlo spread is an admission of that, not a
measurement of it.

**The qualitative indices are judgement calls.** Technology, training, combat
experience, C4ISR, air defence, cyber, morale and stability are all 0–100 numbers
I assigned, not measurements. They carry a lot of weight — the four force-quality
multipliers compound, so a badly trained army with obsolete kit and no ISR comes
out several times worse rather than marginally worse. Change them and the answer
changes. They are all exposed in the side-by-side table and in "show your work."

**Known calibration limits.** Two worth stating plainly:

- *Russia–Ukraine.* Under a **total conquest** aim with full commitment, the
  model gives Russia the war in around four years. Under a **limited** aim with
  materiel support to Ukraine — much the closer description of the actual
  war — it returns roughly an even split between a small Russian gain and a
  stalemate, which is about right. The model has no representation of a war
  fought for aims that shift mid-conflict.
- *Civilian casualties* count people killed by ordnance, not the much larger
  number who die of everything else a war causes. They still read high against
  confirmed counts from recent conflicts; treat them as an upper band.

**The nuclear module is deliberately crude.** It exists so the model refuses to
report a tidy conventional victory over a nuclear-armed state facing collapse —
the single most misleading thing a simulator like this can do. It is not an
estimate of what a nuclear war would be like.

## Layout

```
index.html        page shell and the scenario controls
css/styles.css    dark theme; the three series colours are validated (see below)
js/data.js        the dataset — 74 countries, alliances, platform values
js/model.js       the model: force quality, projection, the campaign loop,
                  attrition, occupation, escalation, Monte Carlo
js/charts.js      two SVG chart forms with hover layers and table fallbacks
js/app.js         controls and the report
```

Chart colours were checked with a palette validator against this exact surface
rather than chosen by eye: attacker `#3987e5`, defender `#c98500`, critical
`#d03b3b` — worst all-pairs normal-vision ΔE 16.9, worst colour-vision-deficient
ΔE 10.2, all above the floors. "Won the war but cannot hold the ground" is drawn
in the attacker's colour with a hatch rather than a fifth hue, which would have
failed those floors. Every chart has a table view.
