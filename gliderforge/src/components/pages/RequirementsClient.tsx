"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RecordEditor, StatusBadge, type FieldSpec } from "./RecordEditor";
import { api, jsonField, type Row } from "../client";
import { Badge, Card, Spinner } from "../ui";
import { resolveUnit } from "@/lib/units";

const CATEGORIES = [
  "environment",
  "envelope",
  "mass",
  "buoyancy",
  "performance",
  "endurance",
  "sealing",
  "structure",
  "electrical",
  "control",
  "safety",
  "programmatic",
  "other",
];

const FIELDS: FieldSpec[] = [
  { key: "key", label: "Requirement ID", type: "text", required: true, hint: "Short, stable and unique, e.g. REQ-004. Referenced from tests and reports.", placeholder: "REQ-001" },
  { key: "title", label: "Title", type: "text", required: true, placeholder: "Maximum operating depth" },
  { key: "description", label: "Description", type: "textarea", rows: 2, hint: "State it as a verifiable sentence: 'The vehicle shall …'." },
  { key: "category", label: "Category", type: "select", options: CATEGORIES.map((c) => ({ value: c, label: c })) },
  {
    key: "priority",
    label: "Priority",
    type: "select",
    options: [
      { value: "shall", label: "shall — mandatory" },
      { value: "should", label: "should — strongly desired" },
      { value: "may", label: "may — optional" },
    ],
  },
  {
    key: "comparator",
    label: "Comparator",
    type: "select",
    options: [
      { value: "<=", label: "≤ at most" },
      { value: ">=", label: "≥ at least" },
      { value: "=", label: "= equal to" },
      { value: "range", label: "within range" },
    ],
  },
  { key: "target_value", label: "Target value", type: "number", hint: "The number the design is measured against." },
  { key: "target_unit", label: "Target unit", type: "text", hint: "Type the unit symbol, e.g. m, kg, N, m/s, %, USD. Validated against the unit registry.", placeholder: "m" },
  { key: "tolerance", label: "Tolerance", type: "text", hint: "e.g. ±0.2 m, or -0 / +0.5 m." },
  { key: "source", label: "Source", type: "text", hint: "Where it came from: facility constraint, course standard, advisor, derived from another requirement." },
  { key: "rationale", label: "Rationale", type: "textarea", rows: 2, hint: "Why this number and not another. A reviewer will ask." },
  {
    key: "verification_method",
    label: "Verification method",
    type: "select",
    options: [
      { value: "test", label: "Test — measure it" },
      { value: "analysis", label: "Analysis — calculate it" },
      { value: "inspection", label: "Inspection — look at it" },
      { value: "demonstration", label: "Demonstration — show it works" },
    ],
  },
  {
    key: "verification_status",
    label: "Verification status",
    type: "select",
    options: [
      { value: "not-verified", label: "Not verified" },
      { value: "in-progress", label: "In progress" },
      { value: "verified", label: "Verified — evidence attached" },
      { value: "waived", label: "Waived — with a recorded reason" },
    ],
    hint: "Do not mark verified without evidence.",
  },
  { key: "notes", label: "Notes", type: "textarea", rows: 2 },
];

