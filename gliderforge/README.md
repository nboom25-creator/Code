# GliderForge Assistant

An engineering workspace for a senior-design project building a laboratory-scale
autonomous underwater glider with a motor-driven syringe buoyancy engine.

It is a working application, not a design document: it stores your project,
computes buoyancy, stability, actuator loads, drag, glide performance, power and
mission behaviour, holds your requirements, tests, decisions and risks, and
generates the reports a design review asks for.

Its governing principle is that **it never invents data**. Every number is tagged
with where it came from, every model shows its working and states its
assumptions, missing values are reported as errors rather than treated as zero,
and nothing in it is a verified engineering result.

---

## Quick start

```bash
cd gliderforge
npm install
cp .env.example .env.local     # optional; sensible defaults apply without it
npm run dev                    # http://localhost:3000
```

On first run, open **Projects** and either create your own project or click
**Load the demonstration project** to see the whole workflow populated with
clearly-labelled synthetic data.

Production:

```bash
npm run build
npm start
```

### Environment variables

All optional; the defaults work out of the box.

| Variable | Default | Purpose |
| --- | --- | --- |
| `GLIDERFORGE_DB` | `./data/gliderforge.db` | SQLite database file. Created automatically. |
| `GLIDERFORGE_UPLOAD_DIR` | `./data/uploads` | Where uploaded geometry and attachments are stored. |
| `GLIDERFORGE_MAX_UPLOAD_BYTES` | `26214400` (25 MB) | Upload size cap. |
| `ASSISTANT_PROVIDER` | `local` | `local` (built-in deterministic assistant) or `anthropic`. |
| `ANTHROPIC_API_KEY` | — | Server-side only, never sent to the browser. Only read when `ASSISTANT_PROVIDER=anthropic`. |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Model id for the optional external provider. |

No secrets are committed. `.env.local` and `data/` are git-ignored.

### Database

The schema is applied automatically on first connection — there is no separate
migration step to run. Useful scripts:

```bash
npm run db:schema   # regenerate the bundled schema module from schema.sql
npm run db:reset    # delete the database file (schema is recreated on next start)
npm run db:seed     # create the demonstration project
```

Back up by exporting a project to JSON from the Projects page, or by copying the
`.db` file.

### Testing

```bash
npm run typecheck   # TypeScript, strict
npm test            # 148 unit tests of the calculation engine and persistence
npm run test:e2e    # 15 Playwright tests driving the real UI
```

---

## Architecture

Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, with SQLite for
persistence. The calculation engine is a set of pure modules with no React or
database dependency, which is what makes it directly testable.

```
src/lib/
  units/          Unit registry, conversion, significant figures, formatting
  calc/           Calculation engine — pure functions, no UI or DB
    types.ts        The CalcResult envelope every calculation returns
    buoyancy.ts     Archimedes, net buoyancy, ballast solver
    massprops.ts    CG, CB, displacement model, component roll-up
    stability.ts    Righting moment, equilibrium attitude, trim solver
    syringe.ts      Buoyancy-engine architectures, forces, torque, sweeps
    pressure.ts     Housing, end cap, penetration and O-ring checks
    hydro.ts        Reynolds, drag buildup, steady glide
    power.ts        Load budget and battery endurance
    mission.ts      State-machine mission simulator
    uncertainty.ts  First-order uncertainty propagation
  analysis/       Descriptive statistics, curve fitting, outliers, comparison
  geometry/       STL/OBJ parsing, mesh analysis, STEP/IGES metadata
  reference/      Water properties (EOS-80) and the material library
  db/             SQLite client, schema, generic repository with revision log
  project/        Settings schema, the shared project snapshot, session
  assistant/      Provider adapter, deterministic local assistant, task ranker
  reports/        Markdown report generation
  electronics/    Control strategies, checklists, code templates
src/app/          Pages and API routes
src/components/   UI primitives, charts, 3D viewer, page clients
```

### Why the calculation engine is separate

Every calculation returns the same envelope:

```ts
{ id, title, values, steps, equations, assumptions, warnings, inputs,
  confidence, limitations }
```

`values` are `Quantity` objects carrying a unit and a provenance tag. `steps`
carry the equation, the numeric substitution and the result, so the UI and the
reports render identical working. `inputs` is a literal snapshot, which is what
makes a stored calculation run reproducible.

### The shared project snapshot

`buildSnapshot(project)` loads every table and runs the whole engine in one
pass. Every page, the assistant and every report read from it, which is why a
value entered once appears consistently everywhere. It is recomputed on demand
rather than cached, so it cannot drift from the stored data.

### Deviations from the suggested stack, and why

