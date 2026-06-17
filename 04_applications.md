# Chapter 4 — Applications

This is where the physics of Chapters 1–3 turns into engineering. Each section
connects a real technology back to the parameters, drifts, waves, and sheaths
you've already learned.

---

## 4.1 Fusion energy

**The goal.** Force light nuclei together so they fuse and release energy. The
workhorse reaction is **D–T**:

```
D + T → ⁴He (3.5 MeV) + n (14.1 MeV)
```

The neutron carries 80% of the energy out to a blanket (where it breeds tritium
from lithium and deposits heat); the alpha stays and heats the plasma.

**Why it's hard.** Nuclei repel (Coulomb barrier), so you need ~10–20 keV
temperatures (100–200 million K) *and* enough density *and* enough confinement
time. This is captured by the **Lawson criterion / triple product**:

```
n · T · τ_E  ≳  ~3×10²¹  keV·s·m⁻³     (for D–T ignition)
```

where τ_E is the **energy confinement time** (how long the plasma holds its
heat). You can trade the three factors, which splits fusion into two families:

| Approach | Strategy | Example |
|---|---|---|
| **Magnetic confinement (MCF)** | Modest n, *long* τ_E (seconds) | Tokamak (ITER), stellarator (W7-X) |
| **Inertial confinement (ICF)** | Enormous n, *tiny* τ_E (ns) | Laser fusion (NIF) |

**Tokamak essentials (ties back to Ch. 2).** A pure toroidal field fails because
grad-B + curvature drifts separate charges (§2.3). The fix is a **helical**
field = toroidal (from external coils) + poloidal (from a toroidal **plasma
current**). The twist short-circuits the vertical charge separation. Heating
methods map directly to Ch. 3 waves: **ohmic** (limited by falling Spitzer
resistivity), **neutral beam injection**, and **RF** at ICRH/ECRH/lower-hybrid
resonances.

**Milestone:** In Dec 2022, NIF (ICF) achieved **scientific breakeven**
(fusion energy out > laser energy delivered to the target) for the first time.

---

## 4.2 Plasma processing (semiconductor manufacturing)

The largest *commercial* use of plasmas. Nearly every chip involves dozens of
plasma steps. These are typically **low-pressure, non-equilibrium** plasmas:
T_e ~ a few eV (hot electrons drive chemistry) but T_i ≈ T_gas ≈ room
temperature (cold ions/neutrals, so the wafer isn't cooked).

**(a) Plasma etching.** Reactive species + directional ions remove material.
- *Chemistry* (from hot electrons creating radicals) provides **selectivity**.
- *Sheath-accelerated ions* (§3.7) provide **anisotropy** — vertical sidewalls.
- The combination (ion-enhanced etching) is what makes nanometer features
  possible. **RIE** (reactive ion etching) and **DRIE** are the standard tools.

**(b) Sputtering / PVD deposition.** Energetic ions from the plasma bombard a
**target**; ejected atoms coat a substrate. **Magnetron sputtering** uses an
E×B electron trap (Ch. 2 drifts!) near the target to boost ionization and rate.

**(c) PECVD** (plasma-enhanced chemical vapor deposition). The plasma lets you
deposit films at *low* temperature because electron-impact (not heat) drives the
chemistry — essential for temperature-sensitive substrates.

**Common source types:** capacitively coupled (CCP), inductively coupled (ICP,
high density), ECR, and helicon — chosen by the density and ion-energy control
you need.

---

## 4.3 Electric (plasma) propulsion

Spacecraft thrusters that expel ionized propellant at very high exhaust speed.
Low thrust, but enormous **specific impulse (I_sp)** → far less propellant for
the same Δv. The figure of merit traces straight back to the rocket equation
(Δv = v_ex · ln(m₀/m_f)).

| Thruster | How it works | Notes |
|---|---|---|
| **Gridded ion (Kaufman)** | Ionize, then electrostatically accelerate ions through grids; neutralize downstream | Very high I_sp (~3000 s); space-charge limited |
| **Hall-effect thruster** | Radial B + axial E → **E×B** electron drift (Ch. 2!) ionizes gas; ions accelerated by the axial field | Workhorse for satellites; higher thrust density |
| **Magnetoplasmadynamic / VASIMR** | Higher power, RF-heated, magnetic nozzle | Future high-power missions |

Hall thrusters are a beautiful, direct application of the **E×B drift**: the
field geometry traps electrons in an azimuthal drift so they ionize efficiently,
while the ions (too heavy to be magnetized) are simply accelerated out.

---

## 4.4 Plasma diagnostics

How you actually *measure* the parameters from Chapter 1. Diagnostics split into
**probes** (intrusive) and **wave/optical** methods (non-intrusive).

| Diagnostic | Measures | Principle (ties to…) |
|---|---|---|
| **Langmuir probe** | n_e, T_e, V_p, EEDF | Sheath I–V curve; ion saturation = Bohm flux (§3.7) |
| **Interferometry** | line-integrated n_e | Phase shift ∝ refractive index ∝ ω_pe (Ch. 1/3) |
| **Microwave cutoff/reflectometry** | n_e | Reflection at the critical density n_c (§3.3) |
| **Thomson scattering** | n_e and T_e (local) | Laser scattering off electrons; spectral width → T_e |
| **Spectroscopy** | T, species, density | Line emission/ratios, Stark/Doppler broadening |
| **Magnetic (Mirnov) coils** | currents, MHD activity | Faraday's law |

**Langmuir probe in one breath.** Sweep a small electrode's voltage and record
current. At very negative bias you collect the **ion saturation current**
(∝ n·u_B, Ch. 3) → density. The **exponential** electron-retarding region's
slope on a semilog plot gives **T_e**. The knee marks the **plasma potential**.
It's cheap and local — and a perfect capstone, because reading it correctly
requires the sheath, Bohm criterion, and Maxwellian electrons all at once.

---

## 4.5 Other places plasmas show up

- **Lighting:** fluorescent, HID, and neon lamps are low-temperature discharges.
- **Plasma medicine & surface treatment:** cold atmospheric plasmas for
  sterilization, wound healing, and polymer activation.
- **Space & astrophysics:** the solar wind, magnetospheres, the ionosphere
  (radio propagation), stars, and accretion disks are all plasmas.
- **Arc/thermal plasmas:** welding, cutting, plasma torches, waste treatment.
- **MHD power & pumps; spacecraft re-entry blackout** (the sheath of ionized air
  reflects radio — Ch. 3 cutoff again).

---

## Quick self-check

1. State the Lawson triple product and name the three knobs. *(n·T·τ_E; density,
   temperature, energy confinement time.)*
2. Which Ch. 2 drift is the operating principle of a Hall thruster? *(E×B drift
   of the trapped electrons.)*
3. In plasma etching, what gives anisotropy and what gives selectivity?
   *(Sheath-accelerated directional ions → anisotropy; radical chemistry →
   selectivity.)*
4. From a Langmuir-probe I–V curve, how do you extract T_e and n_e?
   *(T_e from the slope of the electron-retarding region on a semilog plot; n_e
   from the ion saturation current ∝ n·u_B.)*
