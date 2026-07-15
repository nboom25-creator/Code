"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from "@/lib/seed/categories";
import { TOOLS } from "@/lib/seed/catalog";
import { activeFilterCount, DEFAULT_FILTERS } from "@/lib/filters";
import { formatCostBand } from "@/lib/format";
import type {
  CategorySlug,
  CostBand,
  Difficulty,
  ProjectFilterState,
} from "@/lib/types";

const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];
const COST_BANDS: CostBand[] = ["under_25", "25_75", "75_200", "200_plus"];
const TIME_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "Any time", minutes: null },
  { label: "Under 1 hour", minutes: 60 },
  { label: "Under 3 hours", minutes: 180 },
  { label: "Under a day", minutes: 60 * 8 },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((v) => v !== value)
    : [...list, value];
}

export function ProjectFilters({
  filters,
  onChange,
}: {
  filters: ProjectFilterState;
  onChange: (next: ProjectFilterState) => void;
}) {
  const count = activeFilterCount(filters);
  const patch = (partial: Partial<ProjectFilterState>) =>
    onChange({ ...filters, ...partial });

  return (
    <div className="space-y-6">
      <div>
        <Label htmlFor="project-search" className="mb-1.5 block">
          Search
        </Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="project-search"
            type="search"
            value={filters.query}
            onChange={(e) => patch({ query: e.target.value })}
            placeholder="Search projects…"
            className="pl-9"
          />
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Category</legend>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const active = filters.categories.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  patch({ categories: toggle<CategorySlug>(filters.categories, c.slug) })
                }
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
              >
                <Badge variant={active ? "default" : "outline"}>{c.name}</Badge>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Difficulty</legend>
        <div className="flex flex-wrap gap-1.5">
          {DIFFICULTIES.map((d) => {
            const active = filters.difficulties.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  patch({ difficulties: toggle<Difficulty>(filters.difficulties, d) })
                }
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full capitalize"
              >
                <Badge variant={active ? "default" : "outline"} className="capitalize">
                  {d}
                </Badge>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Estimated time</legend>
        <div className="flex flex-wrap gap-1.5">
          {TIME_OPTIONS.map((opt) => {
            const active = filters.maxMinutes === opt.minutes;
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={active}
                onClick={() => patch({ maxMinutes: opt.minutes })}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
              >
                <Badge variant={active ? "default" : "outline"}>{opt.label}</Badge>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Estimated cost</legend>
        <div className="flex flex-wrap gap-1.5">
          {COST_BANDS.map((band) => {
            const active = filters.costBands.includes(band);
            return (
              <button
                key={band}
                type="button"
                aria-pressed={active}
                onClick={() => patch({ costBands: toggle<CostBand>(filters.costBands, band) })}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
              >
                <Badge variant={active ? "default" : "outline"}>
                  {formatCostBand(band)}
                </Badge>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Location</legend>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "indoor", "outdoor"] as const).map((opt) => {
            const active = filters.indoor === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                onClick={() => patch({ indoor: opt })}
                className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full capitalize"
              >
                <Badge variant={active ? "default" : "outline"} className="capitalize">
                  {opt === "all" ? "Indoor & outdoor" : opt}
                </Badge>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="renter-friendly">Renter-friendly only</Label>
          <Switch
            id="renter-friendly"
            checked={filters.renterFriendlyOnly}
            onCheckedChange={(v) => patch({ renterFriendlyOnly: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="hide-pro">Hide projects needing a pro/permit</Label>
          <Switch
            id="hide-pro"
            checked={filters.hideProfessionalRequired}
            onCheckedChange={(v) => patch({ hideProfessionalRequired: v })}
          />
        </div>
      </div>

      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Tools required ({filters.requiredTools.length})
        </summary>
        <div className="mt-3 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1">
          {TOOLS.map((tool) => (
            <label key={tool.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={filters.requiredTools.includes(tool.id)}
                onCheckedChange={() =>
                  patch({ requiredTools: toggle(filters.requiredTools, tool.id) })
                }
              />
              {tool.name}
            </label>
          ))}
        </div>
      </details>

      {count > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="w-full"
        >
          <X className="h-4 w-4" aria-hidden="true" /> Clear {count} filter
          {count === 1 ? "" : "s"}
        </Button>
      ) : null}
    </div>
  );
}