| Suggested | Used here | Reason |
| --- | --- | --- |
| PostgreSQL + Prisma | SQLite via `better-sqlite3`, hand-written SQL | A senior-design workspace is single-user and file-based. No server to run, no query-engine binary to download, and the schema is plain reviewable SQL. The repository layer is isolated, so swapping the dialect is a contained change. |
| A unit-conversion library | Own unit registry | Engineering results need an explicit *dimension* so the app can refuse to add a pressure to a force. Small conversion packages convert within a category and expose no dimension algebra. Every factor here is exact-by-definition (SI / NIST SP 811) and unit-tested. |
| Server-side PDF library | Browser print pipeline | Print styles produce selectable text, identical to what the user sees on screen, with no heavy dependency. Markdown, CSV and JSON export are native. |

Everything else follows the suggestion: Next.js, React, TypeScript, Tailwind,
Zod for runtime validation, React Three Fiber for 3D, Recharts for plots,
Vitest for unit tests, Playwright for end-to-end tests.

---

## What the application does

**Dashboard** — vehicle state, warnings, requirement verification, milestones,
open questions and assumptions, recent calculations and tests, plus a
deterministic *"What should I work on next?"* ranker that explains why each task
matters and what evidence would close it.

**Requirements** — full requirement records with target, tolerance, priority,
source, rationale, verification method and status, linked to tests, with a
traceability matrix that reports its own gaps.

**Components** — inventory with measured *and* estimated mass (a measurement
supersedes an estimate without deleting it), displacement mode, position,
material, cost and confidence. Geometry upload with mesh analysis.

**CAD viewer** — three.js scene with real STL/OBJ meshes where available,
bounding boxes otherwise, CG and CB markers, axes, transparency, section
clipping, measurement, and colour coding by subsystem, material, confidence or
displacement mode.

**Mass & buoyancy** — the full budget with per-component contributions, warnings
for missing masses, double-counted displacement, implausible densities and unit
errors, plus interactive uncertainty propagation.

**Syringe engine** — architecture selection with labelled schematics, sizing,
forces, torque, timing, energy, margins, parameter sweeps, a classical
power-screw cross-check, and requirement-based component selection guidance.

**Pressure & structure** — hydrostatic pressure, thin-wall housing under external
pressure (membrane stress plus long-tube and finite-length collapse), flat end
caps, penetration thrust and O-ring gland geometry.

**Stability & trim** — CG/CB separations, equilibrium attitude, righting-moment
curve, live component-move preview, and a trim solver that states its
constraints and its non-uniqueness.

**Hydrodynamics** — four modelling levels, drag buildup with cited correlations,
steady glide, and sweeps of drag, polar, glide ratio and speed.

**Mission simulator** — an explicit state machine with recorded transitions,
depth/trajectory/energy plots, limit violations and CSV/JSON export.

**Electronics** — load list, power budget, pin table, control strategies with
their failure modes, a pre-deployment checklist, a fault-response table, and
code templates generated only after the hardware platform is confirmed.

**Tests & data** — test plan templates, run records with verbatim raw CSV,
descriptive statistics, curve fitting with confidence intervals, residual plots,
outlier flagging that never deletes, and predicted-versus-measured comparison
with a calibration factor.

**Notebook, decisions, risks, assumptions** — chronological notebook, decision
records with weighted matrices and a sensitivity check, a risk register seeded
with editable starter risks marked unreviewed until you own them, and an
assumptions register alongside the assumptions the models themselves make.

**Reports** — 21 report kinds in Markdown, printable HTML/PDF, CSV and JSON.

**Assistant** — answers from your project data with cited values, separated
calculations and advice, explicit missing-data reporting, safety flagging, and an
accept/edit/reject/defer queue for anything it proposes.

---

## Implemented calculations

