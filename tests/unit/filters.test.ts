import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  filterProjects,
  matchesQuery,
  sortProjects,
} from "@/lib/filters";
import { PROJECTS } from "@/lib/seed/projects";
import type { ProjectFilterState } from "@/lib/types";

const withFilters = (partial: Partial<ProjectFilterState>): ProjectFilterState => ({
  ...DEFAULT_FILTERS,
  ...partial,
});

describe("matchesQuery", () => {
  const paint = PROJECTS.find((p) => p.slug === "paint-a-bedroom-wall")!;

  it("matches when the query is empty", () => {
    expect(matchesQuery(paint, "")).toBe(true);
  });
  it("matches on title terms case-insensitively", () => {
    expect(matchesQuery(paint, "PAINT")).toBe(true);
  });
  it("requires every term to appear", () => {
    expect(matchesQuery(paint, "paint zzzznotpresent")).toBe(false);
  });
});

describe("filterProjects", () => {
  it("returns all projects with default filters", () => {
    expect(filterProjects(PROJECTS, DEFAULT_FILTERS)).toHaveLength(PROJECTS.length);
  });

  it("filters by category", () => {
    const result = filterProjects(PROJECTS, withFilters({ categories: ["plumbing"] }));
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.category === "plumbing")).toBe(true);
  });

  it("filters by difficulty", () => {
    const result = filterProjects(PROJECTS, withFilters({ difficulties: ["beginner"] }));
    expect(result.every((p) => p.difficulty === "beginner")).toBe(true);
  });

  it("filters by max time", () => {
    const result = filterProjects(PROJECTS, withFilters({ maxMinutes: 60 }));
    expect(result.every((p) => p.totalMinutes <= 60)).toBe(true);
  });

  it("filters by renter-friendly", () => {
    const result = filterProjects(PROJECTS, withFilters({ renterFriendlyOnly: true }));
    expect(result.every((p) => p.renterFriendly)).toBe(true);
  });

  it("filters by required tools (must include all)", () => {
    const result = filterProjects(
      PROJECTS,
      withFilters({ requiredTools: ["tool-drill"] }),
    );
    expect(
      result.every((p) => p.tools.some((t) => t.toolId === "tool-drill")),
    ).toBe(true);
  });

  it("combines filters with AND semantics", () => {
    const result = filterProjects(
      PROJECTS,
      withFilters({ categories: ["painting"], difficulties: ["advanced"] }),
    );
    // No painting project is advanced in the seed data.
    expect(result).toHaveLength(0);
  });
});

describe("sortProjects", () => {
  it("sorts quickest first by total time", () => {
    const sorted = sortProjects(PROJECTS, "time");
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.totalMinutes).toBeGreaterThanOrEqual(sorted[i - 1]!.totalMinutes);
    }
  });

  it("puts featured projects first when recommended", () => {
    const sorted = sortProjects(PROJECTS, "recommended");
    const firstNonFeatured = sorted.findIndex((p) => !p.featured);
    const lastFeatured = sorted.map((p) => p.featured).lastIndexOf(true);
    expect(firstNonFeatured).toBeGreaterThan(lastFeatured - 1);
  });
});

describe("activeFilterCount", () => {
  it("is zero for defaults", () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });
  it("counts each active filter", () => {
    expect(
      activeFilterCount(
        withFilters({ query: "paint", categories: ["painting"], renterFriendlyOnly: true }),
      ),
    ).toBe(3);
  });
});
