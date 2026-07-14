"use client";

import { useState } from "react";
import type { Controls } from "@/lib/prompts";
import type { TutorReply } from "@/lib/schemas";
import { MarkdownMath } from "./MarkdownMath";
import { EquationList } from "./blocks";
import { Diagram } from "./Diagram";

interface Turn {
  q: string;
  reply?: TutorReply;
  error?: string;
}

const SUGGESTIONS = [
  "Why did you use this equation?",
  "Explain that more simply.",
  "Solve it another way.",
  "Give me a hint, not the answer.",
  "What changes if we remove an assumption?",
];

/** Contextual follow-up Q&A that keeps the active lesson/problem in scope. */
export function FollowUp({ context, controls }: { context: unknown; controls: Controls }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setQ("");
    setTurns((t) => [...t, { q: question }]);
    setLoading(true);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, context, controls }),
      });
      const data = await res.json();
      setTurns((t) => {
        const copy = [...t];
        const last = copy[copy.length - 1];
        if (!res.ok) last.error = data.error || "Something went wrong.";
        else last.reply = data.reply;
        return copy;
      });
    } catch {
      setTurns((t) => {
        const copy = [...t];
        copy[copy.length - 1].error = "Network error.";
        return copy;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="chip hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => ask(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
              <span className="font-medium">You:</span> {t.q}
            </div>
            {t.error && <div className="text-sm text-red-600">{t.error}</div>}
            {t.reply && (
              <div className="card">
                <MarkdownMath>{t.reply.answer}</MarkdownMath>
                {t.reply.equations?.length > 0 && (
                  <div className="mt-2">
                    <EquationList equations={t.reply.equations} />
                  </div>
                )}
                {t.reply.diagram && t.reply.diagram.type !== "none" && (
                  <div className="mt-2">
                    <Diagram diagram={t.reply.diagram} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {loading && <div className="text-sm text-slate-400">Tutor is thinking…</div>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(q);
        }}
        className="flex gap-2"
      >
        <input
          className="input"
          placeholder="Ask a follow-up question…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn-primary" disabled={loading || !q.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
