# 6-DOF underwater-glider simulator

`glider_6dof.py` expands a 3-DOF longitudinal-plane glider model into a full
**12-state, 6 degree-of-freedom** rigid-body flight simulation.

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
python glider_6dof.py
```

This writes `glider_6dof_trajectory.png` (3-D path, top-down drift, depth
profile, attitude history) and prints a summary.

## Tuning

All physical and control parameters live in `Glider6DOF.__init__` and the
`simulate()` / `control()` signatures — mass, volume, inertia, added mass,
damping, aero coefficients, the ocean-current profile, the dive band and the
commanded heading. The defaults model a ~50 kg glider; drop in numbers from the
web calculator to study a specific design.

> First-order coefficients for design exploration, not a validated CFD/tow-tank
> model. Confirm hydrodynamic derivatives experimentally before relying on them.