| Area | Relations |
| --- | --- |
| Buoyancy | `F_B = ρgV`, `W = mg`, `F_net = F_B − W`, ballast and displacement routes to neutral |
| Mass properties | `r_CG = Σm·r / Σm`, `r_CB = ΣV·r_V / ΣV`, four-mode displacement model |
| Stability | `M = ρgV·BG·sin θ`, `θ_eq = atan2(dx, dz)`, single-component trim solution |
| Syringe engine | `A_p = πD²/4`, `ΔV = A_p·x`, `ΔF = ρgΔV`, `P = P₀ + ρgh`, `F = ΔP·A_p`, `T = FL/2π`, efficiency chain, stall margin, feasible depth, energy per stroke |
| Lead screw | Classical power-screw raise/lower torque, collar torque, efficiency, self-locking condition |
| Pressure | Membrane hoop stress, long-tube collapse `2E/(1−ν²)(t/D)³`, Windenburg–Trilling finite length, Roark flat plates, penetration thrust, O-ring squeeze and gland fill |
| Hydrodynamics | `Re = ρVL/μ`, ITTC-57 friction line, Hoerner form factor, wing profile and induced drag, steady-glide equilibrium, Helmbold lift slope |
| Power | `P = VI/η`, duty-weighted average, `E = QV·DoD·k`, endurance |
| Mission | Time-stepped state machine with optional first-order velocity lag |
| Water | EOS-80 one-atmosphere seawater density, Vogel-type viscosity |
| Statistics | Descriptive stats, OLS polynomial and power-law fits with coefficient CIs, residuals, modified z-score and Tukey outliers, pooled repeatability, prediction-vs-measurement metrics |
| Uncertainty | First-order propagation with numerical sensitivities and variance shares |

### What was independently verified, and how

**Verified against hand calculations** (148 unit tests in `tests/`):

- Unit conversions against exact SI definitions, including offset temperature
  scales and round-trips through SI.
- Archimedes and net buoyancy against worked examples (2.0 L at 1000 kg/m³ →
  19.6133 N buoyant, 1.96133 N net for a 1.8 kg vehicle), neutral buoyancy,
  fresh-versus-salt water, and every boundary case (zero volume, zero mass,
  negative inputs, impossible density).
- CG and CB against closed-form two-body and offset cases, including that the CB
  is independent of mass and that internal components contribute no
  displacement.
- Stability righting moment against `ρgV·BG·sin θ`, and the equilibrium-pitch
  sign convention against a hand-checked geometry (CB aft of CG → nose-down).
- Syringe geometry, buoyancy change, pressure force, and the whole torque chain
  (ideal → screw efficiency → gear ratio) against hand calculations; the
  power-screw torque against the classical Shigley relation evaluated
  independently in the test.
- Hydrostatic pressure against the 1 bar per 10 m rule and exact arithmetic.
- Pressure housing hoop stress and both collapse formulas against their
  published forms; Roark flat-plate stress against `3qa²/4t²`.
- Reynolds number, the ITTC-57 line, the Hoerner form factor and the capsule
  wetted-area formula against direct evaluation; drag-versus-velocity scaling
  against the Reynolds-corrected expectation.
- Steady glide speed and angle against the closed-form equilibrium.
- Power budget and endurance against hand-computed watts and joules.
- Mission timing against depth divided by sink rate; energy monotonicity; fault
  triggering on depth and battery limits; termination on an unreachable state.
- Uncertainty propagation against the analytical quadrature result for a
  product, with variance shares summing to one.
- Water density against published tabulated values (998.2 kg/m³ at 20 °C fresh,
  1025.97 kg/m³ at 15 °C / 35 PSU) and the 4 °C density maximum.

**Verified by construction**, in the same suite: missing data raises errors
rather than defaulting to zero; buoyancy-engine architectures are not
interchangeable (sign, mass behaviour and pressure-opposed stroke all differ);
calculation runs are immutable; undo restores create, update and delete; unknown
collections and columns are rejected.

**Verified end to end** (15 Playwright tests): all 18 acceptance criteria driven
through the real UI, plus a 53-check API-level acceptance script.

### What is NOT verified and needs physical experiment or higher-fidelity tools

- **Every hydrodynamic coefficient.** The drag buildup is a correlation-based
  estimate; 30–50% error against measurement is normal at this scale. Needs a
  tow or glide test.
- **Plunger and seal friction.** Assumed unless you measure it, and it dominates
  actuator sizing at shallow depth.
- **Lead-screw efficiency.** Spans a factor of three across screw types and
  changes the required torque proportionally.
- **All structural results.** Closed-form elastic checks on a perfect cylinder.
  Real out-of-roundness, polymer creep, penetrations and stress concentrations
  are not modelled. Buckling is imperfection-sensitive: measured collapse
  pressures of 50–70% of theory are common. **Proof-test the housing.**
- **Seal performance.** Only gland geometry is checked, against published design
  bands. Nothing here predicts whether a seal actually seals.
- **Delivered volume versus swept volume.** Bladder compliance, trapped air and
  barrel expansion are not modelled. Needs a displacement test.
- **Battery capacity and real load currents.** Needs a discharge test at the
  actual load.
- **Vehicle dynamics.** No added mass, no damping, no pitch response, so no
  controller can be tuned from this application.
- **Material properties**, unless you have replaced the library values with
  supplier datasheet numbers.

---

## Known assumptions

Recorded on every calculation and reproduced in every report. The load-bearing
ones:

