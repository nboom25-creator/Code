# Testing guide

```bash
cd backend
../.venv/bin/python -m pytest tests/ -q            # full suite (~1–2 min with solver)
../.venv/bin/python -m pytest tests/ -q -k "not fea_analytical and not demo_full"   # fast subset
../.venv/bin/ruff check app tests                  # lint
cd ../frontend && npm run build                    # TS type-check + production build
```

FEA-dependent tests skip automatically when Gmsh/CalculiX are unavailable.

## Layout

| File | Covers |
|---|---|
| `tests/fixtures.py` | Geometry regression fixtures: watertight cube, open cube, thin-wall bracket, plate with hole, non-manifold mesh, inverted normals, multi-body STL, corrupted STL |
| `test_stl_io.py` | Format detection, strict validation, corrupted-file rejection, size/triangle limits |
| `test_units.py` | Unit conversions, bbox-based unit suggestion labeling |
| `test_geometry.py` | Exact cube metrics + mass, health counts on defective fixtures, thickness on a known plate |
| `test_materials_rules.py` | Catalog seeding, overrides, printed-polymer knockdown, every major recommendation rule with evidence assertions |
| `test_operations.py` | Operation schema validation, boolean ops, protected-region rejection, bbox-growth limits, variant generation + strategy scaling |
| `test_fea_parsing.py` | von Mises / principal-stress math, FRD/DAT parsing, load-case validation incl. rigid-body detection |
| `test_fea_analytical.py` | Axial bar and cantilever vs. analytical solutions (documented tolerances); refusal of unconstrained models |
| `test_api_workflow.py` | Integration: upload→analyze, repair preserving originals, material/use-case flow, FEA precondition gates (409s), AI draft behavior, job cancellation, and the full demo lifecycle (upload→FEA→recommendations→variants→comparison→report→archive) |

The demo-lifecycle test is the end-to-end acceptance test: it asserts the seeded weak bracket is
detected (gusset + sharp-corner rules), a gusset variant is generated and re-analyzed, the variant
is measurably stiffer under the same load case, and the PDF/ZIP exports are produced.
