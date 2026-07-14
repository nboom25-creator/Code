"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ControlsBar, useControls } from "@/components/ControlsBar";
import { LessonView } from "@/components/LessonView";
import { Spinner, ErrorBanner, SaveActions, EmptyState } from "@/components/ui";
import { getSession, saveSession } from "@/lib/storage";
import { DEMO_LESSON } from "@/lib/demo";
import type { Lesson } from "@/lib/schemas";

const SAMPLES = ["Entropy generation", "Bernoulli's equation", "Bode plots", "Second moment of area"];

function LearnInner() {
  const params = useSearchParams();
  const [controls, updateControls] = useControls();
  const [topic, setTopic] = useState("");
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();

  useEffect(() => {
    const id = params.get("id");
    if (id) {
      const s = getSession(id);
      if (s && s.kind === "lesson") {
        setLesson(s.payload as Lesson);
        setTopic(s.topic);
        setSavedId(s.id);
      }
      return;
    }
    const q = params.get("q");
    if (q) {
      setTopic(q);
      generate(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function generate(t: string) {
    if (!t.trim()) return;
    setLoading(true);
    setError(null);
    setLesson(null);
    try {
      const res = await fetch("/api/lesson", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic: t, controls }),
      });
      const data = await res.json();
      if (!res.ok) setError({ message: data.error, code: data.code });
      else setLesson(data.lesson);
    } catch {
      setError({ message: "Network error — is the dev server running?" });
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!lesson) return;
    const s = saveSession({
      id: savedId,
      kind: "lesson",
      title: lesson.topic || topic,
      topic: lesson.topic || topic,
      payload: lesson,
    });
    setSavedId(s.id);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Learn a subject</h1>
        <p className="text-sm text-slate-500">
          Enter any engineering topic, concept, or equation for a structured lesson.
        </p>
      </div>

      <ControlsBar controls={controls} onChange={updateControls} />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          generate(topic);
        }}
        className="flex gap-2"
      >
        <input
          className="input"
          placeholder="e.g. PID controller tuning"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        <button className="btn-primary" disabled={loading || !topic.trim()}>
          {loading ? "…" : "Generate lesson"}
        </button>
      </form>
      <div className="flex flex-wrap items-center gap-1">
        {SAMPLES.map((s) => (
          <button key={s} className="chip" onClick={() => { setTopic(s); generate(s); }}>
            {s}
          </button>
        ))}
        <button
          className="chip !border-brand-400 !text-brand-700 dark:!text-brand-200"
          onClick={() => { setError(null); setLesson(DEMO_LESSON); }}
        >
          ▶ View demo lesson (no key needed)
        </button>
      </div>

      {loading && <Spinner label="Building your lesson…" />}
      {error && <ErrorBanner message={error.message} code={error.code} />}

      {lesson ? (
        <div className="space-y-4">
          <SaveActions
            onSave={save}
            exportData={lesson}
            filename={`lesson-${(lesson.topic || "topic").replace(/\s+/g, "-")}`}
          />
          <LessonView lesson={lesson} controls={controls} />
        </div>
      ) : (
        !loading &&
        !error && (
          <EmptyState
            title="No lesson yet"
            hint="Type a topic above or pick a sample. Lessons include equations, a worked example, common mistakes, a knowledge check, and real videos."
          />
        )
      )}
    </div>
  );
}

export default function LearnPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <LearnInner />
    </Suspense>
  );
}
