"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, ApiError, jsonField, type Row } from "../client";
import { Card, Grid, Badge, Spinner, ErrorNotice, TextInput, SelectInput } from "../ui";
import { Markdown } from "../Markdown";
import type { AssistantAnswer } from "@/lib/assistant/types";

const SUGGESTIONS = [
  "What information is still missing?",
  "Is the current syringe large enough?",
  "Which assumption creates the most technical risk?",
  "How much ballast should I add?",
  "What happens if vehicle mass increases by 200 grams?",
  "How does syringe diameter affect required motor torque?",
  "Where should I move the battery to improve trim?",
  "Which requirements have not been verified?",
  "What should I test next?",
  "Why did the measured glide speed differ from the prediction?",
  "Summarise the project's progress this week.",
  "Prepare me for my advisor meeting.",
  "Draft a section of my design report using verified project data.",
];

export function AssistantClient({
  projectId,
  provider,
  recommendations,
  history,
}: {
  projectId: string;
  provider: { name: string; configured: boolean; note: string };
  recommendations: Row[];
  history: Row[];
}) {
  const router = useRouter();
  const [question, setQuestion] = React.useState("");
  const [answer, setAnswer] = React.useState<AssistantAnswer | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await api.ask(projectId, q.trim());
      setAnswer(res.answer as AssistantAnswer);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pending = recommendations.filter((r) => String(r.status) === "pending");

  return (
    <div className="space-y-4">
      {error && <ErrorNotice title="The assistant could not answer" detail={error} onRetry={() => setError(null)} />}

      <Card title="How this assistant works">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={provider.configured && provider.name !== "local-rules" ? "accent" : "neutral"}>provider: {provider.name}</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted">{provider.note}</p>
        <ul className="ml-4 mt-2 list-disc space-y-1 text-[11px] leading-snug text-muted">
          <li>It reads your project data and cites the exact values it used, with links back to where they came from.</li>
          <li>It separates calculated results from qualitative advice, and tells you when data is missing rather than filling the gap.</li>
          <li>
            It never writes to your project. Anything it proposes appears below as a recommendation for you to accept, edit, reject or defer,
            with a recorded reason.
          </li>
          <li>It flags safety-relevant conclusions for human review. It is engineering support, not a verified engineering result.</li>
        </ul>
      </Card>

      <Card title="Ask a question">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="gf-input flex-1"
            placeholder="Ask about your project…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(question);
              }
            }}
            aria-label="Question for the assistant"
          />
          <button className="gf-btn gf-btn-primary shrink-0" onClick={() => ask(question)} disabled={busy || !question.trim()}>
            {busy ? <Spinner label="Thinking…" /> : "Ask"}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              className="gf-btn px-2 py-1 text-[11px]"
              onClick={() => {
                setQuestion(s);
                ask(s);
              }}
              disabled={busy}
            >
              {s}
            </button>
          ))}
        </div>
      </Card>

      {answer && (
        <Grid cols={2}>
          <Card
            title="Answer"
            subtitle={`Intent: ${answer.intent} · provider: ${answer.provider}`}
            actions={answer.safetyFlag ? <Badge tone="critical">safety-relevant — human review required</Badge> : undefined}
          >
            <div className="gf-prose">
              <Markdown source={answer.answer} />
            </div>

            {answer.calculations.length > 0 && (
              <div className="mt-4">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Calculated values</h3>
                <table className="gf-table">
                  <tbody>
                    {answer.calculations.map((c, i) => (
                      <tr key={i}>
                        <td>
                          <span className="font-medium">{c.label}</span>
                          {c.equation && <span className="block font-mono text-[10px] text-muted">{c.equation}</span>}
                          {c.note && <span className="block text-[10px] text-muted">{c.note}</span>}
                        </td>
                        <td className="whitespace-nowrap font-semibold">{c.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {answer.advice.length > 0 && (
              <div className="mt-4 rounded border p-2.5">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Qualitative advice — judgement, not calculation</h3>
                <ul className="ml-4 list-disc space-y-1 text-xs text-muted">
                  {answer.advice.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            {answer.safetyFlag && (
              <div className="mt-3 rounded border border-[#d03b3b] p-2.5 text-[11px] leading-snug text-muted">
                <strong className="text-[#d03b3b]">This answer touches something safety-relevant. </strong>
                Take it to your advisor or lab supervisor before acting on it. Nothing in this application is a substitute for a physical proof
                test on a pressure housing, a seal or a battery.
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card title="Project values used" subtitle="Every number in the answer traces to one of these.">
              {answer.citations.length === 0 ? (
                <p className="text-xs text-muted">No specific project values were needed for this answer.</p>
              ) : (
                <table className="gf-table">
                  <tbody>
                    {answer.citations.map((c, i) => (
                      <tr key={i}>
                        <td>
                          <span className="font-medium">{c.label}</span>
                          <span className="block text-[10px] leading-snug text-muted">{c.source}</span>
                        </td>
                        <td className="whitespace-nowrap">
                          <span className="font-semibold">{c.value}</span>
                          {c.href && (
                            <Link href={c.href} className="ml-2 text-[10px] underline">
                              open
                            </Link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {answer.missingData.length > 0 && (
              <Card title="Data the assistant could not find">
                <ul className="ml-4 list-disc space-y-1 text-xs text-muted">
                  {answer.missingData.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-muted">
                  Missing data is reported rather than filled in. Where a value is genuinely unknown, the answer above says so instead of
                  inventing a plausible number.
                </p>
              </Card>
            )}

            {answer.proposedChange && (
              <ProposedChangeCard projectId={projectId} answer={answer} onDone={() => router.refresh()} />
            )}
          </div>
        </Grid>
      )}

      {pending.length > 0 && (
        <Card title={`Recommendations awaiting your decision (${pending.length})`}>
          <RecommendationList projectId={projectId} rows={pending} />
        </Card>
      )}

      {recommendations.length > pending.length && (
        <Card title="Resolved recommendations">
          <RecommendationList projectId={projectId} rows={recommendations.filter((r) => String(r.status) !== "pending")} readOnly />
        </Card>
      )}

      {history.length > 0 && (
        <Card title={`Conversation history (${history.length} messages)`}>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {history
              .slice()
              .reverse()
              .map((m) => (
                <div key={String(m.id)} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={String(m.role) === "user" ? "neutral" : "accent"}>{String(m.role)}</Badge>
                    <span className="text-[10px] text-muted">{String(m.created_at).slice(0, 16).replace("T", " ")}</span>
                    {m.provider ? <span className="text-[10px] text-muted">· {String(m.provider)}</span> : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed text-muted">
                    {String(m.content).slice(0, 600)}
                    {String(m.content).length > 600 ? "…" : ""}
                  </p>
                  {jsonField<{ label: string; value: string }[]>(m.citations_json, []).length > 0 && (
                    <p className="mt-1 text-[10px] text-muted">
                      Cited: {jsonField<{ label: string; value: string }[]>(m.citations_json, []).map((c) => `${c.label} = ${c.value}`).join("; ")}
                    </p>
                  )}
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ProposedChangeCard({ projectId, answer, onDone }: { projectId: string; answer: AssistantAnswer; onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const change = answer.proposedChange!;
  const record = async () => {
    setBusy(true);
    try {
      await api.create(projectId, "ai_recommendations", {
        context: answer.intent,
        recommendation: change.description,
        rationale: answer.answer.slice(0, 2000),
        proposed_change_json: JSON.stringify(change),
        status: "pending",
        safety_flag: answer.safetyFlag ? 1 : 0,
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Proposed change">
      <p className="text-xs">{change.description}</p>
      <p className="mt-2 text-[11px] text-muted">
        Nothing has been changed. Recording this puts it in the queue below, where you can accept, edit, reject or defer it with a reason.
      </p>
      <button className="gf-btn mt-2" onClick={record} disabled={busy}>
        {busy ? <Spinner label="Recording…" /> : "Record for review"}
      </button>
    </Card>
  );
}

function RecommendationList({ projectId, rows, readOnly }: { projectId: string; rows: Row[]; readOnly?: boolean }) {
  const router = useRouter();
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState("accepted");
  const [reason, setReason] = React.useState("");
  const [edited, setEdited] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  const resolve = async (id: string) => {
    setBusy(true);
    try {
      await api.update(projectId, "ai_recommendations", id, {
        status,
        decision_reason: reason,
        edited_text: status === "edited" ? edited : null,
        resolved_at: new Date().toISOString(),
      });
      setOpenId(null);
      setReason("");
      setEdited("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={String(r.id)} className="rounded border p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">{String(r.recommendation)}</p>
              <p className="mt-0.5 text-[11px] text-muted">
                context: {String(r.context ?? "—")} · created {String(r.created_at).slice(0, 16).replace("T", " ")}
              </p>
              {r.decision_reason ? (
                <p className="mt-1 text-[11px] text-muted">
                  <strong className="text-ink">Reason recorded: </strong>
                  {String(r.decision_reason)}
                </p>
              ) : null}
              {r.edited_text ? (
                <p className="mt-1 text-[11px] text-muted">
                  <strong className="text-ink">Edited to: </strong>
                  {String(r.edited_text)}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {Number(r.safety_flag) === 1 && <Badge tone="critical">safety</Badge>}
              <Badge tone={String(r.status) === "accepted" ? "good" : String(r.status) === "rejected" ? "critical" : String(r.status) === "pending" ? "warning" : "neutral"}>
                {String(r.status)}
              </Badge>
              {!readOnly && (
                <button className="gf-btn px-2 py-0.5 text-[10px]" onClick={() => setOpenId(openId === String(r.id) ? null : String(r.id))}>
                  Decide
                </button>
              )}
            </div>
          </div>

          {openId === String(r.id) && (
            <div className="mt-3 space-y-2 border-t pt-3">
              <SelectInput
                label="Decision"
                value={status}
                onChange={setStatus}
                options={[
                  { value: "accepted", label: "Accept — I will apply this" },
                  { value: "edited", label: "Accept with edits" },
                  { value: "rejected", label: "Reject" },
                  { value: "deferred", label: "Defer — revisit later" },
                ]}
              />
              {status === "edited" && <TextInput label="Edited recommendation" value={edited} onChange={setEdited} multiline rows={2} />}
              <TextInput
                label="Reason for this decision"
                value={reason}
                onChange={setReason}
                multiline
                rows={2}
                required
                hint="Recorded permanently. In three months this is what tells you why you did or did not follow the advice."
              />
              <button className="gf-btn gf-btn-primary" onClick={() => resolve(String(r.id))} disabled={busy || !reason.trim()}>
                {busy ? <Spinner label="Saving…" /> : "Record decision"}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
