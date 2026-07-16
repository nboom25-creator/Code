# FEA: assumptions, limitations, verification

## What runs

Preliminary **linear static structural** analysis:

1. The (watertight) surface mesh is volume-meshed with Gmsh into second-order tetrahedra (C3D10 by
   default; C3D4 optional). Surface classification falls back through finer angles and finally
   reparametrization; element size targets a configurable element count.
2. User-selected surface regions are mapped to solver node sets by proximity; distributed loads are
   area-weighted over the mapped nodes.
3. A CalculiX input deck is generated in SI units (geometry scaled by the confirmed unit).
4. `ccx` runs as a sandboxed subprocess (argv array, CPU/memory rlimits, timeout).
5. Displacements, stresses and strains are parsed from the FRD file; reactions from the DAT file;
   von Mises and principal stresses computed per node.

## Modeling assumptions (recorded with every result)

- Small displacements, linear-elastic **isotropic** material, no contact, no thermal loading.
- With solid elements, *pinned* equals *fixed* (no rotational DOFs) — stated in the assumptions.
- Roller/symmetry supports are limited to the global X/Y/Z axes.
- Forces are equivalent (not consistent) nodal loads, area-weighted; pressure is applied as nodal
  forces along inward surface normals; torque as a statically-equivalent tangential force couple;
  bearing loads are approximated as area-weighted distributed force (no cosine distribution).
- Printed polymers: strengths can be derated by the user's layer-adhesion factor (worst-case Z);
  the solver itself remains isotropic — a stated approximation, opt-in.

## Validity gates — when a factor of safety is (not) reported as valid

`fos_valid` requires ALL of:

- solver converged with no errors;
- acceptable element quality (≤5% of elements with minSICN < 0.1, no inverted elements);
- plausible displacement (max < 10% of the bounding diagonal — larger indicates missing
  constraints or violated small-displacement assumptions);
- **no dominant stress singularity**: if max von Mises > 3× the 99th percentile, the peak is
  flagged as a suspected singularity (sharp re-entrant corner / point constraint). Peak values at
  singularities do not converge with mesh refinement, so the raw-peak FoS is marked
  reference-only and a p95-based FoS is reported alongside.

Additional hard blocks upstream: units unconfirmed, material unconfirmed, mesh not watertight,
invalid load case (no support, no load, insufficient roller directions → rigid-body motion),
missing elastic properties. Missing yield strength ⇒ no FoS at all, with the reason stated.

In demo/development mode a clearly-labeled mock result can exist only if seeded explicitly;
`production` environment never returns mock analysis, and the API returns 503 with an explanation
when the solver is absent.

## Verification against analytical cases (automated tests)

| Case | Analytical value | Assertion |
|---|---|---|
| Axial bar 10×10×100 mm, 1000 N | σ = F/A = 10 MPa; δ = FL/AE = 14.51 µm | mid-length mean σvM within 10%; loaded-end axial displacement within 15%; reactions match applied load to 0.1% |
| Cantilever 10×10×100 mm, 100 N tip | δ = FL³/3EI + shear ≈ 0.206 mm; σ(L/2) = 30 MPa | tip displacement within 15%; mid-length surface stress within 20% |
| Unconstrained model | — | refused with an explanatory error, no result produced |

Tolerances are deliberately wide because the FE model includes real effects the hand formulas
ignore (Poisson restraint at fixed ends, shear deformation, corner singularities). See
`backend/tests/test_fea_analytical.py`.

## Known limitations

No buckling, modal, fatigue, nonlinear material, large displacement, contact, or thermal analysis.
Stress at re-entrant corners is mesh-dependent (flagged, not resolved). Region mapping is
proximity-based: re-select regions after significant re-meshing. These are product-level honesty
requirements, not TODOs: the UI states them wherever relevant.
