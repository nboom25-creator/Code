"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type Row, downloadText, toCsv } from "../client";
import { Card, TextInput, SelectInput, NumberInput, UnitInput, Badge, ErrorNotice, Spinner, EmptyState, Field } from "../ui";
import type { Dimension } from "@/lib/units";

/**
 * Schema-driven record editor.
 *
 * Used by the register-style pages (requirements, risks, decisions, notebook,
 * assumptions, electronics). Each page supplies a field list; this component
 * handles listing, searching, creating, editing, deleting and CSV export, so
 * the behaviour and the validation messages are identical everywhere.
 */

export type FieldSpec =
  | { key: string; label: string; type: "text"; hint?: string; placeholder?: string; required?: boolean }
  | { key: string; label: string; type: "textarea"; hint?: string; rows?: number; placeholder?: string }
  | { key: string; label: string; type: "number"; hint?: string; min?: number; max?: number; suffix?: string }
  | { key: string; label: string; type: "quantity"; dimension: Dimension; defaultUnit?: string; hint?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; hint?: string }
  | { key: string; label: string; type: "date"; hint?: string }
  | { key: string; label: string; type: "checkbox"; hint?: string };

export interface RecordEditorProps {
  projectId: string;
  table: string;
  rows: Row[];
  fields: FieldSpec[];
  /** Fields shown in the list. */
  columns: { key: string; label: string; render?: (row: Row) => React.ReactNode; width?: string }[];
  titleKey: string;
  newRecordDefaults?: Row;
  emptyTitle: string;
  emptyBody: React.ReactNode;
  /** Optional grouping of fields into disclosure sections. */
  sections?: { title: string; keys: string[]; defaultOpen?: boolean }[];
  searchKeys?: string[];
  exportName: string;
  renderExtra?: (row: Row, refresh: () => void) => React.ReactNode;
  addLabel?: string;
}

