"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useControls } from "@/components/ControlsBar";
import { StudyPlanView } from "@/components/StudyPlanView";
import { Spinner, ErrorBanner, SaveActions, EmptyState } from "@/components/ui";
import { getSession, saveSession } from "@/lib/storage";
import type { StudyPlan } from "@/lib/schemas";

function StudyPlanInner() {
  const params = useSearchParams();
  const [controls] = useControls();
  const [form, setForm] = useState({
    course: "Thermodynamics I",
    topics: "First law, entropy, cycles, gas power cycles",
    examDate: "",
    hoursPerDay: 2,
    confidence: "",
    learningStyle: "mixed",
  });
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();

  useEffect(() => {
    const id = params.get("id");
    if (id) {
      const s = getSession(id);
      if (s && s.kind === "study-plan") {
        setPlan(s.payload as StudyPlan);
        setSavedId(s.id);
      }
    }
  }, [params]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function generate() {
    setLoading(true);
    setError(null);
    setPlan(null);
    try {
      const res = await fetch("/api/study-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, controls }),
      });
      const data = await res.json();
      if (!res.ok) setError({ message: data.error, code: data.code });
      else setPlan(data.plan);
    } catch {
      setError({ message: "Network error — is the dev server running?" });
    } finally {
      setLoading(false);
    }
  }

  function save() {
    if (!plan) return;
    const s = saveSession({
      id: savedId,
      kind: "study-plan",
      title: `Plan · ${plan.course}`,
      topic: plan.course,
      payload: plan,
    });
    setSavedId(s.id);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Study plan</h1>
        <p className="text-sm text-slate-500">
          Build an editable plan toward your exam. Check off tasks and adjust time estimates.
        </p>
      </div>

      <div className="card grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="label">Course</span>
          <input className="input" value={form.course} onChange={(e) => set("course", e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="label">Exam date</span>
          <input type="date" className="input" value={form.examDate} onChange={(e) => set("examDate", e.target.value)} />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="label">Topics to study</span>
          <input className="input" value={form.topics} onChange={(e) => set("topics", e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="label">Hours per day</span>
          <input
            type="number"
            min={0.5}
            step={0.5}
            className="input"
            value={form.hoursPerDay}
            onChange={(e) => set("hoursPerDay", parseFloat(e.target.value) || 2)}
          />
        </label>
        <label className="text-xs">
          <span className="label">Preferred learning style</span>
          <input className="input" value={form.learningStyle} onChange={(e) => set("learningStyle", e.target.value)} />
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="label">Current confidence by topic (optional)</span>
          <input
            className="input"
            placeholder="e.g. entropy: low, first law: high"
            value={form.confidence}
            onChange={(e) => set("confidence", e.target.value)}
          />
        </label>
      </div>

      <button className="btn-primary" onClick={generate} disabled={loading || !form.course.trim()}>
        {loading ? "Building…" : "Generate plan"}
      </button>

      {loading && <Spinner label="Designing your plan…" />}
      {error && <ErrorBanner message={error.message} code={error.code} />}

      {plan ? (
        <div className="space-y-4">
          <SaveActions onSave={save} exportData={plan} filename="study-plan" />
          <StudyPlanView plan={plan} />
        </div>
      ) : (
        !loading && !error && (
          <EmptyState
            title="No plan yet"
            hint="Fill in your course, topics, and exam date. The plan balances lessons, practice, videos, and review with time estimates and checkpoints."
          />
        )
      )}
    </div>
  );
}

export default function StudyPlanPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <StudyPlanInner />
    </Suspense>
  );
}
