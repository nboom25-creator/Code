# Equation & Constants Cheat Sheet

Keep this open during problem sets and exams. SI units unless noted; temperature
energies in eV where flagged.

---

## Physical constants

| Symbol | Quantity | Value |
|---|---|---|
| e | elementary charge | 1.602×10⁻¹⁹ C |
| m_e | electron mass | 9.109×10⁻³¹ kg |
| m_p | proton mass | 1.673×10⁻²⁷ kg |
| ε₀ | vacuum permittivity | 8.854×10⁻¹² F/m |
| µ₀ | vacuum permeability | 1.257×10⁻⁶ H/m |
| k_B | Boltzmann constant | 1.381×10⁻²³ J/K |
| c | speed of light | 2.998×10⁸ m/s |
| — | 1 eV (energy) | 1.602×10⁻¹⁹ J |
| — | 1 eV (temperature) | 11,605 K |
| — | m_p / m_e | 1836 |
| — | 1 amu | 1.661×10⁻²⁷ kg |

---

## Fundamental parameters (Ch. 1)

| Quantity | Formula | Practical form |
|---|---|---|
| Debye length | λ_D = √(ε₀ k_B T_e / n_e e²) | ≈ 7430·√(T_e[eV]/n_e[m⁻³]) m |
| Electron plasma freq | ω_pe = √(n_e e²/ε₀ m_e) | f_pe ≈ 8.98·√(n_e[m⁻³]) Hz |
| Ion plasma freq | ω_pi = √(n_i Z²e²/ε₀ m_i) | — |
| # in Debye sphere | N_D = n·(4/3)π λ_D³ | need ≫ 1 |
| Critical density | n_c = ε₀ m_e ω²/e² | cutoff for frequency ω |
| Thermal speed | v_th = √(k_B T/m) | (√2 variant common) |
| Ionization (Saha) | n_e n_i/n_n ∝ T^{3/2} e^{−U_i/k_B T} | equilibrium only |

**Plasma criteria:** λ_D ≪ L,  N_D ≫ 1,  ω_pe τ > 1.

---

## Single-particle motion (Ch. 2)

| Quantity | Formula | Notes |
|---|---|---|
| Lorentz force | m dv/dt = q(E + v×B) | the master equation |
| Gyrofrequency | ω_c = |q|B/m | f_ce ≈ 28·B[T] GHz |
| Larmor radius | r_L = m v_⊥/|q|B = v_⊥/ω_c | electrons ≪ ions |
| **E×B drift** | v_E = (E×B)/B² | charge/mass independent |
| Force drift | v_F = (F×B)/qB² | charge-dependent |
| Grad-B drift | v_∇B = ±½ v_⊥ r_L (B×∇B)/B² | charge-dependent |
| Curvature drift | v_R = (m v_∥²/q)(R_c×B)/R_c²B² | charge-dependent |
| Magnetic moment | µ = m v_⊥²/2B | adiabatic invariant |
| Mirror loss cone | sin²θ < 1/R_m → escapes | R_m = B_max/B_min |

---

## Waves & collisions (Ch. 3)

| Quantity | Formula | Notes |
|---|---|---|
| Langmuir (Bohm–Gross) | ω² = ω_pe² + 3k²v_th,e² | electron oscillation |
| Ion sound speed | c_s = √(k_B T_e/m_i) | T_e ≫ T_i |
| EM wave (unmag.) | ω² = ω_pe² + c²k² | cutoff at ω_pe |
| Alfvén speed | v_A = B/√(µ₀ n_i m_i) | MHD waves |
| Collision freq | ν ∝ n ln Λ / T^{3/2} | hotter ⇒ fewer |
| Spitzer resistivity | η ∝ ln Λ / T_e^{3/2} | density-independent |
| Mean free path | λ_mfp = v_th/ν | vs L → fluid/kinetic |
| Cross-B diffusion | D_⊥ ∝ ν r_L² ∝ 1/B² | classical |
| Bohm diffusion | D_B ≈ k_B T_e/16eB ∝ 1/B | anomalous |

**Sheath:** thickness ~ few λ_D; **Bohm velocity** u_B = c_s = √(k_B T_e/m_i);
floating potential V_f − V_p = −(k_B T_e/2e)·ln(m_i/2πm_e); Bohm flux
Γ ≈ 0.6 n₀ u_B.

---

## Applications (Ch. 4)

| Quantity | Formula | Notes |
|---|---|---|
| D–T reaction | D+T → ⁴He(3.5 MeV) + n(14.1 MeV) | main fusion fuel |
| Lawson triple product | n T τ_E ≳ 3×10²¹ keV·s·m⁻³ | D–T ignition |
| Rocket equation | Δv = v_ex ln(m₀/m_f) | why high I_sp wins |
| Specific impulse | I_sp = v_ex/g₀ | exhaust speed / 9.81 |

---

## Order-of-magnitude reference plasmas

| Plasma | n_e (m⁻³) | T_e (eV) | λ_D | Notes |
|---|---|---|---|---|
| Interstellar | 10⁶ | ~1 | ~m | extremely diffuse |
| Ionosphere | 10¹¹–10¹² | ~0.1 | mm–cm | reflects radio |
| Glow discharge / processing | 10¹⁵–10¹⁸ | 1–5 | 10–100 µm | non-equilibrium |
| Tokamak core | 10²⁰ | 10⁴ (10 keV) | ~10s µm | fusion-grade |
| Inertial (compressed) | 10³¹ | 10⁴ | sub-nm | huge density |

---

### Common mistakes to avoid

- **Forgetting eV → J.** When a formula has k_B T, plug in joules
  (T[eV]×1.602×10⁻¹⁹), not the eV number or kelvin.
- **Mixing T_e and T_i.** Many lab plasmas have T_e ≫ T_i — use the right one
  (e.g. c_s and λ_D use **T_e**).
- **Using m_e where m_i belongs** (ion sound speed, Bohm velocity, ion plasma
  frequency all use the **ion** mass).
- **Assuming Saha applies** to non-equilibrium discharges — it doesn't; those
  are ionized by energetic electrons.
- **Density units.** The 8.98 and 7430 prefactors assume **m⁻³**. Watch for
  cm⁻³ in textbooks (factor of 10⁶).
