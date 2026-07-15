import type { Project, TroubleshootingEntry } from "@/lib/types";

export interface TroubleshootingMatch {
  entry: TroubleshootingEntry;
  score: number;
  matchedKeywords: string[];
}

/**
 * v1 troubleshooting: keyword matching against a project's predefined entries.
 * The interface returns ranked *possibilities* — the UI presents these as
 * "possible matches", never as a confirmed diagnosis.
 *
 * Architected so a future AI service can replace `matchTroubleshooting` with an
 * async call returning the same shape.
 */
export function matchTroubleshooting(
  project: Project,
  description: string,
  stepId?: string | null,
): TroubleshootingMatch[] {
  const text = description.toLowerCase();
  const words = new Set(text.split(/[^a-z0-9]+/).filter(Boolean));

  const scored = project.troubleshooting
    .filter((entry) => {
      // Prefer step-scoped or project-wide entries relevant to the context.
      if (stepId === undefined) return true;
      return entry.stepId === null || entry.stepId === stepId;
    })
    .map((entry) => {
      const matched: string[] = [];
      let score = 0;
      for (const kw of entry.keywords) {
        const kwLower = kw.toLowerCase();
        if (text.includes(kwLower)) {
          matched.push(kw);
          // Multi-word phrases and whole-word hits weigh more.
          score += kwLower.includes(" ") ? 3 : words.has(kwLower) ? 2 : 1;
        }
      }
      // Slightly boost entries scoped to the current step.
      if (stepId && entry.stepId === stepId) score += 1;
      return { entry, score, matchedKeywords: matched };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored;
}

/** Whether any entry across the project mentions calling a professional. */
export function hasProfessionalGuidance(project: Project): boolean {
  return (
    project.callProfessionalIf.length > 0 ||
    project.troubleshooting.some((t) => t.callProfessionalIf.length > 0)
  );
}
