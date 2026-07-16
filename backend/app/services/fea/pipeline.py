"""End-to-end preliminary FEA pipeline with validity gates.

A factor of safety is reported as *valid* only when every gate passes:
solver converged, mesh quality acceptable, constraints adequate, units
confirmed (enforced upstream), material properties present, and the peak
stress is not dominated by a suspected singularity.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ...config import get_settings
from .bcs import map_region_to_nodes, region_sample_points, validate_load_case
from .deck import DeckError, DeckResult, build_deck
from .frd import parse_dat_reactions, parse_frd, principal_stresses, von_mises
from .runner import run_calculix
from .volmesh import VolumeMesh, generate_volume_mesh


class FeaError(RuntimeError):
    """User-facing FEA failure with an actionable message."""


def _pressure_node_data(nodes_sel: np.ndarray, vol: VolumeMesh) -> tuple[np.ndarray, np.ndarray]:
    """Per-selected-node outward normals and tributary areas (mesh units^2),
    from volume-surface triangles fully inside the selection."""
    sel = np.zeros(len(vol.nodes), dtype=bool)
    sel[nodes_sel] = True
    tris = vol.surface_tris[sel[vol.surface_tris].all(axis=1)]
    normals_acc = np.zeros((len(vol.nodes), 3))
    areas_acc = np.zeros(len(vol.nodes))
    if len(tris):
        p = vol.nodes[tris]
        cr = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
        area2 = np.linalg.norm(cr, axis=1)
        n_hat = cr / np.maximum(area2[:, None], 1e-30)
        for k in range(3):
            np.add.at(normals_acc, tris[:, k], n_hat * (area2[:, None] / 6.0))
            np.add.at(areas_acc, tris[:, k], area2 / 6.0)
    node_n = normals_acc[nodes_sel]
    norms = np.linalg.norm(node_n, axis=1, keepdims=True)
    node_n = np.divide(node_n, np.maximum(norms, 1e-30))
    return node_n, areas_acc[nodes_sel]


def run_fea(
    stl_path: Path,
    unit_scale_to_m: float,
    material_props: dict,
    bcs: list[dict],                 # [{bc_type, params(SI), description, triangle_indices}]
    display_vertices: np.ndarray,    # display-mesh geometry the regions were selected on
    display_faces: np.ndarray,
    workdir: Path,
    progress=lambda frac, msg: None,
    settings_override: dict | None = None,
) -> dict:
    settings = get_settings()
    ov = settings_override or {}
    workdir.mkdir(parents=True, exist_ok=True)

    check = validate_load_case(bcs)
    if not check["ok"]:
        raise FeaError("Load case invalid: " + " ".join(check["errors"]))

    progress(0.05, "Generating volumetric tetrahedral mesh (Gmsh)")
    vol = generate_volume_mesh(
        stl_path,
        target_elements=int(ov.get("target_elements", settings.fea_target_elements)),
        second_order=bool(ov.get("second_order", settings.fea_second_order)),
        max_nodes=settings.fea_max_nodes,
    )
    mesh_warnings: list[str] = []
    q = vol.quality
    if q.get("inverted_elements"):
        raise FeaError(f"Volume mesh contains {q['inverted_elements']} inverted elements; refusing to solve.")
    if q.get("poor_fraction", 0) > 0.05:
        mesh_warnings.append(
            f"{q['poor_fraction'] * 100:.1f}% of elements have poor quality (minSICN < 0.1); "
            "stresses in those regions are less reliable.")

    progress(0.25, "Mapping selected regions to mesh node sets")
    scale = float(np.linalg.norm(vol.nodes.max(axis=0) - vol.nodes.min(axis=0)))
    tol = max(0.01 * scale, 2.0 * _median_edge(vol))
    mapped: list[dict] = []
    for bc in bcs:
        params = dict(bc.get("params", {}))
        # axis points are picked in mesh units; the deck needs metres
        if "axis_point" in params and "axis_point_m" not in params:
            params["axis_point_m"] = (np.asarray(params["axis_point"], float) * unit_scale_to_m).tolist()
        entry = dict(bc_type=bc["bc_type"], params=params,
                     description=bc.get("description", ""))
        if bc["bc_type"] in ("gravity", "rotation"):
            mapped.append(entry)
            continue
        pts = region_sample_points(display_vertices, display_faces, bc.get("triangle_indices", []))
        m = map_region_to_nodes(pts, vol.nodes, vol.surface_tris, tol)
        if len(m["nodes"]) == 0:
            raise FeaError(
                f"Region for '{entry['description'] or bc['bc_type']}' could not be mapped onto the "
                "FEA mesh (no nodes within tolerance). Re-select the region on the current mesh version.")
        entry.update(nodes=m["nodes"], weights=m["weights"], area=m["area"])
        if bc["bc_type"] == "pressure":
            node_n, node_a = _pressure_node_data(m["nodes"], vol)
            entry["node_normals"] = node_n
            entry["node_areas"] = node_a * unit_scale_to_m ** 2
        mapped.append(entry)

    progress(0.35, "Writing CalculiX input deck")
    try:
        deck: DeckResult = build_deck(vol, unit_scale_to_m, material_props, mapped)
    except DeckError as exc:
        raise FeaError(str(exc)) from exc
    deck_path = workdir / "job.inp"
    deck_path.write_text(deck.deck_text)

    progress(0.45, "Running CalculiX solver")
    run = run_calculix(workdir, "job")
    solver_log = run.stdout[-20000:] + ("\n--- stderr ---\n" + run.stderr[-5000:] if run.stderr else "")
    if run.timed_out:
        raise FeaError(f"Solver exceeded the {settings.fea_timeout_s}s time limit and was stopped.")
    converged = (run.returncode == 0 and run.frd_path is not None
                 and "Job finished" in run.stdout and "*ERROR" not in run.stdout)
    if not converged:
        err_lines = [line for line in run.stdout.splitlines() if "ERROR" in line.upper()][:5]
        raise FeaError("Solver did not complete successfully. " + (" | ".join(err_lines) or
                       f"exit code {run.returncode}. See solver log."))

    progress(0.7, "Parsing solver results")
    frd = parse_frd(run.frd_path)
    disp = frd["displacement"]
    stress = frd.get("stress", {})
    strain = frd.get("strain", {})
    node_ids = np.array(sorted(disp.keys()), dtype=np.int64)
    U = np.array([disp[n] for n in node_ids])
    umag = np.linalg.norm(U, axis=1)

    S = None
    vm = None
    p_stresses = None
    if stress:
        s_ids = np.array(sorted(stress.keys()), dtype=np.int64)
        S = np.array([stress[n] for n in s_ids])
        vm_all = von_mises(S)
        p_all = principal_stresses(S)
        # align stress nodes with displacement node ordering
        pos = {int(n): i for i, n in enumerate(s_ids)}
        idx = np.array([pos.get(int(n), -1) for n in node_ids])
        ok = idx >= 0
        vm = np.zeros(len(node_ids))
        vm[ok] = vm_all[idx[ok]]
        p_stresses = np.zeros((len(node_ids), 3))
        p_stresses[ok] = p_all[idx[ok]]

    reactions = parse_dat_reactions(run.dat_path) if run.dat_path else {}

    # ---------- validity gates ----------
    gates: dict[str, dict] = {}
    def gate(name: str, ok: bool, detail: str):
        gates[name] = {"ok": bool(ok), "detail": detail}

    gate("solver_converged", True, "CalculiX finished without errors.")
    gate("mesh_quality", q.get("poor_fraction", 0) <= 0.05,
         f"minSICN min={q.get('min'):.3f}, poor fraction={q.get('poor_fraction', 0) * 100:.1f}%")

    bbox_diag_m = scale * unit_scale_to_m
    max_disp = float(umag.max()) if len(umag) else 0.0
    plausible = max_disp < 0.1 * bbox_diag_m
    gate("displacement_plausible", plausible,
         f"max displacement {max_disp:.3e} m vs bounding diagonal {bbox_diag_m:.3e} m"
         + ("" if plausible else " — geometry may be under-constrained or the load unrealistic; "
            "small-displacement assumption is violated."))

    singularity_suspected = False
    sing_detail = "stress field available" if vm is not None else "no stress output"
    fos = None
    fos_note = ""
    if vm is not None and len(vm):
        p95 = float(np.percentile(vm, 95))
        p99 = float(np.percentile(vm, 99))
        vmax = float(vm.max())
        ratio = vmax / max(p99, 1e-9)
        singularity_suspected = ratio > 3.0
        sing_detail = (f"max von Mises {vmax:.3e} Pa, p99 {p99:.3e} Pa (ratio {ratio:.1f})."
                       + (" Peak is a suspected numerical singularity (sharp re-entrant corner or point "
                          "constraint); the local value will not converge with refinement."
                          if singularity_suspected else ""))
        yield_s = material_props.get("yield_strength")
        if yield_s:
            fos = yield_s / vmax if vmax > 0 else None
            fos_p95 = yield_s / p95 if p95 > 0 else None
        else:
            fos_p95 = None
            fos_note = "Yield strength not provided; factor of safety not computed."
    else:
        p95 = p99 = vmax = None
        fos_p95 = None
        fos_note = "Solver returned no stress field."
    gate("no_dominant_singularity", not singularity_suspected, sing_detail)

    fos_valid = all(g["ok"] for g in gates.values()) and fos is not None
    if not fos_valid and fos is not None:
        failed = [k for k, g in gates.items() if not g["ok"]]
        fos_note = ("Factor of safety is shown for reference only — validity gates failed: "
                    + ", ".join(failed) + ". "
                    + ("Use the 95th-percentile-based value as a more robust indicator; the raw peak "
                       "is dominated by a suspected singularity." if singularity_suspected else ""))

    # ---------- visualization fields (volume-surface nodes only) ----------
    surf_nodes = np.unique(vol.surface_tris.reshape(-1))
    remap = -np.ones(len(vol.nodes), dtype=np.int64)
    remap[surf_nodes] = np.arange(len(surf_nodes))
    tris_remapped = remap[vol.surface_tris]
    # frd node ids are 1-based mesh order
    frd_index = {int(n): i for i, n in enumerate(node_ids)}
    surf_rows = np.array([frd_index.get(int(n) + 1, -1) for n in surf_nodes])
    valid_rows = surf_rows >= 0
    U_surf = np.zeros((len(surf_nodes), 3))
    U_surf[valid_rows] = U[surf_rows[valid_rows]]
    vm_surf = np.zeros(len(surf_nodes))
    s1_surf = np.zeros(len(surf_nodes))
    s3_surf = np.zeros(len(surf_nodes))
    if vm is not None:
        vm_surf[valid_rows] = vm[surf_rows[valid_rows]]
        s1_surf[valid_rows] = p_stresses[surf_rows[valid_rows], 0]
        s3_surf[valid_rows] = p_stresses[surf_rows[valid_rows], 2]

    fields_path = workdir / "result_fields.npz"
    np.savez_compressed(
        fields_path,
        positions=vol.nodes[surf_nodes] ,   # mesh units for viewer consistency
        triangles=tris_remapped,
        displacement_m=U_surf,
        von_mises_pa=vm_surf,
        s1_pa=s1_surf,
        s3_pa=s3_surf,
        unit_scale_to_m=np.array([unit_scale_to_m]),
    )

    max_vm_loc = None
    if vm is not None and len(vm):
        # locate max vm node position (1-based id -> 0-based mesh index)
        n_at_max = int(node_ids[int(np.argmax(vm))]) - 1
        if 0 <= n_at_max < len(vol.nodes):
            max_vm_loc = (vol.nodes[n_at_max]).tolist()

    strain_max = None
    if strain:
        E6 = np.array(list(strain.values()))
        strain_max = float(np.abs(E6).max())

    summary = {
        "element_type": vol.element_type,
        "node_count": int(len(vol.nodes)),
        "element_count": int(len(vol.elements)),
        "mesh_quality": q,
        "mesh_warnings": mesh_warnings,
        "converged": True,
        "max_displacement_m": max_disp,
        "max_von_mises_pa": vmax,
        "p95_von_mises_pa": p95,
        "p99_von_mises_pa": p99,
        "max_principal_stress_pa": float(p_stresses[:, 0].max()) if p_stresses is not None else None,
        "min_principal_stress_pa": float(p_stresses[:, 2].min()) if p_stresses is not None else None,
        "max_strain": strain_max,
        "max_vm_location_mesh_units": max_vm_loc,
        "reactions_n": reactions,
        "applied_loads": deck.applied_load_summary,
        "factor_of_safety_yield": fos,
        "factor_of_safety_p95": fos_p95,
        "fos_valid": bool(fos_valid),
        "fos_note": fos_note,
        "singularity_suspected": bool(singularity_suspected),
        "validity_gates": gates,
        "load_case_warnings": check["warnings"],
    }
    return {
        "summary": summary,
        "assumptions": deck.assumptions,
        "fields_path": str(fields_path),
        "deck_path": str(deck_path),
        "solver_log": solver_log,
    }


def _median_edge(vol: VolumeMesh) -> float:
    tris = vol.surface_tris[: min(2000, len(vol.surface_tris))]
    p = vol.nodes[tris]
    e = np.linalg.norm(np.roll(p, -1, axis=1) - p, axis=2)
    return float(np.median(e)) if len(e) else 0.0
