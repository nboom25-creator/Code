import { z } from "zod";

/**
 * Structured-output schemas for every AI response in EngineerTutor.
 *
 * Each schema is the validation contract: the model is forced (via tool-use)
 * to return JSON, and we `parse` it here before ANY rendering. Fields are kept
 * deliberately forgiving (optional + defaults) so a minor model deviation
 * degrades a single field rather than blanking the whole lesson.
 */

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

export const EquationSchema = z.object({
  name: z.string().default(""),
  latex: z.string().default(""),
  description: z.string().default(""),
});
export type Equation = z.infer<typeof EquationSchema>;

export const VariableSchema = z.object({
  symbol: z.string().default(""),
  name: z.string().default(""),
  siUnit: z.string().default(""),
  description: z.string().default(""),
});
export type Variable = z.infer<typeof VariableSchema>;

export const DefinitionSchema = z.object({
  term: z.string().default(""),
  definition: z.string().default(""),
});

export const DiagramSchema = z.object({
  // "mermaid" and "svg" are deterministic and safe to render. "none" when no
  // diagram is warranted. AI never produces raster artwork for technical figs.
  type: z.enum(["mermaid", "svg", "description", "none"]).default("none"),
  title: z.string().default(""),
  // For mermaid: the diagram source. For svg: an <svg>...</svg> string.
  content: z.string().default(""),
  caption: z.string().default(""),
});
export type Diagram = z.infer<typeof DiagramSchema>;

export const KnowledgeCheckSchema = z.object({
  question: z.string().default(""),
  options: z.array(z.string()).default([]),
  answer: z.string().default(""),
  explanation: z.string().default(""),
});

// ---------------------------------------------------------------------------
// A. Lesson
// ---------------------------------------------------------------------------

export const LessonSchema = z.object({
  topic: z.string().default(""),
  discipline: z.string().default(""),
  level: z.string().default("intermediate"),
  overview: z.string().default(""),
  prerequisites: z.array(z.string()).default([]),
  objectives: z.array(z.string()).default([]),
  definitions: z.array(DefinitionSchema).default([]),
  principles: z.array(z.string()).default([]),
  equations: z.array(EquationSchema).default([]),
  variables: z.array(VariableSchema).default([]),
  assumptions: z.array(z.string()).default([]),
  example: z
    .object({
      problem: z.string().default(""),
      steps: z
        .array(
          z.object({
            title: z.string().default(""),
            explanation: z.string().default(""),
            latex: z.string().default(""),
          }),
        )
        .default([]),
      answer: z.string().default(""),
    })
    .default({ problem: "", steps: [], answer: "" }),
  commonMistakes: z.array(z.string()).default([]),
  physicalInterpretation: z.string().default(""),
  knowledgeCheck: z.array(KnowledgeCheckSchema).default([]),
  relatedConcepts: z.array(z.string()).default([]),
  videoQueries: z.array(z.string()).default([]),
});
export type Lesson = z.infer<typeof LessonSchema>;

// ---------------------------------------------------------------------------
// B. Problem solution (ordered steps drive both full-solution and hint modes)
// ---------------------------------------------------------------------------

export const SolveStepSchema = z.object({
  title: z.string().default(""),
  // Markdown + inline LaTeX ($...$) explanation of this step.
  detail: z.string().default(""),
  // Optional display equation for this step.
  latex: z.string().default(""),
});

export const KnownQtySchema = z.object({
  symbol: z.string().default(""),
  value: z.string().default(""),
  unit: z.string().default(""),
  label: z.string().default(""),
  // "given" = supplied by user, "assumed" = explicitly assumed by tutor.
  source: z.enum(["given", "assumed"]).default("given"),
});

