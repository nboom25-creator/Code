# PartForge AI — REST API

Base path: `/api/v1`. Interactive OpenAPI docs: `http://localhost:8000/docs` (auto-generated).
All responses are JSON unless noted. Errors use FastAPI's `{"detail": "..."}` shape with
actionable messages; 409 means a workflow precondition is unmet (e.g. units not confirmed).

## Capabilities
- `GET /capabilities` — solver availability (`fea_available`, `ccx_available`, `gmsh_available`),
  limits, AI provider, STEP-export policy. The UI must consult this instead of assuming features.

## Projects & units
- `POST /projects` `{name, description}` / `GET /projects` / `GET|PATCH|DELETE /projects/{id}`
- `POST /projects/{id}/unit` `{unit: mm|cm|m|in}` — explicit confirmation; nothing is analyzed in SI before this.
- `GET /projects/{id}/unit/suggestion` — bbox-based estimate, labeled as an estimate.

## Upload & meshes
- `POST /projects/{id}/upload` (multipart `file`) — binary/ASCII STL, OBJ, 3MF. Content-validated,
  size/triangle limits enforced. Returns asset + created `mesh_version` + unit suggestion.
  The uploaded bytes are stored verbatim and never modified.
- `GET /projects/{id}/meshes` — version tree (kind: original|repaired|variant, parent ids, checksums).
- `GET /meshes/{id}` / `GET /meshes/{id}/file` (binary STL) 
- `GET /meshes/{id}/scalars?field=thickness|overhang|sharpness` — per-vertex heat-map scalars
  (requires geometry analysis).

## Repair (non-destructive)
- `POST /meshes/{id}/repair/preview` `{operations: [...]}` — before/after health counts, no changes.
- `POST /meshes/{id}/repair/commit` — same ops; creates a NEW mesh version.
  Operations: `remove_duplicate_faces, remove_degenerate_faces, merge_vertices, fix_winding,
  fix_normals, fill_holes, remove_small_components, watertight_reconstruction`.

## Materials, manufacturing, use case
- `GET /materials` / `POST /materials` (user-defined; SI units)
- `PUT /projects/{id}/material` `{material_id, overrides, confirmed}` — critical properties must be
  confirmed before FEA reports a factor of safety.
- `GET /projects/{id}/material` — includes `effective_properties` with an `_adjustments` audit list
  (overrides, printed-part strength knockdowns).
- `PUT|GET /projects/{id}/manufacturing` `{method: fdm|sla|sls|cnc|casting|sheet|unspecified, params}` —
  FDM params: `layer_height_mm, infill_pct, infill_pattern, wall_count, nozzle_diameter_mm,
  build_direction, annealed, layer_adhesion_factor, treat_isotropic`.
- `GET /presets` — intended-use presets + questionnaire schema. Presets never create loads.
- `PUT|GET /projects/{id}/usecase` `{preset, free_text, answers}`.

## Regions & protection
- `POST /projects/{id}/regions` `{mesh_version_id, name, triangle_indices, kind, meta, color}`
- `GET /projects/{id}/regions?mesh_version_id=` / `DELETE /regions/{id}`
- `POST /regions/{id}/protect` `{reason}` / `DELETE /regions/{id}/protect` — protected regions are
  enforced by variant generation (operations that move them are rejected).

## Load cases & boundary conditions
- `POST /projects/{id}/loadcases` / `GET /projects/{id}/loadcases` / `DELETE /loadcases/{id}`
- `POST /loadcases/{id}/bcs` — body:
  `{bc_type, region_id, description, magnitude, units, direction, axis_point, axis_direction, rpm, g}`.
  Types: `fixed, pinned, roller, force, pressure, bearing, torque, gravity, rotation, symmetry`.
  Units are converted to SI server-side (force N/kN/lbf/kgf; pressure Pa/kPa/MPa/psi/bar;
  torque Nm/Nmm/lbf·ft/lbf·in). Bare numbers without units are rejected.
- `DELETE /bcs/{id}` ; `POST /loadcases/{id}/validate` — support/load sanity checks incl.
  rigid-body-motion detection.

## Analysis
- `POST /projects/{id}/analyze/geometry` `{mesh_version_id}` → job (Tier A, always available)
- `GET /meshes/{id}/analysis` — metrics, health, thickness stats, overhang, features, warnings.
- `POST /projects/{id}/analyze/fea` `{mesh_version_id, load_case_id, display_mesh_id?, settings?}` → job.
  Preconditions (409 otherwise): units confirmed, material confirmed, mesh watertight, load case valid,
  Gmsh + CalculiX installed (503 with explanation if not — no mock results outside demo mode).

## Jobs
- `GET /projects/{id}/jobs` / `GET /jobs/{id}` / `POST /jobs/{id}/cancel`
- `GET /jobs/{id}/events` — Server-Sent Events stream of job state (progress is real stage progress).

## Results
- `GET /projects/{id}/results` / `GET /results/{id}` — summary: max/p95/p99 von Mises, principal
  stresses, max displacement + location, reactions, mesh quality, element counts,
  `factor_of_safety_yield`, `fos_valid` + `validity_gates` (convergence, mesh quality,
  displacement plausibility, singularity detection), assumptions list.
- `GET /results/{id}/fields` — FEA surface mesh + per-node displacement/von Mises/principal stresses
  for browser visualization (positions in mesh units, displacement in metres).
- `GET /results/{id}/deck` (CalculiX .inp) / `GET /results/{id}/log` (solver log)

## Recommendations
- `POST /projects/{id}/recommendations/generate` `{mesh_version_id}` (requires geometry analysis)
- `GET /projects/{id}/recommendations?mesh_version_id=` — each has rule_id, severity, confidence,
  problem, evidence, location (centroid + triangle indices), rationale, proposed change,
  expected benefit, downside, manufacturing impact, validation required, auto_generatable, assumptions.
- `PATCH /recommendations/{id}` `{state: open|accepted|dismissed}`

## Variants & comparison
- `POST /projects/{id}/variants/generate` `{base_mesh_id, strategies, recommendation_ids?}` → job.
  Strategies: conservative | balanced | performance. Each variant re-runs geometry checks and,
  when a valid load case + solver exist, the same FEA load case.
- `GET /projects/{id}/variants` / `GET /variants/{id}` (operation list with per-op status/errors)
- `POST /variants/{id}/approval` `{approval}` ; `GET /variants/{id}/recipe` — JSON modification recipe.
- `GET /projects/{id}/comparison?baseline_mesh_id=` — metric table + deltas + evidence-based score
  with an explicit `score_explanation`.

## Reports & export
- `POST /projects/{id}/report` → job; `GET /projects/{id}/reports`; `GET /reports/{id}/file` (PDF)
- `POST /projects/{id}/snapshots` (multipart PNG + label) — viewport screenshots embedded in reports.
- `GET /projects/{id}/archive` — ZIP (manifest, all mesh versions, reports).

## AI (optional, provider-gated)
- `POST /projects/{id}/ai/explain` `{mesh_version_id}` — provider re-presents deterministic findings.
- `POST /projects/{id}/ai/propose-loadcase` `{text}` — returns a schema-validated DRAFT; the user
  must map regions and confirm before anything is applied. Providers never invent numbers.

## Demo
- `POST /demo` — creates the seeded demo bracket project (runs analysis; FEA/variants as jobs).
