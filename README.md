# Intro to Plasma Engineering — Study Guide

A structured study guide for the core concepts of an introductory plasma
engineering / plasma physics course. Each chapter explains the *intuition*,
states the *key equations*, and works through *numerical examples* so you can
both understand and compute.

> **What is a plasma?** A quasineutral gas of charged particles (and usually
> neutrals) that exhibits *collective behavior*. "Quasineutral" means it looks
> electrically neutral on large scales (n_e ≈ Z·n_i) but supports strong local
> fields. "Collective behavior" means particles interact through long-range
> electromagnetic forces with many neighbors at once, not just through
> billiard-ball collisions. Plasma is often called the *fourth state of matter*
> and makes up ~99% of the visible universe.

## How to use this guide

1. Start with **[Chapter 1 — Fundamental Parameters](01_fundamental_parameters.md)**.
   Everything else builds on the Debye length, plasma frequency, and the
   plasma criteria.
2. Move to **[Chapter 2 — Single-Particle Motion](02_single_particle_motion.md)**
   to see how individual charges move in E and B fields (drifts, gyration,
   mirrors).
3. Then **[Chapter 3 — Waves & Collisions](03_waves_and_collisions.md)** for
   collective oscillations, collision rates, transport, and sheaths.
4. Finish with **[Chapter 4 — Applications](04_applications.md)**: fusion,
   plasma processing, propulsion, and diagnostics.
5. Keep the **[Equation & Constants Cheat Sheet](cheat_sheet.md)** open during
   problem sets and exams.

## The four pillars (and why they matter)

| Pillar | Core question it answers | Where it shows up |
|---|---|---|
| **Fundamental parameters** | Is this even a plasma, and on what scales does it shield/oscillate? | Every problem starts here |
| **Single-particle motion** | How does one charge move in given E and B? | Confinement, drifts, diagnostics |
| **Waves & collisions** | How does the plasma respond *collectively*, and how does it relax? | Heating, transport, diagnostics |
| **Applications** | How is all of this engineered into useful devices? | Fusion, chip fab, thrusters |

## A note on units

Plasma physics mixes SI and "practical" units freely. The dangerous one is
**temperature**: it is almost always quoted as an *energy* in **electron-volts
(eV)**, where `T[eV] = k_B·T / e`. So "a 2 eV plasma" means
k_B·T = 2 eV ≈ 3.2×10⁻¹⁹ J, corresponding to T ≈ 23,200 K. When a formula has
k_B·T in it, just substitute the energy in joules (multiply eV by 1.602×10⁻¹⁹).

Unless noted, this guide uses **SI units**.
