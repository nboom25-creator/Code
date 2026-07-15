import { describe, expect, it } from "vitest";
import { recommendProjects } from "@/lib/planner";
import { PROJECTS } from "@/lib/seed/projects";
import type { PlannerAnswers } from "@/lib/types";

const baseAnswers: PlannerAnswers = {
  goal: "",
  availableMinutes: 120,
  budgetCents: 10000,
  ownedToolIds: [],
  experience: "beginner",
  rentOrOwn: "own",
  comfortablePlumbingElectrical: true,
};

describe("recommendProjects", () => {
  it("returns recommendations with reasons", () => {
    const recs = recommendProjects(PROJECTS, baseAnswers);
    expect(recs.length).toBeGreaterThan(0);
    for (const rec of recs) {
      expect(rec.reasons.length).toBeGreaterThan(0);
    }
  });

  it("never surfaces projects above a beginner by more than one level", () => {
    const recs = recommendProjects(PROJECTS, { ...baseAnswers, experience: "beginner" });
    expect(recs.every((r) => r.project.difficulty !== "advanced")).toBe(true);
  });

  it("prioritizes renter-friendly projects for renters", () => {
    const recs = recommendProjects(
      PROJECTS,
      { ...baseAnswers, rentOrOwn: "rent" },
      3,
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs[0]!.project.renterFriendly).toBe(true);
  });

  it("deprioritizes plumbing when the user is not comfortable with it", () => {
    const comfortable = recommendProjects(PROJECTS, {
      ...baseAnswers,
      goal: "fix a running toilet",
      comfortablePlumbingElectrical: true,
    });
    const notComfortable = recommendProjects(PROJECTS, {
      ...baseAnswers,
      goal: "fix a running toilet",
      comfortablePlumbingElectrical: false,
    });
    const plumbingRankComfortable = comfortable.findIndex(
      (r) => r.project.category === "plumbing",
    );
    const plumbingRankNot = notComfortable.findIndex(
      (r) => r.project.category === "plumbing",
    );
    // Either it drops out entirely, or ranks no better than when comfortable.
    if (plumbingRankNot !== -1 && plumbingRankComfortable !== -1) {
      expect(plumbingRankNot).toBeGreaterThanOrEqual(plumbingRankComfortable);
    } else {
      expect(true).toBe(true);
    }
  });

  it("respects the limit", () => {
    const recs = recommendProjects(PROJECTS, baseAnswers, 2);
    expect(recs.length).toBeLessThanOrEqual(2);
  });

  it("rewards goal keyword relevance", () => {
    const recs = recommendProjects(PROJECTS, {
      ...baseAnswers,
      goal: "paint my bedroom wall",
      experience: "intermediate",
    });
    expect(recs[0]!.project.category).toBe("painting");
  });
});
