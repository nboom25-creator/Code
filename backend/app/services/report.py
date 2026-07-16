"""PDF engineering-assistance report (reportlab).

The report states, prominently, what the analysis can and cannot conclude.
"""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from ..version import APP_NAME, APP_VERSION

DISCLAIMER = (
    "This document is an engineering-assistance report generated from a tessellated (STL) surface "
    "model, user-entered assumptions, and — where present — preliminary linear-static finite-element "
    "analysis. It is NOT a certified engineering validation, code-compliance calculation, or "
    "fitness-for-service determination. Material properties are representative values unless "
    "explicitly overridden and confirmed. Results depend on the correctness of user-supplied units, "
    "loads, constraints and material data. Independent verification by a qualified engineer is "
    "required before relying on these results for safety-relevant decisions."
)


def _fmt(v, digits=4, unit=""):
    if v is None:
        return "—"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, float):
        if v == 0:
            s = "0"
        elif abs(v) >= 1e5 or abs(v) < 1e-3:
            s = f"{v:.{digits}g}"
        else:
            s = f"{v:.{digits}g}"
        return f"{s} {unit}".strip()
    return f"{v} {unit}".strip()


def build_report_pdf(path: Path, ctx: dict) -> None:
    """ctx keys: project, metrics, health, thickness, overhang, material, use_case,
    load_cases, fea (list), recommendations, variants, comparison, images (label->path),
    warnings, repro (dict)."""
    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    body.fontSize = 9
    h1, h2 = styles["Heading1"], styles["Heading2"]
    small = ParagraphStyle("small", parent=body, fontSize=7.5, textColor=colors.grey)
    warn_style = ParagraphStyle("warn", parent=body, fontSize=9, textColor=colors.HexColor("#8a4500"))

    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm,
                            title=f"{APP_NAME} report – {ctx['project'].get('name', '')}")
    story = []
    p = ctx["project"]
    story.append(Paragraph(f"{APP_NAME} — Engineering-Assistance Report", h1))
    story.append(Paragraph(
        f"Project: <b>{p.get('name', '')}</b> &nbsp;&nbsp; Generated: "
        f"{datetime.now(UTC).strftime('%Y-%m-%d %H:%M UTC')} &nbsp;&nbsp; "
        f"Application version: {APP_VERSION}", body))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"<i>{DISCLAIMER}</i>", small))
    story.append(Spacer(1, 8))

    if p.get("description"):
        story.append(Paragraph("Summary", h2))
        story.append(Paragraph(p["description"], body))

    images = ctx.get("images") or {}
    for label, img_path in list(images.items())[:2]:
        if Path(img_path).exists():
            story.append(Spacer(1, 6))
            story.append(Image(str(img_path), width=90 * mm, height=90 * mm))
            story.append(Paragraph(label, small))

    story.append(Paragraph("Units and geometry", h2))
    unit = p.get("unit")
    story.append(Paragraph(
        f"Confirmed unit: <b>{unit or 'NOT CONFIRMED'}</b>. "
        + ("" if unit else "Geometry values below are in raw mesh units; mass and FEA were blocked."),
        warn_style if not unit else body))
    m = ctx.get("metrics") or {}
    bb = m.get("bounding_box_mesh_units", {}).get("extents", [None] * 3)
    rows = [
        ["Triangles", _fmt(m.get("triangle_count")), "Vertices", _fmt(m.get("vertex_count"))],
        ["Bounding box", " × ".join(_fmt(x, 4) for x in bb) + f" {unit or 'mu'}",
         "Surface area", _fmt(m.get("surface_area_mesh_units2"), 5, f"{unit or 'mu'}²")],
        ["Watertight", _fmt(m.get("watertight")), "Volume",
         _fmt(m.get("volume_mesh_units3"), 5, f"{unit or 'mu'}³")],
        ["Est. mass", _fmt(m.get("estimated_mass_kg"), 4, "kg"), "Components",
         _fmt((ctx.get("health") or {}).get("connected_components"))],
    ]
    t = Table(rows, colWidths=[28 * mm, 55 * mm, 28 * mm, 55 * mm])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8),
                           ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                           ("BACKGROUND", (0, 0), (0, -1), colors.whitesmoke),
                           ("BACKGROUND", (2, 0), (2, -1), colors.whitesmoke)]))
    story.append(t)
    if m.get("mass_note"):
        story.append(Paragraph(m["mass_note"], small))

    th = ctx.get("thickness") or {}
    if th.get("ok"):
        story.append(Paragraph(
            f"Estimated wall thickness: min {_fmt(th.get('min_wall_estimate'), 3, unit)} / median "
            f"{_fmt(th.get('median_wall'), 3, unit)} / max {_fmt(th.get('max_wall_estimate'), 3, unit)}. "
            f"<i>{th.get('note', '')}</i>", body))

    health = ctx.get("health") or {}
    if health.get("issues"):
        story.append(Paragraph("Mesh integrity findings", h2))
        for iss in health["issues"]:
            story.append(Paragraph(f"• [{iss['severity']}] {iss['message']}", warn_style))

    mat = ctx.get("material")
    story.append(Paragraph("Material assumptions", h2))
    if mat:
        props = mat.get("properties", {})
        story.append(Paragraph(
            f"<b>{mat.get('name')}</b> ({'confirmed by user' if mat.get('confirmed') else 'NOT confirmed'}). "
            f"E = {_fmt((props.get('elastic_modulus') or 0) / 1e9, 4, 'GPa')}, ν = {_fmt(props.get('poisson_ratio'))}, "
            f"ρ = {_fmt(props.get('density'), 4, 'kg/m³')}, yield = "
            f"{_fmt((props.get('yield_strength') or 0) / 1e6, 4, 'MPa')}. Source: {mat.get('source', '—')}",
            body))
        for adj in props.get("_adjustments", []):
            story.append(Paragraph(f"• {adj}", small))
    else:
        story.append(Paragraph("No material selected — mass and FEA unavailable.", warn_style))

    uc = ctx.get("use_case") or {}
    if uc:
        story.append(Paragraph("Intended use (user-declared)", h2))
        ans = uc.get("answers", {})
        items = [f"Function: {ans.get('function', '—')}",
                 f"Roles: {', '.join(ans.get('flags', []) or ['—'])}",
                 f"Exposures: {', '.join(ans.get('exposures', []) or ['—'])}",
                 f"Loading: {ans.get('loading', '—')}; target FoS: {ans.get('target_safety_factor', '—')}"]
        for it in items:
            story.append(Paragraph(it, body))

    lcs = ctx.get("load_cases") or []
    if lcs:
        story.append(Paragraph("Loads and constraints", h2))
        for lc in lcs:
            story.append(Paragraph(f"<b>{lc['name']}</b>", body))
            for bc in lc.get("boundary_conditions", []):
                pr = bc.get("params", {})
                desc = f"• {bc['bc_type']}"
                if pr.get("magnitude") is not None:
                    desc += f": {pr['magnitude']} {pr.get('units', '')}"
                if pr.get("direction"):
                    desc += f", direction {pr['direction']}"
                if bc.get("description"):
                    desc += f" — {bc['description']}"
                story.append(Paragraph(desc, body))

    for fea in ctx.get("fea") or []:
        story.append(Paragraph(f"FEA result — {fea.get('label', '')}", h2))
        if fea.get("is_mock"):
            story.append(Paragraph(
                "MOCK RESULT (demo/development mode): this block contains illustrative placeholder "
                "values because no solver was available. It must not be used for any decision.",
                warn_style))
        s = fea.get("summary", {})
        rows = [
            ["Elements / nodes", f"{_fmt(s.get('element_count'))} / {_fmt(s.get('node_count'))}",
             "Element type", s.get("element_type", "—")],
            ["Max displacement", _fmt(s.get("max_displacement_m"), 4, "m"),
             "Max von Mises", _fmt((s.get('max_von_mises_pa') or 0) / 1e6, 4, "MPa")],
            ["p95 von Mises", _fmt((s.get('p95_von_mises_pa') or 0) / 1e6, 4, "MPa"),
             "Converged", _fmt(s.get("converged"))],
            ["FoS (yield/peak)", _fmt(s.get("factor_of_safety_yield"), 3),
             "FoS valid", _fmt(s.get("fos_valid"))],
        ]
        t = Table(rows, colWidths=[32 * mm, 51 * mm, 32 * mm, 51 * mm])
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8),
                               ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey)]))
        story.append(t)
        if s.get("fos_note"):
            story.append(Paragraph(s["fos_note"], warn_style))
        if s.get("singularity_suspected"):
            story.append(Paragraph(
                "A stress singularity is suspected at the peak location: local peak values at sharp "
                "re-entrant corners or point constraints do not converge with mesh refinement; "
                "percentile values are more meaningful there.", warn_style))
        for a in fea.get("assumptions", []):
            story.append(Paragraph(f"• {a}", small))

    recs = ctx.get("recommendations") or []
    if recs:
        story.append(PageBreak())
        story.append(Paragraph("Recommendations", h2))
        for r in recs:
            story.append(Paragraph(
                f"<b>[{r.get('severity', '').upper()}] {r.get('title')}</b> "
                f"(rule {r.get('rule_id')}, confidence {r.get('confidence')})", body))
            story.append(Paragraph(f"Problem: {r.get('problem')}", body))
            story.append(Paragraph(f"Why: {r.get('rationale')}", body))
            story.append(Paragraph(f"Proposed change: {r.get('proposed_change')} "
                                   f"Expected benefit: {r.get('expected_benefit')}", body))
            if r.get("validation_required"):
                story.append(Paragraph(f"Validation required: {r['validation_required']}", small))
            story.append(Spacer(1, 4))

    comp = ctx.get("comparison")
    if comp and comp.get("rows"):
        story.append(Paragraph("Design-variant comparison", h2))
        header = ["Design", "Mass (kg)", "Max disp (m)", "p95 σvM (MPa)", "FoS", "Score"]
        data = [header]
        for row in comp["rows"]:
            data.append([
                row.get("name", "—"), _fmt(row.get("mass_kg"), 4),
                _fmt(row.get("max_displacement_m"), 3),
                _fmt((row.get("p95_von_mises_pa") or 0) / 1e6 if row.get("p95_von_mises_pa") else None, 4),
                _fmt(row.get("fos_yield"), 3) + ("" if row.get("fos_valid") else " *"),
                _fmt(row.get("score")),
            ])
        t = Table(data)
        t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8),
                               ("GRID", (0, 0), (-1, -1), 0.25, colors.lightgrey),
                               ("BACKGROUND", (0, 0), (-1, 0), colors.whitesmoke)]))
        story.append(t)
        story.append(Paragraph("* FoS shown for reference only (validity gates failed).", small))
        story.append(Paragraph(comp.get("score_explanation", ""), small))

    story.append(Paragraph("Warnings and limitations", h2))
    for w in ctx.get("warnings") or []:
        story.append(Paragraph(f"• {w}", warn_style))
    story.append(Paragraph(
        "• STL files carry no units, materials, tolerances or load information; all such inputs are "
        "user declarations. • Wall thickness, holes and features are estimated from the tessellation. "
        "• FEA here is preliminary linear statics; buckling, fatigue, nonlinearity, contact and "
        "thermal effects are not modeled unless stated.", small))

    repro = ctx.get("repro") or {}
    story.append(Paragraph("Reproducibility metadata", h2))
    for k, v in repro.items():
        story.append(Paragraph(f"{k}: {v}", small))

    doc.build(story)
