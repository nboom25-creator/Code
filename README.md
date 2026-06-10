# glidercalc

A command-line tool for the engineering calculations you need when designing and
building an **underwater glider** — an autonomous vehicle that moves by changing
its buoyancy and using wings to turn that vertical motion into forward glide.

## 🌊 No-install web app (easiest way to use it)

Open **[`glider_calculator.html`](glider_calculator.html)** in any web browser —
just double-click the file. It's a single self-contained page (no install, no
Python, works offline on a phone, tablet or laptop) with friendly input fields
and **live-updating** results. It also includes:

- **Requirements-driven mode**: enter your project requirements (depth, hull
  tube size/material, syringe-pump volume, target speed and glide angle) and it
  sizes the hull wall, ballast authority, wing area and trim, then runs the full
  analysis — handy for a senior-design lab glider. It also sizes the syringe-pump
  engine (force, torque, flow, stroke time), checks the chosen motor can supply
  it, and totals a bill of materials.
- **Animated dive simulation**: plays back the glider's sawtooth glide path
  (descend → pump → ascend → pump) on a canvas, with a dive-cycle timeline and
  live phase/depth/distance/speed readouts.
- **Colour-coded safety warnings** and a **Recommendations** panel that turns
  the numbers into concrete actions (e.g. *“increase the wall to 7.2 mm for
  buckling SF 2.0”*), each with a one-click **Apply** button.
- A **design-target solver** — pick a goal (glide ratio, speed, range, rated
  depth or pitch) and it solves the input that hits it.
- **Saved designs**: name and store several configurations in the browser,
  reload them, and **compare two side by side** in a metrics table.
- An interactive **glide-polar chart**, plus **Copy report**, **Download .txt**
  and **Save as PDF** (print) export.

Your inputs are saved automatically in the browser.

The web app reimplements the same physics as the Python package below, so the
numbers match. Use the web app for quick interactive design; use the CLI/library
below for scripting, automation, or batch studies.

## Command-line tool

It covers six design domains:

| Domain | What it answers |
| ------ | --------------- |
| **Buoyancy & ballast** | Is the vehicle heavy or light? How much ballast volume do I need to move? |
| **Hydrodynamics & glide** | How fast does it go, at what angle, and what glide ratio? Plus a full **polar sweep**. |
| **Pressure hull** | Will the hull survive at depth (yield and buckling)? |
| **Power, energy & range** | How many dive cycles, how far, and for how long? |
| **Stability & trim** | Is the CB above the CG? How far must the moving mass slide to pitch by X degrees? |
| **Water column** | How much does seawater density (and pressure) rise with depth? |

Everything is in **SI units** (metres, kilograms, seconds, newtons, pascals,
joules), with convenient `mm` / `litre` / `Wh` inputs on the CLI where that's
more natural.

> ⚠️ These are first-order design formulas for exploring trade-offs. They are
> not a substitute for FEA, tank testing, or certification before you put a
> hull in deep water.

## Install

No third-party packages are required for the core tool (Python 3.9+). YAML
config support uses `PyYAML` if present; JSON configs always work.

```bash
# run directly from the repo
python -m glidercalc --help

# or install as a console script named "glider"
pip install -e .
glider --help
```

## Quick start — full report

Edit `examples/glider.yaml` with your numbers, then:

```bash
python -m glidercalc report examples/glider.yaml
```

This chains the domains the way a real design depends on them: buoyancy gives
the net driving force → that force drives the glide solution → the glide ratio
and speed feed the range/endurance estimate. Add `--json` for machine-readable
output.

## Individual subcommands

