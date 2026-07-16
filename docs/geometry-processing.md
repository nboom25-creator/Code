# Geometry processing

## Loading and connectivity

STL stores each triangle independently, so meshes are loaded with exact-duplicate vertex merging
to recover surface connectivity (required for adjacency, watertightness, and heat maps). The
uploaded file itself is stored verbatim; every derived mesh is a new version with provenance.

## Mesh health

Exact, deterministic counts: boundary edges (used by exactly one face), non-manifold edges (>2
faces), duplicate faces, degenerate (zero-area) faces, extreme-aspect triangles, winding
consistency, connected components. Self-intersection is only *checked* when cheap
(manifold3d status on watertight meshes ≤200k faces) and otherwise reported as "not checked" —
never silently assumed fine.

## Estimates (labeled as such everywhere)

- **Wall thickness** — inward ray casting from face centroids (deterministic seed). Exact for
  parallel walls, approximate for curved/tapered regions. Percentiles are area-weighted so a few
  large triangles cannot hide a thin wall. The per-vertex field drives the thickness heat map.
- **Overhangs** — face normal vs. selected build direction (default 45°); bed-contact faces
  excluded; unsupported islands grouped by adjacency. Slicers may differ slightly.
- **Trapped volumes** — fully enclosed inner shells (relevant to SLA resin / SLS powder / water ingress),
  detected by body containment (capped at 25 bodies).
- **Feature candidates** — planar patches from coplanar facets; hole candidates from circle fits to
  inner boundary loops of planar patches (coaxial pairs merged into through-holes with depth);
  symmetry planes tested by mirroring surface samples across principal planes and measuring
  distance to the actual surface. These are geometric inferences, not CAD features.

## Repair

Preview-first and non-destructive: `repair/preview` reports before/after health deltas without
persisting; `repair/commit` creates a new mesh version recording the operation list and log.
Operations: remove duplicate/degenerate faces, merge vertices, fix winding, recalc normals,
fill holes, remove tiny components, manifold3d watertight reconstruction.

## Design operations (variants)

Operations are JSON documents validated by Pydantic schemas (`operations.py`), applied by
deterministic geometry code, then checked:

- watertightness, non-empty volume
- bounding-box growth limit and volume-change limit (strategy-dependent)
- **protected regions**: sample points of protected triangles must remain on the result surface
  within a tight tolerance, otherwise the operation is rejected (this is what keeps mounting holes
  and interfaces untouched)

Boolean operations (`add_gusset`, `add_rib`, `add_boss`, `add_pad`, `enlarge_hole`,
`add_drain_hole`, `remove_pocket`) run through manifold3d, which guarantees manifold output.
`thicken_region` builds a closed prism between a surface patch and its outward offset and unions
it. `smooth_region` is displacement-capped Taubin smoothing with protected vertices locked; note
that heavy smoothing of sharp corners can produce surfaces that volumetric meshers reject, which
is why the sharp-corner rule generates a 45° chamfer strip (a boolean, robust) rather than
smoothing.

Failed or rejected operations are recorded per-variant with their reason; a variant is only kept
if at least one operation applied and the final mesh passes validation. There is no path by which
invalid geometry is silently exported.
