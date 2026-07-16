# Troubleshooting

## "FEA: solver not installed" / 503 on FEA start
CalculiX is missing. `sudo apt install calculix-ccx` (Debian/Ubuntu) or set `PARTFORGE_CCX_PATH`.
The Docker backend image includes it. Geometry analysis, recommendations and variant generation
work without the solver; only FEA is disabled (never mocked outside the demo).

## `gmsh` import fails with `libGLU.so.1: cannot open shared object file`
Install the GL libraries Gmsh links against even headless:
`sudo apt install libglu1-mesa libxrender1 libxcursor1 libxft2 libxinerama1`.

## FEA fails with "Volume meshing failed: … parametrization" or "PLC Error"
The surface has topology or self-intersections the tet mesher cannot handle. Run mesh repair
(merge vertices, fix winding, watertight reconstruction) and retry on the repaired version. For
variant meshes this is reported per-variant; the variant STL itself is still valid surface
geometry.

## "Confirm the model units before running FEA" (409)
Deliberate: STL has no units, and every SI result depends on the scale. Confirm units in step 1.

## Upload rejected (422)
The message states the reason: not a valid binary/ASCII STL (truncated files are detected by the
size equation), too large, too many triangles, or an unsupported extension. Decimate or re-export.

## Factor of safety shown as "reference only"
One or more validity gates failed — the result panel lists which (mesh quality, displacement
plausibility, suspected singularity, convergence). A common cause is a sharp re-entrant corner at
the stress peak: add a fillet/chamfer (see recommendations) and re-run; the p95-based FoS is the
more robust indicator meanwhile.

## Variant operation "rejected: protected region moved"
Working as intended: the operation would have modified a protected interface. Unprotect the region
or choose different recommendations.

## Job stuck at "pending" after a restart
Jobs interrupted by a crash/restart are marked failed with "interrupted by restart; please retry".
If you see perpetual pending, check backend logs (structured JSON on stdout).

## SQLite "database is locked"
Heavy parallel job load on SQLite. WAL mode is enabled by default; for sustained use configure
PostgreSQL via `PARTFORGE_DATABASE_URL` (docker-compose does this already).

## Frontend shows CORS errors in dev
Use the Vite dev server (`npm run dev`) which proxies `/api`, or add your origin to
`PARTFORGE_CORS_ORIGINS`.
