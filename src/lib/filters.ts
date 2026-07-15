import type {
  CostBand,
  Project,
  ProjectFilterState,
} from "@/lib/types";

export const DEFAULT_FILTERS: ProjectFilterState = {
  query: "",
  categories: [],
  difficulties: [],
  maxMinutes: null,
  costBands: [],
  indoor: "all",
  requiredTools: [],
  renterFriendlyOnly: false,
  hideProfessionalRequired: false,
};

const COST_BAND_ORDER: Record<CostBand, number> = {
  under_25: 0,
  "25_75": 1,
  "75_200": 2,
  "200_plus": 3,
};

/** Case-insensitive search across title, summary, category and tool names. */
export function matchesQuery(project: Project, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    project.title,
    project.summary,
    project.description,
    project.category,
    ...project.skillPrerequisites,
  ]
    .join(" ")
    .toLowerCase();
  // Every whitespace-separated term must appear somewhere.
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/**
 * Pure filtering function — the single source of truth for the library and
 * planner. Kept free of React so it is trivially testable.
 */
export function filterProjects(
  projects: Project[],
  filters: ProjectFilterState,
): Project[] {
  return projects.filter((project) => {
    if (!matchesQuery(project, filters.query)) return false;

    if (
      filters.categories.length > 0 &&
      !filters.categories.includes(project.category)
    ) {
      return false;
    }

    if (
      filters.difficulties.length > 0 &&
      !filters.difficulties.includes(project.difficulty)
    ) {
      return false;
    }

    if (filters.maxMinutes !== null && project.totalMinutes > filters.maxMinutes) {
      return false;
    }

    if (
      filters.costBands.length > 0 &&
      !filters.costBands.includes(project.costBand)
    ) {
      return false;
    }

    if (filters.indoor === "indoor" && !project.indoor) return false;
    if (filters.indoor === "outdoor" && project.indoor) return false;

    if (filters.renterFriendlyOnly && !project.renterFriendly) return false;

    if (filters.hideProfessionalRequired && project.requiresPermitOrPro) {
      return false;
    }

    if (filters.requiredTools.length > 0) {
      const projectToolIds = new Set(project.tools.map((t) => t.toolId));
      const hasAll = filters.requiredTools.every((id) => projectToolIds.has(id));
      if (!hasAll) return false;
    }

    return true;
  });
}

export type SortKey = "recommended" | "time" | "cost" | "difficulty";

const DIFFICULTY_ORDER = { beginner: 0, intermediate: 1, advanced: 2 };

export function sortProjects(projects: Project[], sort: SortKey): Project[] {
  const copy = [...projects];
  switch (sort) {
    case "time":
      return copy.sort((a, b) => a.totalMinutes - b.totalMinutes);
    case "cost":
      return copy.sort(
        (a, b) => a.estimatedCostLowCents - b.estimatedCostLowCents,
      );
    case "difficulty":
      return copy.sort(
        (a, b) =>
          DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty],
      );
    case "recommended":
    default:
      // Featured first, then beginner-friendly, then cheaper.
      return copy.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        if (a.difficulty !== b.difficulty) {
          return DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty];
        }
        return COST_BAND_ORDER[a.costBand] - COST_BAND_ORDER[b.costBand];
      });
  }
}

export function activeFilterCount(filters: ProjectFilterState): number {
  let count = 0;
  if (filters.query.trim()) count += 1;
  count += filters.categories.length;
  count += filters.difficulties.length;
  if (filters.maxMinutes !== null) count += 1;
  count += filters.costBands.length;
  if (filters.indoor !== "all") count += 1;
  count += filters.requiredTools.length;
  if (filters.renterFriendlyOnly) count += 1;
  if (filters.hideProfessionalRequired) count += 1;
  return count;
}