```bash
# Buoyancy: 52 kg vehicle displacing 50.7 L of seawater
python -m glidercalc buoyancy --mass 52 --volume-l 50.7

# Glide: solve at the best (max) glide ratio for a given drag polar
python -m glidercalc glide --net-force 7 --wing-area 0.1 --cd0 0.1 --k 0.3

# Hull: 100 mm radius, 6 mm wall aluminium cylinder rated to 200 m
python -m glidercalc hull --radius 100 --thickness 6 --depth 200 \
    --yield-strength 276 --youngs-modulus 69

# Energy: range and endurance from a 200 Wh battery
python -m glidercalc energy --battery-wh 200 --ballast-l 0.5 \
    --depth-band 200 --glide-ratio 3 --speed 0.3

# Polar sweep: how speed/angle/glide-ratio trade off across CL (table or CSV)
python -m glidercalc polar --net-force 7 --wing-area 0.1 --cd0 0.1 --k 0.3
python -m glidercalc polar --net-force 7 --wing-area 0.1 --cd0 0.1 --k 0.3 \
    --csv polar.csv

# Stability & trim: CB above CG? how far to slide the battery for 25 deg pitch?
python -m glidercalc stability --mass 52 --cg-z -0.015 --cb-z 0 \
    --mass-shift 12 --shift-distance 0.05 --target-pitch 25

# Water column: density and pressure vs depth
python -m glidercalc density --depth 1000 --table
```

Use `--water-density 998` for fresh-water (e.g. lake/pool) testing.

## The physics, briefly

**Buoyancy.** Buoyancy force `B = ρ·g·V`, weight `W = m·g`, net `F = B − W`.
A glider runs on a *small* net buoyancy; the ballast system changes displaced
volume by `ΔV = ΔF / (ρ·g)`.

**Glide.** In steady glide, net buoyancy is balanced by lift (⊥ flow) and drag
(∥ flow). With a quadratic drag polar `C_D = C_D0 + k·C_L²`:
`tan(γ) = C_D/C_L`, glide ratio `= C_L/C_D = 1/tan(γ)`, and
`V = √(2·F·cos γ / (ρ·S·C_L))`. Max glide ratio is at `C_L = √(C_D0/k)`.

**Pressure hull.** Pressure at depth `p = ρ·g·d`. Thin-wall hoop stress is
`p·r/t` (cylinder) or `p·r/2t` (sphere). Elastic buckling uses the long-cylinder
`p_cr = E/(4(1−ν²))·(t/r)³` and spherical `p_cr = 2E/√(3(1−ν²))·(t/r)²`. The tool
reports collapse depth for both modes and flags whichever governs.

**Energy.** Pump work per inflation is `p·ΔV/η` against pressure at depth.
Range per dive/climb cycle `= 2·d·(glide ratio)`; total range and endurance
follow from battery capacity minus the continuous hotel load.

**Stability & trim.** A submerged vehicle is kept upright by the vertical gap
`BG` between the centre of buoyancy (which must be **above**) and the centre of
gravity. The righting couple is `B·BG·sin θ`. Pitching by sliding an internal
mass `m_p` a distance `d` shifts the CG by `Δx = m_p·d/m_total`, and the vehicle
settles at `tan θ = Δx/BG` — so a small BG trims easily but is less stable.

**Water column.** Density rises with depth, mostly from compression:
`ρ(d) = ρ_surface + gradient·d`, with `gradient = ρ²·g/K` (`K` = bulk modulus,
~2.2 GPa) ≈ 0.0047 kg/m³ per metre. Pressure integrates this:
`p(d) = g·(ρ_surface·d + ½·gradient·d²)`. In a full `report`, enabling the
`water` section makes buoyancy use the local density and the hull use the
integrated pressure.

## Project layout

```
glidercalc/
  buoyancy.py        net buoyancy, ballast sizing
  hydrodynamics.py   steady-glide speed, angle, glide ratio, polar sweep
  pressure_hull.py   hull stress and collapse depth
  energy.py          pump energy, range, endurance
  stability.py       CG/CB static stability and pitch/roll trim
  water.py           depth-varying seawater density and pressure
  report.py          chained full-vehicle analysis
  cli.py             argparse command-line interface
examples/glider.yaml example configuration
tests/               pytest test suite
```

## Tests

```bash
pytest
```
