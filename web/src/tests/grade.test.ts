import { describe, it, expect } from "vitest";
import { gradeAnswer, normalizeNum } from "@/lib/grade";
import type { QuizQuestion } from "@/lib/schemas";

function q(partial: Partial<QuizQuestion>): QuizQuestion {
  return {
    id: "1",
    type: "conceptual-mc",
    topic: "",
    difficulty: "intermediate",
    prompt: "",
    options: [],
    correctAnswer: "",
    unit: "",
    solutionSteps: [],
    explanation: "",
    concept: "",
    ...partial,
  };
}

describe("gradeAnswer", () => {
  it("grades multiple choice by exact text (case-insensitive)", () => {
    const qn = q({ type: "conceptual-mc", correctAnswer: "Increases" });
    expect(gradeAnswer(qn, "increases")).toBe(true);
    expect(gradeAnswer(qn, "decreases")).toBe(false);
  });

  it("grades numerical within 2% tolerance", () => {
    const qn = q({ type: "numerical", correctAnswer: "502320" });
    expect(gradeAnswer(qn, "502000")).toBe(true); // within 2%
    expect(gradeAnswer(qn, "450000")).toBe(false); // outside 2%
  });

  it("parses numbers out of noisy answers", () => {
    expect(normalizeNum("about 3.5 m/s")).toBeCloseTo(3.5);
    expect(normalizeNum("1,200")).toBe(1200);
    expect(normalizeNum("no number")).toBeNull();
  });
});
