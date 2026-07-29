"use client";

import React from "react";
import { RecordEditor, type FieldSpec } from "./RecordEditor";
import type { Row } from "../client";
import { Badge } from "../ui";

export function NotebookClient({
  projectId,
  rows,
  requirements,
}: {
  projectId: string;
  rows: Row[];
  requirements: { id: string; key: string; title: string }[];
}) {
  const fields: FieldSpec[] = [
    { key: "title", label: "Title", type: "text", required: true },
    {
      key: "kind",
      label: "Kind",
      type: "select",
      options: [
        { value: "note", label: "Daily note" },
        { value: "meeting", label: "Meeting" },
        { value: "calculation", label: "Calculation" },
        { value: "test", label: "Test record" },
        { value: "question", label: "Open question" },
        { value: "decision", label: "Decision" },
        { value: "change", label: "Design change" },
        { value: "action", label: "Action item" },
      ],
    },
    { key: "subsystem", label: "Subsystem", type: "text", hint: "e.g. buoyancy-engine, hull, electronics, hydrodynamics." },
    { key: "tags", label: "Tags", type: "text", hint: "Comma separated." },
    { key: "author", label: "Author", type: "text" },
    {
      key: "requirement_id",
      label: "Related requirement",
      type: "select",
      options: [{ value: "", label: "(none)" }, ...requirements.map((r) => ({ value: r.id, label: `${r.key} — ${r.title}` }))],
    },
    { key: "body", label: "Entry", type: "textarea", rows: 10, hint: "Write what you did, what you measured and what surprised you. The surprises are the valuable part." },
  ];

  const sorted = React.useMemo(() => [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))), [rows]);

  return (
    <RecordEditor
      projectId={projectId}
      table="notebook_entries"
      rows={sorted}
      fields={fields}
      titleKey="title"
      addLabel="New entry"
      exportName="notebook"
      searchKeys={["title", "body", "tags", "subsystem", "kind"]}
      newRecordDefaults={{ kind: "note" }}
      emptyTitle="The notebook is empty"
      emptyBody="Log meetings, calculations, questions and surprises as they happen. Reconstructing them at the end of the semester never works, and the notebook is usually assessed."
      columns={[
        { key: "created_at", label: "Date", width: "1%", render: (r) => <span className="whitespace-nowrap text-[11px] text-muted">{String(r.created_at).slice(0, 10)}</span> },
        { key: "kind", label: "Kind", width: "1%", render: (r) => <Badge tone={String(r.kind) === "question" ? "warning" : "neutral"}>{String(r.kind)}</Badge> },
        {
          key: "title",
          label: "Entry",
          render: (r) => (
            <div>
              <div className="font-medium">{String(r.title)}</div>
              <div className="mt-0.5 max-w-3xl whitespace-pre-wrap text-[11px] leading-snug text-muted">
                {String(r.body ?? "").slice(0, 400)}
                {String(r.body ?? "").length > 400 ? "…" : ""}
              </div>
            </div>
          ),
        },
        { key: "subsystem", label: "Subsystem", width: "1%" },
        { key: "author", label: "Author", width: "1%" },
      ]}
    />
  );
}
