"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RecordEditor, type FieldSpec } from "./RecordEditor";
import { api, jsonField, type Row } from "../client";
import { Badge, Card, Spinner, ErrorNotice } from "../ui";

interface Criterion {
  name: string;
  weight: number;
}
interface Alternative {
  name: string;
  note?: string;
}

const FIELDS: FieldSpec[] = [
  { key: "key", label: "Decision ID", type: "text", required: true, placeholder: "DEC-001" },
  { key: "statement", label: "Decision statement", type: "text", required: true, hint: "Write the decision as a sentence: 'Use X rather than Y'." },
  { key: "context", label: "Context", type: "textarea", rows: 2, hint: "What forced the decision and what constrained it." },
  { key: "chosen", label: "Chosen alternative", type: "text", hint: "Must match one of the alternative names in the matrix below." },
  { key: "advantages", label: "Advantages", type: "textarea", rows: 2 },
  { key: "disadvantages", label: "Disadvantages", type: "textarea", rows: 2 },
  { key: "risks", label: "Risks created by this choice", type: "textarea", rows: 2 },
  {
    key: "status",
    label: "Approval status",
    type: "select",
    options: [
      { value: "proposed", label: "Proposed" },
      { value: "accepted", label: "Accepted" },
      { value: "superseded", label: "Superseded" },
      { value: "rejected", label: "Rejected" },
    ],
  },
  { key: "decided_on", label: "Decided on", type: "date" },
  { key: "revision_reason", label: "Reason for revision", type: "textarea", rows: 2, hint: "Required if you change a decision that was already accepted." },
];

/**
 * Weighted decision matrix with a sensitivity check.
 *
 * The sensitivity test perturbs each criterion weight by ±25% one at a time
 * and reports whether the winner changes. A matrix whose result flips under
 * that perturbation is not evidence — the criteria are not really separating
 * the alternatives.
 */
function analyseMatrix(criteria: Criterion[], alternatives: Alternative[], scores: Record<string, number[]>) {
  const totalFor = (alt: string, weights: number[]) =>
    criteria.reduce((s, _c, i) => s + weights[i] * ((scores[alt] ?? [])[i] ?? 0), 0);
  const baseWeights = criteria.map((c) => c.weight);
  const ranked = alternatives
    .map((a) => ({ name: a.name, total: totalFor(a.name, baseWeights) }))
    .sort((x, y) => y.total - x.total);
  const winner = ranked[0]?.name;
  const margin = ranked.length > 1 ? ranked[0].total - ranked[1].total : Infinity;

  const flips: string[] = [];
  for (let i = 0; i < criteria.length; i++) {
    for (const factor of [0.75, 1.25]) {
      const w = [...baseWeights];
      w[i] = w[i] * factor;
      const best = alternatives.map((a) => ({ name: a.name, total: totalFor(a.name, w) })).sort((x, y) => y.total - x.total)[0];
      if (best && winner && best.name !== winner) {
        flips.push(`Changing the weight on "${criteria[i].name}" by ${factor > 1 ? "+25%" : "−25%"} makes "${best.name}" win instead.`);
      }
    }
  }
  return { ranked, winner, margin, flips: [...new Set(flips)] };
}

