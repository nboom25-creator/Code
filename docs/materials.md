# Material data

## Policy

The built-in catalog (`backend/app/services/materials_seed.py`) contains **representative,
room-temperature values** compiled from public datasheets and engineering handbooks (MMPDS-style
typical values for metals, generic-filament datasheets for printed polymers). Real properties vary
by supplier, grade, heat treatment, and — decisively for printed parts — process parameters.

Consequences enforced by the application:

- Every material view is labeled "representative values — estimates".
- FEA will not run until the user **confirms** (or overrides) the critical properties:
  density, elastic modulus, Poisson ratio, yield strength.
- User overrides are stored per-project (`MaterialOverride`) and echoed in the report's
  assumptions, alongside any printed-part knockdown that was applied.

## Printed polymers and anisotropy

FDM/SLA/SLS materials are flagged non-isotropic in the catalog. The linear-static solver is
isotropic, so PartForge handles anisotropy at the *strength* level, not the stiffness level:

- The manufacturing profile asks for printer/process, layer height, infill, walls, nozzle,
  orientation, annealing, and an expected **layer-adhesion factor** (Z-strength / XY-strength).
- If given, yield and ultimate strengths are multiplied by that factor (worst-case direction) and
  the adjustment is recorded verbatim in `effective_properties._adjustments`.
- If not given, strengths are NOT silently derated — instead a written warning states that
  Z-direction strength may be substantially lower than reported.
- Treating a printed polymer as isotropic requires an explicit user opt-in (`treat_isotropic`).

## Fields per material

density (kg/m³), elastic modulus (Pa), Poisson ratio, yield strength (Pa), ultimate tensile
strength (Pa), compressive strength (Pa or null), shear strength (Pa or null), fatigue data
(text or "not available"), max recommended service temperature (°C), thermal expansion (1/K),
isotropic flag, source, notes. User-defined materials are validated (positive moduli/density,
physical Poisson range) and marked `user`.
