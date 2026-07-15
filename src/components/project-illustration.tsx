import { cn } from "@/lib/utils";
import type { CategorySlug } from "@/lib/types";
import {
  Armchair,
  Droplets,
  Grid3x3,
  Hammer,
  LayoutGrid,
  Paintbrush,
  Square,
  Trees,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

const CATEGORY_ICONS: Record<CategorySlug, LucideIcon> = {
  painting: Paintbrush,
  "walls-drywall": Square,
  "shelving-storage": LayoutGrid,
  plumbing: Droplets,
  furniture: Armchair,
  flooring: Grid3x3,
  outdoor: Trees,
  electrical: Zap,
  maintenance: Wrench,
  woodworking: Hammer,
};

// Deterministic warm gradient per category — no external images required.
const CATEGORY_TINT: Record<CategorySlug, string> = {
  painting: "from-orange-100 to-amber-50 dark:from-orange-950/40 dark:to-amber-950/20",
  "walls-drywall": "from-stone-100 to-stone-50 dark:from-stone-900/60 dark:to-stone-950/30",
  "shelving-storage": "from-amber-100 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/20",
  plumbing: "from-sky-100 to-cyan-50 dark:from-sky-950/40 dark:to-cyan-950/20",
  furniture: "from-rose-100 to-orange-50 dark:from-rose-950/40 dark:to-orange-950/20",
  flooring: "from-teal-100 to-emerald-50 dark:from-teal-950/40 dark:to-emerald-950/20",
  outdoor: "from-green-100 to-lime-50 dark:from-green-950/40 dark:to-lime-950/20",
  electrical: "from-yellow-100 to-amber-50 dark:from-yellow-950/40 dark:to-amber-950/20",
  maintenance: "from-slate-100 to-zinc-50 dark:from-slate-900/60 dark:to-zinc-950/30",
  woodworking: "from-amber-100 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/20",
};

/**
 * Tasteful placeholder illustration. Uses the category icon over a warm
 * gradient so every project has a consistent visual without stock photos.
 * `alt` is applied via an accessible label on the container.
 */
export function ProjectIllustration({
  category,
  alt,
  className,
  iconClassName,
}: {
  category: CategorySlug;
  alt: string;
  className?: string;
  iconClassName?: string;
}) {
  const Icon = CATEGORY_ICONS[category];
  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        "flex items-center justify-center bg-gradient-to-br",
        CATEGORY_TINT[category],
        className,
      )}
    >
      <Icon
        className={cn("text-secondary/70 dark:text-foreground/60", iconClassName)}
        strokeWidth={1.25}
        aria-hidden="true"
      />
    </div>
  );
}
