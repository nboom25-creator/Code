# Chapter 3 — Waves & Collisions

This chapter covers the plasma's **collective** dynamics (waves and
oscillations) and its **dissipative** dynamics (collisions, transport, and the
sheaths that form at boundaries). Together they govern how energy is coupled
in, how the plasma relaxes, and how it talks to surfaces.

---

## 3.1 Reading a dispersion relation

A wave is written `exp[i(k·x − ωt)]`. A **dispersion relation** ω(k) tells you:

- **Phase velocity** `v_φ = ω/k` (speed of crests).
- **Group velocity** `v_g = dω/dk` (speed of energy/information).
- **Cutoff:** k → 0 at finite ω → wave reflected/evanescent below that ω.
- **Resonance:** k → ∞ at finite ω → wave absorbed; energy dumped into plasma.

Cutoffs and resonances are *the* engineering hooks for heating and diagnostics.

---

## 3.2 Electrostatic waves

**(a) Langmuir waves (electron plasma oscillations).** Electrons oscillate
against the ion background. With finite temperature (the **Bohm–Gross**
relation):

```
ω² = ω_pe² + 3 k² v_th,e²        (v_th,e² = k_B T_e/m_e)
```

At long wavelength it's just ω ≈ ω_pe — a near-fixed frequency set by density,
which is the basis of density diagnostics.

**(b) Ion-acoustic waves.** The plasma analog of sound, restored by electron
pressure but carrying ion inertia. For T_e ≫ T_i:

```
ω/k = c_s = sqrt( k_B T_e / m_i )      (ion sound speed)
```

c_s is one of the most-used quantities in plasma processing (it sets the **Bohm
velocity** at sheath edges — see §3.7). Note electrons set the "stiffness," ions
set the "mass."

> **Worked example.** Argon (m_i ≈ 40 amu = 6.6×10⁻²⁶ kg), T_e = 3 eV.
> c_s = √(3·1.6e-19 / 6.6e-26) ≈ √(7.3×10⁶) ≈ **2.7×10³ m/s**.

---

## 3.3 Electromagnetic waves in unmagnetized plasma

For light waves crossing a plasma:

```
ω² = ω_pe² + c² k²
```

- **Below ω_pe:** k² < 0 → evanescent → **reflected** (radio off the
  ionosphere, microwave cutoff in dense plasmas).
- **Above ω_pe:** propagates, but with v_φ > c and v_g < c.
- The **critical density** for frequency ω: `n_c = ε₀ m_e ω²/e²`. Laser–plasma
  interaction is largely organized around where the beam hits n_c.

---

## 3.4 Waves in magnetized plasma (overview)

A magnetic field makes the plasma **anisotropic** and produces a rich zoo of
waves. You don't need all the algebra in an intro course, but recognize:

| Wave | Regime | Engineering use |
|---|---|---|
| **Alfvén wave** | low-freq, along B; `v_A = B/√(µ₀ ρ)` | MHD dynamics, solar/space, heating |
| **Electron cyclotron (ECR)** | ω ≈ ω_ce | ECR ion/plasma sources, ECRH heating |
| **Ion cyclotron (ICR/ICRH)** | ω ≈ ω_ci | fusion ion heating, mass spectrometry |
| **Lower/upper hybrid** | hybrid resonances | current drive, heating |
| **Whistler / helicon** | bounded by ω_ce | helicon plasma sources, propulsion |

The **Alfvén speed** `v_A = B/√(µ₀ n_i m_i)` is the magnetic analog of the
sound speed and the natural speed of MHD disturbances.

---

## 3.5 Collisions in plasmas

Charged particles interact via the long-range Coulomb force, so a "collision" is
really the cumulative effect of **many small-angle deflections**, not one hard
hit. That cumulative effect is captured by the **Coulomb logarithm** ln Λ
(typically 10–20; Λ here is the plasma parameter from Ch. 1).

Key scalings (memorize the *trends*, look up the constants):

```
Collision frequency:  ν ∝ n · ln Λ / T^{3/2}        (electron-ion)
Resistivity (Spitzer): η ∝ ln Λ / T_e^{3/2}         (independent of density!)
```

**Counter-intuitive but crucial:** hotter plasmas are *less* collisional and
*better* conductors. Spitzer resistivity falls as T^{−3/2}, so a fusion-grade
plasma is an extraordinarily good conductor — which is exactly why ohmic
heating alone can't reach ignition temperatures (the plasma stops resisting the
current).

