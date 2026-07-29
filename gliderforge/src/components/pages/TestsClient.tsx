"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, parseCsv, jsonField, downloadText, toCsv, type Row } from "../client";
import { Card, Grid, Tabs, Badge, TextInput, SelectInput, Field, Spinner, ErrorNotice, EmptyState, Stat, Checkbox } from "../ui";
import { LinePlot, ParityPlot, ResidualPlot } from "../Charts";
import { describe, flagOutliers, linearFit, powerLawFit, polynomialFit, comparePredictionToMeasurement, repeatability } from "@/lib/analysis/stats";
import { formatQty, convert, resolveUnit } from "@/lib/units";

interface Template {
  key: string;
  title: string;
  category: string;
  objective: string;
  equipment: string;
  setup: string;
  variables: { name: string; role: string; unit: string }[];
  procedure: string;
  safety: string;
  rawFields: { name: string; unit: string; note?: string }[];
  expected: string;
  passCriteria: string;
  uncertaintySources: string;
}

interface Predictions {
  diveSpeedMS: number;
  verticalSpeedMS: number;
  glideRatio: number;
  buoyancyAuthorityN: number;
  sweptVolumeCm3: number;
  designForceN: number;
  netBuoyancyN: number;
  totalMassKg: number;
  displacedVolumeCm3: number;
  equilibriumPitchDeg: number;
  averagePowerW: number;
}

const PREDICTION_OPTIONS: { key: keyof Predictions; label: string; unit: string }[] = [
  { key: "diveSpeedMS", label: "Predicted dive speed", unit: "m/s" },
  { key: "verticalSpeedMS", label: "Predicted vertical speed", unit: "m/s" },
  { key: "glideRatio", label: "Predicted glide ratio", unit: "-" },
  { key: "buoyancyAuthorityN", label: "Predicted buoyancy authority", unit: "N" },
  { key: "sweptVolumeCm3", label: "Predicted swept volume", unit: "cm^3" },
  { key: "designForceN", label: "Predicted design actuator force", unit: "N" },
  { key: "netBuoyancyN", label: "Predicted net buoyancy", unit: "N" },
  { key: "totalMassKg", label: "Predicted total mass", unit: "kg" },
  { key: "displacedVolumeCm3", label: "Predicted displaced volume", unit: "cm^3" },
  { key: "equilibriumPitchDeg", label: "Predicted equilibrium pitch", unit: "deg" },
  { key: "averagePowerW", label: "Predicted average power", unit: "W" },
];

