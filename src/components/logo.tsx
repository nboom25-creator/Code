import { Compass } from "lucide-react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-bold", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Compass className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-lg tracking-tight">
        Project<span className="text-primary">Path</span>
      </span>
    </span>
  );
}
