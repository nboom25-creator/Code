"use client";

import { AlertTriangle, ShieldAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { SafetyWarning as SafetyWarningType, SafetyLevel } from "@/lib/types";

const LEVEL_STYLES: Record<
  SafetyLevel,
  { border: string; bg: string; icon: typeof AlertTriangle; label: string }
> = {
  low: {
    border: "border-sky-300 dark:border-sky-800",
    bg: "bg-sky-50 dark:bg-sky-950/30",
    icon: Info,
    label: "Good to know",
  },
  moderate: {
    border: "border-warning/60",
    bg: "bg-warning/10",
    icon: AlertTriangle,
    label: "Safety warning",
  },
  elevated: {
    border: "border-destructive/60",
    bg: "bg-destructive/10",
    icon: ShieldAlert,
    label: "Important safety warning",
  },
};

/**
 * Safety warning card. Content is ALWAYS visible — never hidden behind an
 * expander. When `requiresAcknowledgment` is set and no `onAcknowledge`
 * handler/`acknowledged` state is passed, it renders as an inline notice; in
 * the guided flow it becomes a blocking gate.
 */
export function SafetyWarning({
  warning,
  acknowledged,
  onAcknowledge,
}: {
  warning: SafetyWarningType;
  acknowledged?: boolean;
  onAcknowledge?: () => void;
}) {
  const style = LEVEL_STYLES[warning.level];
  const Icon = style.icon;
  const showGate = warning.requiresAcknowledgment && onAcknowledge;

  return (
    <div
      role={warning.level === "elevated" ? "alert" : "note"}
      className={cn("rounded-lg border p-4", style.border, style.bg)}
    >
      <div className="flex gap-3">
        <Icon
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0",
            warning.level === "elevated"
              ? "text-destructive"
              : warning.level === "moderate"
                ? "text-warning"
                : "text-sky-600 dark:text-sky-400",
          )}
          aria-hidden="true"
        />
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {style.label}
          </p>
          <p className="font-semibold">{warning.title}</p>
          <p className="text-sm text-muted-foreground">{warning.detail}</p>

          {showGate ? (
            <label className="mt-3 flex items-start gap-2 rounded-md bg-background/60 p-2 text-sm">
              <Checkbox
                checked={acknowledged}
                onCheckedChange={() => {
                  if (!acknowledged) onAcknowledge();
                }}
                aria-label={`I understand: ${warning.title}`}
              />
              <span>I&apos;ve read this and understand the risk.</span>
            </label>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Blocking gate used in guided mode. Renders all warnings that require
 * acknowledgment and calls `onAllAcknowledged` only after each is confirmed.
 */
export function SafetyGate({
  warnings,
  acknowledgedIds,
  onAcknowledge,
  onProceed,
}: {
  warnings: SafetyWarningType[];
  acknowledgedIds: string[];
  onAcknowledge: (id: string) => void;
  onProceed: () => void;
}) {
  const required = warnings.filter((w) => w.requiresAcknowledgment);
  const allAck = required.every((w) => acknowledgedIds.includes(w.id));

  return (
    <div className="space-y-3">
      {warnings.map((w) => (
        <SafetyWarning
          key={w.id}
          warning={w}
          acknowledged={acknowledgedIds.includes(w.id)}
          onAcknowledge={
            w.requiresAcknowledgment ? () => onAcknowledge(w.id) : undefined
          }
        />
      ))}
      {required.length > 0 ? (
        <Button onClick={onProceed} disabled={!allAck} className="w-full sm:w-auto">
          {allAck ? "I understand — continue" : "Acknowledge the warnings above"}
        </Button>
      ) : null}
    </div>
  );
}
