"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ControlsBar, useControls } from "@/components/ControlsBar";
import { SolveView } from "@/components/SolveView";
import { Spinner, ErrorBanner, SaveActions, EmptyState } from "@/components/ui";
import { getSession, saveSession } from "@/lib/storage";
import { DEMO_SOLVE } from "@/lib/demo";
import type { Solve } from "@/lib/schemas";
import type { CalcResult } from "@/lib/calc";

const SAMPLE =
  "2 kg of water at 20°C is heated to 80°C in an insulated container. The specific heat of water is 4186 J/(kg·K). How much heat is required?";

function SolveInner() {
  const params = useSearchParams();
  const [controls, updateControls] = useControls();
  const [problem, setProblem] = useState("");
  const [solve, setSolve] = useState<Solve | null>(null);
  const [calc, setCalc] = useState<CalcResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = params.get("id");
    if (id) {
      const s = getSession(id);
      if (s && s.kind === "problem") {
        const p = s.payload as { solve: Solve; calc: CalcResult | null };
        setSolve(p.solve);
        setCalc(p.calc ?? null);
        setProblem(s.topic);
        setSavedId(s.id);
      }
      return;
    }
    const q = params.get("q");
    if (q) {
      setProblem(q);
      run(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function run(text: string) {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setSolve(null);
    setCalc(null);
    try {
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ problem: text, controls }),
      });
      const data = await res.json();
      if (!res.ok) setError({ message: data.error, code: data.code });
      else {
        setSolve(data.solve);
        setCalc(data.calc);
      }
    } catch {
      setError({ message: "Network error — is the dev server running?" });
    } finally {
      setLoading(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadNote("");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) setError({ message: data.error, code: data.code });
      else {
        setProblem(data.text);
        setUploadNote(data.notes || "Review the extracted text before solving.");
      }
    } catch {
      setError({ message: "Upload failed." });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    if (!solve) return;
    const s = saveSession({
      id: savedId,
      kind: "problem",
      title: solve.problemStatement.slice(0, 60) || problem.slice(0, 60),
      topic: problem,
      payload: { solve, calc },
    });
    setSavedId(s.id);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Solve a problem</h1>
        <p className="text-sm text-slate-500">
          Type or upload a problem. Use <b>Guided</b> or <b>Hints only</b> to reveal one step at a time.
        </p>
      </div>

      <ControlsBar controls={controls} onChange={updateControls} showSolutionMode />

      <div className="card space-y-2">
        <textarea
          className="input min-h-28"
          placeholder="Paste your engineering problem here…"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
        />
        {uploadNote && (
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {uploadNote}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary" onClick={() => run(problem)} disabled={loading || !problem.trim()}>
            {loading ? "Solving…" : "Solve"}
          </button>
          <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? "Extracting…" : "📎 Upload (PDF / image / text)"}
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".txt,.csv,.md,image/*,application/pdf"
            onChange={onFile}
          />
          <button className="chip" onClick={() => { setProblem(SAMPLE); }}>
            Load sample
          </button>
          <button
            className="chip !border-brand-400 !text-brand-700 dark:!text-brand-200"
            onClick={() => { setError(null); setCalc(null); setSolve(DEMO_SOLVE); }}
          >
            ▶ View demo solution (no key needed)
          </button>
        </div>
      </div>

      {loading && <Spinner label="Working through the solution…" />}
      {error && <ErrorBanner message={error.message} code={error.code} />}

      {solve ? (
        <div className="space-y-4">
          <SaveActions onSave={save} exportData={{ solve, calc }} filename="solution" />
          <SolveView solve={solve} calc={calc} controls={controls} />
        </div>
      ) : (
        !loading &&
        !error && (
          <EmptyState
            title="No problem solved yet"
            hint="Enter a numerical problem and choose a solution mode. The tutor lists knowns/unknowns, checks units, verifies arithmetic deterministically, and interprets the answer."
          />
        )
      )}
    </div>
  );
}

export default function SolvePage() {
  return (
    <Suspense fallback={<Spinner />}>
      <SolveInner />
    </Suspense>
  );
}
