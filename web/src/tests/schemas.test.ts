import { describe, it, expect } from "vitest";
import { LessonSchema, SolveSchema, QuizSchema } from "@/lib/schemas";

describe("structured AI output validation", () => {
  it("fills defaults for a minimal lesson", () => {
    const parsed = LessonSchema.parse({ topic: "Entropy", overview: "..." });
    expect(parsed.topic).toBe("Entropy");
    expect(parsed.equations).toEqual([]);
    expect(parsed.level).toBe("intermediate");
    expect(parsed.videoQueries).toEqual([]);
  });

  it("coerces a full solution and preserves ordered steps", () => {
    const parsed = SolveSchema.parse({
      problemStatement: "Heat water",
      known: [{ symbol: "m", value: "2", unit: "kg", label: "mass", source: "given" }],
      steps: [
        { title: "Governing eq", detail: "Q = m Cp dT" },
        { title: "Substitute", detail: "..." },
      ],
      finalAnswer: { value: "502320", unit: "J" },
    });
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.known[0].source).toBe("given");
    expect(parsed.finalAnswer.sigFigs).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(LessonSchema.safeParse("nope").success).toBe(false);
  });

  it("defaults an invalid question type back to conceptual-mc via catch? (strict enum)", () => {
    // Enum without catch should fail on a bad value — ensures we don't render junk.
    const res = QuizSchema.safeParse({
      topic: "x",
      questions: [{ id: "1", type: "totally-invalid", prompt: "?", correctAnswer: "a", explanation: "" }],
    });
    expect(res.success).toBe(false);
  });

  it("accepts a valid quiz", () => {
    const res = QuizSchema.parse({
      topic: "Thermo",
      questions: [
        {
          id: "1",
          type: "numerical",
          prompt: "Q?",
          options: [],
          correctAnswer: "502320",
          unit: "J",
          solutionSteps: ["step"],
          explanation: "because",
          concept: "first law",
        },
      ],
    });
    expect(res.questions[0].type).toBe("numerical");
  });
});
