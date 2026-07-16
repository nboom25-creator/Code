"""Deterministic recommendation engine.

Every recommendation is tied to computed evidence (geometry observations,
user-supplied requirements, or FEA results) and records its rule id, the
evidence values, its location on the model, and the assumptions it rests on.
No recommendation is produced without identifying where, why and how.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import trimesh


@dataclass
class RuleContext:
    mesh: trimesh.Trimesh
    unit: str | None
    unit_scale_to_m: float | None
    metrics: dict
    health: dict
    thickness: dict            # from thickness.estimate_thickness (with per_face np array)
    overhang: dict
    features: dict
    use_case: dict = field(default_factory=dict)        # questionnaire answers
    manufacturing: dict = field(default_factory=dict)   # method + params
    material: dict = field(default_factory=dict)        # effective properties + name/key
    fea_summary: dict | None = None
    fea_fields: dict | None = None                      # positions (mesh units), von_mises_pa arrays


@dataclass
class Draft:
    rule_id: str
    title: str
    category: str
    severity: str
    confidence: str
    problem: str
    evidence: dict
    location: dict
    rationale: str
    proposed_change: str
    expected_benefit: str
    possible_downside: str
    manufacturing_impact: str
    validation_required: str
    auto_generatable: bool = False
    auto_op: dict | None = None
    assumptions: list[str] = field(default_factory=list)


def _min_feature_size_mu(ctx: RuleContext) -> float | None:
    """User-entered minimum manufacturable feature size, converted to mesh units."""
    raw = ctx.use_case.get("min_feature_size_mm")
    if raw is None or not ctx.unit_scale_to_m:
        return None
    return float(raw) * 1e-3 / ctx.unit_scale_to_m


def _cluster_faces(mesh: trimesh.Trimesh, face_mask: np.ndarray, max_clusters: int = 8) -> list[np.ndarray]:
    import networkx as nx
    sel = np.nonzero(face_mask)[0]
    if len(sel) == 0:
        return []
    selset = set(sel.tolist())
    g = nx.Graph()
    g.add_nodes_from(sel.tolist())
    for a, b in mesh.face_adjacency:
        if a in selset and b in selset:
            g.add_edge(int(a), int(b))
    comps = sorted(nx.connected_components(g), key=len, reverse=True)
    return [np.array(sorted(c)) for c in comps[:max_clusters] if len(c) >= 3]


# --------------------------------------------------------------------------- rules

def rule_not_watertight(ctx: RuleContext) -> list[Draft]:
    if ctx.health.get("watertight"):
        return []
    n = ctx.health.get("boundary_edge_count", 0)
    return [Draft(
        rule_id="R-MESH-002", title="Repair open mesh before analysis",
        category="mesh_integrity", severity="high", confidence="high",
        problem=f"The mesh is not watertight ({n} boundary edges).",
        evidence={"boundary_edge_count": n},
        location={},
        rationale="Volume, mass, wall thickness and FEA meshing all require a closed, manifold surface.",
        proposed_change="Run the repair pipeline (merge vertices, fill holes, reconstruct) and continue "
                        "with the repaired mesh version.",
        expected_benefit="Unlocks volume/mass measurement and FEA.",
        possible_downside="Aggressive reconstruction can round sharp features slightly.",
        manufacturing_impact="None (analysis-side only).",
        validation_required="Visually compare repaired vs. original geometry.",
    )]


def rule_multiple_components(ctx: RuleContext) -> list[Draft]:
    n = ctx.health.get("connected_components", 1)
    if n <= 1:
        return []
    return [Draft(
        rule_id="R-MESH-001", title=f"Mesh contains {n} disconnected bodies",
        category="mesh_integrity", severity="medium", confidence="high",
        problem=f"{n} disconnected components found; STL export of an assembly, floating debris, or "
                "an internal cavity shell.",
        evidence={"connected_components": n, "component_face_counts": ctx.health.get("component_face_counts")},
        location={},
        rationale="Analysis treats the largest body only if components are unintentional; loads cannot "
                  "transfer between disconnected bodies.",
        proposed_change="If unintentional, remove small components in repair; if this is an assembly, "
                        "analyze parts separately.",
        expected_benefit="Meaningful mass/FEA results.",
        possible_downside="None.",
        manufacturing_impact="Loose shells confuse slicers and CAM.",
        validation_required="Confirm which bodies are intentional.",
    )]


def rule_thin_walls(ctx: RuleContext) -> list[Draft]:
    thk = ctx.thickness
    if not thk.get("ok"):
        return []
    per_face = thk.get("per_face")
    if per_face is None:
        return []
    min_mu = _min_feature_size_mu(ctx)
    layer = ctx.manufacturing.get("params", {}).get("layer_height_mm")
    walls = ctx.manufacturing.get("params", {}).get("wall_count")
    nozzle = ctx.manufacturing.get("params", {}).get("nozzle_diameter_mm")
    # threshold: user min feature size, else printing floor (3 extrusion widths), else 2% of bbox diag
    thresholds: list[tuple[float, str]] = []
    if min_mu:
        thresholds.append((min_mu, "user minimum manufacturable feature size"))
    if nozzle and ctx.unit_scale_to_m:
        thresholds.append((3 * float(nozzle) * 1e-3 / ctx.unit_scale_to_m, "3 extrusion widths (FDM floor)"))
    diag = float(np.linalg.norm(ctx.mesh.extents))
    thresholds.append((0.02 * diag, "2% of bounding-box diagonal (geometric heuristic)"))
    thr, thr_src = max(thresholds, key=lambda t: t[0])

    mask = np.isfinite(per_face) & (per_face < thr)
    if mask.sum() < 3:
        return []
    clusters = _cluster_faces(ctx.mesh, mask, max_clusters=5)
    drafts = []
    for cl in clusters[:3]:
        t_med = float(np.nanmedian(per_face[cl]))
        centroid = ctx.mesh.triangles_center[cl].mean(axis=0)
        area = float(ctx.mesh.area_faces[cl].sum())
        unit = ctx.unit or "mesh units"
        drafts.append(Draft(
            rule_id="R-THIN-001",
            title=f"Thin wall region ({t_med:.2f} {unit} median thickness)",
            category="wall_thickness", severity="high" if t_med < 0.6 * thr else "medium",
            confidence="medium",
            problem=f"A region of ~{area:.1f} {unit}² has estimated wall thickness "
                    f"{t_med:.2f} {unit}, below the {thr:.2f} {unit} threshold ({thr_src}).",
            evidence={"median_thickness": t_med, "threshold": thr, "threshold_source": thr_src,
                      "region_area": area, "face_count": int(len(cl))},
            location={"centroid": centroid.tolist(), "triangle_indices": cl[:400].tolist()},
            rationale="Thin sections concentrate stress, deflect disproportionately, and may not "
                      "form reliably at the selected manufacturing process resolution.",
            proposed_change=f"Thicken this region locally to at least {thr:.2f} {unit} "
                            "(outward offset, keeping protected interfaces untouched).",
            expected_benefit="Higher local stiffness and strength; reliable manufacturing.",
            possible_downside="Added mass; possible interference if clearance is tight on the outside.",
            manufacturing_impact="More material/print time; may need drying/warp care in thick blends.",
            validation_required="Re-run geometry check and FEA (if loads defined) on the variant.",
            auto_generatable=True,
            auto_op={"op_type": "thicken_region", "params": {
                "triangle_indices": cl[:2000].tolist(),
                "offset": max(thr - t_med, 0.25 * thr),
            }},
            assumptions=[f"Wall thickness from inward ray casting ({thk.get('note')})."]
            + ([f"Layer height {layer} mm, walls {walls}" ] if layer else []),
        ))
    return drafts


def rule_sharp_internal_corners(ctx: RuleContext) -> list[Draft]:
    mesh = ctx.mesh
    if len(mesh.face_adjacency) == 0:
        return []
    angles = mesh.face_adjacency_angles
    convex = mesh.face_adjacency_convex
    sharp_concave = (angles > np.radians(60)) & (~convex)
    if sharp_concave.sum() < 2:
        return []
    edges = mesh.face_adjacency_edges[sharp_concave]
    pts = mesh.vertices[edges.reshape(-1)]
    # cluster edge midpoints
    mids = 0.5 * (mesh.vertices[edges[:, 0]] + mesh.vertices[edges[:, 1]])
    faces_pair = mesh.face_adjacency[sharp_concave]
    from scipy.cluster.hierarchy import fcluster, linkage
    drafts = []
    if len(mids) > 1:
        Z = linkage(mids, method="single")
        diag = float(np.linalg.norm(mesh.extents))
        seg_lens = np.linalg.norm(mesh.vertices[edges[:, 0]] - mesh.vertices[edges[:, 1]], axis=1)
        # chain edges into corner lines: midpoints of consecutive edges along a
        # line are ~one edge length apart, so the threshold must exceed that
        t = max(0.05 * diag, 1.5 * float(np.median(seg_lens)))
        labels = fcluster(Z, t=t, criterion="distance")
    else:
        labels = np.array([1])
    del pts
    structural = "structural" in (ctx.use_case.get("flags") or [])
    # rank clusters by total concave-edge length so the dominant corner chain wins
    edge_lens = np.linalg.norm(mesh.vertices[edges[:, 0]] - mesh.vertices[edges[:, 1]], axis=1)
    cluster_ids = sorted(np.unique(labels), key=lambda lb: -float(edge_lens[labels == lb].sum()))
    for lbl in cluster_ids[:3]:
        sel = labels == lbl
        if sel.sum() < 2:
            continue
        center = mids[sel].mean(axis=0)
        ang_deg = float(np.degrees(angles[sharp_concave][sel].mean()))
        tri_idx = np.unique(faces_pair[sel].reshape(-1))
        edge_len = float(np.linalg.norm(
            mesh.vertices[edges[sel][:, 0]] - mesh.vertices[edges[sel][:, 1]], axis=1).sum())
        unit = ctx.unit or "mesh units"

        # auto-op: a 45° chamfer strip along the junction (robust boolean union),
        # only when the corner chain is close to a straight line
        auto_op = None
        pts = mids[sel] - center
        if len(pts) >= 2:
            _w, _v = np.linalg.eigh(np.cov(pts.T)) if len(pts) > 2 else (None, None)
            if _w is not None:
                jdir = _v[:, -1]
                spread_off_axis = float(np.sqrt(max(_w[-2], 0.0)))
            else:
                jdir = pts[1] - pts[0]
                jdir = jdir / (np.linalg.norm(jdir) or 1.0)
                spread_off_axis = 0.0
            if spread_off_axis < 0.15 * max(edge_len, 1e-9):
                # split adjacent faces into the two sides of the corner by normal
                fa = faces_pair[sel].reshape(-1)
                fnorm = mesh.face_normals[fa]
                ref = fnorm[0]
                side_a = fnorm[(fnorm @ ref) > 0.7]
                side_b = fnorm[(fnorm @ ref) <= 0.7]
                if len(side_a) and len(side_b):
                    nA = side_a.mean(axis=0)
                    nA /= np.linalg.norm(nA)
                    nB = side_b.mean(axis=0)
                    nB /= np.linalg.norm(nB)
                    dA = np.cross(nA, jdir)
                    if dA @ nB < 0:
                        dA = -dA
                    dB = np.cross(nB, jdir)
                    if dB @ nA < 0:
                        dB = -dB
                    seg_med = edge_len / max(int(sel.sum()), 1)
                    leg = float(np.clip(1.5 * seg_med,
                                        0.5 * seg_med,
                                        0.15 * float(np.linalg.norm(mesh.extents))))
                    auto_op = {"op_type": "add_gusset", "params": {
                        "corner_point": center.tolist(),
                        "normal_a": nA.tolist(), "normal_b": nB.tolist(),
                        "patch_centroid_a": (center + dA * leg * 3).tolist(),
                        "patch_centroid_b": (center + dB * leg * 3).tolist(),
                        "junction_dir": jdir.tolist(),
                        "leg": leg, "width": 0.9 * edge_len,
                    }}
        drafts.append(Draft(
            rule_id="R-CORNER-001",
            title="Sharp internal corner (stress riser)",
            category="stress_riser",
            severity="high" if structural else "medium",
            confidence="medium" if ctx.fea_summary is None else "high",
            problem=f"A concave edge chain of ~{edge_len:.1f} {unit} with ~{ang_deg:.0f}° dihedral "
                    "change has effectively zero fillet radius.",
            evidence={"mean_dihedral_deg": ang_deg, "edge_length": edge_len,
                      "edge_count": int(sel.sum())},
            location={"centroid": center.tolist(), "triangle_indices": tri_idx[:400].tolist()},
            rationale="Re-entrant corners are theoretical stress singularities: fatigue cracks start "
                      "there, and FEA peak stress at such corners grows without bound as the mesh is "
                      "refined. A generous fillet spreads the load path.",
            proposed_change="Add a blend at this corner (target radius ≥ local wall thickness). The "
                            "automatic variant applies a 45° chamfer strip along the junction, which "
                            "approximates the fillet's load-spreading effect on mesh geometry.",
            expected_benefit="Lower peak stress, better fatigue life.",
            possible_downside="Slight geometry change near the corner; check clearances.",
            manufacturing_impact="FDM: minor. CNC: internal radius must be ≥ cutter radius anyway.",
            validation_required="Re-run FEA; peak should drop and become mesh-converged.",
            auto_generatable=auto_op is not None,
            auto_op=auto_op,
            assumptions=["Corner sharpness measured from face dihedral angles on the tessellation."],
        ))
    return drafts


def rule_cantilever_junction(ctx: RuleContext) -> list[Draft]:
    """Two large near-perpendicular planar patches meeting along a concave edge:
    classic bracket junction. Recommend a gusset."""
    mesh = ctx.mesh
    planars = ctx.features.get("planar_faces", [])
    if len(planars) < 2:
        return []
    angles = mesh.face_adjacency_angles
    convex = mesh.face_adjacency_convex
    concave_sharp = (angles > np.radians(45)) & (~convex)
    if not concave_sharp.any():
        return []
    pair_faces = mesh.face_adjacency[concave_sharp]
    face_to_patch = {}
    for pi, p in enumerate(planars[:12]):
        for f in p["face_indices"]:
            face_to_patch[f] = pi
    junctions: dict[tuple[int, int], list[int]] = {}
    for ei, (fa, fb) in enumerate(pair_faces):
        pa, pb = face_to_patch.get(int(fa)), face_to_patch.get(int(fb))
        if pa is None or pb is None or pa == pb:
            continue
        na = np.array(planars[pa]["normal"])
        nb = np.array(planars[pb]["normal"])
        if abs(float(na @ nb)) > 0.35:
            continue  # not close to perpendicular
        key = (min(pa, pb), max(pa, pb))
        junctions.setdefault(key, []).append(ei)
    drafts = []
    edges_all = mesh.face_adjacency_edges[concave_sharp]
    diag = float(np.linalg.norm(mesh.extents))
    for (pa, pb), eis in sorted(junctions.items(), key=lambda kv: -len(kv[1]))[:2]:
        edges = edges_all[eis]
        seg = mesh.vertices[edges.reshape(-1, 2)]
        length = float(np.linalg.norm(seg[:, 0] - seg[:, 1], axis=1).sum())
        if length < 0.08 * diag:
            continue
        mid = seg.reshape(-1, 3).mean(axis=0)
        A, B = planars[pa], planars[pb]
        jdir = np.cross(A["normal"], B["normal"])
        jn = np.linalg.norm(jdir)
        if jn < 1e-9:
            continue
        jdir = (jdir / jn).tolist()
        unit = ctx.unit or "mesh units"
        structural = "structural" in (ctx.use_case.get("flags") or []) or \
                     "load_bearing" in (ctx.use_case.get("flags") or [])
        leg = 0.5 * min(np.sqrt(A["area"]), np.sqrt(B["area"]))
        drafts.append(Draft(
            rule_id="R-GUSSET-001",
            title="Unreinforced right-angle junction (gusset candidate)",
            category="reinforcement",
            severity="high" if structural and ctx.fea_summary else "medium",
            confidence="high" if ctx.fea_summary else "medium",
            problem=f"Two large planar regions meet at ~90° along a {length:.1f} {unit} concave "
                    "junction with no rib or gusset.",
            evidence={"junction_length": length, "patch_areas": [A["area"], B["area"]],
                      "normals": [A["normal"], B["normal"]]},
            location={"centroid": mid.tolist(),
                      "triangle_indices": (A["face_indices"][:150] + B["face_indices"][:150])},
            rationale="A perpendicular wall loaded away from its base acts as a cantilever; bending "
                      "moment concentrates at the root. A triangular gusset converts bending into "
                      "compression/tension along the gusset edge, typically cutting root stress "
                      "and tip deflection substantially.",
            proposed_change=f"Add a triangular gusset (legs ≈ {leg:.1f} {unit}) centered on the "
                            "junction, plus a root fillet if possible.",
            expected_benefit="Large stiffness gain at the root for little added mass.",
            possible_downside="Occupies the inside corner; check for interference with mating parts.",
            manufacturing_impact="FDM: printable without support in the right orientation. "
                                 "CNC: adds setups; molded: improves rigidity but adds sink risk at the rib base.",
            validation_required="Re-run FEA to quantify stress/deflection change.",
            auto_generatable=True,
            auto_op={"op_type": "add_gusset", "params": {
                "corner_point": mid.tolist(),
                "normal_a": A["normal"], "normal_b": B["normal"],
                "patch_centroid_a": A["centroid"], "patch_centroid_b": B["centroid"],
                "junction_dir": jdir,
                "leg": float(leg), "width": float(min(0.3 * length, leg)),
            }},
            assumptions=["Junction detected from planar-patch adjacency on the tessellation; load "
                         "path inferred from geometry" + (" and FEA stress field." if ctx.fea_summary else " only.")],
        ))
    return drafts


def rule_hole_checks(ctx: RuleContext) -> list[Draft]:
    holes = ctx.features.get("hole_candidates", [])
    if not holes:
        return []
    drafts = []
    unit = ctx.unit or "mesh units"
    # hole spacing
    for i in range(len(holes)):
        for j in range(i + 1, len(holes)):
            ci, cj = np.array(holes[i]["center"]), np.array(holes[j]["center"])
            d = float(np.linalg.norm(ci - cj))
            if d < 1e-9:
                continue
            # skip coaxial pairs (two ends / counterbores of the same hole)
            ax = np.array(holes[i].get("axis", [0, 0, 1]))
            if abs(float(((cj - ci) / d) @ ax)) > 0.9:
                continue
            dm = 0.5 * (holes[i]["diameter"] + holes[j]["diameter"])
            ligament = d - dm
            if ligament < 1.0 * dm:
                mid = (0.5 * (ci + cj)).tolist()
                drafts.append(Draft(
                    rule_id="R-HOLE-002", title="Closely spaced holes (small ligament)",
                    category="stress_riser", severity="medium", confidence="medium",
                    problem=f"Holes Ø{holes[i]['diameter']:.2f} and Ø{holes[j]['diameter']:.2f} {unit} are "
                            f"{d:.2f} {unit} apart; the ligament between them is ~{max(ligament, 0):.2f} {unit} "
                            f"(< 1× mean diameter).",
                    evidence={"center_distance": d, "mean_diameter": dm, "ligament": ligament},
                    location={"centroid": mid},
                    rationale="Stress concentration factors of adjacent holes interact when the ligament "
                              "is under about one diameter, multiplying local stress.",
                    proposed_change="Increase hole spacing to ≥ 2× diameter center-to-center, or thicken "
                                    "the ligament region.",
                    expected_benefit="Lower peak stress between holes.",
                    possible_downside="Interface hole positions may be fixed by the mating part.",
                    manufacturing_impact="Minor.",
                    validation_required="If hole positions are fixed interfaces, protect them and thicken "
                                        "locally instead.",
                    assumptions=["Hole geometry fitted from tessellated boundary loops (candidates, not "
                                 "CAD features)."],
                ))
    # edge distance: nearest other planar-facet boundary — approximated via mesh boundary proximity
    for h in holes[:12]:
        c = np.array(h["center"])
        r = 0.5 * h["diameter"]
        # distance to the nearest vertex outside 1.2r belongs to silhouette approximation
        d_all = np.linalg.norm(ctx.mesh.vertices - c, axis=1)
        ring = d_all[d_all > 1.5 * r]
        if len(ring) == 0:
            continue
        # crude but deterministic: closest geometry beyond the hole wall
        edge_dist = float(ring.min()) - r
        if edge_dist < 1.0 * h["diameter"] and edge_dist > 0:
            drafts.append(Draft(
                rule_id="R-HOLE-001", title="Hole close to part edge",
                category="stress_riser", severity="medium", confidence="low",
                problem=f"Hole Ø{h['diameter']:.2f} {unit} has ~{edge_dist:.2f} {unit} of material to the "
                        "nearest surrounding geometry (< 1× diameter).",
                evidence={"diameter": h["diameter"], "edge_distance_estimate": edge_dist},
                location={"centroid": h["center"]},
                rationale="Rule of thumb for loaded holes: edge distance ≥ 1.5–2× diameter to avoid "
                          "tear-out and elevated stress concentration.",
                proposed_change="Move the hole inward, add a boss, or thicken the surrounding material.",
                expected_benefit="Reduced tear-out risk.",
                possible_downside="Hole position may be a fixed interface.",
                manufacturing_impact="Minor.",
                validation_required="Confirm actual edge distance in CAD; this estimate is from "
                                    "tessellated geometry and is conservative.",
                auto_generatable=True,
                auto_op={"op_type": "add_boss", "params": {
                    "center": h["center"], "axis": h["axis"],
                    "hole_diameter": h["diameter"],
                    "outer_diameter": 2.2 * h["diameter"],
                    "height": (h.get("depth") or h["diameter"]) + h["diameter"]}},
                assumptions=["Edge distance approximated as nearest-geometry distance on the mesh."],
            ))
    return drafts[:6]


def rule_fea_high_stress(ctx: RuleContext) -> list[Draft]:
    if not ctx.fea_summary or not ctx.fea_fields:
        return []
    s = ctx.fea_summary
    vm = np.asarray(ctx.fea_fields.get("von_mises_pa", []))
    pos = np.asarray(ctx.fea_fields.get("positions", []))
    if vm.size == 0 or pos.size == 0:
        return []
    yield_s = ctx.material.get("yield_strength")
    target_fos = float(ctx.use_case.get("target_safety_factor") or 2.0)
    if not yield_s:
        return []
    allow = yield_s / target_fos
    p95 = s.get("p95_von_mises_pa") or 0
    hot = vm > max(allow, 0.8 * p95)
    if hot.sum() < 3:
        return []
    centroid = pos[hot].mean(axis=0)
    frac = float(hot.mean())
    drafts = [Draft(
        rule_id="R-FEA-001", title="High-stress region exceeds allowable",
        category="strength", severity="high" if s.get("fos_valid") else "medium",
        confidence="high" if s.get("fos_valid") else "medium",
        problem=f"{frac * 100:.1f}% of surface nodes exceed the allowable stress "
                f"{allow / 1e6:.1f} MPa (yield {yield_s / 1e6:.0f} MPa / target FoS {target_fos:g}).",
        evidence={"allowable_pa": allow, "p95_von_mises_pa": p95,
                  "max_von_mises_pa": s.get("max_von_mises_pa"),
                  "fos": s.get("factor_of_safety_yield"), "fos_valid": s.get("fos_valid")},
        location={"centroid": centroid.tolist(), "world_space": "fea_surface"},
        rationale="Sustained stress above yield/FoS target risks permanent deformation or fracture "
                  "under the declared load case.",
        proposed_change="Locally thicken the highlighted region or add a rib/gusset along the load path.",
        expected_benefit="Raises factor of safety toward the target.",
        possible_downside="Added mass.",
        manufacturing_impact="Depends on chosen reinforcement.",
        validation_required="Re-run the same load case on the variant; verify FoS gates pass.",
        auto_generatable=True,
        auto_op={"op_type": "thicken_hotspot", "params": {
            "hotspot_points": pos[hot][:500].tolist(),
            "offset_fraction_of_diag": 0.01}},
        assumptions=list(ctx.fea_summary.get("_assumptions", []))
                    or ["Based on the user-declared load case and confirmed material properties."],
    )]
    if s.get("singularity_suspected"):
        drafts[0].assumptions.append(
            "Peak stress is singularity-affected; the recommendation uses the p95/allowable comparison, "
            "not the raw peak.")
    return drafts


def rule_fea_lightweighting(ctx: RuleContext) -> list[Draft]:
    if not ctx.fea_summary or not ctx.fea_fields:
        return []
    vm = np.asarray(ctx.fea_fields.get("von_mises_pa", []))
    yield_s = ctx.material.get("yield_strength")
    if vm.size == 0 or not yield_s:
        return []
    goal = (ctx.use_case.get("weight_goal") or "").strip()
    low = vm < 0.05 * yield_s
    frac = float(low.mean())
    if frac < 0.4 or not goal:
        return []
    pos = np.asarray(ctx.fea_fields["positions"])
    centroid = pos[low].mean(axis=0)
    return [Draft(
        rule_id="R-FEA-002", title="Large low-stress volume — lightweighting candidate",
        category="mass_reduction", severity="info", confidence="medium",
        problem=f"{frac * 100:.0f}% of surface nodes carry < 5% of yield stress under the declared load case.",
        evidence={"low_stress_fraction": frac, "threshold_pa": 0.05 * yield_s},
        location={"centroid": centroid.tolist(), "world_space": "fea_surface"},
        rationale="Material far below the working stress contributes little strength for its mass; "
                  "pockets, shelling or cutouts there reduce weight with modest stiffness cost.",
        proposed_change="Introduce pockets or reduce section in the low-stress zone, keeping ribs along "
                        "load paths and respecting protected regions and minimum wall thickness.",
        expected_benefit=f"Progress toward the stated weight goal ({goal}).",
        possible_downside="Stiffness and buckling margins drop; stress rises elsewhere.",
        manufacturing_impact="Pockets add machining time; for FDM they mostly save time/material.",
        validation_required="Mandatory FEA re-run; single-load-case optimization can be unsafe under "
                            "other load directions.",
        auto_generatable=False,
        assumptions=["Low-stress classification applies only to the analyzed load case."],
    )]


def rule_overhangs(ctx: RuleContext) -> list[Draft]:
    if ctx.manufacturing.get("method") not in ("fdm", "sla", "sls"):
        return []
    ov = ctx.overhang
    if not ov.get("ok"):
        return []
    frac = ov.get("overhang_fraction", 0)
    islands = ov.get("unsupported_islands", [])
    drafts = []
    if frac > 0.15 and ctx.manufacturing.get("method") == "fdm":
        drafts.append(Draft(
            rule_id="R-AM-001", title=f"{frac * 100:.0f}% of surface overhangs the build direction",
            category="manufacturability", severity="medium", confidence="high",
            problem=f"{frac * 100:.0f}% of the surface area faces more than "
                    f"{ov.get('threshold_deg', 45):.0f}° downward for build direction "
                    f"{np.round(ov.get('build_direction', [0, 0, 1]), 2).tolist()}.",
            evidence={"overhang_fraction": frac, "islands": len(islands)},
            location={"centroid": islands[0]["centroid"] if islands else None},
            rationale="Steep overhangs need support material: worse surface finish, longer prints, and "
                      "weaker down-facing surfaces.",
            proposed_change="Re-orient the part (see overhang heat map), add chamfers ≥ 45°, or split "
                            "the part.",
            expected_benefit="Less support, better finish, shorter print.",
            possible_downside="Orientation changes layer directions and therefore anisotropic strength.",
            manufacturing_impact="Direct print-time/quality impact.",
            validation_required="Check strength-critical directions after re-orienting (layer adhesion).",
            assumptions=["Overhang threshold "
                         f"{ov.get('threshold_deg', 45):.0f}°; slicers differ slightly."],
        ))
    if ov.get("trapped_volumes"):
        tv = ov["trapped_volumes"][0]
        drafts.append(Draft(
            rule_id="R-AM-002", title="Enclosed cavity traps resin/powder (or water in service)",
            category="manufacturability", severity="high", confidence="medium",
            problem="The mesh contains at least one fully enclosed internal cavity.",
            evidence={"trapped_volumes": ov["trapped_volumes"]},
            location={"centroid": tv.get("centroid")},
            rationale="SLA/SLS cannot evacuate resin/powder from sealed cavities; submerged or outdoor "
                      "parts also accumulate liquid. Sealed volumes may burst in vacuum or heat.",
            proposed_change="Add ≥2 drainage holes (Ø ≥ 3 mm for resin, ≥ 5 mm for powder) at low points "
                            "of the cavity, or open the cavity.",
            expected_benefit="Manufacturable cavity; no trapped fluid mass.",
            possible_downside="Holes may affect appearance or sealing; position them on hidden faces.",
            manufacturing_impact="Required for SLA/SLS; recommended for submerged service.",
            validation_required="Confirm cavity is not meant to be a sealed pressure volume.",
            auto_generatable=True,
            auto_op={"op_type": "add_drain_hole", "params": {
                "cavity_centroid": tv.get("centroid"), "diameter_mm": 4.0}},
            assumptions=["Cavity detection from disconnected inner shells contained in the outer shell."],
        ))
    return drafts


def rule_print_orientation_vs_load(ctx: RuleContext) -> list[Draft]:
    if ctx.manufacturing.get("method") != "fdm" or not ctx.fea_summary:
        return []
    loads = ctx.fea_summary.get("applied_loads", [])
    dirs = [ld.get("direction") for ld in loads if ld.get("direction")]
    if not dirs:
        return []
    build = np.asarray(ctx.manufacturing.get("params", {}).get("build_direction", [0, 0, 1]), dtype=float)
    build = build / (np.linalg.norm(build) or 1)
    worst = max(abs(float(np.dot(np.asarray(d) / (np.linalg.norm(d) or 1), build))) for d in dirs)
    if worst < 0.7:
        return []
    factor = ctx.manufacturing.get("params", {}).get("layer_adhesion_factor")
    return [Draft(
        rule_id="R-AM-003", title="Primary load acts across print layers",
        category="manufacturability", severity="high", confidence="medium",
        problem=f"The dominant load direction is within ~{np.degrees(np.arccos(min(worst, 1.0))):.0f}° of the "
                "build (Z) axis, so tension crosses layer boundaries.",
        evidence={"alignment": worst, "layer_adhesion_factor": factor},
        location={},
        rationale="FDM parts are weakest across layers; layer adhesion is commonly 50–80% of in-plane "
                  "strength and far worse with poor settings.",
        proposed_change="Re-orient the part so principal tension lies in the layer plane, increase "
                        "perimeters, or use a tougher material/annealing.",
        expected_benefit="Uses the strong material direction for the main load.",
        possible_downside="New orientation may add supports (see overhang analysis).",
        manufacturing_impact="Print-plan change only.",
        validation_required="Strength values used in FEA assume the entered layer-adhesion factor"
                            + (f" ({factor})." if factor else " — none was provided."),
        assumptions=["Load direction from the declared load case; anisotropy factor from user input."],
    )]


def rule_environment_material(ctx: RuleContext) -> list[Draft]:
    drafts = []
    exposures = set(ctx.use_case.get("exposures") or [])
    mat_key = ctx.material.get("key", "")
    tmax = ctx.use_case.get("temp_max_c")
    mat_tmax = ctx.material.get("max_service_temp_c")
    if tmax is not None and mat_tmax is not None and float(tmax) > float(mat_tmax):
        drafts.append(Draft(
            rule_id="R-ENV-002", title="Service temperature exceeds material rating",
            category="material", severity="critical", confidence="high",
            problem=f"Declared maximum service temperature {tmax}°C exceeds the material's "
                    f"recommended limit {mat_tmax}°C.",
            evidence={"temp_max_c": tmax, "material_limit_c": mat_tmax, "material": mat_key},
            location={},
            rationale="Above its service limit a polymer creeps/softens rapidly; strength values used "
                      "in analysis no longer apply.",
            proposed_change="Select a higher-temperature material (e.g. PC, PA, metal) or reduce the "
                            "thermal load.",
            expected_benefit="Valid strength margins at temperature.",
            possible_downside="Cost/process change.",
            manufacturing_impact="Material change may change the process.",
            validation_required="All analysis results must be re-based on the new material.",
            assumptions=["Temperature limit is the catalog's representative value."],
        ))
    if "salt water" in exposures and mat_key not in ("ss_316", "ti_6al_4v") and \
            ctx.material.get("category") == "metal":
        drafts.append(Draft(
            rule_id="R-ENV-001", title="Marine exposure vs. material corrosion resistance",
            category="material", severity="high", confidence="medium",
            problem=f"Salt-water exposure declared, but material '{ctx.material.get('name', mat_key)}' "
                    "is not a marine-grade alloy.",
            evidence={"exposures": sorted(exposures), "material": mat_key},
            location={},
            rationale="Chlorides pit 304 stainless and corrode aluminum (especially with dissimilar-metal "
                      "contact) and rust carbon steel.",
            proposed_change="Use 316 stainless or titanium, apply a qualified coating/anodize + isolation, "
                            "or add a documented corrosion allowance to walls.",
            expected_benefit="Service life in the declared environment.",
            possible_downside="Cost.",
            manufacturing_impact="Alloy availability/machinability changes.",
            validation_required="Corrosion allowance sizing is application-specific and not computed here.",
            assumptions=["Based on declared exposure, not measured conditions."],
        ))
    return drafts


def rule_target_fos(ctx: RuleContext) -> list[Draft]:
    if not ctx.fea_summary:
        return []
    s = ctx.fea_summary
    target = ctx.use_case.get("target_safety_factor")
    fos = s.get("factor_of_safety_yield")
    if not target or fos is None:
        return []
    if fos >= float(target):
        return []
    basis = "valid" if s.get("fos_valid") else "reference-only (validity gates failed — see analysis)"
    return [Draft(
        rule_id="R-FEA-003", title=f"Factor of safety {fos:.2f} below target {float(target):g}",
        category="strength", severity="high" if s.get("fos_valid") else "medium",
        confidence="high" if s.get("fos_valid") else "low",
        problem=f"Yield-based FoS is {fos:.2f} ({basis}); the declared target is {float(target):g}.",
        evidence={"fos": fos, "fos_valid": s.get("fos_valid"), "target": target,
                  "p95_fos": s.get("factor_of_safety_p95")},
        location={"centroid": s.get("max_vm_location_mesh_units")},
        rationale="The part does not meet the safety margin the user declared for this load case.",
        proposed_change="Apply the reinforcement recommendations (thicken/gusset) or reduce load; "
                        "re-analyze.",
        expected_benefit="Meets the declared margin.",
        possible_downside="Mass increase.",
        manufacturing_impact="Depends on reinforcement chosen.",
        validation_required="FoS must come from a converged, non-singular result to be meaningful.",
        assumptions=["Target FoS as entered by the user."],
    )]


def rule_cnc_internal_corners(ctx: RuleContext) -> list[Draft]:
    if ctx.manufacturing.get("method") != "cnc":
        return []
    mesh = ctx.mesh
    if len(mesh.face_adjacency) == 0:
        return []
    angles = mesh.face_adjacency_angles
    convex = mesh.face_adjacency_convex
    sharp_concave = (angles > np.radians(80)) & (~convex)
    n = int(sharp_concave.sum())
    if n < 2:
        return []
    edges = mesh.face_adjacency_edges[sharp_concave]
    mid = mesh.vertices[edges.reshape(-1)].mean(axis=0)
    return [Draft(
        rule_id="R-CNC-001", title="Sharp internal corners are not millable",
        category="manufacturability", severity="medium", confidence="high",
        problem=f"{n} concave near-90° edges have zero corner radius.",
        evidence={"sharp_concave_edges": n},
        location={"centroid": mid.tolist()},
        rationale="A rotating cutter always leaves a radius ≥ tool radius on internal corners; "
                  "zero-radius internal corners require EDM or redesign.",
        proposed_change="Add corner radii ≥ the planned cutter radius (or dog-bone reliefs where mating "
                        "square parts must fit).",
        expected_benefit="Machinable as drawn; also reduces stress concentration.",
        possible_downside="None significant.",
        manufacturing_impact="Removes an EDM/manual operation.",
        validation_required="Pick radii from actual tooling.",
        assumptions=["3-axis milling assumed."],
    )]


ALL_RULES = [
    rule_not_watertight,
    rule_multiple_components,
    rule_thin_walls,
    rule_sharp_internal_corners,
    rule_cantilever_junction,
    rule_hole_checks,
    rule_fea_high_stress,
    rule_fea_lightweighting,
    rule_overhangs,
    rule_print_orientation_vs_load,
    rule_environment_material,
    rule_target_fos,
    rule_cnc_internal_corners,
]


def generate_recommendations(ctx: RuleContext) -> list[Draft]:
    drafts: list[Draft] = []
    for rule in ALL_RULES:
        try:
            drafts.extend(rule(ctx))
        except Exception as exc:  # a rule must never take down the run
            drafts.append(Draft(
                rule_id="R-INTERNAL", title=f"Rule {rule.__name__} failed",
                category="internal", severity="info", confidence="low",
                problem=f"Internal error while evaluating {rule.__name__}: {exc}",
                evidence={}, location={}, rationale="", proposed_change="",
                expected_benefit="", possible_downside="", manufacturing_impact="",
                validation_required="", assumptions=[],
            ))
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    drafts.sort(key=lambda d: order.get(d.severity, 5))
    return drafts
