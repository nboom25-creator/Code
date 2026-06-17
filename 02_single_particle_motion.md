# Chapter 2 — Single-Particle Motion

Before treating the plasma as a fluid or a wave medium, it pays to understand
how **one** charged particle moves in given electric and magnetic fields. This
"single-particle" or "orbit" picture is valid when the particle's own fields are
negligible compared to the applied fields, and it gives enormous physical
intuition for confinement and drifts.

The governing equation is just the **Lorentz force law**:

```
m dv/dt = q ( E + v × B )
```

---

## 2.1 Gyration in a uniform B field (E = 0)

With **B** along ẑ and no E field, the magnetic force is always perpendicular to
**v**, so it does no work — speed is constant — and the particle moves in a
**circle** in the plane ⊥ B while drifting freely along B. The result is a
**helix**.

```
Gyrofrequency (cyclotron freq):   ω_c = |q| B / m
Larmor radius (gyroradius):       r_L = m v_⊥ / (|q| B) = v_⊥ / ω_c
```

- The sense of rotation is **opposite** for electrons and ions (both gyrate
  such that their self-field *reduces* B inside the orbit → plasma is
  diamagnetic).
- Motion **parallel** to B is unaffected: v_∥ = const (until forces appear).

Practical electron cyclotron frequency: `f_ce ≈ 28 · B[T]` GHz. This is why
**ECR** (electron cyclotron resonance) sources use ~2.45 GHz microwaves with
B ≈ 0.0875 T.

> **Worked example.** Electron, B = 0.01 T, T_e = 5 eV.
> v_⊥ ~ v_th = √(k_B T/m_e) = √(5·1.6e-19 / 9.11e-31) ≈ 9.4×10⁵ m/s.
> ω_ce = 1.6e-19·0.01 / 9.11e-31 ≈ 1.76×10⁹ rad/s (f_ce ≈ 280 MHz).
> r_L = 9.4e5 / 1.76e9 ≈ **5.3×10⁻⁴ m ≈ 0.53 mm**. Ions with the same energy
> have a gyroradius ~√(m_i/m_e) ≈ 43–270× larger → far less magnetized.

---

## 2.2 The E × B drift (the big one)

Add a *uniform* E field perpendicular to B. The particle still gyrates, but its
guiding center **drifts** with velocity:

```
v_E = (E × B) / B²
```

**Remarkable facts**

- It is **independent of charge sign, mass, and energy.** Electrons and ions
  drift *together*, in the *same* direction → **no net current** from E×B
  alone, and the whole plasma moves as one.
- Magnitude: `v_E = E_⊥ / B`.
- Intuition: during the half-orbit where E accelerates the particle, its
  gyroradius grows; during the decelerating half it shrinks. The mismatched
  circle radii make the orbit "walk" sideways.

> **Worked example.** E = 100 V/m, B = 0.05 T → v_E = 100/0.05 = **2000 m/s**,
> perpendicular to both E and B, same for every species.

---

## 2.3 General guiding-center drifts

Any force **F** ⊥ B produces a drift `v_F = (F × B)/(qB²)`. The important cases:

| Drift | Formula | Charge-dependent? | Cause |
|---|---|---|---|
| **E×B** | `(E×B)/B²` | No | Electric field |
| **Gravity / general force** | `(F×B)/(qB²)` | **Yes** | Any steady force |
| **Grad-B** | `v_∇B = ± ½ v_⊥ r_L (B×∇B)/B²` | **Yes** | Field strength varies ⊥ B |
| **Curvature** | `v_R = (m v_∥²/q) (R_c×B)/(R_c²B²)` | **Yes** | Field lines curved |
| **Polarization** | `v_p = (m/qB²) dE_⊥/dt` | **Yes** | Time-varying E |

The charge-dependent drifts (grad-B, curvature, gravity) push ions and
electrons in **opposite** directions → they drive **currents** and **charge
separation**, which is the seed of many instabilities (e.g., the
gravitational/Rayleigh–Taylor and curvature-driven instabilities in fusion
devices). This is precisely why a simple toroidal field alone cannot confine a
plasma — the grad-B and curvature drifts separate charges, build up an E field,
and the resulting E×B drift throws the plasma to the wall. The fix (twisting the
field into a helix, as in a **tokamak** or **stellarator**) short-circuits that
charge buildup.

---

## 2.4 Magnetic moment and adiabatic invariance

A gyrating particle is a tiny current loop with **magnetic moment**:

```
µ = m v_⊥² / (2B)
```

When B changes *slowly* compared to a gyro-orbit (in space or time), µ is an
**adiabatic invariant** — approximately constant. This single fact powers
magnetic confinement.

---

## 2.5 Magnetic mirrors

Because µ = m v_⊥²/2B is conserved, as a particle moves into a region of
**stronger** B, v_⊥² must grow to keep µ fixed. But total kinetic energy
(½m(v_∥²+v_⊥²)) is also conserved (no work by B). So v_⊥ grows at the expense of
v_∥ — the particle slows along the field and can be **reflected**: a *magnetic
mirror*.

**Loss cone.** A particle is reflected only if its pitch angle is large enough.
With mirror ratio `R_m = B_max / B_min`, particles are confined unless

```
sin²θ < 1 / R_m        →   they're in the "loss cone" and escape.
```

Mirror machines therefore always leak particles whose velocity is too aligned
with B. The same physics traps particles in Earth's **Van Allen belts** and
produces the **aurora** (particles in the loss cone precipitate into the
atmosphere).

> **Worked example.** Mirror ratio R_m = 4. Confined particles need
> sin²θ ≥ 1/4 → sinθ ≥ 0.5 → **θ ≥ 30°**. Anything with pitch angle < 30°
> (well-aligned with B) escapes out the ends.

---

## 2.6 When does the single-particle picture break?

It's valid when:
- The particle's self-field ≪ applied fields (low density / strong drive).
- Collisions are rare over the time of interest (ω_c ≫ ν for magnetized
  behavior).
- Fields vary slowly vs. a gyro-orbit (for adiabatic invariants).

When these fail, you need the **fluid (MHD)** or **kinetic** descriptions — but
the drifts above still appear inside those theories as guiding-center motion.

---

## Quick self-check

1. Why does the E×B drift carry no net current while the grad-B drift does?
   *(E×B is charge-independent; grad-B reverses with charge sign.)*
2. A 1 keV proton in B = 1 T: find r_L. *(v_⊥=√(2·1000·1.6e-19/1.67e-27)≈4.4×10⁵
   m/s; r_L = m v_⊥/qB ≈ 1.67e-27·4.4e5/(1.6e-19·1) ≈ 4.6×10⁻³ m ≈ 4.6 mm.)*
3. Why can't a purely toroidal magnetic field confine a plasma?
   *(Grad-B + curvature drifts separate charges → vertical E → E×B drift to the
   wall. Need rotational transform / poloidal field.)*
