"use client";

import React from "react";
import clsx from "clsx";
import { convert, formatQty, prettyUnit, unitsFor, resolveUnit, type Dimension, type Provenance, type Quantity } from "@/lib/units";
import type { CalcStep, CalcWarning, CalcAssumption } from "@/lib/calc/types";

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  dense,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section className={clsx("gf-panel", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-2.5">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={dense ? "" : "p-4"}>{children}</div>
    </section>
  );
}

export function Grid({ cols = 2, children }: { cols?: 1 | 2 | 3 | 4; children: React.ReactNode }) {
  const cls = { 1: "", 2: "lg:grid-cols-2", 3: "md:grid-cols-2 xl:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4" }[cols];
  return <div className={clsx("grid grid-cols-1 gap-4", cls)}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Provenance and status                                               */
/* ------------------------------------------------------------------ */

const PROVENANCE_META: Record<Provenance | "estimated" | "unknown", { label: string; short: string; hint: string; className: string }> = {
  measured: { label: "Measured", short: "MEAS", hint: "Physically measured by you.", className: "text-[#0ca30c] border-[#0ca30c]" },
  user: { label: "User-entered", short: "USER", hint: "Typed in by you, not measured.", className: "text-[color:var(--series-1)] border-[color:var(--series-1)]" },
  cad: { label: "CAD-derived", short: "CAD", hint: "Extracted from an uploaded geometry file.", className: "text-[color:var(--series-7)] border-[color:var(--series-7)]" },
  calculated: { label: "Calculated", short: "CALC", hint: "Produced by the calculation engine from other values.", className: "text-muted border-edge" },
  estimated: { label: "Estimated", short: "EST", hint: "An estimate, not a measurement.", className: "text-[#ec835a] border-[#ec835a]" },
  assumed: { label: "Assumed", short: "ASSUM", hint: "A placeholder chosen because the real value is unknown.", className: "text-[#fab219] border-[#fab219]" },
  reference: { label: "Reference", short: "REF", hint: "From the bundled reference library — unverified for your specific part.", className: "text-[color:var(--series-5)] border-[color:var(--series-5)]" },
  ai: { label: "AI proposal", short: "AI", hint: "Proposed by the assistant. NOT a verified engineering result.", className: "text-[#d03b3b] border-[#d03b3b]" },
  unknown: { label: "Missing", short: "MISSING", hint: "No value has been entered. Treated as zero, which biases results.", className: "text-[#d03b3b] border-[#d03b3b]" },
};

export function ProvenanceBadge({ provenance, className }: { provenance: keyof typeof PROVENANCE_META; className?: string }) {
  const m = PROVENANCE_META[provenance] ?? PROVENANCE_META.calculated;
  return (
    <span
      title={`${m.label} — ${m.hint}`}
      className={clsx("inline-block shrink-0 rounded border px-1 py-px text-[9px] font-bold uppercase leading-tight tracking-wider", m.className, className)}
    >
      {m.short}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warning" | "serious" | "critical" | "accent";
  title?: string;
}) {
  const tones = {
    neutral: "border-edge text-muted",
    good: "border-[#0ca30c] text-[#0ca30c]",
    warning: "border-[#fab219] text-[#fab219]",
    serious: "border-[#ec835a] text-[#ec835a]",
    critical: "border-[#d03b3b] text-[#d03b3b]",
    accent: "border-[color:var(--series-1)] text-[color:var(--series-1)]",
  };
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", tones[tone])}>
      {children}
    </span>
  );
}

const SEVERITY_ICON = { error: "✕", warning: "!", info: "i" } as const;

