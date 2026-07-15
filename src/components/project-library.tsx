"use client";

import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, PackageSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ProjectCard } from "@/components/project-card";
import { ProjectFilters } from "@/components/project-filters";
import { EmptyState } from "@/components/states";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  filterProjects,
  sortProjects,
  type SortKey,
} from "@/lib/filters";
import { PROJECTS } from "@/lib/seed/projects";
import { useAppStore } from "@/lib/store/store";
import type { ProjectFilterState } from "@/lib/types";

export function ProjectLibrary({
  initialFilters,
}: {
  initialFilters: Partial<ProjectFilterState>;
}) {
  const [filters, setFilters] = useState<ProjectFilterState>({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  });
  const [sort, setSort] = useState<SortKey>("recommended");
  const { recordView } = useAppStore();

  // Keep the document title query in sync is unnecessary; recordView noop here.
  useEffect(() => {
    void recordView;
  }, [recordView]);

  const results = useMemo(() => {
    const filtered = filterProjects(PROJECTS, filters);
    return sortProjects(filtered, sort);
  }, [filters, sort]);

  const count = activeFilterCount(filters);

  return (
    <div className="container py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Project library</h1>
        <p className="text-muted-foreground">
          {results.length} {results.length === 1 ? "project" : "projects"}
          {count > 0 ? " match your filters" : " to explore"}.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 lg:block">
          <div className="sticky top-24 rounded-xl border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Filters
            </h2>
            <ProjectFilters filters={filters} onChange={setFilters} />
          </div>
        </aside>

        <div className="flex-1">
          {/* Mobile controls */}
          <div className="mb-4 flex items-center justify-between gap-3">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline" className="lg:hidden">
                  <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                  Filters
                  {count > 0 ? (
                    <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                      {count}
                    </span>
                  ) : null}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Filters</DialogTitle>
                </DialogHeader>
                <ProjectFilters filters={filters} onChange={setFilters} />
              </DialogContent>
            </Dialog>

            <div className="ml-auto flex items-center gap-2">
              <label htmlFor="sort" className="text-sm text-muted-foreground">
                Sort by
              </label>
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger id="sort" className="w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recommended">Recommended</SelectItem>
                  <SelectItem value="time">Quickest first</SelectItem>
                  <SelectItem value="cost">Cheapest first</SelectItem>
                  <SelectItem value="difficulty">Easiest first</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {results.length > 0 ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {results.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<PackageSearch className="h-10 w-10" />}
              title="No projects match your filters"
              description="Try removing a filter or searching for something else."
              action={
                <Button variant="outline" onClick={() => setFilters(DEFAULT_FILTERS)}>
                  Clear all filters
                </Button>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