export function DecisionsClient({ projectId, rows }: { projectId: string; rows: Row[] }) {
  const router = useRouter();
  const [openMatrix, setOpenMatrix] = React.useState<string | null>(null);
  const nextKey = React.useMemo(() => {
    const nums = rows.map((r) => /^DEC-(\d+)$/.exec(String(r.key ?? ""))).filter(Boolean).map((m) => Number(m![1]));
    return `DEC-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
  }, [rows]);

  return (
    <RecordEditor
      projectId={projectId}
      table="decisions"
      rows={rows}
      fields={FIELDS}
      titleKey="statement"
      addLabel="Record a decision"
      exportName="decisions"
      searchKeys={["key", "statement", "context", "chosen"]}
      newRecordDefaults={{
        key: nextKey,
        status: "proposed",
        alternatives_json: JSON.stringify([]),
        criteria_json: JSON.stringify([]),
        scores_json: JSON.stringify({}),
      }}
      sections={[
        { title: "Decision", keys: ["key", "statement", "context", "chosen"], defaultOpen: true },
        { title: "Consequences", keys: ["advantages", "disadvantages", "risks"], defaultOpen: true },
        { title: "Approval", keys: ["status", "decided_on", "revision_reason"], defaultOpen: false },
      ]}
      emptyTitle="No decisions recorded"
      emptyBody="Record the choices that shaped the vehicle: the buoyancy engine architecture, the hull material, how you trim it, the control strategy. Each one is a question a reviewer will ask."
      columns={[
        { key: "key", label: "ID", width: "1%", render: (r) => <span className="font-mono text-[11px]">{String(r.key)}</span> },
        {
          key: "statement",
          label: "Decision",
          render: (r) => (
            <div>
              <div className="font-medium">{String(r.statement)}</div>
              {r.chosen ? <div className="mt-0.5 text-[11px] text-muted">Chosen: {String(r.chosen)}</div> : null}
            </div>
          ),
        },
        { key: "status", label: "Status", width: "1%", render: (r) => <Badge tone={String(r.status) === "accepted" ? "good" : "neutral"}>{String(r.status)}</Badge> },
        { key: "decided_on", label: "Date", width: "1%" },
        {
          key: "matrix",
          label: "Matrix",
          width: "1%",
          render: (r) => (
            <button className="gf-btn px-2 py-0.5 text-[10px]" onClick={() => setOpenMatrix(openMatrix === String(r.id) ? null : String(r.id))}>
              {openMatrix === String(r.id) ? "Hide" : "Edit"}
            </button>
          ),
        },
      ]}
      renderExtra={(row, refresh) =>
        openMatrix === String(row.id) ? <MatrixEditor projectId={projectId} row={row} onSaved={() => { refresh(); router.refresh(); }} /> : null
      }
    />
  );
}

function MatrixEditor({ projectId, row, onSaved }: { projectId: string; row: Row; onSaved: () => void }) {
  const [criteria, setCriteria] = React.useState<Criterion[]>(() => jsonField<Criterion[]>(row.criteria_json, []));
  const [alternatives, setAlternatives] = React.useState<Alternative[]>(() => jsonField<Alternative[]>(row.alternatives_json, []));
  const [scores, setScores] = React.useState<Record<string, number[]>>(() => jsonField<Record<string, number[]>>(row.scores_json, {}));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const analysis = analyseMatrix(criteria, alternatives, scores);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.update(projectId, "decisions", String(row.id), {
        criteria_json: JSON.stringify(criteria),
        alternatives_json: JSON.stringify(alternatives),
        scores_json: JSON.stringify(scores),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setScore = (alt: string, index: number, value: number) => {
    setScores((s) => {
      const arr = [...(s[alt] ?? criteria.map(() => 0))];
      while (arr.length < criteria.length) arr.push(0);
      arr[index] = value;
      return { ...s, [alt]: arr };
    });
  };

  return (
    <div className="border-y bg-surface p-3">
      <Card title={`Decision matrix — ${String(row.key)}`} dense>
        <div className="space-y-4 p-3">
          {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Criteria and weights</h4>
              <div className="space-y-1.5">
                {criteria.map((c, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      className="gf-input flex-1"
                      value={c.name}
                      aria-label={`Criterion ${i + 1} name`}
                      onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                    <input
                      className="gf-input w-20"
                      type="number"
                      min={0}
                      value={c.weight}
                      aria-label={`Criterion ${i + 1} weight`}
                      onChange={(e) => setCriteria((cs) => cs.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
                    />
                    <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setCriteria((cs) => cs.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </div>
                ))}
                <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setCriteria((cs) => [...cs, { name: "New criterion", weight: 3 }])}>
                  Add criterion
                </button>
              </div>
            </div>

            <div>
              <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Alternatives</h4>
              <div className="space-y-1.5">
                {alternatives.map((a, i) => (
                  <div key={i} className="flex gap-1.5">
                    <input
                      className="gf-input flex-1"
                      value={a.name}
                      aria-label={`Alternative ${i + 1} name`}
                      onChange={(e) =>
                        setAlternatives((as) => as.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                      }
                    />
                    <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setAlternatives((as) => as.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </div>
                ))}
                <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setAlternatives((as) => [...as, { name: `Alternative ${as.length + 1}` }])}>
                  Add alternative
                </button>
              </div>
            </div>
          </div>

          {criteria.length > 0 && alternatives.length > 0 && (
            <div className="gf-scroll-x">
              <table className="gf-table">
                <thead>
                  <tr>
                    <th>Alternative</th>
                    {criteria.map((c, i) => (
                      <th key={i}>
                        {c.name}
                        <span className="block font-normal normal-case text-muted">weight {c.weight}</span>
                      </th>
                    ))}
                    <th>Weighted total</th>
                  </tr>
                </thead>
                <tbody>
                  {alternatives.map((a) => {
                    const total = criteria.reduce((s, c, i) => s + c.weight * ((scores[a.name] ?? [])[i] ?? 0), 0);
                    return (
                      <tr key={a.name}>
                        <td className="font-medium">{a.name}</td>
                        {criteria.map((_, i) => (
                          <td key={i}>
                            <input
                              className="gf-input w-16"
                              type="number"
                              min={0}
                              max={5}
                              aria-label={`Score for ${a.name} on ${criteria[i].name}`}
                              value={(scores[a.name] ?? [])[i] ?? 0}
                              onChange={(e) => setScore(a.name, i, Number(e.target.value))}
                            />
                          </td>
                        ))}
                        <td className="font-semibold">
                          {total}
                          {analysis.winner === a.name && (
                            <Badge tone="good" title="Highest weighted total">
                              best
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {alternatives.length > 1 && (
            <div className={`rounded border p-2.5 text-xs ${analysis.flips.length > 0 ? "border-[#fab219]" : ""}`}>
              <h4 className="font-semibold">Sensitivity check</h4>
              <p className="mt-1 text-muted">
                Winner: <strong className="text-ink">{analysis.winner ?? "—"}</strong>, ahead of the runner-up by{" "}
                <strong className="text-ink">{Number.isFinite(analysis.margin) ? analysis.margin : "—"}</strong> points.
              </p>
              {analysis.flips.length === 0 ? (
                <p className="mt-1 text-muted">
                  Perturbing each criterion weight by ±25% one at a time does not change the winner. The result is not being carried by one
                  weight.
                </p>
              ) : (
                <>
                  <p className="mt-1 font-medium text-[#fab219]">
                    <span aria-hidden>! </span>The result is sensitive to the weights:
                  </p>
                  <ul className="ml-4 mt-1 list-disc space-y-0.5 text-muted">
                    {analysis.flips.map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                  <p className="mt-1 text-muted">
                    A matrix that flips under a small weight change is not deciding anything — the criteria are not separating the
                    alternatives. Either find a criterion that genuinely discriminates, or accept that the choice rests on judgement and say
                    so in the record.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <button className="gf-btn gf-btn-primary" onClick={save} disabled={busy}>
              {busy ? <Spinner label="Saving…" /> : "Save matrix"}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
