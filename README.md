# PartForge AI

PartForge AI is an engineering-assistance web application for tessellated (STL) mechanical parts.
Upload a model, confirm its units, inspect and repair the mesh, declare material / manufacturing /
intended use, select supports and loads on the 3D model, run geometry checks and preliminary
finite-element analysis, get evidence-based design recommendations, generate improved design
variants automatically, compare them, and export meshes, reports and the full modification recipe.

**Monorepo:** `backend/` (Python / FastAPI / trimesh / Gmsh / CalculiX) · `frontend/`
(React / TypeScript / Three.js) · `docs/` · `deploy/`.

---

## What this tool is — and is not

An STL file contains **tessellated surface geometry only**. It has no units, no materials, no
tolerances, no load cases, no feature history and no design intent. PartForge therefore separates
everything it tells you into three confidence levels:

1. **Geometry observations** — measured directly from the mesh (dimensions, volume, wall-thickness
   estimates, mesh defects, feature *candidates*). Deterministic, but estimates are labeled as such.
2. **Engineering recommendations** — produced by deterministic rules from those observations plus
   *your* declared assumptions (material, loads, environment) and optional FEA. Each one carries its
   rule id, evidence, confidence and the assumptions it rests on.
3. **Generated design variants** — real geometry produced by an explicit, validated, recorded list
   of operations (gussets, ribs, bosses, local thickening, …). Every variant is re-checked and,
   where a load case exists, re-analyzed before any improvement is claimed.

Know the difference between these terms as used here:

| Term | What it means in PartForge |
|---|---|
| **Mesh analysis** | Measurements and integrity checks on triangles. Exact for counts/topology; estimated for thickness/features. |
| **Geometric modification** | Boolean/smoothing operations applied to the triangle mesh. Produces valid STL/3MF — **not** an editable CAD feature tree. |
| **Parametric CAD** | Feature-history solid modeling. PartForge does **not** reconstruct this from an STL; STEP export is only offered when a true solid B-rep exists (it currently never does, so exports are STL + a JSON operation recipe). |
| **Finite-element approximation** | Preliminary **linear-static** FEA (Gmsh tetrahedra + CalculiX). Valid within small-displacement, linear-elastic assumptions; peak stresses at sharp corners are singularities and are flagged, not trusted. |
| **Certified engineering validation** | **Out of scope.** Nothing here replaces review by a qualified engineer, physical testing, or code-compliance calculation. |

Numerical results are never invented: units must be confirmed by you, material properties must be
confirmed or overridden by you, safety factors are only marked *valid* when every validity gate
(convergence, mesh quality, constraint plausibility, no dominant singularity) passes, and the
optional LLM layer can only re-present numbers computed by deterministic code.

---

## Quick start (local)

Prerequisites: Python 3.11+, Node 20+, and (for FEA) `calculix-ccx` (`apt install calculix-ccx`).
Gmsh installs via pip; on slim Linux systems it also needs `libglu1-mesa`.

```bash
./scripts/setup.sh     # creates .venv, installs backend + frontend dependencies
./scripts/dev.sh       # starts backend :8000 and frontend :5173
```

Open http://localhost:5173, click **Load demo project**, and explore. The demo bracket has a known
weak cantilever root; geometry analysis and recommendations are seeded, and FEA + variant
generation run as visible background jobs (only if the solver is installed — otherwise the FEA job
is skipped and the UI says so).

Run the tests:

```bash
cd backend && ../.venv/bin/python -m pytest tests/ -q          # includes analytical FEA checks
cd frontend && npm run build                                    # type-check + production build
```

## Quick start (Docker)

```bash
docker compose up --build
# frontend: http://localhost:5173   backend API: http://localhost:8000/docs
```

The backend image includes Gmsh and CalculiX, so FEA works out of the box. Uploads, generated
meshes and reports persist in the `partforge_data` volume.

## Configuration

All settings are environment variables with the `PARTFORGE_` prefix (see `.env.example`):
database URL (SQLite default, PostgreSQL supported), upload size / triangle limits, solver path,
FEA time/memory limits, worker threads, and the optional AI provider
(`rules` default — fully local; `openai` / `anthropic` with API keys; `mock` for tests).

## Documentation

| Doc | Contents |
|---|---|
| [docs/setup.md](docs/setup.md) | Local + Docker setup in detail |
| [docs/architecture.md](docs/architecture.md) | System design, data model, job system |
| [docs/geometry-processing.md](docs/geometry-processing.md) | Mesh pipeline, repair, thickness/feature estimation, operations |
| [docs/fea.md](docs/fea.md) | FEA assumptions, limitations, validity gates, verification cases |
| [docs/materials.md](docs/materials.md) | Material catalog data policy |
| [docs/ai-safety.md](docs/ai-safety.md) | AI provider layer and numerical-integrity rules |
| [docs/api.md](docs/api.md) | REST API reference (plus live OpenAPI at `/docs`) |
| [docs/testing.md](docs/testing.md) | Test suite guide |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common failures and fixes |

## License / status

Internal prototype. Not for production safety decisions.