export function WarningList({ warnings, title = "Warnings" }: { warnings: CalcWarning[]; title?: string }) {
  if (!warnings || warnings.length === 0) return null;
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...warnings].sort((a, b) => order[a.severity] - order[b.severity]);
  const tone = { error: "critical", warning: "warning", info: "neutral" } as const;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <ul className="space-y-1.5">
        {sorted.map((w, i) => (
          <li key={i} className="flex gap-2 text-xs leading-relaxed">
            <span aria-hidden className="mt-px shrink-0">
              <Badge tone={tone[w.severity]}>
                <span aria-hidden>{SEVERITY_ICON[w.severity]}</span>
                {w.severity}
              </Badge>
            </span>
            <span className="text-muted">{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AssumptionList({ assumptions }: { assumptions: CalcAssumption[] }) {
  if (!assumptions || assumptions.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Assumptions</h3>
      <ul className="space-y-1.5">
        {assumptions.map((a, i) => (
          <li key={i} className="text-xs leading-relaxed">
            <span className="font-medium">{a.text}</span>
            <span className="text-muted"> — {a.basis}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StepList({ steps, defaultOpen = false }: { steps: CalcStep[]; defaultOpen?: boolean }) {
  if (!steps || steps.length === 0) return null;
  return (
    <details open={defaultOpen} className="rounded border">
      <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Show the working ({steps.length} steps)
      </summary>
      <div className="space-y-3 border-t p-3">
        {steps.map((s, i) => (
          <div key={i} className="text-xs">
            <div className="font-semibold">{s.label}</div>
            {s.equation && <pre className="gf-scroll-x mt-1 rounded bg-surface p-1.5 font-mono text-[11px]">{s.equation}</pre>}
            {s.substitution && <div className="mt-1 font-mono text-[11px] text-muted">{s.substitution}</div>}
            {s.result && <div className="mt-1 font-medium">→ {s.result}</div>}
            {s.note && <div className="mt-1 border-l-2 border-[#fab219] pl-2 text-muted">{s.note}</div>}
          </div>
        ))}
      </div>
    </details>
  );
}

export function Limitations({ items }: { items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="rounded border border-[#fab219] bg-[color:rgb(250_178_25/0.06)] p-2.5">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#fab219]">
        <span aria-hidden>! </span>Limitations of this result
      </h3>
      <ul className="ml-4 list-disc space-y-1 text-xs text-muted">
        {items.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stat tiles                                                          */
/* ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  unit,
  hint,
  provenance,
  tone,
  href,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
  provenance?: keyof typeof PROVENANCE_META;
  tone?: "good" | "warning" | "critical";
  href?: string;
}) {
  const toneClass = tone === "good" ? "text-[#0ca30c]" : tone === "warning" ? "text-[#fab219]" : tone === "critical" ? "text-[#d03b3b]" : "";
  const inner = (
    <>
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-muted">{label}</span>
        {provenance && <ProvenanceBadge provenance={provenance} />}
      </div>
      <div className={clsx("gf-num mt-1 text-xl font-semibold tracking-tight", toneClass)}>
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-muted">{hint}</div>}
    </>
  );
  return href ? (
    <a href={href} className="gf-panel block p-3 transition hover:border-[color:rgb(var(--accent))]">
      {inner}
    </a>
  ) : (
    <div className="gf-panel p-3">{inner}</div>
  );
}

export function QtyValue({ q, digits = 4, provenance }: { q?: Quantity; digits?: number; provenance?: keyof typeof PROVENANCE_META }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="gf-num">{formatQty(q, digits)}</span>
      {provenance && <ProvenanceBadge provenance={provenance} />}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      {/* The required marker sits OUTSIDE the <label> element and is hidden
          from assistive technology, so the control's accessible name is exactly
          the field name. The requirement itself is conveyed by the `required`
          attribute on the control, which is what screen readers announce. */}
      <div className="flex items-baseline gap-0.5">
        <label className="gf-label" htmlFor={htmlFor}>
          {label}
        </label>
        {required && (
          <span aria-hidden className="text-[10px] leading-none text-[#d03b3b]" title="Required">
            *
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="text-[11px] text-[#d03b3b]">{error}</p>
      ) : hint ? (
        <p className="text-[11px] leading-snug text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A numeric input that always shows a unit next to it and stores SI internally.
 *
 * The component owns the display unit; `value` and `onChange` are always in the
 * SI base unit for the dimension, which is what keeps the calculation engine
 * free of unit handling.
 */
export function UnitInput({
  label,
  dimension,
  valueSI,
  onChangeSI,
  defaultUnit,
  hint,
  min,
  max,
  required,
  placeholder,
  provenance,
  disabled,
  id,
}: {
  label: string;
  dimension: Dimension;
  valueSI: number | undefined | null;
  onChangeSI: (v: number | undefined) => void;
  defaultUnit?: string;
  hint?: React.ReactNode;
  min?: number;
  max?: number;
  required?: boolean;
  placeholder?: string;
  provenance?: keyof typeof PROVENANCE_META;
  disabled?: boolean;
  id?: string;
}) {
  const generated = React.useId();
  const controlId = id ?? generated;
  const options = React.useMemo(() => unitsFor(dimension), [dimension]);
  const [unit, setUnit] = React.useState(() => defaultUnit && resolveUnit(defaultUnit) ? defaultUnit : options[0]?.symbol ?? "-");
  const [text, setText] = React.useState<string>(() =>
    valueSI === undefined || valueSI === null || !Number.isFinite(valueSI) ? "" : trim(convert(valueSI, options[0]?.symbol ?? "-", defaultUnit ?? options[0]?.symbol ?? "-")),
  );
  const [touched, setTouched] = React.useState(false);

  // Re-sync from the outside when the caller changes the value (undo, presets).
  const lastPushed = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (valueSI === lastPushed.current) return;
    setText(valueSI === undefined || valueSI === null || !Number.isFinite(valueSI) ? "" : trim(convert(valueSI, baseOf(dimension), unit)));
  }, [valueSI, unit, dimension]);

  const parsed = text.trim() === "" ? undefined : Number(text);
  const invalid =
    touched &&
    text.trim() !== "" &&
    (!Number.isFinite(parsed as number) ||
      (min !== undefined && (parsed as number) < convert(min, baseOf(dimension), unit)) ||
      (max !== undefined && (parsed as number) > convert(max, baseOf(dimension), unit)));

  const push = (nextText: string, nextUnit: string) => {
    if (nextText.trim() === "") {
      lastPushed.current = undefined;
      onChangeSI(undefined);
      return;
    }
    const n = Number(nextText);
    if (!Number.isFinite(n)) return;
    const si = convert(n, nextUnit, baseOf(dimension));
    lastPushed.current = si;
    onChangeSI(si);
  };

  return (
    <Field
      label={label}
      hint={hint}
      required={required}
      error={invalid ? `Enter a number${min !== undefined ? ` of at least ${trim(convert(min, baseOf(dimension), unit))} ${unit}` : ""}${max !== undefined ? ` and at most ${trim(convert(max, baseOf(dimension), unit))} ${unit}` : ""}.` : undefined}
      htmlFor={controlId}
    >
      <div className="flex gap-1.5">
        <input
          id={controlId}
          type="text"
          inputMode="decimal"
          className="gf-input flex-1"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setText(e.target.value);
            push(e.target.value, unit);
          }}
          onBlur={() => setTouched(true)}
        />
        {options.length > 1 && (
          <select
            aria-label={`Unit for ${label}`}
            className="gf-input w-24 shrink-0"
            value={unit}
            disabled={disabled}
            onChange={(e) => {
              const nextUnit = e.target.value;
              // Convert the displayed number so the physical value is unchanged.
              const n = Number(text);
              if (text.trim() !== "" && Number.isFinite(n)) {
                const converted = convert(n, unit, nextUnit);
                setText(trim(converted));
                push(String(converted), nextUnit);
              }
              setUnit(nextUnit);
            }}
          >
            {options.map((u) => (
              <option key={u.symbol} value={u.symbol} title={u.label}>
                {prettyUnit(u.symbol) || u.symbol}
              </option>
            ))}
          </select>
        )}
        {provenance && (
          <span className="flex items-center">
            <ProvenanceBadge provenance={provenance} />
          </span>
        )}
      </div>
    </Field>
  );
}

function baseOf(d: Dimension): string {
  return unitsFor(d)[0]?.symbol ?? "-";
}

function trim(n: number): string {
  if (!Number.isFinite(n)) return "";
  const s = n.toPrecision(10);
  return String(Number(s));
}

export function TextInput({
  label,
  value,
  onChange,
  hint,
  placeholder,
  required,
  multiline,
  rows = 3,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: React.ReactNode;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  id?: string;
}) {
  // Every control gets a stable id so its <label> is programmatically
  // associated with it — required for screen readers and for anything that
  // looks a control up by its accessible name.
  const generated = React.useId();
  const controlId = id ?? generated;
  return (
    <Field label={label} hint={hint} required={required} htmlFor={controlId}>
      {multiline ? (
        <textarea id={controlId} className="gf-input" rows={rows} value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input id={controlId} className="gf-input" value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

export function SelectInput<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  id,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  hint?: React.ReactNode;
  id?: string;
}) {
  const generated = React.useId();
  const controlId = id ?? generated;
  return (
    <Field label={label} hint={hint} htmlFor={controlId}>
      <select id={controlId} className="gf-input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  hint,
  min,
  max,
  step,
  suffix,
  id,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  hint?: React.ReactNode;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  id?: string;
}) {
  const generated = React.useId();
  const controlId = id ?? generated;
  const [text, setText] = React.useState(value === undefined || !Number.isFinite(value) ? "" : String(value));
  React.useEffect(() => {
    setText(value === undefined || !Number.isFinite(value) ? "" : String(value));
  }, [value]);
  const n = text.trim() === "" ? undefined : Number(text);
  const invalid = text.trim() !== "" && (!Number.isFinite(n as number) || (min !== undefined && (n as number) < min) || (max !== undefined && (n as number) > max));
  return (
    <Field label={label} hint={hint} error={invalid ? `Must be a number${min !== undefined ? ` ≥ ${min}` : ""}${max !== undefined ? ` and ≤ ${max}` : ""}.` : undefined} htmlFor={controlId}>
      <div className="flex items-center gap-1.5">
        <input
          id={controlId}
          className="gf-input"
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={invalid || undefined}
          step={step}
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.trim() === "" ? undefined : Number(e.target.value);
            if (v === undefined || Number.isFinite(v)) onChange(v);
          }}
        />
        {suffix && <span className="shrink-0 text-xs text-muted">{suffix}</span>}
      </div>
    </Field>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input type="checkbox" className="mt-0.5 accent-[color:rgb(var(--accent))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function EmptyState({ title, body, action }: { title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mx-auto mt-1.5 max-w-lg text-xs leading-relaxed text-muted">{body}</div>
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-xs text-muted">
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorNotice({ title = "Something went wrong", detail, onRetry }: { title?: string; detail?: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded border border-[#d03b3b] p-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#d03b3b]">
        <span aria-hidden>✕</span>
        {title}
      </div>
      {detail && <p className="mt-1 text-xs text-muted">{detail}</p>}
      {onRetry && (
        <button className="gf-btn mt-2" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="group relative inline-flex items-center">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden w-64 -translate-x-1/2 rounded border bg-panel p-2 text-[11px] leading-snug text-muted shadow-lg group-hover:block">
        {text}
      </span>
    </span>
  );
}

export function InfoDot({ text }: { text: string }) {
  return (
    <Tooltip text={text}>
      <span
        tabIndex={0}
        role="note"
        aria-label={text}
        className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border text-[9px] font-bold text-muted"
      >
        ?
      </span>
    </Tooltip>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; badge?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="gf-scroll-x mb-4 flex gap-1 border-b">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            "whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition",
            active === t.id ? "border-[color:rgb(var(--accent))] text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.badge !== undefined && t.badge > 0 && <span className="ml-1.5 rounded bg-surface px-1 text-[10px]">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

export function SampleBanner() {
  return (
    <div className="mb-4 rounded border border-[#fab219] bg-[color:rgb(250_178_25/0.08)] px-3 py-2 text-xs">
      <strong className="font-semibold text-[#fab219]">
        <span aria-hidden>⚠ </span>Demonstration project
      </strong>{" "}
      <span className="text-muted">
        Every value here is synthetic example data created to show the workflow. It describes no real vehicle and contains no real
        measurements. Create your own project before entering anything you intend to build.
      </span>
    </div>
  );
}
