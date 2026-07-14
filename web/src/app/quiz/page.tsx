"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useControls } from "@/components/ControlsBar";
import { QuizView } from "@/components/QuizView";
import { Spinner, ErrorBanner, SaveActions, EmptyState } from "@/components/ui";
import { getSession, saveSession } from "@/lib/storage";
import type { Quiz } from "@/lib/schemas";

const TYPES = [
  ["conceptual-mc", "Conceptual MC"],
  ["numerical", "Numerical"],
  ["equation-selection", "Equation selection"],
  ["unit-analysis", "Unit analysis"],
  ["error-identification", "Error identification"],
  ["short-response", "Short response"],
  ["multi-step", "Multi-step"],
] as const;

function QuizInner() {
  const params = useSearchParams();
  const [controls] = useControls();
  const [subject, setSubject] = useState("Thermodynamics");
  const [topic, setTopic] = useState("");
  const [difficulty, setDifficulty] = useState("intermediate");
  const [count, setCount] = useState(5);
  const [types, setTypes] = useState<string[]>(["conceptual-mc", "numerical"]);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();

  useEffect(() => {
    const id = params.get("id");
    if (id) {
      const s = getSession(id);
      if (s && s.kind === "quiz") {
        setQuiz(s.payload as Quiz);
        setSavedId(s.id);
      }
    }
  }, [params]);

  function toggleType(t: string) {
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setQuiz(null);
    try {
      const res = await fetch("/api/quiz", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, topic, difficulty, count, types, controls }),
      });
      const data = await res.json();
      if (!res.ok) setError({ message: data.error, code: data.code });
      else setQuiz(data.quiz);
    } catch {
      setError({ message: "Network error — is the dev server running?" });
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!quiz) return;
    const s = saveSession({
      id: savedId,
      kind: "quiz",
      title: `Quiz · ${quiz.topic}`,
      topic: quiz.topic,
      payload: quiz,
    });
    setSavedId(s.id);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Practice &amp; quiz</h1>
        <p className="text-sm text-slate-500">Generate questions, answer, and get worked solutions.</p>
      </div>

      <div className="card grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">
          <span className="label">Subject</span>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="label">Topic (optional)</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. entropy" />
        </label>
        <label className="text-xs">
          <span className="label">Difficulty</span>
          <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="label">Questions</span>
          <input
            type="number"
            min={1}
            max={15}
            className="input"
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value) || 5)}
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-4">
          <span className="label">Question types</span>
          <div className="flex flex-wrap gap-1">
            {TYPES.map(([val, label]) => (
              <button
                key={val}
                onClick={() => toggleType(val)}
                className={`chip ${types.includes(val) ? "!border-brand-500 !bg-brand-50 !text-brand-700 dark:!bg-brand-900/40 dark:!text-brand-200" : ""}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button className="btn-primary" onClick={generate} disabled={loading || !subject.trim()}>
        {loading ? "Generating…" : "Generate quiz"}
      </button>

      {loading && <Spinner label="Writing questions…" />}
      {error && <ErrorBanner message={error.message} code={error.code} />}

      {quiz ? (
        <div className="space-y-4">
          <SaveActions onSave={save} exportData={quiz} filename="quiz" />
          <QuizView quiz={quiz} />
        </div>
      ) : (
        !loading &&
        !error && (
          <EmptyState
            title="No quiz yet"
            hint="Pick a subject, difficulty, and question types, then generate. Each question comes with a full solution and explanation, and your results feed the mastery tracker."
          />
        )
      )}
    </div>
  );
}

export default function QuizPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <QuizInner />
    </Suspense>
  );
}
