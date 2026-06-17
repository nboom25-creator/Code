# 6-DOF underwater-glider simulator

`glider_6dof.py` expands a 3-DOF longitudinal-plane glider model into a full
**12-state, 6 degree-of-freedom** rigid-body flight simulation.

## Run it in your browser (no install — works on a phone)

Open the notebook in Google Colab and press *Runtime → Run all*; the trajectory
figures and the animated dive appear inline:

**https://colab.research.google.com/github/nboom25-creator/code/blob/claude/underwater-glider-calc-HNYEV/simulation/glider_6dof.ipynb**


| Group | States |
| ----- | ------ |
| Position (earth/NED) | `x` (north), `y` (east), `z` (depth, down +) |
| Attitude (Euler ZYX) | `phi` roll, `theta` pitch, `psi` yaw |
| Body linear velocity | `u` surge, `v` sway, `w` heave |
| Body angular velocity | `p` roll-rate, `q` pitch-rate, `r` yaw-rate |

## What the model captures

- **Rigid-body + added-mass inertia** assembled as a 6×6 system matrix
  `M = M_RB + M_A`.
- **Coriolis/centripetal** `C(ν)` derived from `M` via Fossen's
  parameterisation, which reproduces the destabilising added-mass
  (**Munk**) moments automatically.
- **Hydrodynamics** from angle-of-attack `α` and sideslip `β`: lift, drag and
  side force in the wind frame, rotated into the body frame; plus rotary
  damping (roll/pitch/yaw) and a steerable **rudder**.
- A **linear damping matrix** `D` (low in surge so it still glides, strong in
  sway/yaw) representing the tail fins and viscous losses — this is what keeps
  a slender hull directionally stable.
- **Buoyancy/gravity restoring** with the centre of buoyancy above the centre
  of gravity (the metacentric righting moment).
- **Actuators**: a variable-ballast buoyancy engine and a movable internal
  mass that trims **pitch** (fore/aft) *and* **roll** (lateral).
- A **depth-varying lateral ocean current**; all hydrodynamics use velocity
  *relative to the moving water*, so the glider visibly crabs and drifts.
- **RK4** time integration and a simple flight controller (sawtooth dive logic
  + PD heading hold via the rudder).

It reduces to the original 3-DOF longitudinal baseline when the lateral states
(`v, p, r, phi, psi`), the current and the rudder are all zero.

## Run it

```bash
pip install -r requirements.txt

python glider_6dof.py                          # baseline ~50 kg glider
python glider_6dof.py design.json              # a specific design (see below)
python glider_6dof.py design.json --animate    # also write an animated GIF
python glider_6dof.py --bank                   # use bank-to-turn steering
```

The static run writes `*_trajectory.png` (3-D path, top-down drift, depth
profile, attitude history) and prints a summary; `--animate` also writes a
moving side-view + top-down `*_animation.gif` (uses Pillow, no ffmpeg needed).

## Feeding it a design from the web calculator

In the web app's **Requirements** card, press **“Export design for 6-DOF
simulator (.json)”** to download `glider_design.json`, then:

```bash
python glider_6dof.py glider_design.json --animate
```

`Glider6DOF.from_design()` maps the design (mass, volume, hull radius/length,
wing area/span, C_D0, k, ballast swing, depth band, water density, speed) into
the model, estimating inertia (including the wing span), added mass and a
**scale-robust critical-damping** rule so it stays well-behaved from a 3 kg lab
hull up to a 50 kg vehicle. A sample `lab_glider_design.json` is included.

## Steering modes

- **`rudder`** (default) — a PD heading-hold on the rudder. Validated: tracks
  the commanded heading and stays directionally stable.
- **`bank`** — a coordinated bank-to-turn using only the lateral movable mass,
  reversing the bank between dive and climb (as real gliders do). It banks the
  vehicle correctly, but this study found that for a slow, internal-mass-only
  glider the heading tracking is limited by roll–pitch–yaw cross-coupling — a
  real reason gliders such as the Slocum carry a rudder.

## Tuning

All physical and control parameters live in `Glider6DOF.__init__` and the
`simulate()` / `control()` signatures — mass, volume, inertia, added mass,
damping, aero coefficients, the ocean-current profile, the dive band and the
commanded heading. The defaults model a ~50 kg glider; drop in numbers from the
web calculator to study a specific design.

> First-order coefficients for design exploration, not a validated CFD/tow-tank
> model. Confirm hydrodynamic derivatives experimentally before relying on them.
