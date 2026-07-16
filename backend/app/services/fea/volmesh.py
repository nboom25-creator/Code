"""Volumetric tetrahedral meshing of a watertight surface mesh using Gmsh.

Gmsh's C API is process-global, so access is serialized with a lock. The
input surface must be watertight and consistently wound; callers enforce that
before scheduling an FEA job.
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

_GMSH_LOCK = threading.Lock()


class MeshingError(RuntimeError):
    pass


@dataclass
class VolumeMesh:
    nodes: np.ndarray          # (n, 3) float, mesh units of the input STL
    elements: np.ndarray       # (m, 4) or (m, 10) int, zero-based node indices
    element_type: str          # C3D4 | C3D10
    surface_tris: np.ndarray   # (k, 3) zero-based corner-node indices of boundary faces
    quality: dict


def _boundary_faces(elements: np.ndarray) -> np.ndarray:
    corners = elements[:, :4]
    faces = np.concatenate([
        corners[:, [0, 1, 2]], corners[:, [0, 1, 3]],
        corners[:, [0, 2, 3]], corners[:, [1, 2, 3]],
    ])
    key = np.sort(faces, axis=1)
    _uniq, inv, counts = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    return faces[counts[inv] == 1]


def generate_volume_mesh(stl_path: Path, target_elements: int, second_order: bool,
                         max_nodes: int) -> VolumeMesh:
    try:
        import gmsh
    except Exception as exc:  # pragma: no cover
        raise MeshingError(f"Gmsh is not available in this environment: {exc}") from exc

    with _GMSH_LOCK:
        try:
            # interruptible=False: don't install signal handlers (we run in worker threads)
            gmsh.initialize(interruptible=False)
            gmsh.option.setNumber("General.Terminal", 0)
            gmsh.option.setNumber("General.NumThreads", 2)

            # Surface classification can fail on smoothed/boolean geometry
            # ("Wrong topology of boundary mesh for parametrization"); retry with
            # finer classification angles and finally with reparametrization.
            attempts = [(40.0, False), (25.0, False), (15.0, True)]
            last_exc: Exception | None = None
            for classify_angle, reparam in attempts:
                try:
                    gmsh.clear()
                    gmsh.merge(str(stl_path))
                    gmsh.model.mesh.removeDuplicateNodes()
                    gmsh.model.mesh.classifySurfaces(
                        math.radians(classify_angle), True, reparam, math.radians(180))
                    gmsh.model.mesh.createGeometry()
                    surfaces = gmsh.model.getEntities(2)
                    if not surfaces:
                        raise MeshingError("Surface classification produced no surfaces.")
                    loop = gmsh.model.geo.addSurfaceLoop([s[1] for s in surfaces])
                    gmsh.model.geo.addVolume([loop])
                    gmsh.model.geo.synchronize()
                    last_exc = None
                    break
                except Exception as exc:  # try next classification setting
                    last_exc = exc
            if last_exc is not None:
                raise MeshingError(
                    f"Surface classification failed after {len(attempts)} attempts: {last_exc}")

            # element size from target count: V_tet ~ h^3 / (6*sqrt(2))
            xmin, ymin, zmin, xmax, ymax, zmax = gmsh.model.getBoundingBox(-1, -1)
            bbox_vol = max((xmax - xmin) * (ymax - ymin) * (zmax - zmin), 1e-30)
            approx_part_vol = 0.35 * bbox_vol  # parts rarely fill their bbox; refined later by cap
            h = (approx_part_vol * 6.0 * math.sqrt(2.0) / max(target_elements, 1000)) ** (1.0 / 3.0)
            min_extent = min(xmax - xmin, ymax - ymin, zmax - zmin)
            h = float(np.clip(h, min_extent / 60.0, min_extent / 2.0))
            gmsh.option.setNumber("Mesh.MeshSizeMax", h)
            gmsh.option.setNumber("Mesh.MeshSizeMin", h / 4.0)
            gmsh.option.setNumber("Mesh.Optimize", 1)

            gmsh.model.mesh.generate(3)
            if second_order:
                gmsh.option.setNumber("Mesh.SecondOrderLinear", 1)
                gmsh.model.mesh.setOrder(2)

            elem_code = 11 if second_order else 4  # tet10 / tet4
            elem_tags, node_tags_flat = gmsh.model.mesh.getElementsByType(elem_code)
            if len(elem_tags) == 0:
                raise MeshingError("Gmsh produced no tetrahedra. The surface may not enclose a valid volume.")

            all_tags, coords, _ = gmsh.model.mesh.getNodes()
            if len(all_tags) > max_nodes:
                raise MeshingError(
                    f"Volume mesh has {len(all_tags):,} nodes (limit {max_nodes:,}). "
                    "Reduce mesh density or simplify the model."
                )
            tag_to_idx = np.zeros(int(all_tags.max()) + 1, dtype=np.int64)
            tag_to_idx[all_tags.astype(np.int64)] = np.arange(len(all_tags))
            nodes = coords.reshape(-1, 3).astype(float)
            npe = 10 if second_order else 4
            elements = tag_to_idx[node_tags_flat.astype(np.int64)].reshape(-1, npe)
            if second_order:
                # Gmsh tet10 mid-edge order is (01,12,02,03,23,13); CalculiX C3D10
                # expects (01,12,02,03,13,23) — swap the last two columns.
                elements = elements[:, [0, 1, 2, 3, 4, 5, 6, 7, 9, 8]]

            try:
                q = np.asarray(gmsh.model.mesh.getElementQualities(elem_tags.tolist(), "minSICN"))
                quality = {
                    "metric": "minSICN (signed inverse condition number; 1 = ideal, <0 = inverted)",
                    "min": float(q.min()), "p05": float(np.percentile(q, 5)),
                    "median": float(np.median(q)),
                    "poor_fraction": float((q < 0.1).mean()),
                    "inverted_elements": int((q <= 0).sum()),
                }
            except Exception:
                quality = {"metric": "unavailable", "note": "gmsh quality query failed"}

            surface_tris = _boundary_faces(elements)
            return VolumeMesh(
                nodes=nodes, elements=elements,
                element_type="C3D10" if second_order else "C3D4",
                surface_tris=surface_tris, quality=quality,
            )
        except MeshingError:
            raise
        except Exception as exc:
            raise MeshingError(f"Volume meshing failed: {exc}") from exc
        finally:
            try:
                gmsh.finalize()
            except Exception:
                pass
