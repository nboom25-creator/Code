"use client";

import React from "react";
import { RecordEditor, type FieldSpec } from "./RecordEditor";
import type { Row } from "../client";
import { Badge } from "../ui";

const FIELDS: FieldSpec[] = [
  { key: "text", label: "Assumption", type: "textarea", rows: 2, hint: "State it as a claim you are treating as true, with the number if there is one." },
  { key: "basis", label: "Basis", type: "textarea", rows: 2, hint: "Why you think it is reasonable, and what would change if it is wrong." },
  {
    key: "criticality",
    label: "Criticality",
    type: "select",
    options: [
      { value: "high", label: "High - a design conclusion depends on it" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low - would not change a decision" },
    ],
  },
  {
    key: "status",
    label: "Status",
    type: "select",
    options: [
      { value: "open", label: "Open - not yet confirmed" },
      { value: "confirmed", label: "Confirmed - evidence obtained" },
      { value: "rejected", label: "Rejected - turned out to be wrong" },
      { value: "deferred", label: "Deferred - accepted for now with a reason" },
    ],
  },
  { key: "related_type", label: "Related to", type: "text", hint: "e.g. syringe, hull, hydrodynamics." },
  { key: "resolution_note", label: "Resolution note", type: "textarea", rows: 2, hint: "Required when you close an assumption: what evidence resolved it, or why you are accepting it unconfirmed." },
];

export function AssumptionsClient({ projectId, rows }: { projectId: string; rows: Row[] }) {
  const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
  const sorted = React.useMemo(
    () =>
      [...rows].sort((a, b) => {
        const openDiff = (String(a.status) === "open" ? 0 : 1) - (String(b.status) === "open" ? 0 : 1);
        if (openDiff !== 0) return openDiff;
        return (order[String(a.criticality)] ?? 1) - (order[String(b.criticality)] ?? 1);
      }),
    [rows],
  );

  return (
    <RecordEditor
      projectId={projectId}
      table="assumptions"
      rows={sorted}
      fields={FIELDS}
      titleKey="text"
      addLabel="Record an assumption"
      exportName="assumptions"
      searchKeys={["text", "basis", "related_type"]}
      newRecordDefaults={{ criticality: "medium", status: "open" }}
      emptyTitle="No assumptions recorded"
      emptyBody="Every project runs on assumptions. Writing them down is what lets you tell, later, which one was responsible when a prediction misses."
      columns={[
        {
          key: "text",
          label: "Assumption",
          render: (r) => (
            <div>
              <div className="font-medium">{String(r.text)}</div>
              {r.basis ? <div className="mt-0.5 text-[11px] leading-snug text-muted">{String(r.basis)}</div> : null}
            </div>
          ),
        },
        {
          key: "criticality",
          label: "Criticality",
          width: "1%",
          render: (r) => (
            <Badge tone={String(r.criticality) === "high" ? "critical" : String(r.criticality) === "low" ? "neutral" : "warning"}>
              {String(r.criticality)}
            </Badge>
          ),
        },
        {
          key: "status",
          label: "Status",
          width: "1%",
          render: (r) => (
            <Badge tone={String(r.status) === "confirmed" ? "good" : String(r.status) === "open" ? "warning" : "neutral"}>
              {String(r.status)}
            </Badge>
          ),
        },
        { key: "related_type", label: "Related to" },
        { key: "resolution_note", label: "Resolution", render: (r) => <span className="text-[11px] text-muted">{String(r.resolution_note ?? "—")}</span> },
      ]}
    />
  );
}
