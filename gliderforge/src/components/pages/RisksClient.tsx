"use client";

import React from "react";
import { RecordEditor, type FieldSpec } from "./RecordEditor";
import type { Row } from "../client";
import { Badge } from "../ui";

const SCALE = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }));

const FIELDS: FieldSpec[] = [
  { key: "key", label: "Risk ID", type: "text", required: true, placeholder: "RSK-001" },
  { key: "description", label: "Risk", type: "text", required: true, hint: "State the event, not the consequence: 'water leaks into the hull', not 'electronics destroyed'." },
  { key: "cause", label: "Cause", type: "textarea", rows: 2, hint: "How it happens. Several causes usually share one risk." },
  { key: "consequence", label: "Consequence", type: "textarea", rows: 2, hint: "What it costs you if it happens." },
  { key: "likelihood", label: "Likelihood (1-5)", type: "select", options: SCALE, hint: "1 = very unlikely on this project, 5 = expect it." },
  { key: "severity", label: "Severity (1-5)", type: "select", options: SCALE, hint: "1 = minor annoyance, 5 = loss of the vehicle or injury." },
  { key: "detectability", label: "Detectability (1-5)", type: "select", options: SCALE, hint: "1 = you would notice immediately, 5 = you would not know until it was too late. Higher is worse." },
  { key: "mitigation", label: "Mitigation", type: "textarea", rows: 2, hint: "What you do to reduce likelihood or severity BEFORE it happens." },
  { key: "contingency", label: "Contingency", type: "textarea", rows: 2, hint: "What you do AFTER it happens." },
  { key: "owner", label: "Owner", type: "text", hint: "A named person. An unowned risk is an unmanaged risk." },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "open", label: "Open" },
      { value: "mitigated", label: "Mitigated" },
      { value: "accepted", label: "Accepted" },
      { value: "closed", label: "Closed" },
    ],
  },
  { key: "reviewed", label: "Reviewed by the team", type: "checkbox", hint: "Tick once this risk has been read, edited for THIS vehicle and scored by the team." },
];

const rpn = (r: Row) => Number(r.likelihood ?? 0) * Number(r.severity ?? 0) * Number(r.detectability ?? 0);

export function RisksClient({ projectId, rows }: { projectId: string; rows: Row[] }) {
  const sorted = React.useMemo(() => [...rows].sort((a, b) => rpn(b) - rpn(a)), [rows]);
  const nextKey = React.useMemo(() => {
    const nums = rows.map((r) => /^RSK-(\d+)$/.exec(String(r.key ?? ""))).filter(Boolean).map((m) => Number(m![1]));
    return `RSK-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
  }, [rows]);

  return (
    <RecordEditor
      projectId={projectId}
      table="risks"
      rows={sorted}
      fields={FIELDS}
      titleKey="description"
      addLabel="Add risk"
      exportName="risk-register"
      searchKeys={["key", "description", "cause", "consequence", "mitigation", "owner"]}
      newRecordDefaults={{ key: nextKey, likelihood: 3, severity: 3, detectability: 3, status: "open", reviewed: 1, is_starter: 0 }}
      sections={[
        { title: "Risk", keys: ["key", "description", "cause", "consequence"], defaultOpen: true },
        { title: "Scoring", keys: ["likelihood", "severity", "detectability"], defaultOpen: true },
        { title: "Response", keys: ["mitigation", "contingency", "owner", "status", "reviewed"], defaultOpen: true },
      ]}
      emptyTitle="No risks recorded"
      emptyBody="Start with the ways this class of vehicle usually fails: leaks, actuator stall at depth, battery depletion, and unstable trim. Then add the ones specific to your build."
      columns={[
        { key: "key", label: "ID", width: "1%", render: (r) => <span className="font-mono text-[11px]">{String(r.key)}</span> },
        {
          key: "description",
          label: "Risk",
          render: (r) => (
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{String(r.description)}</span>
                {Number(r.is_starter) === 1 && Number(r.reviewed) === 0 && (
                  <Badge tone="warning" title="Pre-populated starter example. Not yet reviewed by the team.">
                    starter, unreviewed
                  </Badge>
                )}
              </div>
              {r.consequence ? <div className="mt-0.5 text-[11px] leading-snug text-muted">→ {String(r.consequence)}</div> : null}
            </div>
          ),
        },
        {
          key: "rpn",
          label: "L × S × D",
          width: "1%",
          render: (r) => {
            const n = rpn(r);
            return (
              <span className="whitespace-nowrap">
                <span className="text-[11px] text-muted">
                  {String(r.likelihood)}×{String(r.severity)}×{String(r.detectability)} =
                </span>{" "}
                <Badge tone={n >= 45 ? "critical" : n >= 24 ? "warning" : "neutral"}>{n}</Badge>
              </span>
            );
          },
        },
        { key: "mitigation", label: "Mitigation", render: (r) => <span className="text-[11px] text-muted">{String(r.mitigation ?? "—")}</span> },
        { key: "owner", label: "Owner", render: (r) => (r.owner ? String(r.owner) : <Badge tone="warning">unassigned</Badge>) },
        { key: "status", label: "Status", render: (r) => <Badge tone={String(r.status) === "closed" ? "good" : String(r.status) === "open" ? "warning" : "neutral"}>{String(r.status)}</Badge> },
      ]}
    />
  );
}