export const SolveSchema = z.object({
  problemStatement: z.string().default(""),
  discipline: z.string().default(""),
  known: z.array(KnownQtySchema).default([]),
  unknown: z
    .array(z.object({ symbol: z.string().default(""), label: z.string().default("") }))
    .default([]),
  assumptions: z.array(z.string()).default([]),
  missingInfo: z.array(z.string()).default([]),
  diagram: DiagramSchema.default({ type: "none", title: "", content: "", caption: "" }),
  governingPrinciples: z.array(z.string()).default([]),
  equations: z.array(EquationSchema).default([]),
  // Ordered solution steps — revealed one at a time in hint mode.
  steps: z.array(SolveStepSchema).default([]),
  unitCheck: z.string().default(""),
  finalAnswer: z
    .object({
      value: z.string().default(""),
      unit: z.string().default(""),
      latex: z.string().default(""),
      sigFigs: z.number().int().nullable().default(null),
    })
    .default({ value: "", unit: "", latex: "", sigFigs: null }),
  sanityCheck: z.string().default(""),
  physicalInterpretation: z.string().default(""),
  commonMistakes: z.array(z.string()).default([]),
  videoQueries: z.array(z.string()).default([]),
  practiceProblem: z.string().default(""),
  // Optional deterministic calculation request for the Python calc service.
  calcRequest: z
    .object({
      // symbolic expression to evaluate, e.g. "m*Cp*(T2-T1)"
      expression: z.string().default(""),
      // variable -> "value unit" string, e.g. { m: "2 kg", Cp: "4186 J/(kg*K)" }
      variables: z.record(z.string()).default({}),
      expectedUnit: z.string().default(""),
    })
    .nullable()
    .default(null),
});
export type Solve = z.infer<typeof SolveSchema>;
export type SolveStep = z.infer<typeof SolveStepSchema>;

// ---------------------------------------------------------------------------
// C. Quiz
// ---------------------------------------------------------------------------

export const QuestionTypeEnum = z.enum([
  "conceptual-mc",
  "numerical",
  "equation-selection",
  "unit-analysis",
  "error-identification",
  "short-response",
  "multi-step",
]);

export const QuizQuestionSchema = z.object({
  id: z.string().default(""),
  type: QuestionTypeEnum.default("conceptual-mc"),
  topic: z.string().default(""),
  difficulty: z.enum(["beginner", "intermediate", "advanced"]).default("intermediate"),
  prompt: z.string().default(""),
  // Present for multiple-choice-style questions.
  options: z.array(z.string()).default([]),
  // The correct answer (option text, numeric string, or model short answer).
  correctAnswer: z.string().default(""),
  unit: z.string().default(""),
  solutionSteps: z.array(z.string()).default([]),
  explanation: z.string().default(""),
  concept: z.string().default(""),
});
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizSchema = z.object({
  topic: z.string().default(""),
  questions: z.array(QuizQuestionSchema).default([]),
});
export type Quiz = z.infer<typeof QuizSchema>;

// ---------------------------------------------------------------------------
// D. Study plan
// ---------------------------------------------------------------------------

export const StudyTaskSchema = z.object({
  kind: z.enum(["lesson", "practice", "video", "review", "checkpoint"]).default("lesson"),
  title: z.string().default(""),
  topic: z.string().default(""),
  estMinutes: z.number().int().default(30),
});

export const StudyPlanSchema = z.object({
  course: z.string().default(""),
  examDate: z.string().default(""),
  summary: z.string().default(""),
  days: z
    .array(
      z.object({
        label: z.string().default(""),
        focus: z.string().default(""),
        tasks: z.array(StudyTaskSchema).default([]),
      }),
    )
    .default([]),
});
export type StudyPlan = z.infer<typeof StudyPlanSchema>;

// ---------------------------------------------------------------------------
// Follow-up tutor chat (guided Q&A within a lesson/problem context)
// ---------------------------------------------------------------------------

export const TutorReplySchema = z.object({
  answer: z.string().default(""),
  equations: z.array(EquationSchema).default([]),
  diagram: DiagramSchema.optional(),
  videoQueries: z.array(z.string()).default([]),
});
export type TutorReply = z.infer<typeof TutorReplySchema>;
