# Chapter 1 — Fundamental Plasma Parameters

These are the quantities you compute *first* for any plasma. They tell you the
length scales, time scales, and whether your ionized gas qualifies as a plasma
at all.

---

## 1.1 Temperature as energy

In a plasma in thermal equilibrium, particles follow a **Maxwell–Boltzmann**
speed distribution. The temperature is a measure of the average kinetic energy:

```
<½ m v²> = (3/2) k_B T        (3D, average kinetic energy)
```

- Quoted in **eV**: `T[eV] = k_B T / e`.  1 eV ⇔ 11,605 K.
- Electrons and ions can have **different** temperatures (T_e ≠ T_i). This is
  extremely common in lab plasmas: electrons are light and heat up fast, ions
  stay cold. Such a plasma is *not* in full thermal equilibrium.

**Thermal speed** (a common convention; definitions vary by a factor of √2):

```
v_th = sqrt(k_B T / m)        or sometimes sqrt(2 k_B T / m)
```

Because electrons are ~1836× lighter than protons, they move ~√1836 ≈ 43×
faster at the same temperature. This asymmetry drives much of plasma behavior
(sheaths, shielding speed, etc.).

---

## 1.2 Debye length λ_D — the shielding scale

Drop a test charge into a plasma. Mobile electrons rearrange to "screen" it, so
its potential decays *exponentially* instead of as 1/r. The screening distance
is the **Debye length**:

```
λ_D = sqrt( ε₀ k_B T_e / (n_e e²) )
```

Handy practical form (T_e in eV, n_e in m⁻³):

```
λ_D ≈ 7430 · sqrt( T_e[eV] / n_e[m⁻³] )   meters
```

**Physical meaning**

- Beyond ~λ_D, the plasma is effectively neutral; fields are screened.
- Quasineutrality holds for system sizes **L ≫ λ_D**.
- A *shielded* (Debye–Hückel) potential: `φ(r) = (q/4πε₀ r)·exp(−r/λ_D)`.

> **Worked example.** A processing plasma: T_e = 3 eV, n_e = 1×10¹⁷ m⁻³.
> λ_D ≈ 7430·√(3 / 1e17) = 7430·√(3e-17) ≈ 7430·5.48×10⁻⁹ ≈ **4.1×10⁻⁵ m
> ≈ 41 µm**. A 10 cm chamber is ~2400 Debye lengths wide → very well
> quasineutral.

---

## 1.3 Plasma frequency ω_pe — the oscillation scale

Displace the electrons relative to the ions and the restoring electric field
makes them oscillate. The natural (angular) frequency is the **electron plasma
frequency**:

```
ω_pe = sqrt( n_e e² / (ε₀ m_e) )        [rad/s]
```

Practical form:

```
f_pe = ω_pe / 2π ≈ 8.98 · sqrt( n_e[m⁻³] )   Hz
       ≈ 9000 · sqrt( n_e[cm⁻³] )            Hz
```

There is an analogous, much lower **ion plasma frequency** ω_pi (replace m_e
with the ion mass, e with Ze).

**Why it matters**

- It's the fastest natural electrostatic response time of the plasma.
- **EM-wave cutoff:** waves below f_pe cannot propagate — they're reflected.
  This is why the ionosphere reflects AM radio and why there is a *critical
  density* `n_c` for a given laser/RF frequency:
  `n_c = ε₀ m_e ω² / e²`.

> **Worked example.** n_e = 1×10¹⁸ m⁻³ → f_pe ≈ 8.98×√1e18 ≈ 8.98×10⁹ ≈
> **9 GHz**. Microwaves below 9 GHz are reflected by this plasma.

---

## 1.4 The plasma parameter Λ and the coupling parameter

The number of particles inside a **Debye sphere**:

```
N_D = n · (4/3) π λ_D³
```

The dimensionless **plasma parameter** is `Λ = n λ_D³` (sometimes 4π/3 times
this). For *collective behavior to dominate over individual collisions*, you
need **many** particles per Debye sphere:

```
N_D ≫ 1   ⇔   weakly coupled, "ideal" plasma
```

The inverse ~1/N_D is the **coupling parameter** Γ. Most lab and space plasmas
are weakly coupled (N_D ranges from ~10² to ~10¹⁰). Strongly coupled plasmas
(Γ ≳ 1: white dwarf interiors, ultracold plasmas) behave more like liquids.

---

## 1.5 The three plasma criteria

An ionized gas is a **plasma** only if all three hold:

1. **λ_D ≪ L** — system much larger than the shielding length (quasineutral).
2. **N_D ≫ 1** — many particles per Debye sphere (collective, not collisional).
3. **ω_pe·τ > 1** — plasma oscillations faster than the electron–neutral
   collision time τ (so electromagnetic forces, not neutral collisions, govern
   dynamics). Equivalently ω_pe > ν_collision.

If any fails, you have a (partially) ionized gas but not a plasma in the useful
sense.

---

## 1.6 Degree of ionization & the Saha equation

Most engineering plasmas are **partially ionized**. The fractional ionization

```
α = n_i / (n_i + n_n)
```

ranges from ~10⁻⁶ (flames, glow discharges) to ~1 (fusion, fully ionized).

In **thermal equilibrium**, the ionization fraction follows the **Saha
equation**:

```
n_i n_e / n_n ≈ 2.4×10²¹ · (T^{3/2} / n_i) · exp(−U_i / k_B T)
```

(T in K, densities in m⁻³, U_i = ionization energy). The key takeaway: because
of the exponential, ionization rises *steeply* once k_B T approaches a
meaningful fraction of U_i — but note U_i (e.g. 13.6 eV for H) is usually
*several times larger* than k_B T, so even "hot" plasmas can be only weakly
ionized in equilibrium. Many lab plasmas are *not* in equilibrium and are
ionized by energetic electrons instead.

---

## 1.7 Magnetization parameters (preview of Ch. 2)

When a B-field is present, two more scales appear:

- **Gyrofrequency (cyclotron):** `ω_c = |q| B / m`
- **Larmor radius (gyroradius):** `r_L = m v_⊥ / (|q| B) = v_⊥ / ω_c`

A species is **magnetized** if its gyroradius is small compared to the system
(r_L ≪ L) and it completes many orbits between collisions (ω_c ≫ ν). Electrons
magnetize far more easily than ions because of their small mass. See Chapter 2.

---

## Quick self-check

1. Why does a plasma shield a test charge over λ_D rather than letting its field
   extend to infinity?
2. A plasma has n_e = 1×10¹⁶ m⁻³, T_e = 2 eV. Find λ_D and f_pe.
   *(Answers: λ_D ≈ 7430·√(2/1e16) ≈ 1.05×10⁻⁴ m ≈ 105 µm;
   f_pe ≈ 8.98×√1e16 ≈ 0.90 GHz.)*
3. Which of the three plasma criteria is most likely to fail in a dense, cold,
   weakly ionized gas? *(Hint: collisions — criterion 3.)*
