import { getProject, createRow } from "@/lib/db/repo";
import { buildSnapshot } from "@/lib/project/snapshot";
import { generateReport, REPORT_CATALOG, toCsv, type ReportKind } from "@/lib/reports/generate";
import { fail, handleError } from "@/lib/api";

export const dynamic = "force-dynamic";

const KINDS = new Set(REPORT_CATALOG.map((r) => r.kind as string));

export async function GET(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const { id, kind } = await params;
    const project = getProject(id);
    if (!project) return fail("Project not found.", 404);
    if (!KINDS.has(kind)) return fail(`Unknown report "${kind}".`, 404);

    const url = new URL(req.url);
    const format = url.searchParams.get("format") ?? "markdown";
    const save = url.searchParams.get("save") === "1";

    const snap = buildSnapshot(project);
    const report = generateReport(kind as ReportKind, snap);

    if (save) {
      createRow("reports", id, {
        kind,
        title: report.title,
        format: "markdown",
        content: report.markdown,
        generated_at: new Date().toISOString(),
      });
    }

    const filename = `${project.slug}-${kind}-rev${snap.settings.project.revision}`;

    if (format === "json") {
      return Response.json({ title: report.title, markdown: report.markdown, generatedAt: new Date().toISOString() });
    }
    if (format === "csv") {
      const rows = csvFor(kind, snap);
      if (!rows) return fail(`Report "${kind}" has no tabular CSV form. Use markdown or json.`, 400);
      return new Response(toCsv(rows), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}.csv"` },
      });
    }
    return new Response(report.markdown, {
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${filename}.md"`,
      },
    });
  } catch (e) {
    return handleError(e, "GET report");
  }
}

type Snap = ReturnType<typeof buildSnapshot>;

function csvFor(kind: string, snap: Snap): Record<string, unknown>[] | null {
  switch (kind) {
    case "mass-budget":
      return snap.massProps.contributions.map((c) => ({
        component: c.name,
        category: c.category,
        mass_kg: c.massKnown ? c.massSI : "",
        mass_known: c.massKnown,
        mass_fraction: c.massFraction,
        displacement_mode: c.displacementMode,
        displaced_volume_m3: c.volumeKnown ? c.volumeSI : "",
      }));
    case "requirements":
    case "traceability":
      return snap.requirements.map((r) => ({
        id: r.key,
        title: r.title,
        category: r.category,
        comparator: r.comparator,
        target_value: r.target_value,
        target_unit: r.target_unit,
        tolerance: r.tolerance,
        priority: r.priority,
        verification_method: r.verification_method,
        verification_status: r.verification_status,
        source: r.source,
      }));
    case "risk-register":
      return snap.risks.map((r) => ({
        id: r.key,
        description: r.description,
        cause: r.cause,
        consequence: r.consequence,
        likelihood: r.likelihood,
        severity: r.severity,
        detectability: r.detectability,
        rpn: Number(r.likelihood) * Number(r.severity) * Number(r.detectability),
        mitigation: r.mitigation,
        contingency: r.contingency,
        owner: r.owner,
        status: r.status,
        team_reviewed: Number(r.reviewed) === 1,
      }));
    case "bom":
      return snap.components.map((c) => ({
        part_number: c.part_number,
        name: c.name,
        category: c.category,
        quantity: c.quantity,
        material: c.material_name,
        supplier: c.supplier,
        unit_cost_usd: c.cost,
        extended_cost_usd: c.cost === null || c.cost === undefined ? "" : Number(c.cost) * Number(c.quantity ?? 1),
      }));
    case "power-budget":
      return snap.power.breakdown.map((b) => ({
        load: b.name,
        subsystem: b.subsystem,
        active_power_w: b.activePowerW,
        average_power_w: b.averagePowerW,
        share_of_average: b.shareOfAverage,
        provenance: b.provenance,
      }));
    case "test-plans":
      return snap.tests.map((t) => ({
        id: t.key,
        title: t.title,
        category: t.category,
        objective: t.objective,
        pass_criteria: t.pass_criteria,
        status: t.status,
      }));
    default:
      return null;
  }
}
