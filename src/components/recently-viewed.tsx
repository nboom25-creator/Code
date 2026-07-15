"use client";

import { History } from "lucide-react";
import { ProjectCard } from "@/components/project-card";
import { useAppStore } from "@/lib/store/store";
import { PROJECT_BY_ID } from "@/lib/seed/projects";

/**
 * Renders the "Recently viewed" strip. Returns null until hydrated and only
 * when there is history, so it never causes a hydration mismatch or an empty
 * heading on first load.
 */
export function RecentlyViewed() {
  const { data, hydrated } = useAppStore();
  if (!hydrated || data.recentlyViewed.length === 0) return null;

  const projects = data.recentlyViewed
    .map((id) => PROJECT_BY_ID[id])
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, 3);

  if (projects.length === 0) return null;

  return (
    <section className="container py-8" aria-labelledby="recently-viewed-heading">
      <h2
        id="recently-viewed-heading"
        className="mb-4 flex items-center gap-2 text-xl font-semibold"
      >
        <History className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        Recently viewed
      </h2>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}
