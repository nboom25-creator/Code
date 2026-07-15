import type {
  Project,
  ProjectStep,
  StepProgress,
  UserProject,
} from "@/lib/types";

/**
 * A step is blocked from completion until every safety warning that requires
 * acknowledgment has been acknowledged. High-risk warnings are never hidden;
 * this only governs whether the user may advance past the step.
 */
export function stepAcknowledgmentBlocked(
  step: ProjectStep,
  acknowledgedIds: string[],
): boolean {
  return step.safetyWarnings
    .filter((w) => w.requiresAcknowledgment)
    .some((w) => !acknowledgedIds.includes(w.id));
}

/** Percentage of steps completed, 0–100, rounded to an integer. */
export function progressPercent(steps: StepProgress[]): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((s) => s.completed).length;
  return Math.round((done / steps.length) * 100);
}

export function completedStepCount(steps: StepProgress[]): number {
  return steps.filter((s) => s.completed).length;
}

/** Build the initial per-step progress array for a project. */
export function initialStepProgress(project: Project): StepProgress[] {
  return project.steps.map((step) => ({
    stepId: step.id,
    completed: false,
    completedAt: null,
  }));
}

/** Are all steps complete? An empty step list is never "complete". */
export function isProjectComplete(steps: StepProgress[]): boolean {
  return steps.length > 0 && steps.every((s) => s.completed);
}

/**
 * Index of the first incomplete step, used to resume "exactly where you left
 * off". Returns the last index when everything is done.
 */
export function firstIncompleteIndex(steps: StepProgress[]): number {
  const idx = steps.findIndex((s) => !s.completed);
  return idx === -1 ? Math.max(0, steps.length - 1) : idx;
}

/**
 * Apply completion of a single step immutably and recompute derived fields.
 * Pure so it can be unit-tested independent of storage.
 */
export function toggleStep(
  userProject: UserProject,
  stepId: string,
  completed: boolean,
  now: string,
): UserProject {
  const steps = userProject.steps.map((s) =>
    s.stepId === stepId
      ? { ...s, completed, completedAt: completed ? now : null }
      : s,
  );
  const allDone = isProjectComplete(steps);
  // Marking a step complete does not move the cursor — navigation is explicit
  // (Previous/Next). We only clamp the index so it stays in range.
  const clampedIndex = Math.min(
    userProject.currentStepIndex,
    Math.max(0, steps.length - 1),
  );
  return {
    ...userProject,
    steps,
    status: allDone ? "completed" : "in_progress",
    currentStepIndex: clampedIndex,
    completedAt: allDone ? (userProject.completedAt ?? now) : null,
    updatedAt: now,
  };
}

/** Sum estimated cost saved by tackling completed projects yourself. */
export function estimatedMoneySavedCents(
  completedProjects: Project[],
): number {
  // Rough heuristic: midpoint of the project's own cost band is what a pro
  // would typically charge on top of materials. Clearly an estimate.
  return completedProjects.reduce((sum, p) => {
    const midMaterials = (p.estimatedCostLowCents + p.estimatedCostHighCents) / 2;
    const laborEstimate = Math.max(4000, p.activeMinutes * 100); // ~$60/hr
    return sum + Math.round(laborEstimate + midMaterials * 0.15);
  }, 0);
}
