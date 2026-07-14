"use client";

import { useState } from "react";
import type { Quiz, QuizQuestion } from "@/lib/schemas";
import { MarkdownMath } from "./MarkdownMath";
import { recordAttempt } from "@/lib/storage";
import { gradeAnswer } from "@/lib/grade";

const SELF_GRADED = new Set(["short-response", "multi-step"]);

function QuestionCard({
  qn,
  index,
  onGraded,
}: {
  qn: QuizQuestion;
  index: number;
  onGraded: (correct: boolean) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [selfCorrect, setSelfCorrect] = useState<boolean | null>(null);
  const isSelf = SELF_GRADED.has(qn.type);
  const correct = submitted && !isSelf ? gradeAnswer(qn, answer) : selfCorrect;

  function submit() {
    setSubmitted(true);
    if (!isSelf) onGraded(gradeAnswer(qn, answer));
  }

  return (
    <div className="card space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">
          {index + 1}. <MarkdownMath>{qn.prompt}</MarkdownMath>
        </div>
        <span className="chip shrink-0">{qn.type}</span>
      </div>

      {qn.options.length > 0 ? (
        <div className="space-y-1">
          {qn.options.map((o, i) => (
            <label
              key={i}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                submitted && o === qn.correctAnswer
                  ? "border-green-400 bg-green-50 dark:bg-green-950/40"
                  : submitted && o === answer
                    ? "border-red-400 bg-red-50 dark:bg-red-950/40"
                    : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <input
                type="radio"
                name={qn.id}
                value={o}
                disabled={submitted}
                checked={answer === o}
                onChange={() => setAnswer(o)}
              />
              <MarkdownMath>{o}</MarkdownMath>
            </label>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            className="input"
            placeholder={qn.type === "numerical" ? "Your numeric answer" : "Your answer"}
            value={answer}
            disabled={submitted && !isSelf}
            onChange={(e) => setAnswer(e.target.value)}
          />
          {qn.unit && <span className="text-sm text-slate-500">{qn.unit}</span>}
        </div>
      )}

      {!submitted ? (
        <button className="btn-primary !py-1.5" onClick={submit} disabled={!answer.trim()}>
          Submit
        </button>
      ) : (
        <div className="space-y-2">
          {!isSelf && (
            <div className={`text-sm font-medium ${correct ? "text-green-600" : "text-red-600"}`}>
              {correct ? "✓ Correct" : "✗ Incorrect"}
              {!correct && (
                <span className="ml-1 font-normal text-slate-500">
                  Correct answer: {qn.correctAnswer} {qn.unit}
                </span>
              )}
            </div>
          )}
          {qn.solutionSteps.length > 0 && (
            <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
              {qn.solutionSteps.map((s, i) => (
                <li key={i}>
                  <MarkdownMath>{s}</MarkdownMath>
                </li>
              ))}
            </ol>
          )}
          {qn.explanation && (
            <div className="rounded-lg bg-slate-50 p-2 text-sm dark:bg-slate-800/50">
              <MarkdownMath>{qn.explanation}</MarkdownMath>
            </div>
          )}
          {qn.concept && <div className="text-xs text-slate-500">Concept: {qn.concept}</div>}
          {isSelf && selfCorrect == null && (
            <div className="flex items-center gap-2 text-sm">
              <span>Did you get it right?</span>
              <button
                className="chip !border-green-400 !text-green-600"
                onClick={() => {
                  setSelfCorrect(true);
                  onGraded(true);
                }}
              >
                Yes
              </button>
              <button
                className="chip !border-red-400 !text-red-600"
                onClick={() => {
                  setSelfCorrect(false);
                  onGraded(false);
                }}
              >
                No
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function QuizView({ quiz }: { quiz: Quiz }) {
  const [results, setResults] = useState<Record<string, boolean>>({});
  const answered = Object.keys(results).length;
  const correct = Object.values(results).filter(Boolean).length;
  const done = answered === quiz.questions.length && quiz.questions.length > 0;
  const ratio = answered ? correct / answered : 0;

  function onGraded(qn: QuizQuestion, isCorrect: boolean) {
    setResults((r) => ({ ...r, [qn.id]: isCorrect }));
    recordAttempt(qn.topic || quiz.topic, isCorrect);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Quiz · {quiz.topic}</h2>
        <span className="chip">
          {correct}/{answered} correct
        </span>
      </div>

      {quiz.questions.map((qn, i) => (
        <QuestionCard key={qn.id || i} qn={qn} index={i} onGraded={(c) => onGraded(qn, c)} />
      ))}

      {done && (
        <div className="card border-brand-300 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/30">
          <div className="text-lg font-bold">
            Score: {correct}/{quiz.questions.length} ({Math.round(ratio * 100)}%)
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {ratio >= 0.8
              ? "Strong grasp — try advancing difficulty or a related topic."
              : ratio >= 0.5
                ? "Solid start. Review the explanations above, then re-quiz this topic."
                : `Recommended next step: revisit the lesson on "${quiz.topic}" before re-quizzing.`}
          </p>
        </div>
      )}
    </div>
  );
}
