"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  listSessions,
  getMastery,
  deleteSession,
  deleteEverything,
  type SavedSession,
  type TopicMastery,
} from "@/lib/storage";

const SUBJECTS = [
  "Thermodynamics", "Fluid mechanics", "Heat transfer", "Statics", "Dynamics",
  "Mechanics of materials", "Control systems", "Electrical circuits", "Signals and systems",
  "Materials science", "Differential equations", "Linear algebra", "Probability and statistics",
];

const MODES = [
  { value: "learn", label: "Learn a subject" },
  { value: "solve", label: "Solve a problem" },
  { value: "quiz", label: "Practice & quiz" },
  { value: "study-plan", label: "Study plan" },
];

const KIND_PATH: Record<string, string> = {
  lesson: "/learn",
  problem: "/solve",
  quiz: "/quiz",
  "study-plan": "/study-plan",
};

const STATUS_COLOR: Record<string, string> = {
  "not-started": "text-slate-400",
  learning: "text-blue-500",
  practicing: "text-amber-500",
  proficient: "text-green-600",
  "review-recommended": "text-red-500",
};

interface Health {
  anthropic: boolean;
  youtube: boolean;
  calcService: boolean;
  model: string;
}

export default function Dashboard() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("learn");
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [mastery, setMastery] = useState<TopicMastery[]>([]);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    setSessions(listSessions());
    setMastery(getMastery());
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  function go() {
    if (mode === "quiz" || mode === "study-plan") {
      router.push(`/${mode}`);
      return;
    }
    const q = query.trim();
    router.push(`/${mode}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }

  function removeSession(id: string) {
    deleteSession(id);
    setSessions(listSessions());
  }

  const last = sessions[0];
  const review = mastery.filter((m) => m.status === "review-recommended");

  return (
    <div className="space-y-6">
      <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white">
        <h1 className="text-2xl font-bold sm:text-3xl">Learn any engineering subject</h1>
        <p className="mt-1 max-w-2xl text-sm text-brand-100">
          Structured lessons, step-by-step problem solving with hints, quizzes, deterministic
          unit-checked calculations, and real instructional videos.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className="flex-1 rounded-lg px-3 py-2 text-sm text-slate-900 outline-none"
            placeholder="Enter a topic, concept, equation, or problem…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
          />
          <select
            className="rounded-lg px-3 py-2 text-sm text-slate-900"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <button className="rounded-lg bg-white px-5 py-2 text-sm font-semibold text-brand-700" onClick={go}>
            Start
          </button>
        </div>
      </section>

      {/* Integration status — honest about missing keys */}
      {health && (!health.anthropic || !health.youtube || !health.calcService) && (
        <div className="card border-amber-300 bg-amber-50 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <div className="section-title text-amber-700">Setup status</div>
          <ul className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300">
            <li>{health.anthropic ? "✅" : "⚠️"} Anthropic API {health.anthropic ? `(model: ${health.model})` : "— set ANTHROPIC_API_KEY to generate content"}</li>
            <li>{health.youtube ? "✅" : "⚠️"} YouTube Data API {health.youtube ? "" : "— set YOUTUBE_API_KEY for real video search"}</li>
            <li>{health.calcService ? "✅" : "⚠️"} Python calc service {health.calcService ? "" : "— start services/calc for full SymPy/Pint checks (JS fallback active)"}</li>
          </ul>
        </div>
      )}

      {/* Continue last session */}
      {last && (
        <section>
          <div className="section-title mb-2">Continue where you left off</div>
          <Link
            href={`${KIND_PATH[last.kind]}?id=${last.id}`}
            className="card flex items-center justify-between hover:border-brand-400"
          >
            <div>
              <div className="text-xs uppercase text-slate-400">{last.kind}</div>
              <div className="font-medium">{last.title}</div>
            </div>
            <span className="btn-primary !py-1.5">Resume →</span>
          </Link>
        </section>
      )}

      {/* Subject quick-picks */}
      <section>
        <div className="section-title mb-2">Browse subjects</div>
        <div className="flex flex-wrap gap-1">
          {SUBJECTS.map((s) => (
            <Link key={s} href={`/learn?q=${encodeURIComponent(s)}`} className="chip hover:border-brand-400">
              {s}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent / saved */}
        <section className="lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="section-title">Saved &amp; recent</div>
            {sessions.length > 0 && (
              <button
                className="text-xs text-slate-400 hover:text-red-500"
                onClick={() => {
                  if (confirm("Delete ALL saved sessions and progress?")) {
                    deleteEverything();
                    setSessions([]);
                    setMastery([]);
                  }
                }}
              >
                Delete all my data
              </button>
            )}
          </div>
          {sessions.length === 0 ? (
            <div className="card text-sm text-slate-500">
              Nothing saved yet. Generate a lesson, solve a problem, or take a quiz — then hit Save.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sessions.slice(0, 8).map((s) => (
                <div key={s.id} className="card flex items-center justify-between gap-2">
                  <Link href={`${KIND_PATH[s.kind]}?id=${s.id}`} className="min-w-0 flex-1">
                    <div className="text-xs uppercase text-slate-400">{s.kind}</div>
                    <div className="truncate text-sm font-medium">{s.title}</div>
                  </Link>
                  <button className="chip hover:text-red-500" onClick={() => removeSession(s.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Mastery */}
        <section>
          <div className="section-title mb-2">Topic mastery</div>
          {mastery.length === 0 ? (
            <div className="card text-sm text-slate-500">
              Take a quiz to start tracking mastery by topic.
            </div>
          ) : (
            <div className="card space-y-1">
              {mastery
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .slice(0, 10)
                .map((m) => (
                  <div key={m.topic} className="flex items-center justify-between text-sm">
                    <span className="truncate">{m.topic}</span>
                    <span className={`text-xs font-medium ${STATUS_COLOR[m.status]}`}>
                      {m.status}
                    </span>
                  </div>
                ))}
            </div>
          )}
          {review.length > 0 && (
            <div className="mt-2 card border-red-300 bg-red-50 text-sm dark:border-red-900 dark:bg-red-950/40">
              <div className="section-title text-red-600">Recommended review</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {review.map((m) => (
                  <Link key={m.topic} href={`/learn?q=${encodeURIComponent(m.topic)}`} className="chip">
                    {m.topic}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
