"use client";

import React from "react";
import { downloadText, type Row } from "../client";
import { Card, Grid, Badge, Spinner, ErrorNotice, Tabs } from "../ui";
import { Markdown } from "../Markdown";

interface CatalogEntry {
  kind: string;
  title: string;
  description: string;
  csv: boolean;
}

export function ReportsClient({
  projectId,
  projectName,
  revision,
  catalog,
  stored,
}: {
  projectId: string;
  projectName: string;
  revision: string;
  catalog: CatalogEntry[];
  stored: Row[];
}) {
  const [tab, setTab] = React.useState("generate");
  const [active, setActive] = React.useState<string | null>(null);
  const [markdown, setMarkdown] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = async (kind: string, save = false) => {
    setBusy(true);
    setError(null);
    setActive(kind);
    try {
      const res = await fetch(`/api/projects/${projectId}/reports/${kind}?format=json${save ? "&save=1" : ""}`);
      if (!res.ok) throw new Error(`Report generation failed (HTTP ${res.status}).`);
      const json = (await res.json()) as { markdown: string };
      setMarkdown(json.markdown);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMarkdown(null);
    } finally {
      setBusy(false);
    }
  };

  const filename = (kind: string, ext: string) => `${projectName.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}-${kind}-rev${revision}.${ext}`;

  return (
    <div className="space-y-4">
      {error && <ErrorNotice title="Could not generate the report" detail={error} onRetry={() => setError(null)} />}

      <Tabs
        tabs={[
          { id: "generate", label: "Generate" },
          { id: "stored", label: "Saved reports", badge: stored.length },
          { id: "formats", label: "Export formats" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "generate" && (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card title="Available reports" dense>
            <ul className="max-h-[640px] divide-y overflow-y-auto">
              {catalog.map((c) => (
                <li key={c.kind} className={`p-3 ${active === c.kind ? "bg-surface" : ""}`}>
                  <button className="text-left" onClick={() => load(c.kind)}>
                    <span className="text-sm font-medium hover:underline">{c.title}</span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted">{c.description}</span>
                  </button>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <a className="gf-btn px-2 py-0.5 text-[10px]" href={`/api/projects/${projectId}/reports/${c.kind}?download=1`} download={filename(c.kind, "md")}>
                      Markdown
                    </a>
                    {c.csv && (
                      <a className="gf-btn px-2 py-0.5 text-[10px]" href={`/api/projects/${projectId}/reports/${c.kind}?format=csv`} download={filename(c.kind, "csv")}>
                        CSV
                      </a>
                    )}
                    <button className="gf-btn px-2 py-0.5 text-[10px]" onClick={() => load(c.kind, true)}>
                      Generate &amp; save
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <div className="space-y-3">
            {markdown ? (
              <Card
                title={catalog.find((c) => c.kind === active)?.title ?? "Report"}
                actions={
                  <>
                    <button className="gf-btn" onClick={() => downloadText(filename(active ?? "report", "md"), markdown, "text/markdown")}>
                      Download .md
                    </button>
                    <button className="gf-btn" onClick={() => window.print()} title="Use your browser's print dialogue and choose 'Save as PDF'">
                      Print / PDF
                    </button>
                  </>
                }
              >
                <div className="gf-prose max-h-[70vh] overflow-y-auto">
                  <Markdown source={markdown} />
                </div>
              </Card>
            ) : busy ? (
              <Card>
                <Spinner label="Generating…" />
              </Card>
            ) : (
              <Card title="Select a report">
                <p className="text-xs leading-relaxed text-muted">
                  Choose a report on the left to preview it here. Every one is generated live from your current project data, so a report is
                  never stale — but that also means a report you generated yesterday and one you generate today may differ. Use{" "}
                  <strong className="text-ink">Generate &amp; save</strong> to freeze a copy in the project when you issue it.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      {tab === "stored" && (
        <Card title="Saved report versions">
          {stored.length === 0 ? (
            <p className="text-xs text-muted">
              No reports have been saved. Saving a report freezes its text at the moment you issued it, which is what you want when a report
              has gone to an advisor and the design has moved on since.
            </p>
          ) : (
            <div className="gf-scroll-x">
              <table className="gf-table">
                <thead>
                  <tr>
                    <th>Report</th>
                    <th>Kind</th>
                    <th>Revision</th>
                    <th>Generated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {stored.map((r) => (
                    <tr key={String(r.id)}>
                      <td className="font-medium">{String(r.title)}</td>
                      <td className="font-mono text-[11px]">{String(r.kind)}</td>
                      <td>{String(r.revision)}</td>
                      <td className="text-[11px] text-muted">{String(r.generated_at).slice(0, 16).replace("T", " ")}</td>
                      <td>
                        <div className="flex gap-1">
                          <button className="gf-btn px-2 py-0.5 text-[10px]" onClick={() => setMarkdown(String(r.content))}>
                            View
                          </button>
                          <button
                            className="gf-btn px-2 py-0.5 text-[10px]"
                            onClick={() => downloadText(`${String(r.kind)}-${String(r.generated_at).slice(0, 10)}.md`, String(r.content), "text/markdown")}
                          >
                            Download
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === "formats" && (
        <Grid cols={2}>
          <Card title="Formats and how to get them">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>How</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="font-medium">Markdown</td>
                  <td>Download button on any report. Plain text, version-controllable, pastes into most report tooling.</td>
                </tr>
                <tr>
                  <td className="font-medium">Printable HTML / PDF</td>
                  <td>
                    Preview a report and use <strong>Print / PDF</strong>. Print styles hide the navigation, keep panels from breaking across
                    pages, and produce selectable text rather than a raster image.
                  </td>
                </tr>
                <tr>
                  <td className="font-medium">CSV</td>
                  <td>Available for the tabular reports (mass budget, requirements, traceability, risks, bill of materials, power budget, test plans).</td>
                </tr>
                <tr>
                  <td className="font-medium">JSON</td>
                  <td>
                    Append <code className="rounded bg-surface px-1">?format=json</code> to any report URL, or export the whole project from the
                    Projects page.
                  </td>
                </tr>
                <tr>
                  <td className="font-medium">PNG / SVG plots</td>
                  <td>
                    Every chart offers its underlying data as CSV, and the browser&apos;s print-to-PDF captures the rendered vector chart.
                    For a raster copy, screenshot the chart panel.
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card title="What every report contains">
            <ul className="ml-4 list-disc space-y-1.5 text-xs leading-relaxed text-muted">
              <li>Project name, revision and generation timestamp.</li>
              <li>The environment and the exact water density used, with the correlation named and cited.</li>
              <li>Input values with units, and the equations they were put through.</li>
              <li>Assumptions, each with its basis.</li>
              <li>Every warning the model raised at generation time.</li>
              <li>Requirement verification counts and the number of test runs recorded.</li>
              <li>
                A standing statement that the results are preliminary engineering estimates, not proof of performance or safety, and that
                nothing has been experimentally validated unless a test run says so.
              </li>
            </ul>
            <p className="mt-3 text-[11px] leading-snug text-muted">
              That last item is not boilerplate to delete before submitting. A report that states its limitations reads as more competent, not
              less — and a reviewer who finds an undisclosed limitation trusts the rest of the document less.
            </p>
          </Card>
        </Grid>
      )}
    </div>
  );
}
