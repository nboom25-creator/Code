import { Progress } from "@/components/ui/progress";

export function ProgressBar({
  value,
  completed,
  total,
  showLabel = true,
}: {
  value: number;
  completed?: number;
  total?: number;
  showLabel?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {showLabel ? (
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {completed !== undefined && total !== undefined
              ? `Step ${Math.min(completed + 1, total)} of ${total}`
              : "Progress"}
          </span>
          <span className="text-muted-foreground">{value}% complete</span>
        </div>
      ) : null}
      <Progress
        value={value}
        aria-label={`Project progress: ${value} percent complete`}
      />
    </div>
  );
}
