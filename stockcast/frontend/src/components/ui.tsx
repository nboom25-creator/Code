"use client";
import React from "react";

export function Card({
  children,
  className = "",
  title,
  subtitle,
  action,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm ${className}`}
    >
      {(title || action) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// Accessible term tooltip: keyboard focusable, hover/focus reveal.
export function InfoTip({ text, label }: { text: string; label?: string }) {
  return (
    <span className="tip ml-1 inline-flex" tabIndex={0} role="button" aria-label={label || text}>
      <span
        aria-hidden
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] font-bold text-muted"
      >
        ?
      </span>
      <span className="tip-body" role="tooltip">
        {text}
      </span>
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className = "",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "up" | "down" | "warn";
  className?: string;
}) {
  const toneClass =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <div className={`rounded-xl border border-border bg-surface/50 p-3 ${className}`}>
      <div className="flex items-center text-xs text-muted">
        {label}
        {hint && <InfoTip text={hint} />}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "up" | "down" | "warn" | "brand";
}) {
  const map: Record<string, string> = {
    default: "bg-border/60 text-fg",
    up: "bg-up/15 text-up",
    down: "bg-down/15 text-down",
    warn: "bg-warn/20 text-warn",
    brand: "bg-brand/15 text-brand",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${map[tone]}`}>
      {children}
    </span>
  );
}

export function Bar({ value, max = 1 }: { value: number; max?: number }) {
  // Diverging bar for a [-max, max] score, centred at zero.
  const pct = Math.max(-1, Math.min(1, value / max));
  const width = Math.abs(pct) * 50;
  const positive = pct >= 0;
  return (
    <div className="relative h-2 w-full rounded-full bg-border/50">
      <div className="absolute left-1/2 top-0 h-full w-px bg-muted/40" />
      <div
        className={`absolute top-0 h-full rounded-full ${positive ? "bg-up" : "bg-down"}`}
        style={positive ? { left: "50%", width: `${width}%` } : { right: "50%", width: `${width}%` }}
      />
    </div>
  );
}