export function TestsClient({
  projectId,
  tests,
  runs,
  requirements,
  templates,
  predictions,
  calibrationFactor,
}: {
  projectId: string;
  tests: Row[];
  runs: Row[];
  requirements: { id: string; key: string; title: string }[];
  templates: Template[];
  predictions: Predictions;
  calibrationFactor: number;
}) {
  const [tab, setTab] = React.useState("plans");
  const [error, setError] = React.useState<string | null>(null);

  return (
    <div className="space-y-4">
      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}
      <Tabs
        tabs={[
          { id: "plans", label: "Test plans", badge: tests.length },
          { id: "runs", label: "Recorded runs", badge: runs.length },
          { id: "analyse", label: "Data analysis" },
          { id: "compare", label: "Predicted vs measured" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "plans" && <TestPlans projectId={projectId} tests={tests} requirements={requirements} templates={templates} onError={setError} />}
      {tab === "runs" && <TestRuns projectId={projectId} tests={tests} runs={runs} onError={setError} />}
      {tab === "analyse" && <DataAnalysis runs={runs} tests={tests} />}
      {tab === "compare" && <PredictionComparison runs={runs} tests={tests} predictions={predictions} calibrationFactor={calibrationFactor} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TestPlans({
  projectId,
  tests,
  requirements,
  templates,
  onError,
}: {
  projectId: string;
  tests: Row[];
  requirements: { id: string; key: string; title: string }[];
  templates: Template[];
  onError: (m: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [draft, setDraft] = React.useState<Row>({});

  const addFromTemplate = async (t: Template) => {
    setBusy(true);
    try {
      await api.create(projectId, "tests", {
        key: t.key,
        title: t.title,
        category: t.category,
        objective: t.objective,
        equipment: t.equipment,
        setup: t.setup,
        variables_json: JSON.stringify(t.variables),
        procedure: t.procedure,
        safety: t.safety,
        raw_fields_json: JSON.stringify(t.rawFields),
        expected_result: t.expected,
        pass_criteria: t.passCriteria,
        uncertainty_sources: t.uncertaintySources,
        status: "planned",
        requirement_ids_json: JSON.stringify([]),
      });
      router.refresh();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      if (editing.id) await api.update(projectId, "tests", String(editing.id), draft);
      else await api.create(projectId, "tests", draft);
      setEditing(null);
      router.refresh();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const existingKeys = new Set(tests.map((t) => String(t.key)));

  return (
    <div className="space-y-4">
      <Card title="Add a test plan from a template" subtitle="Starting points for the tests this class of vehicle needs. Edit each one for your equipment and get the safety section reviewed before running it.">
        <div className="flex flex-wrap gap-1.5">
          {templates.map((t) => (
            <button
              key={t.key}
              className="gf-btn px-2 py-1 text-[11px]"
              onClick={() => addFromTemplate(t)}
              disabled={busy || existingKeys.has(t.key)}
              title={t.objective}
            >
              {existingKeys.has(t.key) ? "✓ " : "+ "}
              {t.key} {t.title}
            </button>
          ))}
        </div>
        <div className="mt-3">
          <button
            className="gf-btn gf-btn-primary"
            onClick={() => {
              setEditing({ id: "" });
              setDraft({ key: `TST-${String(tests.length + 1).padStart(3, "0")}`, status: "planned", category: "other", requirement_ids_json: "[]", variables_json: "[]", raw_fields_json: "[]" });
            }}
          >
            Write a test plan from scratch
          </button>
        </div>
      </Card>

      {editing && (
        <Card
          title={editing.id ? `Edit ${String(editing.key ?? "")}` : "New test plan"}
          actions={
            <>
              <button className="gf-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="gf-btn gf-btn-primary" onClick={save} disabled={busy}>
                {busy ? <Spinner label="Saving…" /> : "Save"}
              </button>
            </>
          }
        >
          <Grid cols={2}>
            <TextInput label="Test ID" value={String(draft.key ?? "")} onChange={(v) => setDraft((d) => ({ ...d, key: v }))} required />
            <TextInput label="Title" value={String(draft.title ?? "")} onChange={(v) => setDraft((d) => ({ ...d, title: v }))} required />
            <SelectInput
              label="Category"
              value={String(draft.category ?? "other")}
              onChange={(v) => setDraft((d) => ({ ...d, category: v }))}
              options={["leak", "mechanism", "buoyancy-engine", "buoyancy", "pressure", "actuator", "power", "performance", "control", "other"].map((c) => ({ value: c, label: c }))}
            />
            <SelectInput
              label="Status"
              value={String(draft.status ?? "planned")}
              onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
              options={[
                { value: "planned", label: "Planned" },
                { value: "ready", label: "Ready to run" },
                { value: "in-progress", label: "In progress" },
                { value: "complete", label: "Complete" },
                { value: "blocked", label: "Blocked" },
              ]}
            />
          </Grid>
          <div className="mt-3 space-y-3">
            <TextInput label="Objective" value={String(draft.objective ?? "")} onChange={(v) => setDraft((d) => ({ ...d, objective: v }))} multiline rows={2} hint="What question does this test answer?" />
            <TextInput label="Equipment" value={String(draft.equipment ?? "")} onChange={(v) => setDraft((d) => ({ ...d, equipment: v }))} multiline rows={2} />
            <TextInput label="Setup" value={String(draft.setup ?? "")} onChange={(v) => setDraft((d) => ({ ...d, setup: v }))} multiline rows={2} />
            <TextInput label="Procedure" value={String(draft.procedure ?? "")} onChange={(v) => setDraft((d) => ({ ...d, procedure: v }))} multiline rows={6} hint="Numbered steps someone else could follow without you present." />
            <TextInput label="Safety considerations" value={String(draft.safety ?? "")} onChange={(v) => setDraft((d) => ({ ...d, safety: v }))} multiline rows={3} hint="A test plan without a safety section is not ready to run." />
            <TextInput label="Expected result" value={String(draft.expected_result ?? "")} onChange={(v) => setDraft((d) => ({ ...d, expected_result: v }))} multiline rows={2} />
            <TextInput label="Pass criterion" value={String(draft.pass_criteria ?? "")} onChange={(v) => setDraft((d) => ({ ...d, pass_criteria: v }))} multiline rows={2} hint="Decide this BEFORE you run the test." />
            <TextInput label="Uncertainty sources" value={String(draft.uncertainty_sources ?? "")} onChange={(v) => setDraft((d) => ({ ...d, uncertainty_sources: v }))} multiline rows={3} />
            <Field label="Requirements verified by this test">
              <div className="flex flex-wrap gap-1.5">
                {requirements.map((r) => {
                  const ids = jsonField<string[]>(draft.requirement_ids_json, []);
                  const on = ids.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      className={`gf-btn px-2 py-1 text-[11px] ${on ? "gf-btn-primary" : ""}`}
                      aria-pressed={on}
                      onClick={() => {
                        const next = on ? ids.filter((x) => x !== r.id) : [...ids, r.id];
                        setDraft((d) => ({ ...d, requirement_ids_json: JSON.stringify(next) }));
                      }}
                    >
                      {r.key}
                    </button>
                  );
                })}
                {requirements.length === 0 && <span className="text-xs text-muted">No requirements defined yet.</span>}
              </div>
            </Field>
          </div>
        </Card>
      )}

      {tests.length === 0 ? (
        <EmptyState title="No test plans yet" body="Add one from a template above, or write your own. A plan written before the test forces you to decide the pass criterion in advance, which is the whole point." />
      ) : (
        <div className="space-y-2">
          {tests.map((t) => {
            const reqIds = jsonField<string[]>(t.requirement_ids_json, []);
            const linked = reqIds.map((id) => requirements.find((r) => r.id === id)).filter(Boolean);
            const open = expanded === String(t.id);
            return (
              <Card
                key={String(t.id)}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-muted">{String(t.key)}</span>
                    {String(t.title)}
                    <Badge tone={String(t.status) === "complete" ? "good" : "neutral"}>{String(t.status)}</Badge>
                    {linked.length === 0 ? <Badge tone="warning">no requirement linked</Badge> : linked.map((r) => <Badge key={r!.id} tone="accent">{r!.key}</Badge>)}
                  </span>
                }
                actions={
                  <>
                    <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setExpanded(open ? null : String(t.id))}>
                      {open ? "Collapse" : "Full plan"}
                    </button>
                    <button
                      className="gf-btn px-2 py-1 text-[11px]"
                      onClick={() => {
                        setEditing(t);
                        setDraft({ ...t });
                      }}
                    >
                      Edit
                    </button>
                  </>
                }
              >
                <p className="text-xs text-muted">{String(t.objective ?? "")}</p>
                {open && (
                  <div className="mt-3 space-y-3 text-xs">
                    <Section title="Equipment" body={String(t.equipment ?? "—")} />
                    <Section title="Setup" body={String(t.setup ?? "—")} />
                    <Section title="Procedure" body={String(t.procedure ?? "—")} />
                    <div className="rounded border border-[#d03b3b] p-2.5">
                      <h4 className="text-xs font-semibold text-[#d03b3b]">Safety</h4>
                      <p className="mt-1 whitespace-pre-wrap leading-relaxed text-muted">{String(t.safety ?? "No safety section recorded — this plan is not ready to run.")}</p>
                    </div>
                    <Section title="Expected result" body={String(t.expected_result ?? "—")} />
                    <Section title="Pass criterion" body={String(t.pass_criteria ?? "—")} />
                    <Section title="Uncertainty sources" body={String(t.uncertainty_sources ?? "—")} />
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Raw data fields</h4>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {jsonField<{ name: string; unit: string }[]>(t.raw_fields_json, []).map((f, i) => (
                          <Badge key={i} tone="neutral">
                            {f.name} [{f.unit}]
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h4>
      <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TestRuns({ projectId, tests, runs, onError }: { projectId: string; tests: Row[]; runs: Row[]; onError: (m: string) => void }) {
  const router = useRouter();
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<Row>({});
  const [csvText, setCsvText] = React.useState("");
  const [csvName, setCsvName] = React.useState<string | null>(null);

  const parsed = React.useMemo(() => (csvText.trim() ? parseCsv(csvText) : null), [csvText]);

  const save = async () => {
    setBusy(true);
    try {
      await api.create(projectId, "test_runs", {
        ...draft,
        raw_csv: csvText || null,
        columns_json: JSON.stringify(parsed?.headers ?? []),
        transformations_json: JSON.stringify([]),
      });
      setCreating(false);
      setDraft({});
      setCsvText("");
      setCsvName(null);
      router.refresh();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card
        title="Record a test run"
        actions={
          <button className="gf-btn gf-btn-primary" onClick={() => setCreating((c) => !c)} disabled={tests.length === 0}>
            {creating ? "Cancel" : "New run"}
          </button>
        }
      >
        {tests.length === 0 ? (
          <p className="text-xs text-muted">Create a test plan first — a run has to belong to a plan so its pass criterion is known in advance.</p>
        ) : (
          <p className="text-xs leading-relaxed text-muted">
            Raw data is stored exactly as imported and is never modified. If you need to exclude a point or transform a column, record that as
            a separate transformation with a reason — the original stays available, which is what makes the analysis defensible.
          </p>
        )}

        {creating && (
          <div className="mt-4 space-y-3">
            <Grid cols={3}>
              <SelectInput
                label="Test plan"
                value={String(draft.test_id ?? tests[0]?.id ?? "")}
                onChange={(v) => setDraft((d) => ({ ...d, test_id: v }))}
                options={tests.map((t) => ({ value: String(t.id), label: `${String(t.key)} — ${String(t.title)}` }))}
              />
              <TextInput label="Run label" value={String(draft.run_label ?? "")} onChange={(v) => setDraft((d) => ({ ...d, run_label: v }))} required placeholder="Run 1" />
              <Field label="Date performed">
                <input type="date" className="gf-input" value={String(draft.performed_on ?? "")} onChange={(e) => setDraft((d) => ({ ...d, performed_on: e.target.value }))} />
              </Field>
              <TextInput label="Operator" value={String(draft.operator ?? "")} onChange={(v) => setDraft((d) => ({ ...d, operator: v }))} />
              <SelectInput
                label="Pass / fail"
                value={String(draft.pass_fail ?? "")}
                onChange={(v) => setDraft((d) => ({ ...d, pass_fail: v || null }))}
                options={[
                  { value: "", label: "Not yet judged" },
                  { value: "pass", label: "Pass" },
                  { value: "fail", label: "Fail" },
                  { value: "inconclusive", label: "Inconclusive" },
                ]}
              />
            </Grid>
            <TextInput label="Result summary" value={String(draft.result_summary ?? "")} onChange={(v) => setDraft((d) => ({ ...d, result_summary: v }))} multiline rows={2} />
            <TextInput label="Conclusion" value={String(draft.conclusion ?? "")} onChange={(v) => setDraft((d) => ({ ...d, conclusion: v }))} multiline rows={2} hint="Judge it against the pass criterion written in the plan, not against what you hoped for." />
            <TextInput label="Recommended follow-up" value={String(draft.follow_up ?? "")} onChange={(v) => setDraft((d) => ({ ...d, follow_up: v }))} multiline rows={2} />

            <Field label="Raw data (CSV)" hint="Upload or paste. The first row is treated as the header. Stored verbatim.">
              <input
                type="file"
                accept=".csv,.txt"
                className="gf-input"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.size > 5_000_000) {
                    onError("CSV files above 5 MB are not accepted here — summarise the data first.");
                    return;
                  }
                  setCsvText(await f.text());
                  setCsvName(f.name);
                }}
              />
            </Field>
            <textarea
              className="gf-input font-mono text-[11px]"
              rows={6}
              placeholder="time_s,depth_m,speed_m_s&#10;0,0,0&#10;1,0.1,0.12"
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setCsvName(null);
              }}
              aria-label="Raw CSV data"
            />
            {parsed && (
              <div className="rounded border p-2 text-xs">
                <p className="font-medium">
                  {csvName ? `${csvName}: ` : ""}
                  {parsed.rows.length} data row(s), {parsed.headers.length} column(s)
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {parsed.headers.map((h) => {
                    const unitMatch = /[_(\[]([a-zA-Z^/*0-9]+)[)\]]?$/.exec(h.trim());
                    const known = unitMatch ? resolveUnit(unitMatch[1]) : undefined;
                    return (
                      <Badge key={h} tone={known ? "good" : "neutral"} title={known ? `Recognised unit: ${known.label}` : "No unit recognised in this column name"}>
                        {h}
                      </Badge>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  Column names ending in a recognised unit (e.g. <code>speed_m_s</code>, <code>force_N</code>) are tagged so the analysis tab
                  can convert them. Unrecognised columns are still imported, just without unit awareness.
                </p>
              </div>
            )}
            <button className="gf-btn gf-btn-primary" onClick={save} disabled={busy || !draft.run_label}>
              {busy ? <Spinner label="Saving…" /> : "Save run"}
            </button>
          </div>
        )}
      </Card>

      {runs.length === 0 ? (
        <EmptyState title="No test runs recorded" body="Nothing in this project has been validated experimentally yet. Even a bucket displacement test changes that." />
      ) : (
        <div className="space-y-2">
          {runs.map((r) => {
            const test = tests.find((t) => t.id === r.test_id);
            const transforms = jsonField<{ description: string; reason: string }[]>(r.transformations_json, []);
            return (
              <Card
                key={String(r.id)}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-muted">{test ? String(test.key) : "?"}</span>
                    {String(r.run_label)}
                    <Badge tone={String(r.pass_fail) === "pass" ? "good" : String(r.pass_fail) === "fail" ? "critical" : "neutral"}>
                      {String(r.pass_fail ?? "not judged")}
                    </Badge>
                  </span>
                }
                actions={
                  r.raw_csv ? (
                    <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => downloadText(`${String(r.run_label)}-raw.csv`, String(r.raw_csv), "text/csv")}>
                      Download raw CSV
                    </button>
                  ) : undefined
                }
              >
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  <div>
                    <span className="text-muted">Performed: </span>
                    {String(r.performed_on ?? "—")} · <span className="text-muted">Operator: </span>
                    {String(r.operator ?? "—")}
                  </div>
                  <div>
                    <span className="text-muted">Raw data: </span>
                    {r.raw_csv ? `${jsonField<string[]>(r.columns_json, []).length} columns, ${String(r.raw_csv).split("\n").length - 1} rows` : "none attached"}
                  </div>
                </div>
                {r.result_summary ? <p className="mt-2 text-xs">{String(r.result_summary)}</p> : null}
                {r.conclusion ? (
                  <p className="mt-1 text-xs">
                    <strong>Conclusion: </strong>
                    {String(r.conclusion)}
                  </p>
                ) : null}
                {transforms.length > 0 && (
                  <div className="mt-2 rounded border p-2">
                    <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Transformations applied</h4>
                    <ul className="ml-4 mt-1 list-disc space-y-0.5 text-[11px] text-muted">
                      {transforms.map((t, i) => (
                        <li key={i}>
                          <strong className="text-ink">{t.description}</strong> — {t.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function DataAnalysis({ runs, tests }: { runs: Row[]; tests: Row[] }) {
  const withData = runs.filter((r) => r.raw_csv);
  const [runId, setRunId] = React.useState<string>(withData[0] ? String(withData[0].id) : "");
  const [xCol, setXCol] = React.useState("");
  const [yCol, setYCol] = React.useState("");
  const [model, setModel] = React.useState<"linear" | "quadratic" | "power">("linear");
  const [excluded, setExcluded] = React.useState<Set<number>>(new Set());
  const [reason, setReason] = React.useState("");

  const run = withData.find((r) => String(r.id) === runId);
  const parsed = React.useMemo(() => (run?.raw_csv ? parseCsv(String(run.raw_csv)) : null), [run]);

  React.useEffect(() => {
    if (parsed && parsed.headers.length > 0) {
      setXCol((c) => (parsed.headers.includes(c) ? c : parsed.headers[0]));
      setYCol((c) => (parsed.headers.includes(c) ? c : parsed.headers[1] ?? parsed.headers[0]));
      setExcluded(new Set());
    }
  }, [parsed]);

  const numeric = React.useMemo(() => {
    if (!parsed) return null;
    const xi = parsed.headers.indexOf(xCol);
    const yi = parsed.headers.indexOf(yCol);
    if (xi < 0 || yi < 0) return null;
    const pairs = parsed.rows.map((row, index) => ({ index, x: Number(row[xi]), y: Number(row[yi]) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    return pairs;
  }, [parsed, xCol, yCol]);

  const kept = numeric?.filter((p) => !excluded.has(p.index)) ?? [];
  const stats = describe(kept.map((p) => p.y));
  const outliers = flagOutliers(numeric?.map((p) => p.y) ?? []);
  const fit = React.useMemo(() => {
    if (kept.length < 2) return null;
    const xs = kept.map((p) => p.x);
    const ys = kept.map((p) => p.y);
    if (model === "linear") return linearFit(xs, ys);
    if (model === "quadratic") return polynomialFit(xs, ys, 2);
    return powerLawFit(xs, ys);
  }, [kept, model]);

  if (withData.length === 0) {
    return <EmptyState title="No runs with raw data" body="Attach a CSV to a test run to analyse it here: descriptive statistics, curve fitting, residuals, confidence intervals and outlier flagging." />;
  }

  const scatter = kept.map((p) => ({ x: Number(p.x.toPrecision(6)), measured: Number(p.y.toPrecision(6)), fitted: fit ? Number(fit.predict(p.x).toPrecision(6)) : 0 }));
  const residuals = fit ? fit.residuals.map((r) => ({ x: Number(r.x.toPrecision(6)), residual: Number(r.residual.toPrecision(6)) })) : [];

  return (
    <div className="space-y-4">
      <Card title="Select data">
        <Grid cols={4}>
          <SelectInput
            label="Test run"
            value={runId}
            onChange={setRunId}
            options={withData.map((r) => {
              const t = tests.find((x) => x.id === r.test_id);
              return { value: String(r.id), label: `${t ? String(t.key) : "?"} — ${String(r.run_label)}` };
            })}
          />
          <SelectInput label="X column" value={xCol} onChange={setXCol} options={(parsed?.headers ?? []).map((h) => ({ value: h, label: h }))} />
          <SelectInput label="Y column" value={yCol} onChange={setYCol} options={(parsed?.headers ?? []).map((h) => ({ value: h, label: h }))} />
          <SelectInput
            label="Fit model"
            value={model}
            onChange={(v) => setModel(v as typeof model)}
            options={[
              { value: "linear", label: "Linear y = a·x + b" },
              { value: "quadratic", label: "Quadratic (degree 2)" },
              { value: "power", label: "Power law y = a·x^b" },
            ]}
          />
        </Grid>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Points used" value={`${kept.length}`} hint={excluded.size > 0 ? `${excluded.size} excluded` : "None excluded"} />
        <Stat label="Mean of Y" value={Number.isFinite(stats.mean) ? stats.mean.toPrecision(5) : "—"} />
        <Stat label="Standard deviation" value={Number.isFinite(stats.stdDev) ? stats.stdDev.toPrecision(4) : "—"} hint="Sample, n−1" />
        <Stat label="95% CI on the mean" value={Number.isFinite(stats.ci95HalfWidth) ? `± ${stats.ci95HalfWidth.toPrecision(3)}` : "—"} hint="Student's t" />
      </div>

      <Grid cols={2}>
        <LinePlot
          title={`${yCol} versus ${xCol}`}
          subtitle={fit ? `Fit: ${fit.equation}` : "Not enough points to fit"}
          data={scatter}
          xKey="x"
          xLabel={xCol}
          yLabel={yCol}
          series={[
            { key: "measured", label: "Measured" },
            { key: "fitted", label: "Fitted model" },
          ]}
          filename={`analysis-${xCol}-${yCol}`}
          note="Measured points and the fitted model on the same axes. Excluded points are omitted from both the fit and this plot; the raw CSV still contains them."
        />
        {fit && residuals.length > 0 && (
          <ResidualPlot
            data={residuals}
            filename="residuals"
            unit={yCol}
            note="Look for structure. A curved or fanning residual pattern means the model form is wrong — no amount of refitting the same form will help."
          />
        )}
      </Grid>

      <Grid cols={2}>
        <Card title="Fit quality">
          {fit ? (
            <div className="space-y-2">
              <table className="gf-table">
                <tbody>
                  <tr>
                    <td className="font-medium">Model</td>
                    <td>{fit.model}</td>
                  </tr>
                  <tr>
                    <td className="font-medium">Equation</td>
                    <td className="font-mono text-[11px]">{fit.equation}</td>
                  </tr>
                  {fit.coefficients.map((c, i) => (
                    <tr key={i}>
                      <td className="font-medium">{fit.coefficientNames[i]}</td>
                      <td>
                        {c.toPrecision(6)}
                        {Number.isFinite(fit.coefficientCi95[i]) && <span className="text-muted"> ± {fit.coefficientCi95[i].toPrecision(3)} (95%)</span>}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="font-medium">R²</td>
                    <td>{Number.isFinite(fit.rSquared) ? fit.rSquared.toFixed(4) : "—"}</td>
                  </tr>
                  <tr>
                    <td className="font-medium">Adjusted R²</td>
                    <td>{Number.isFinite(fit.adjustedRSquared) ? fit.adjustedRSquared.toFixed(4) : "—"}</td>
                  </tr>
                  <tr>
                    <td className="font-medium">RMSE</td>
                    <td>{Number.isFinite(fit.rmse) ? fit.rmse.toPrecision(4) : "—"}</td>
                  </tr>
                  <tr>
                    <td className="font-medium">MAE</td>
                    <td>{Number.isFinite(fit.mae) ? fit.mae.toPrecision(4) : "—"}</td>
                  </tr>
                  <tr>
                    <td className="font-medium">Degrees of freedom</td>
                    <td>{fit.degreesOfFreedom}</td>
                  </tr>
                </tbody>
              </table>
              {fit.warnings.length > 0 && (
                <ul className="ml-4 list-disc space-y-1 text-[11px] text-muted">
                  {fit.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted">Select two numeric columns with at least two valid rows.</p>
          )}
        </Card>

        <Card title="Outliers and exclusions" subtitle="Flagged, never deleted.">
          {outliers.length === 0 ? (
            <p className="text-xs text-muted">No points flagged by either the modified z-score or the Tukey fence.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {outliers.map((o) => (
                <li key={`${o.index}-${o.method}`} className="rounded border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      <strong>Row {o.index + 1}</strong>: {o.value.toPrecision(5)}
                    </span>
                    <Badge tone={o.method === "modified-z" ? "critical" : "warning"}>{o.method}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-muted">{o.reason}</p>
                  <Checkbox
                    label="Exclude this point from the fit"
                    checked={excluded.has(o.index)}
                    onChange={(on) =>
                      setExcluded((s) => {
                        const n = new Set(s);
                        if (on) n.add(o.index);
                        else n.delete(o.index);
                        return n;
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          {excluded.size > 0 && (
            <div className="mt-3 rounded border border-[#fab219] p-2">
              <TextInput
                label="Reason for excluding these points"
                value={reason}
                onChange={setReason}
                multiline
                rows={2}
                hint="Required before the exclusion means anything. 'It looked wrong' is not a reason; 'the stopwatch was restarted mid-run, see notebook 2026-03-14' is."
              />
              <p className="mt-1 text-[11px] text-muted">
                Exclusions here affect this on-screen fit only. The stored raw data is untouched — record the exclusion as a transformation on
                the test run to make it part of the record.
              </p>
            </div>
          )}
        </Card>
      </Grid>

      <Card title="Descriptive statistics for the Y column">
        <div className="gf-scroll-x">
          <table className="gf-table">
            <tbody>
              <tr>
                <td className="font-medium">n</td>
                <td>{stats.n}</td>
                <td className="font-medium">Mean</td>
                <td>{Number.isFinite(stats.mean) ? stats.mean.toPrecision(6) : "—"}</td>
                <td className="font-medium">Median</td>
                <td>{Number.isFinite(stats.median) ? stats.median.toPrecision(6) : "—"}</td>
              </tr>
              <tr>
                <td className="font-medium">Min</td>
                <td>{Number.isFinite(stats.min) ? stats.min.toPrecision(6) : "—"}</td>
                <td className="font-medium">Max</td>
                <td>{Number.isFinite(stats.max) ? stats.max.toPrecision(6) : "—"}</td>
                <td className="font-medium">Range</td>
                <td>{Number.isFinite(stats.range) ? stats.range.toPrecision(6) : "—"}</td>
              </tr>
              <tr>
                <td className="font-medium">Std dev</td>
                <td>{Number.isFinite(stats.stdDev) ? stats.stdDev.toPrecision(5) : "—"}</td>
                <td className="font-medium">Std error</td>
                <td>{Number.isFinite(stats.stdError) ? stats.stdError.toPrecision(5) : "—"}</td>
                <td className="font-medium">CV</td>
                <td>{Number.isFinite(stats.coefficientOfVariation) ? `${(stats.coefficientOfVariation * 100).toFixed(2)} %` : "—"}</td>
              </tr>
              <tr>
                <td className="font-medium">Q1</td>
                <td>{Number.isFinite(stats.q1) ? stats.q1.toPrecision(5) : "—"}</td>
                <td className="font-medium">Q3</td>
                <td>{Number.isFinite(stats.q3) ? stats.q3.toPrecision(5) : "—"}</td>
                <td className="font-medium">IQR</td>
                <td>{Number.isFinite(stats.iqr) ? stats.iqr.toPrecision(5) : "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted">
          Repeatability across repeated runs of the same condition: pooled standard deviation{" "}
          {(() => {
            const rep = repeatability([kept.map((p) => p.y)]);
            return Number.isFinite(rep.pooledStdDev) ? `${rep.pooledStdDev.toPrecision(4)}, ISO 5725 repeatability limit ${rep.repeatabilityLimit95.toPrecision(4)}` : "not available from a single group";
          })()}
          . To get a meaningful repeatability figure, record several runs of the same condition and compare them.
        </p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PredictionComparison({
  runs,
  tests,
  predictions,
  calibrationFactor,
}: {
  runs: Row[];
  tests: Row[];
  predictions: Predictions;
  calibrationFactor: number;
}) {
  const withData = runs.filter((r) => r.raw_csv);
  const [runId, setRunId] = React.useState<string>(withData[0] ? String(withData[0].id) : "");
  const [column, setColumn] = React.useState("");
  const [predictionKey, setPredictionKey] = React.useState<keyof Predictions>("diveSpeedMS");
  const [measuredUnit, setMeasuredUnit] = React.useState("");

  const run = withData.find((r) => String(r.id) === runId);
  const parsed = React.useMemo(() => (run?.raw_csv ? parseCsv(String(run.raw_csv)) : null), [run]);

  React.useEffect(() => {
    if (parsed && parsed.headers.length > 0) setColumn((c) => (parsed.headers.includes(c) ? c : parsed.headers[0]));
  }, [parsed]);

  const spec = PREDICTION_OPTIONS.find((p) => p.key === predictionKey)!;
  const predictedValue = predictions[predictionKey];

  const measured = React.useMemo(() => {
    if (!parsed) return [];
    const i = parsed.headers.indexOf(column);
    if (i < 0) return [];
    const raw = parsed.rows.map((r) => Number(r[i])).filter((n) => Number.isFinite(n));
    if (!measuredUnit || !resolveUnit(measuredUnit) || !resolveUnit(spec.unit)) return raw;
    try {
      return raw.map((n) => convert(n, measuredUnit, spec.unit));
    } catch {
      return raw;
    }
  }, [parsed, column, measuredUnit, spec.unit]);

  const comparison = React.useMemo(
    () => (measured.length > 0 ? comparePredictionToMeasurement(measured.map(() => predictedValue), measured) : null),
    [measured, predictedValue],
  );

  if (withData.length === 0) {
    return (
      <EmptyState
        title="No measured data to compare against"
        body={
          <>
            Record a test run with a CSV first. Once you have measurements, this tab computes bias, RMSE, a calibration factor and its
            confidence interval, and draws a predicted-versus-measured parity plot.
          </>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Pair a prediction with a measurement">
        <Grid cols={4}>
          <SelectInput
            label="Test run"
            value={runId}
            onChange={setRunId}
            options={withData.map((r) => {
              const t = tests.find((x) => x.id === r.test_id);
              return { value: String(r.id), label: `${t ? String(t.key) : "?"} — ${String(r.run_label)}` };
            })}
          />
          <SelectInput label="Measured column" value={column} onChange={setColumn} options={(parsed?.headers ?? []).map((h) => ({ value: h, label: h }))} />
          <TextInput
            label="Unit of that column"
            value={measuredUnit}
            onChange={setMeasuredUnit}
            placeholder={spec.unit}
            hint={`Leave blank if it is already in ${spec.unit}. Entering a recognised unit converts it before comparing.`}
          />
          <SelectInput
            label="Prediction to compare against"
            value={predictionKey}
            onChange={(v) => setPredictionKey(v as keyof Predictions)}
            options={PREDICTION_OPTIONS.map((p) => ({ value: p.key, label: `${p.label} (${p.unit})` }))}
          />
        </Grid>
        <p className="mt-2 text-xs text-muted">
          Current prediction: <strong className="text-ink">{formatQty({ value: predictedValue, unit: spec.unit }, 5)}</strong>
          {calibrationFactor !== 1 && <> — note the drag model already carries a calibration factor of {calibrationFactor.toFixed(3)}.</>}
        </p>
      </Card>

      {comparison && comparison.n > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Measurements compared" value={String(comparison.n)} />
            <Stat label="Mean measured" value={comparison.meanMeasured.toPrecision(5)} unit={spec.unit} />
            <Stat
              label="Bias (predicted − measured)"
              value={comparison.bias.toPrecision(4)}
              unit={spec.unit}
              hint={Number.isFinite(comparison.biasPercent) ? `${comparison.biasPercent.toFixed(1)}% of the measured mean` : undefined}
              tone={Math.abs(comparison.biasPercent) > 30 ? "critical" : Math.abs(comparison.biasPercent) > 10 ? "warning" : "good"}
            />
            <Stat label="RMSE" value={comparison.rmse.toPrecision(4)} unit={spec.unit} />
            <Stat label="Mean absolute error" value={comparison.mae.toPrecision(4)} unit={spec.unit} />
            <Stat label="Maximum absolute error" value={comparison.maxAbsError.toPrecision(4)} unit={spec.unit} />
            <Stat
              label="Calibration factor"
              value={Number.isFinite(comparison.calibrationFactor) ? comparison.calibrationFactor.toFixed(3) : "—"}
              hint={Number.isFinite(comparison.calibrationFactorCi95) ? `± ${comparison.calibrationFactorCi95.toFixed(3)} (95%)` : "Least-squares slope through the origin"}
              tone={Math.abs(comparison.calibrationFactor - 1) > 0.5 ? "critical" : undefined}
            />
            <Stat label="R² against measurement" value={Number.isFinite(comparison.rSquared) ? comparison.rSquared.toFixed(3) : "—"} />
          </div>

          <Card title="Verdict">
            <p className="text-sm">{comparison.verdict}</p>
            <ul className="ml-4 mt-2 list-disc space-y-1 text-[11px] text-muted">
              {comparison.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
            <div className="mt-3 rounded border p-2.5 text-[11px] leading-snug text-muted">
              <strong className="text-ink">To apply a calibration: </strong>
              enter the factor above in{" "}
              <Link href="/settings" className="underline">
                Settings → Hydrodynamics
              </Link>{" "}
              and set the modelling level to &ldquo;calibrated&rdquo;. The uncalibrated buildup is always retained and shown alongside, so
              the original prediction stays visible in every report.
            </div>
          </Card>

          <Grid cols={2}>
            <ParityPlot
              title="Predicted versus measured"
              data={measured.map((m) => ({ predicted: predictedValue, measured: m }))}
              filename="parity"
              unit={spec.unit}
              note="Points on the dashed line agree perfectly. Because a single prediction is being compared with many measurements, the points form a vertical line — its spread is the measurement scatter, its offset from the diagonal is the model bias."
            />
            <Card title="Why they might differ">
              <ul className="ml-4 list-disc space-y-2 text-xs leading-relaxed text-muted">
                <li>
                  <strong className="text-ink">Missing drag sources.</strong> Brackets, screw heads, tape seams, a wet antenna or a tether are
                  zero in the model unless you entered an appendage allowance — and they commonly account for 10–40% of total drag.
                </li>
                <li>
                  <strong className="text-ink">The vehicle never reached steady glide.</strong> In a shallow tank the dive is over in seconds.
                  Set a velocity time constant in the mission simulator and see how much the transient matters.
                </li>
                <li>
                  <strong className="text-ink">Net buoyancy is not what you think.</strong> Trapped air, wet foam or a mis-set engine position
                  changes the driving force by a large percentage, because buoyancy is a small difference of two large numbers.
                </li>
                <li>
                  <strong className="text-ink">Trim was different.</strong> If the vehicle was not at the assumed angle of attack, the real
                  coefficients are not the ones in the model.
                </li>
                <li>
                  <strong className="text-ink">The measurement itself.</strong> Hand timing, parallax, tank wall effects and where you decided
                  the steady glide began are all real sources of scatter — the uncertainty section of the test plan is where they belong.
                </li>
              </ul>
              <p className="mt-2 text-[11px] text-muted">
                Work down that list before adjusting a coefficient. Tuning a coefficient to absorb a missing physical effect makes the model
                fit today&apos;s data and mispredict tomorrow&apos;s.
              </p>
            </Card>
          </Grid>
        </>
      )}
    </div>
  );
}
