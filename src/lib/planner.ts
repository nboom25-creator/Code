import type {
  Difficulty,
  PlannerAnswers,
  Project,
  ProjectRecommendation,
} from "@/lib/types";

const DIFFICULTY_RANK: Record<Difficulty, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
};

/**
 * Recommend projects from the catalog based on the planner questionnaire.
 * Pure and deterministic so recommendations are testable. Every recommendation
 * carries plain-language reasons explaining the match.
 */
export function recommendProjects(
  projects: Project[],
  answers: PlannerAnswers,
  limit = 6,
): ProjectRecommendation[] {
  const goalTerms = answers.goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  const ownedTools = new Set(answers.ownedToolIds);

  const scored: ProjectRecommendation[] = projects.map((project) => {
    let score = 0;
    const reasons: string[] = [];

    // Experience fit — never recommend something above the user's comfort by
    // more than one level, and reward matches.
    const gap = DIFFICULTY_RANK[project.difficulty] - DIFFICULTY_RANK[answers.experience];
    if (gap <= 0) {
      score += 3;
      reasons.push(`Matches your ${answers.experience} experience level`);
    } else if (gap === 1) {
      score += 1;
      reasons.push("A gentle step up from your current level");
    } else {
      score -= 4; // strongly discourage advanced projects for beginners
    }

    // Time fit
    if (project.totalMinutes <= answers.availableMinutes) {
      score += 2;
      reasons.push("Fits the time you have available");
    } else if (project.activeMinutes <= answers.availableMinutes) {
      score += 1;
      reasons.push("Active work fits your time (includes some waiting)");
    } else {
      score -= 2;
    }

    // Budget fit
    if (project.estimatedCostHighCents <= answers.budgetCents) {
      score += 2;
      reasons.push("Comfortably within your budget");
    } else if (project.estimatedCostLowCents <= answers.budgetCents) {
      score += 1;
      reasons.push("Possible within your budget with careful shopping");
    } else {
      score -= 3;
    }

    // Tools already owned
    const requiredToolIds = project.tools
      .filter((t) => !t.optional)
      .map((t) => t.toolId);
    const owned = requiredToolIds.filter((id) => ownedTools.has(id)).length;
    if (requiredToolIds.length > 0 && owned === requiredToolIds.length) {
      score += 2;
      reasons.push("You already own every required tool");
    } else if (owned > 0) {
      score += 1;
      reasons.push(`You already own ${owned} of the required tools`);
    }

    // Renter friendliness
    if (answers.rentOrOwn === "rent") {
      if (project.renterFriendly) {
        score += 2;
        reasons.push("Renter-friendly — no permanent changes");
      } else {
        score -= 2;
      }
    }

    // Plumbing / electrical comfort gating
    if (
      !answers.comfortablePlumbingElectrical &&
      (project.category === "plumbing" || project.category === "electrical")
    ) {
      score -= 3;
    } else if (
      answers.comfortablePlumbingElectrical &&
      (project.category === "plumbing" || project.category === "electrical")
    ) {
      score += 1;
    }

    // Never surface projects that need a professional/permit for beginners.
    if (project.requiresPermitOrPro) score -= 5;

    // Goal keyword relevance
    if (goalTerms.length > 0) {
      const haystack = `${project.title} ${project.summary} ${project.category}`.toLowerCase();
      const hits = goalTerms.filter((t) => haystack.includes(t)).length;
      if (hits > 0) {
        score += hits * 2;
        reasons.push("Related to what you want to accomplish");
      }
    }

    return { project, score, reasons };
  });

  return scored
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