export function RequirementsClient({
  projectId,
  rows,
  tests,
  components,
}: {
  projectId: string;
  rows: Row[];
  tests: { id: string; key: string; title: string }[];
  components: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [linking, setLinking] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const nextKey = React.useMemo(() => {
    const nums = rows
      .map((r) => /^REQ-(\d+)$/.exec(String(r.key ?? "")))
      .filter(Boolean)
      .map((m) => Number(m![1]));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `REQ-${String(next).padStart(3, "0")}`;
  }, [rows]);

  const toggleTest = async (row: Row, testId: string) => {
    setBusy(true);
    try {
      const links = jsonField<{ tests?: string[]; components?: string[] }>(row.links_json, {});
      const current = new Set(links.tests ?? []);
      if (current.has(testId)) current.delete(testId);
      else current.add(testId);
      await api.update(projectId, "requirements", String(row.id), {
        links_json: JSON.stringify({ ...links, tests: [...current] }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <RecordEditor
      projectId={projectId}
      table="requirements"
      rows={rows}
      fields={FIELDS}
      titleKey="title"
      addLabel="Add requirement"
      exportName="requirements"
      searchKeys={["key", "title", "description", "category", "source"]}
      newRecordDefaults={{
        key: nextKey,
        category: "performance",
        priority: "shall",
        comparator: "<=",
        verification_method: "test",
        verification_status: "not-verified",
        links_json: JSON.stringify({ tests: [], components: [] }),
      }}
      sections={[
        { title: "Identity", keys: ["key", "title", "description", "category", "priority"], defaultOpen: true },
        { title: "Target", keys: ["comparator", "target_value", "target_unit", "tolerance"], defaultOpen: true },
        { title: "Justification and verification", keys: ["source", "rationale", "verification_method", "verification_status", "notes"], defaultOpen: true },
      ]}
      emptyTitle="No requirements yet"
      emptyBody={
        <>
          Start with the ones your facility and course force on you: operating depth, vehicle envelope, mass limit and budget. Then add the
          performance targets you are choosing — vertical speed, glide ratio, cycle count — and record where each number came from.
        </>
      }
      columns={[
        { key: "key", label: "ID", width: "1%", render: (r) => <span className="font-mono text-[11px]">{String(r.key)}</span> },
        {
          key: "title",
          label: "Requirement",
          render: (r) => (
            <div>
              <div className="font-medium">{String(r.title)}</div>
              {r.description ? <div className="mt-0.5 text-[11px] leading-snug text-muted">{String(r.description)}</div> : null}
            </div>
          ),
        },
        {
          key: "target_value",
          label: "Target",
          render: (r) => {
            if (r.target_value === null || r.target_value === undefined) return <span className="text-muted">—</span>;
            const unit = String(r.target_unit ?? "");
            const known = unit === "" || Boolean(resolveUnit(unit));
            return (
              <span className="whitespace-nowrap">
                {String(r.comparator ?? "")} {String(r.target_value)} {unit}
                {!known && (
                  <Badge tone="warning" title="This unit is not in the unit registry, so no dimensional check is possible against it.">
                    unknown unit
                  </Badge>
                )}
              </span>
            );
          },
        },
        { key: "priority", label: "Priority", render: (r) => <Badge tone={String(r.priority) === "shall" ? "critical" : "neutral"}>{String(r.priority)}</Badge> },
        { key: "verification_method", label: "Method" },
        { key: "verification_status", label: "Status", render: (r) => <StatusBadge value={String(r.verification_status)} /> },
        {
          key: "links",
          label: "Verifying tests",
          render: (r) => {
            const links = jsonField<{ tests?: string[] }>(r.links_json, {});
            const linked = (links.tests ?? []).map((id) => tests.find((t) => t.id === id)).filter(Boolean);
            return (
              <div className="space-y-1">
                {linked.length === 0 ? (
                  <Badge tone="warning" title="A requirement with no verifying test cannot be shown to be met.">
                    none linked
                  </Badge>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {linked.map((t) => (
                      <Badge key={t!.id} tone="accent">
                        {t!.key}
                      </Badge>
                    ))}
                  </div>
                )}
                <button className="gf-btn px-2 py-0.5 text-[10px]" onClick={() => setLinking(linking === String(r.id) ? null : String(r.id))}>
                  {linking === String(r.id) ? "Done" : "Link tests"}
                </button>
              </div>
            );
          },
        },
      ]}
      renderExtra={(row) =>
        linking === String(row.id) ? (
          <div className="border-y bg-surface p-3">
            <Card title={`Link tests to ${String(row.key)}`} dense>
              <div className="p-3">
                {tests.length === 0 ? (
                  <p className="text-xs text-muted">
                    No test plans exist yet. Create them on the Tests &amp; Data page, then come back and link them here.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {tests.map((t) => {
                      const links = jsonField<{ tests?: string[] }>(row.links_json, {});
                      const on = (links.tests ?? []).includes(t.id);
                      return (
                        <button
                          key={t.id}
                          className={`gf-btn px-2 py-1 text-[11px] ${on ? "gf-btn-primary" : ""}`}
                          onClick={() => toggleTest(row, t.id)}
                          disabled={busy}
                          aria-pressed={on}
                        >
                          {t.key} — {t.title}
                        </button>
                      );
                    })}
                  </div>
                )}
                {busy && <Spinner label="Saving link…" />}
                <p className="mt-2 text-[11px] text-muted">
                  {components.length} component(s) exist in this project; component links are set from the Components page.
                </p>
              </div>
            </Card>
          </div>
        ) : null
      }
    />
  );
}
