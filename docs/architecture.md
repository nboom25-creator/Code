# Architecture

## Overview

```
frontend (React/TS/Three.js)  ──HTTP/SSE──▶  FastAPI backend ──▶ SQLite/PostgreSQL
                                                    │
                                        thread-pool job queue
                                                    │
                    ┌───────────────┬───────────────┼────────────────┬─────────────┐
              geometry analysis   FEA pipeline   variant generation  PDF report
              (trimesh/NumPy)   (Gmsh → CalculiX → FRD parse)  (manifold3d booleans)
```

- **backend/app/api/** — REST routers (projects/meshes, materials/use-case, loads/analysis/jobs,
  recommendations/variants/reports). OpenAPI is generated automatically at `/docs`.
- **backend/app/services/** — all deterministic engineering code:
  - `stl_io` strict upload validation; `geometry` metrics + mesh health; `thickness` ray-cast wall
    estimation; `overhang` AM checks; `features` hole/plane/symmetry candidates; `repair`
    non-destructive repair pipeline
  - `fea/` volumetric meshing (`volmesh`), region→node-set mapping (`bcs`), CalculiX deck
    generation (`deck`), sandboxed solver execution (`runner`), FRD/DAT parsing (`frd`), and the
    orchestrating `pipeline` with validity gates
  - `rules` the deterministic recommendation engine; `operations` the validated design-operation
    system; `variants` variant generation + comparison scoring
  - `ai/` the optional LLM provider layer (explanation + load-case drafting only)
  - `report` PDF generation; `render` headless software rasterizer for report images
- **backend/app/workers/** — job queue (thread pool) and job task implementations.
- **backend/app/demo/** — parametric demo bracket generator and project seeder.

## Data model

Entities (SQLAlchemy): User, Project, UploadedAsset, MeshVersion, GeometryAnalysis, Material,
MaterialOverride, UseCase, ManufacturingProfile, SelectedRegion, ProtectedRegion, LoadCase,
BoundaryCondition, SimulationJob, SimulationMesh, SimulationResult, Recommendation, DesignVariant,
DesignOperation, Comparison, Report, Snapshot, AuditEvent.

Every derived artifact carries `ArtifactMixin` provenance: parent reference, creation time,
software version, processing parameters, input checksum, output checksum, status, and error text.
Mesh versions form a tree (`parent_mesh_id`); uploads are stored byte-for-byte and never modified —
repairs and variants always create new versions.

`SimulationJob` is the generic background-job record (`kind`:
`geometry_analysis | fea | variant_generation | report`) with real progress, message, cancellation
flag, and timing. FEA-specific artifacts (`SimulationMesh`, `SimulationResult`) reference it.

## Job system

A `ThreadPoolExecutor` executes jobs; state lives in the DB so any API worker can serve progress
(including the SSE stream). Cancellation is cooperative via per-job events checked at each progress
update. On startup, jobs left `pending/running` by a crash are marked failed with an explanatory
message ("interrupted by restart") — no zombie states. Redis is not required; the queue interface
is small enough to swap in an external broker later without touching the task code.

Units policy: geometry is processed in the file's native "mesh units"; SI conversion happens only
after the user confirms the unit, and the confirmed scale is recorded with every FEA result.

## Security measures

- content-based upload validation (binary STL size equation, ASCII structure), extension allowlist,
  size and triangle limits, filename sanitization, per-project storage isolation with server-side
  IDs, no execution or shell-interpolation of any user data
- solver runs as `subprocess` argv arrays with CPU/memory rlimits and timeouts, in per-job
  directories
- per-project job quota; structured JSON logs; artifact checksums; deleted projects have their
  storage removed
- AI-proposed operations/load cases are schema-validated (Pydantic) and pass the same deterministic
  geometry validation as any other input; they are never auto-applied
