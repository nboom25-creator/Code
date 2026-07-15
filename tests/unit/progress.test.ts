import { describe, expect, it } from "vitest";
import {
  firstIncompleteIndex,
  initialStepProgress,
  isProjectComplete,
  progressPercent,
  toggleStep,
} from "@/lib/progress";
import { PROJECT_BY_SLUG } from "@/lib/seed/projects";
import type { UserProject } from "@/lib/types";

const project = PROJECT_BY_SLUG["hang-a-framed-picture"]!;

function makeUserProject(): UserProject {
  return {
    id: "up-1",
    userId: "guest",
    projectId: project.id,
    status: "in_progress",
    currentStepIndex: 0,
    steps: initialStepProgress(project),
    acknowledgedWarnings: [],
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("progressPercent", () => {
  it("is 0 with no completed steps", () => {
    expect(progressPercent(initialStepProgress(project))).toBe(0);
  });
  it("is 100 when all steps complete", () => {
    const all = initialStepProgress(project).map((s) => ({
      ...s,
      completed: true,
    }));
    expect(progressPercent(all)).toBe(100);
  });
  it("rounds partial progress", () => {
    const steps = initialStepProgress(project);
    steps[0] = { ...steps[0]!, completed: true };
    const expected = Math.round((1 / steps.length) * 100);
    expect(progressPercent(steps)).toBe(expected);
  });
});

describe("firstIncompleteIndex", () => {
  it("returns the first incomplete step", () => {
    const steps = initialStepProgress(project);
    steps[0] = { ...steps[0]!, completed: true };
    expect(firstIncompleteIndex(steps)).toBe(1);
  });
});

describe("toggleStep", () => {
  const now = "2026-02-02T00:00:00.000Z";

  it("marks a step complete without moving the cursor (navigation is explicit)", () => {
    const up = makeUserProject();
    const firstStepId = project.steps[0]!.id;
    const next = toggleStep(up, firstStepId, true, now);
    expect(next.steps.find((s) => s.stepId === firstStepId)?.completed).toBe(true);
    expect(next.status).toBe("in_progress");
    expect(next.currentStepIndex).toBe(0);
  });

  it("marks the project completed when every step is done", () => {
    let up = makeUserProject();
    for (const step of project.steps) {
      up = toggleStep(up, step.id, true, now);
    }
    expect(isProjectComplete(up.steps)).toBe(true);
    expect(up.status).toBe("completed");
    expect(up.completedAt).toBe(now);
  });

  it("reverts to in_progress when a completed step is unchecked", () => {
    let up = makeUserProject();
    for (const step of project.steps) {
      up = toggleStep(up, step.id, true, now);
    }
    up = toggleStep(up, project.steps[0]!.id, false, now);
    expect(up.status).toBe("in_progress");
    expect(up.completedAt).toBeNull();
  });
});
