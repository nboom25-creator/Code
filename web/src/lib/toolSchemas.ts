/**
 * JSON Schemas presented to the model as tool `input_schema`. These are the
 * *contract the model sees*; the matching Zod schemas in schemas.ts are the
 * *contract we enforce*. Keeping them separate lets the tool schema be rich
 * and descriptive while Zod stays forgiving on parse.
 */

const strArray = (desc: string) => ({
  type: "array",
  items: { type: "string" },
  description: desc,
});

const equationItems = {
  type: "object",
  properties: {
    name: { type: "string" },
    latex: { type: "string", description: "LaTeX WITHOUT surrounding $ delimiters" },
    description: { type: "string" },
  },
  required: ["name", "latex"],
};

export const LESSON_TOOL = {
  name: "emit_lesson",
  description: "Emit a complete structured engineering lesson.",
  input_schema: {
    type: "object" as const,
    properties: {
      topic: { type: "string" },
      discipline: { type: "string", description: "e.g. Thermodynamics, Statics" },
      level: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
      overview: { type: "string", description: "Plain-language overview" },
      prerequisites: strArray("Prerequisite concepts"),
      objectives: strArray("Learning objectives"),
      definitions: {
        type: "array",
        items: {
          type: "object",
          properties: { term: { type: "string" }, definition: { type: "string" } },
          required: ["term", "definition"],
        },
      },
      principles: strArray("Governing principles"),
      equations: { type: "array", items: equationItems },
      variables: {
        type: "array",
        items: {
          type: "object",
          properties: {
            symbol: { type: "string" },
            name: { type: "string" },
            siUnit: { type: "string" },
            description: { type: "string" },
          },
          required: ["symbol", "name", "siUnit"],
        },
      },
      assumptions: strArray("Assumptions and limitations"),
      example: {
        type: "object",
        properties: {
          problem: { type: "string" },
          steps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                explanation: { type: "string" },
                latex: { type: "string" },
              },
              required: ["title", "explanation"],
            },
          },
          answer: { type: "string" },
        },
        required: ["problem", "steps", "answer"],
      },
      commonMistakes: strArray("Common mistakes"),
      physicalInterpretation: { type: "string" },
      knowledgeCheck: {
        type: "array",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            answer: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["question", "answer"],
        },
      },
      relatedConcepts: strArray("Related concepts"),
      videoQueries: strArray("3-5 SPECIFIC YouTube search queries (not generic)"),
    },
    required: ["topic", "overview", "objectives", "equations", "example", "videoQueries"],
  },
} as const;

const knownItems = {
  type: "object",
  properties: {
    symbol: { type: "string" },
    value: { type: "string" },
    unit: { type: "string" },
    label: { type: "string" },
    source: { type: "string", enum: ["given", "assumed"] },
  },
  required: ["symbol", "value", "unit", "label", "source"],
};

export const SOLVE_TOOL = {
  name: "emit_solution",
  description: "Emit a structured, step-by-step engineering problem solution.",
  input_schema: {
    type: "object" as const,
    properties: {
      problemStatement: { type: "string", description: "Restate the problem clearly" },
      discipline: { type: "string" },
      known: { type: "array", items: knownItems },
      unknown: {
        type: "array",
        items: {
          type: "object",
          properties: { symbol: { type: "string" }, label: { type: "string" } },
          required: ["symbol", "label"],
        },
      },
      assumptions: strArray("Assumptions made"),
      missingInfo: strArray("Any required info the user did NOT provide. Do not invent values."),
      diagram: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["mermaid", "svg", "description", "none"] },
          title: { type: "string" },
          content: { type: "string", description: "mermaid source or <svg>..</svg> or text" },
          caption: { type: "string" },
        },
        required: ["type"],
      },
      governingPrinciples: strArray("Governing principles / laws"),
      equations: { type: "array", items: equationItems },
      steps: {
        type: "array",
        description: "Ordered solution steps. Solve symbolically before numbers when practical.",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            detail: { type: "string", description: "Markdown + inline $latex$" },
            latex: { type: "string", description: "optional display equation, no $ delimiters" },
          },
          required: ["title", "detail"],
        },
      },
      unitCheck: { type: "string", description: "Dimensional-consistency check" },
      finalAnswer: {
        type: "object",
        properties: {
          value: { type: "string" },
          unit: { type: "string" },
          latex: { type: "string" },
          sigFigs: { type: ["integer", "null"] },
        },
        required: ["value", "unit"],
      },
      sanityCheck: { type: "string" },
      physicalInterpretation: { type: "string" },
      commonMistakes: strArray("Common mistakes for this problem type"),
      videoQueries: strArray("3-5 SPECIFIC YouTube search queries"),
      practiceProblem: { type: "string", description: "A similar practice problem" },
      calcRequest: {
        type: ["object", "null"],
        description:
          "Deterministic calculation to verify with SymPy/Pint, or null. variables map symbol -> 'value unit'.",
        properties: {
          expression: { type: "string" },
          variables: { type: "object", additionalProperties: { type: "string" } },
          expectedUnit: { type: "string" },
        },
      },
    },
    required: [
      "problemStatement",
      "known",
      "unknown",
      "governingPrinciples",
      "steps",
      "finalAnswer",
      "videoQueries",
    ],
  },
} as const;

export const QUIZ_TOOL = {
  name: "emit_quiz",
  description: "Emit a set of engineering quiz questions with full solutions.",
  input_schema: {
    type: "object" as const,
    properties: {
      topic: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: {
              type: "string",
              enum: [
                "conceptual-mc",
                "numerical",
                "equation-selection",
                "unit-analysis",
                "error-identification",
                "short-response",
                "multi-step",
              ],
            },
            topic: { type: "string" },
            difficulty: { type: "string", enum: ["beginner", "intermediate", "advanced"] },
            prompt: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            correctAnswer: { type: "string" },
            unit: { type: "string" },
            solutionSteps: { type: "array", items: { type: "string" } },
            explanation: { type: "string" },
            concept: { type: "string" },
          },
          required: ["id", "type", "prompt", "correctAnswer", "explanation"],
        },
      },
    },
    required: ["topic", "questions"],
  },
} as const;

export const STUDY_PLAN_TOOL = {
  name: "emit_study_plan",
  description: "Emit an editable study plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      course: { type: "string" },
      examDate: { type: "string" },
      summary: { type: "string" },
      days: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            focus: { type: "string" },
            tasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: {
                    type: "string",
                    enum: ["lesson", "practice", "video", "review", "checkpoint"],
                  },
                  title: { type: "string" },
                  topic: { type: "string" },
                  estMinutes: { type: "integer" },
                },
                required: ["kind", "title", "estMinutes"],
              },
            },
          },
          required: ["label", "focus", "tasks"],
        },
      },
    },
    required: ["course", "summary", "days"],
  },
} as const;

export const TUTOR_TOOL = {
  name: "emit_tutor_reply",
  description: "Answer a student follow-up question within the active lesson/problem context.",
  input_schema: {
    type: "object" as const,
    properties: {
      answer: { type: "string", description: "Markdown + inline $latex$ answer" },
      equations: { type: "array", items: equationItems },
      diagram: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["mermaid", "svg", "description", "none"] },
          title: { type: "string" },
          content: { type: "string" },
          caption: { type: "string" },
        },
      },
      videoQueries: strArray("optional follow-up video queries"),
    },
    required: ["answer"],
  },
} as const;
