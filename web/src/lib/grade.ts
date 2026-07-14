import type { QuizQuestion } from "./schemas";

/** Pure grading logic (no React) — shared by QuizView and tests. */

export function normalizeNum(s: string): number | null {
  const m = /-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(s.replace(/,/g, ""));
  return m ? parseFloat(m[0]) : null;
}

/** Grade one answer. Numerical uses a 2% relative tolerance; others compare text. */
export function gradeAnswer(qn: QuizQuestion, answer: string): boolean {
  if (qn.type === "numerical") {
    const got = normalizeNum(answer);
    const want = normalizeNum(qn.correctAnswer);
    if (got == null || want == null) return false;
    const tol = Math.max(Math.abs(want) * 0.02, 1e-9);
    return Math.abs(got - want) <= tol;
  }
  return answer.trim().toLowerCase() === qn.correctAnswer.trim().toLowerCase();
}