**Mean free path** λ_mfp = v_th / ν. Compare it to system size L:
- λ_mfp ≪ L → **collisional / fluid** regime (use MHD, transport coefficients).
- λ_mfp ≫ L → **collisionless / kinetic** regime (use Vlasov, single-particle).

---

## 3.6 Transport: diffusion and conductivity

Collisions drive **diffusion** of particles and heat down gradients.

- **Unmagnetized / along B:** classical diffusion, `D ∝ ν / ...` familiar
  random-walk with step ~λ_mfp.
- **Across B:** the random-walk step becomes the **gyroradius r_L**, not the
  mean free path. Classical cross-field diffusion scales as
  `D_⊥ ∝ ν r_L² ∝ 1/B²` — a strong B field strongly suppresses cross-field
  transport (the basis of magnetic confinement).
- Real devices usually see **anomalous (turbulent) transport** far larger than
  classical — e.g. **Bohm diffusion**, `D_Bohm ≈ (1/16) k_B T_e/(eB)`, scaling
  as 1/B rather than 1/B². Taming turbulent transport is a central challenge in
  fusion.

**Ambipolar diffusion.** Electrons want to diffuse out faster than ions, but the
resulting charge separation creates an E field that *retards* electrons and
*pulls* ions along, so they leave together at a common (ambipolar) rate. This is
why bulk plasma stays quasineutral as it decays.

---

## 3.7 Sheaths — the plasma–wall interface

Where a plasma meets a wall, the fast electrons hit the surface first, charging
it **negative**. A thin, ion-rich, non-neutral layer — the **sheath** — forms
and self-adjusts so that electron and ion losses balance. Sheaths are
*everywhere* in plasma engineering (probes, etching, wall erosion).

Key results:

- **Sheath thickness** ~ a few **Debye lengths** λ_D.
- **Bohm criterion:** ions must enter the sheath at *at least* the ion sound
  speed:
  ```
  u_i ≥ u_B = c_s = sqrt( k_B T_e / m_i )      (Bohm velocity)
  ```
- A **presheath** (a weak, quasineutral field region) accelerates ions up to
  u_B before they enter the sheath proper.
- **Floating potential.** An electrically isolated surface charges until net
  current = 0. Relative to the plasma potential:
  ```
  V_f − V_p = −(k_B T_e / 2e) · ln( m_i / (2π m_e) )
  ```
  i.e. a few × T_e *negative*. (For hydrogen, ~−2.8 T_e; for argon, ~−4.7 T_e.)
- **Bohm flux** to a surface: `Γ_i ≈ 0.6 · n_0 · u_B` (the 0.6 ≈ e^{−1/2}
  accounts for the density drop across the presheath).

> **Why engineers care.** In plasma etching, ions cross the sheath and strike
> the wafer nearly *perpendicularly* (the sheath E field is normal to the
> surface), giving **anisotropic** (directional) etching — the entire basis of
> fabricating vertical features on a chip. Sheath voltage ⇒ ion bombardment
> energy ⇒ etch/sputter behavior.

---

## 3.8 Landau damping (a heads-up)

Even *without* collisions, a wave can lose energy to particles moving near its
phase velocity — **Landau damping**. It's a purely kinetic effect (no
dissipation in the fluid picture) and is a favorite "wow" topic. Intuition:
particles slightly slower than the wave get accelerated (take energy from it);
those slightly faster give energy to it; in a Maxwellian there are always more
slow ones, so the wave **damps** on average.

---

## Quick self-check

1. Why does plasma resistivity *decrease* with temperature, unlike a metal?
   *(Coulomb collision frequency ∝ T^{−3/2}; fewer effective collisions when
   hot.)*
2. Argon plasma, T_e = 4 eV: find the Bohm velocity. *(u_B = √(4·1.6e-19 /
   6.6e-26) ≈ 3.1×10³ m/s.)*
3. Why is etching anisotropic but chemical (wet) etching isotropic?
   *(Sheath E field accelerates ions normal to the wafer → directional
   bombardment; neutral chemistry has no preferred direction.)*
4. A wave has frequency below ω_pe in an unmagnetized plasma. Does it propagate?
   *(No — it's below cutoff, so it's reflected/evanescent.)*