- The vehicle is fully submerged; water density is uniform and depth-independent
  (compressibility over tens of metres is far below the displaced-volume
  uncertainty).
- Component mass acts at a point; positions are exact; components marked
  *internal* contribute no displacement because the hull envelope already
  includes them.
- Swept volume equals delivered volume; friction is a single constant force;
  actuation is quasi-static.
- Boundary layers are fully turbulent (ITTC-57); the hull is a slender,
  streamlined body of revolution; wing and hull drag simply add.
- Steady glide with constant coefficients and no pitch-moment solution, so angle
  of attack is an input, not a result.
- Mission states have constant power and instantaneous velocity unless a
  velocity time constant is set.
- Structural checks are elastic, small-deflection, perfect-geometry and
  short-duration.

## Known limitations

- STEP and IGES are stored and their headers parsed, but not tessellated —
  evaluating a B-rep needs a geometry kernel this application does not embed.
  Export an STL alongside. 3MF is recognised but not unpacked.
- Moments of inertia are not computed, so no dynamic-response analysis.
- The trim solver moves components along x only and holds the CB fixed.
- The mission simulator is open-loop: it follows the state machine, with no
  control law.
- Single-user: there is a `users` table but no authentication. Do not expose an
  instance to an untrusted network.
- The material library is nominal handbook values, deliberately unverified.

## Safety and validation warnings

- **Nothing in this application is a verified engineering result.** Everything is
  a preliminary estimate whose accuracy is governed entirely by the data you
  entered.
- **Pressure testing is the most hazardous activity in this project.** Use water
  rather than gas, use a shield or full immersion, and have the procedure
  reviewed and supervised.
- **Trim the vehicle slightly positive when unpowered**, so the default failure
  mode is floating. This single choice matters more for recovery than everything
  else in the fault-response table.
- **Never test alone**, and keep mains-powered equipment away from the water.
- Starter risks and test-plan templates are starting points, not an assessment
  of your vehicle or a procedure approved for your facility.

## Incomplete features

- **PDF** is produced through the browser print pipeline rather than a
  server-side renderer. Text is selectable and styling matches the screen, but
  there is no programmatic PDF endpoint.
- **Chart image export** offers the underlying data as CSV and relies on print
  or screenshot for a raster copy; there is no one-click PNG/SVG button.
- **Attachments** (photos, datasheets, PDFs) upload, store and serve, but are not
  yet surfaced as inline galleries on notebook and test-run records.
- **Notebook revision history** has a schema column and is written on every edit
  through the revision log, but has no dedicated diff viewer.
- The **AI provider adapter** ships with one external implementation
  (Anthropic). Adding another means implementing `AssistantProvider` and
  registering it in `resolveProvider`.

## Recommended next development priorities

1. **Measure, then calibrate.** Plunger friction and the hydrodynamic
   coefficients are the two assumptions that most distort the current picture.
   The application is already built to absorb both.
2. **Bidirectional buoyancy-engine states in the mass model.** Model the
   extended and retracted configurations as distinct component sets so trim,
   CB and stability are evaluated in both — particularly for the internal-ballast
   architecture, where the CG genuinely moves.
3. **Attachment galleries** on notebook entries and test runs; the storage and
   serving layers already exist.
4. **A thick-wall (Lamé) housing solution** and an explicit buckling knockdown
   factor, so thicker housings are handled without leaving the tool.
5. **Moments of inertia and added mass**, which would unlock a pitch-dynamics
   model and, with measured data, honest controller tuning.
6. **Multi-user support** if this is ever shared: the schema has a `users` table
   but the application has no authentication.

---

## Data model

Twenty-six tables: users, projects, requirements, components, material
overrides, geometry files, attachments, syringe configs, buoyancy states,
electronics, pin assignments, calculation runs, simulations, assumptions,
decisions, risks, tests, test runs, notebook entries, references, tasks,
milestones, reports, AI recommendations, design variants, assistant messages,
plus a `revisions` audit log.

Two properties matter engineering-wise:

- **Calculation runs are insert-only.** The API refuses updates to them, so a
  number quoted in a report last month stays reproducible after the inputs
  change.
- **Every create, update and delete is journalled** to `revisions` with a
  before/after snapshot, which is what powers undo.

## Security

Server-side Zod validation on every mutating route; column names read from the
database itself so a payload cannot introduce one; parameterised queries
throughout; an allow-list of table names; upload extension whitelist and size
cap; server-generated stored filenames; path-traversal refusal on both read and
write; SVG forced to download rather than render inline; control-character
stripping and length caps on text; secrets read from the environment server-side
only and never logged.
