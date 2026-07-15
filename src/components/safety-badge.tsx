import { ShieldAlert, ShieldCheck, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatSafetyLevel } from "@/lib/format";
import type { SafetyLevel } from "@/lib/types";

const ICONS: Record<SafetyLevel, typeof ShieldCheck> = {
  low: ShieldCheck,
  moderate: ShieldQuestion,
  elevated: ShieldAlert,
};

const VARIANTS: Record<SafetyLevel, "success" | "warning" | "destructive"> = {
  low: "success",
  moderate: "warning",
  elevated: "destructive",
};

/**
 * Safety is never communicated by color alone — every badge pairs a distinct
 * icon and an explicit text label with the color.
 */
export function SafetyBadge({ level }: { level: SafetyLevel }) {
  const Icon = ICONS[level];
  return (
    <Badge variant={VARIANTS[level]}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {formatSafetyLevel(level)}
    </Badge>
  );
}
