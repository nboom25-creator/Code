# glidercalc

A command-line tool for the engineering calculations you need when designing and
building an **underwater glider** — an autonomous vehicle that moves by changing
its buoyancy and using wings to turn that vertical motion into forward glide.

It covers four design domains:

| Domain | What it answers |
| ------ | --------------- |
| **Buoyancy & ballast** | Is the vehicle heavy or light? How much ballast volume do I need to move? |
| **Hydrodynamics & glide** | How fast does it go, at what angle, and what glide ratio? |
| **Pressure hull** | Will the hull survive at depth (yield and buckling)? |
| **Power, energy & range** | How many dive cycles, how far, and for how long? |

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

## Project layout

```
glidercalc/
  buoyancy.py        net buoyancy, ballast sizing
  hydrodynamics.py   steady-glide speed, angle, glide ratio
  pressure_hull.py   hull stress and collapse depth
  energy.py          pump energy, range, endurance
  report.py          chained full-vehicle analysis
  cli.py             argparse command-line interface
examples/glider.yaml example configuration
tests/               pytest test suite
```

## Tests

```bash
pytest
```