export function RecordEditor(props: RecordEditorProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Row | null>(null);
  const [draft, setDraft] = React.useState<Row>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);

  const refresh = () => router.refresh();

  const startNew = () => {
    setEditing({ id: "" });
    setDraft({ ...(props.newRecordDefaults ?? {}) });
    setError(null);
  };
  const startEdit = (row: Row) => {
    setEditing(row);
    setDraft({ ...row });
    setError(null);
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Row = {};
      for (const f of props.fields) payload[f.key] = draft[f.key] ?? null;
      if (editing.id) await api.update(props.projectId, props.table, String(editing.id), payload);
      else await api.create(props.projectId, props.table, payload);
      setEditing(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.remove(props.projectId, props.table, id);
      setConfirmDelete(null);
      if (editing?.id === id) setEditing(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const searchKeys = props.searchKeys ?? [props.titleKey];
  const filtered = search.trim()
    ? props.rows.filter((r) => searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(search.toLowerCase())))
    : props.rows;

  const sectionsFor = props.sections ?? [{ title: "Details", keys: props.fields.map((f) => f.key), defaultOpen: true }];

  return (
    <div className="space-y-4">
      {error && <ErrorNotice detail={error} onRetry={() => setError(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="gf-input max-w-xs"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search records"
        />
        <span className="text-xs text-muted">
          {filtered.length} of {props.rows.length}
        </span>
        <div className="ml-auto flex gap-2">
          <button
            className="gf-btn"
            onClick={() => downloadText(`${props.exportName}.csv`, toCsv(props.rows as Record<string, unknown>[]), "text/csv")}
            disabled={props.rows.length === 0}
          >
            Export CSV
          </button>
          <button className="gf-btn gf-btn-primary" onClick={startNew}>
            {props.addLabel ?? "Add record"}
          </button>
        </div>
      </div>

      {editing && (
        <Card
          title={editing.id ? `Edit: ${String(editing[props.titleKey] ?? "record")}` : "New record"}
          actions={
            <>
              <button className="gf-btn" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button className="gf-btn gf-btn-primary" onClick={save} disabled={busy}>
                {busy ? <Spinner label="Saving…" /> : "Save"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            {sectionsFor.map((section, si) => {
              const fields = props.fields.filter((f) => section.keys.includes(f.key));
              if (fields.length === 0) return null;
              const content = (
                <div className="grid gap-3 sm:grid-cols-2">
                  {fields.map((f) => (
                    <div key={f.key} className={f.type === "textarea" ? "sm:col-span-2" : ""}>
                      <FieldControl field={f} value={draft[f.key]} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                    </div>
                  ))}
                </div>
              );
              return sectionsFor.length === 1 ? (
                <div key={si}>{content}</div>
              ) : (
                <details key={si} open={section.defaultOpen ?? si === 0} className="rounded border">
                  <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{section.title}</summary>
                  <div className="border-t p-3">{content}</div>
                </details>
              );
            })}
          </div>
        </Card>
      )}

      {props.rows.length === 0 && !editing ? (
        <EmptyState
          title={props.emptyTitle}
          body={props.emptyBody}
          action={
            <button className="gf-btn gf-btn-primary" onClick={startNew}>
              {props.addLabel ?? "Add the first one"}
            </button>
          }
        />
      ) : (
        <div className="gf-panel gf-scroll-x">
          <table className="gf-table">
            <thead>
              <tr>
                {props.columns.map((c) => (
                  <th key={c.key} style={c.width ? { width: c.width } : undefined}>
                    {c.label}
                  </th>
                ))}
                <th style={{ width: "1%" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <React.Fragment key={String(row.id)}>
                  <tr>
                    {props.columns.map((c) => (
                      <td key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? "—")}</td>
                    ))}
                    <td className="whitespace-nowrap">
                      <div className="flex gap-1">
                        <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => startEdit(row)}>
                          Edit
                        </button>
                        {confirmDelete === String(row.id) ? (
                          <>
                            <button
                              className="gf-btn border-[#d03b3b] px-2 py-1 text-[11px] text-[#d03b3b]"
                              onClick={() => remove(String(row.id))}
                              disabled={busy}
                            >
                              Confirm
                            </button>
                            <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setConfirmDelete(null)}>
                              No
                            </button>
                          </>
                        ) : (
                          <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setConfirmDelete(String(row.id))}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {props.renderExtra && (
                    <tr>
                      <td colSpan={props.columns.length + 1} className="!py-0">
                        {props.renderExtra(row, refresh)}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="p-4 text-center text-xs text-muted">No records match &ldquo;{search}&rdquo;.</p>}
        </div>
      )}

      <p className="text-[11px] text-muted">
        Deleting a record is reversible with the <strong>Undo</strong> button in the header — every create, edit and delete is written to a
        revision log first.
      </p>
    </div>
  );
}

function FieldControl({ field, value, onChange }: { field: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case "text":
      return (
        <TextInput
          label={field.label}
          value={String(value ?? "")}
          onChange={onChange}
          hint={field.hint}
          placeholder={field.placeholder}
          required={field.required}
        />
      );
    case "textarea":
      return (
        <TextInput
          label={field.label}
          value={String(value ?? "")}
          onChange={onChange}
          hint={field.hint}
          multiline
          rows={field.rows ?? 3}
          placeholder={field.placeholder}
        />
      );
    case "number":
      return (
        <NumberInput
          label={field.label}
          value={value === null || value === undefined || value === "" ? undefined : Number(value)}
          onChange={onChange}
          hint={field.hint}
          min={field.min}
          max={field.max}
          suffix={field.suffix}
        />
      );
    case "quantity":
      return (
        <UnitInput
          label={field.label}
          dimension={field.dimension}
          defaultUnit={field.defaultUnit}
          valueSI={value === null || value === undefined || value === "" ? undefined : Number(value)}
          onChangeSI={onChange}
          hint={field.hint}
        />
      );
    case "select":
      return (
        <SelectInput
          label={field.label}
          value={String(value ?? field.options[0]?.value ?? "")}
          onChange={onChange}
          options={field.options}
          hint={field.hint}
        />
      );
    case "date":
      return (
        <Field label={field.label} hint={field.hint}>
          <input type="date" className="gf-input" value={String(value ?? "").slice(0, 10)} onChange={(e) => onChange(e.target.value || null)} />
        </Field>
      );
    case "checkbox":
      return (
        <Field label={field.label} hint={field.hint}>
          <input
            type="checkbox"
            className="accent-[color:rgb(var(--accent))]"
            checked={Number(value ?? 0) === 1}
            onChange={(e) => onChange(e.target.checked ? 1 : 0)}
          />
        </Field>
      );
  }
}

export function StatusBadge({ value }: { value: string }) {
  const tone =
    value === "verified" || value === "pass" || value === "accepted" || value === "closed" || value === "complete"
      ? "good"
      : value === "fail" || value === "rejected" || value === "open"
        ? value === "open"
          ? "warning"
          : "critical"
        : "neutral";
  return <Badge tone={tone as "good" | "warning" | "critical" | "neutral"}>{value}</Badge>;
}
