"use client";

import { useState } from "react";
import type { StudyPlan } from "@/lib/schemas";

const KIND_ICON: Record<string, string> = {
  lesson: "📘",
  practice: "✏️",
  video: "🎬",
  review: "🔁",
  checkpoint: "🏁",
};

/** Editable study plan: check off tasks, edit time estimates, track progress. */
export function StudyPlanView({ plan: initial }: { plan: StudyPlan }) {
  const [plan, setPlan] = useState(initial);
  const [done, setDone] = useState<Record<string, boolean>>({});

  const allTasks = plan.days.flatMap((d, di) => d.tasks.map((_, ti) => `${di}:${ti}`));
  const completed = allTasks.filter((k) => done[k]).length;
  const totalMinutes = plan.days.reduce(
    (sum, d) => sum + d.tasks.reduce((s, t) => s + (t.estMinutes || 0), 0),
    0,
  );

  function editMinutes(di: number, ti: number, val: number) {
    setPlan((p) => {
      const days = p.days.map((d, i) =>
        i === di
          ? { ...d, tasks: d.tasks.map((t, j) => (j === ti ? { ...t, estMinutes: val } : t)) }
          : d,
      );
      return { ...p, days };
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Study plan · {plan.course}</h2>
        <div className="flex gap-2">
          <span className="chip">
            {completed}/{allTasks.length} tasks
          </span>
          <span className="chip">~{Math.round(totalMinutes / 60)} h total</span>
        </div>
      </div>
      {plan.summary && <p className="text-sm text-slate-600 dark:text-slate-300">{plan.summary}</p>}

      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className="h-full bg-brand-500 transition-all"
          style={{ width: `${allTasks.length ? (completed / allTasks.length) * 100 : 0}%` }}
        />
      </div>

      <div className="space-y-3">
        {plan.days.map((d, di) => (
          <div key={di} className="card">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-semibold">{d.label}</h3>
              <span className="text-xs text-slate-500">{d.focus}</span>
            </div>
            <ul className="space-y-2">
              {d.tasks.map((t, ti) => {
                const key = `${di}:${ti}`;
                return (
                  <li
                    key={ti}
                    className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800"
                  >
                    <input
                      type="checkbox"
                      checked={!!done[key]}
                      onChange={(e) => setDone((s) => ({ ...s, [key]: e.target.checked }))}
                    />
                    <span>{KIND_ICON[t.kind] || "•"}</span>
                    <span className={`flex-1 text-sm ${done[key] ? "text-slate-400 line-through" : ""}`}>
                      {t.title}
                      {t.topic && <span className="ml-1 text-xs text-slate-400">· {t.topic}</span>}
                    </span>
                    <input
                      type="number"
                      className="input !w-20 !py-1 text-right"
                      value={t.estMinutes}
                      min={0}
                      onChange={(e) => editMinutes(di, ti, parseInt(e.target.value) || 0)}
                    />
                    <span className="text-xs text-slate-400">min</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
