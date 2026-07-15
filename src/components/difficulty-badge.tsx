import { Signal, SignalHigh, SignalMedium } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDifficulty } from "@/lib/format";
import type { Difficulty } from "@/lib/types";

const ICONS: Record<Difficulty, typeof Signal> = {
  beginner: SignalMedium,
  intermediate: SignalHigh,
  advanced: Signal,
};

const VARIANTS: Record<Difficulty, "success" | "warning" | "destructive"> = {
  beginner: "success",
  intermediate: "warning",
  advanced: "destructive",
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const Icon = ICONS[difficulty];
  return (
    <Badge variant={VARIANTS[difficulty]}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {formatDifficulty(difficulty)}
    </Badge>
  );
}
