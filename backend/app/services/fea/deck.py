"""CalculiX input-deck generation for linear static analysis.

Everything is written in SI (metres, newtons, pascals). All modeling
approximations made here are recorded in the returned `assumptions` list and
surfaced verbatim in results and reports.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .volmesh import VolumeMesh

AXIS_DIRS = {
    (1, 0, 0): 1, (-1, 0, 0): 1,
    (0, 1, 0): 2, (0, -1, 0): 2,
    (0, 0, 1): 3, (0, 0, -1): 3,
}


class DeckError(ValueError):
    pass


@dataclass
class DeckResult:
    deck_text: str
    assumptions: list[str] = field(default_factory=list)
    support_sets: list[str] = field(default_factory=list)
    applied_load_summary: list[dict] = field(default_factory=list)


def _axis_dof(direction: list[float]) -> int | None:
    v = np.asarray(direction, dtype=float)
    n = np.linalg.norm(v)
    if n == 0:
        return None
    v = v / n
    for axis, dof in AXIS_DIRS.items():
        if np.allclose(v, axis, atol=1e-3):
            return dof
    return None


def _fmt_rows(items: list[str], per_line: int = 12) -> str:
    return "\n".join(
        ", ".join(items[i:i + per_line]) for i in range(0, len(items), per_line)
    )


def build_deck(vol: VolumeMesh, unit_scale_to_m: float, material: dict,
               mapped_bcs: list[dict]) -> DeckResult:
    """mapped_bcs: [{bc_type, params(SI), description, nodes(np idx), weights, area_m2}]"""
    assumptions = [
        "Linear static analysis: small displacements, linear-elastic isotropic material, no contact.",
        f"Element type {vol.element_type}; geometry scaled to metres (factor {unit_scale_to_m:g}).",
    ]
    E = material.get("elastic_modulus")
    nu = material.get("poisson_ratio")
    rho = material.get("density")
    if not E or nu is None:
        raise DeckError("Material elastic modulus and Poisson ratio are required for FEA.")

    nodes_m = vol.nodes * unit_scale_to_m
    lines: list[str] = ["*HEADING", "PartForge AI preliminary linear static analysis",
                        "*NODE, NSET=NALL"]
    lines.extend(f"{i + 1}, {p[0]:.9e}, {p[1]:.9e}, {p[2]:.9e}" for i, p in enumerate(nodes_m))

    lines.append(f"*ELEMENT, TYPE={vol.element_type}, ELSET=EALL")
    for i, el in enumerate(vol.elements):
        ids = ", ".join(str(int(n) + 1) for n in el)
        lines.append(f"{i + 1}, {ids}")

    support_sets: list[str] = []
    boundary_lines: list[str] = []
    cload: dict[tuple[int, int], float] = {}
    dload_lines: list[str] = []
    load_summary: list[dict] = []

    def add_cload(node: int, dof: int, value: float):
        key = (node + 1, dof)
        cload[key] = cload.get(key, 0.0) + value

    si = 0
    for bc in mapped_bcs:
        t = bc["bc_type"]
        p = bc.get("params", {})
        nodes = np.asarray(bc.get("nodes", []), dtype=np.int64)
        weights = np.asarray(bc.get("weights", []), dtype=float)
        desc = bc.get("description") or t

        if t in ("fixed", "pinned"):
            if len(nodes) == 0:
                raise DeckError(f"Support '{desc}' maps to no mesh nodes.")
            si += 1
            name = f"SUP{si}"
            support_sets.append(name)
            lines.append(f"*NSET, NSET={name}")
            lines.append(_fmt_rows([str(int(n) + 1) for n in nodes]))
            boundary_lines.append(f"{name}, 1, 3, 0")
            if t == "pinned":
                assumptions.append(
                    f"Support '{desc}': with solid elements a pinned support equals a fixed support "
                    "(no rotational DOFs exist); modeled as all translations fixed.")
        elif t in ("roller", "symmetry"):
            dof = _axis_dof(p.get("direction") or p.get("normal") or [])
            if dof is None:
                raise DeckError(
                    f"'{desc}': roller/symmetry constraints are currently supported only along the "
                    "global X, Y or Z axes.")
            if len(nodes) == 0:
                raise DeckError(f"Support '{desc}' maps to no mesh nodes.")
            si += 1
            name = f"SUP{si}"
            support_sets.append(name)
            lines.append(f"*NSET, NSET={name}")
            lines.append(_fmt_rows([str(int(n) + 1) for n in nodes]))
            boundary_lines.append(f"{name}, {dof}, {dof}, 0")
            if t == "symmetry":
                assumptions.append(f"Symmetry '{desc}': normal displacement fixed on the selected patch.")
        elif t in ("force", "bearing"):
            if len(nodes) == 0:
                raise DeckError(f"Load '{desc}' maps to no mesh nodes.")
            mag = float(p["magnitude_si"])
            d = np.asarray(p["direction"], dtype=float)
            d = d / np.linalg.norm(d)
            F = mag * d
            for n, w in zip(nodes, weights, strict=True):
                for dof in range(3):
                    if F[dof] != 0:
                        add_cload(int(n), dof + 1, float(F[dof] * w))
            load_summary.append({"type": t, "description": desc, "total_N": mag,
                                 "direction": d.tolist(), "nodes": int(len(nodes))})
            if t == "bearing":
                assumptions.append(
                    f"Bearing load '{desc}' approximated as an area-weighted distributed force over the "
                    "selected surface (no cosine contact distribution).")
            else:
                assumptions.append(
                    f"Force '{desc}' distributed over {len(nodes)} nodes with area weighting "
                    "(equivalent, not consistent, nodal loads).")
        elif t == "pressure":
            mag = float(p["magnitude_si"])  # Pa, positive pushes on the surface
            tri_normals = bc.get("node_normals")
            node_areas = bc.get("node_areas")
            if tri_normals is None or node_areas is None or len(nodes) == 0:
                raise DeckError(f"Pressure '{desc}' maps to no usable surface patch.")
            total = 0.0
            for n, nrm, a in zip(nodes, tri_normals, node_areas, strict=True):
                f_vec = -mag * a * np.asarray(nrm)
                total += mag * a
                for dof in range(3):
                    if f_vec[dof] != 0:
                        add_cload(int(n), dof + 1, float(f_vec[dof]))
            load_summary.append({"type": "pressure", "description": desc, "pressure_Pa": mag,
                                 "resultant_N": total, "nodes": int(len(nodes))})
            assumptions.append(
                f"Pressure '{desc}' applied as equivalent nodal forces along inward surface normals "
                "(area-weighted); geometrically exact only on flat patches with fine meshes.")
        elif t == "torque":
            if len(nodes) == 0:
                raise DeckError(f"Torque '{desc}' maps to no mesh nodes.")
            T = float(p["magnitude_si"])  # N*m
            ap = np.asarray(p["axis_point_m"], dtype=float)
            ad = np.asarray(p["axis_direction"], dtype=float)
            ad = ad / np.linalg.norm(ad)
            pos = nodes_m[nodes]
            r = pos - ap
            r_perp = r - np.outer(r @ ad, ad)
            r_len = np.linalg.norm(r_perp, axis=1)
            ok = r_len > 1e-9
            if not ok.any():
                raise DeckError(f"Torque '{desc}': all selected nodes lie on the axis.")
            w = weights.copy()
            w[~ok] = 0
            w = w / w.sum()
            tang = np.cross(np.broadcast_to(ad, r_perp.shape), r_perp)
            tang[ok] = tang[ok] / np.linalg.norm(tang[ok], axis=1, keepdims=True)
            for i, n in enumerate(nodes):
                if not ok[i]:
                    continue
                f_vec = tang[i] * (T * w[i] / r_len[i])
                for dof in range(3):
                    if f_vec[dof] != 0:
                        add_cload(int(n), dof + 1, float(f_vec[dof]))
            load_summary.append({"type": "torque", "description": desc, "torque_Nm": T,
                                 "nodes": int(ok.sum())})
            assumptions.append(
                f"Torque '{desc}' applied as tangential nodal forces about the specified axis "
                "(statically equivalent couple).")
        elif t == "gravity":
            if not rho:
                raise DeckError("Gravity load requires material density.")
            d = np.asarray(p.get("direction", [0, 0, -1]), dtype=float)
            d = d / np.linalg.norm(d)
            g = float(p.get("magnitude_si", 9.80665))
            dload_lines.append(f"EALL, GRAV, {g:.6f}, {d[0]:.6f}, {d[1]:.6f}, {d[2]:.6f}")
            load_summary.append({"type": "gravity", "g_m_s2": g, "direction": d.tolist()})
        elif t == "rotation":
            if not rho:
                raise DeckError("Rotational (centrifugal) load requires material density.")
            omega = float(p["omega_rad_s"])
            ap = np.asarray(p["axis_point_m"], dtype=float)
            ad = np.asarray(p["axis_direction"], dtype=float)
            ad = ad / np.linalg.norm(ad)
            dload_lines.append(
                f"EALL, CENTRIF, {omega * omega:.6e}, {ap[0]:.6e}, {ap[1]:.6e}, {ap[2]:.6e}, "
                f"{ad[0]:.6f}, {ad[1]:.6f}, {ad[2]:.6f}")
            load_summary.append({"type": "rotation", "omega_rad_s": omega})
        elif t == "temperature":
            raise DeckError("Thermal loading is not supported in the current FEA tier "
                            "(structural linear statics only).")
        else:
            raise DeckError(f"Unsupported boundary-condition type '{t}'.")

    if not support_sets:
        raise DeckError("No support constraints were mapped to the mesh.")
    if not cload and not dload_lines:
        raise DeckError("No loads were mapped to the mesh.")

    lines.append("*MATERIAL, NAME=MAT1")
    lines.append("*ELASTIC")
    lines.append(f"{E:.6e}, {nu:.4f}")
    if rho:
        lines.append("*DENSITY")
        lines.append(f"{rho:.6e}")
    lines.append("*SOLID SECTION, ELSET=EALL, MATERIAL=MAT1")
    lines.append("*STEP")
    lines.append("*STATIC")
    lines.append("*BOUNDARY")
    lines.extend(boundary_lines)
    if cload:
        lines.append("*CLOAD")
        lines.extend(f"{n}, {dof}, {v:.9e}" for (n, dof), v in sorted(cload.items()))
    if dload_lines:
        lines.append("*DLOAD")
        lines.extend(dload_lines)
    lines.append("*NODE FILE")
    lines.append("U")
    lines.append("*EL FILE")
    lines.append("S, E")
    for name in support_sets:
        lines.append(f"*NODE PRINT, NSET={name}, TOTALS=ONLY")
        lines.append("RF")
    lines.append("*END STEP")

    return DeckResult(deck_text="\n".join(lines) + "\n", assumptions=assumptions,
                      support_sets=support_sets, applied_load_summary=load_summary)
