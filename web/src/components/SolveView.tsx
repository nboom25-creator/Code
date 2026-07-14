"use client";

import { useState } from "react";
import type { Solve } from "@/lib/schemas";
import type { Controls } from "@/lib/prompts";
import type { CalcResult } from "@/lib/calc";
import { Section, BulletList, EquationList } from "./blocks";
import { MarkdownMath } from "./MarkdownMath";
import { Katex } from "./Katex";
import { Diagram } from "./Diagram";
import { VideoPanel } from "./VideoPanel";
import { FollowUp } from "./FollowUp";

function CalcBadge({ calc }: { calc: CalcResult }) {
  const good = calc.ok && calc.dimensionallyConsistent !== false;
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        good
          ? "border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/40"
          : "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40"
      }`}
    >
      <div className="font-medium">
        Deterministic check ·{" "}
        <span className="font-mono text-xs">
          {calc.engine === "python-sympy-pint" ? "SymPy + Pint" : "JS fallback"}
        </span>
      </div>
      {calc.value != null && (
        <div className="mt-1">
          Computed: <span className="font-mono">{calc.value}</span> {calc.unit}
        </div>
      )}
      <div className="mt-1 text-slate-600 dark:text-slate-300">{calc.message}</div>
      {calc.warnings?.map((w, i) => (
        <div key={i} className="mt-1 text-xs text-amber-700 dark:text-amber-300">
          ⚠ {w}
        </div>
      ))}
    </div>
  );
}

export function SolveView({
  solve,
  calc,
  controls,
}: {
  solve: Solve;
  calc: CalcResult | null;
  controls: Controls;
}) {
  const hintMode = controls.solutionMode === "hints" || controls.solutionMode === "guided";
  const [revealed, setRevealed] = useState(hintMode ? 0 : solve.steps.length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">Solution</h2>
        {solve.discipline && <span className="chip">{solve.discipline}</span>}
        <span className="chip">AI-generated</span>
      </div>

      <Section title="Problem statement">
        <MarkdownMath>{solve.problemStatement}</MarkdownMath>
      </Section>

      {solve.missingInfo.length > 0 && (
        <div className="card border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <div className="section-title text-amber-700">Missing information (not invented)</div>
          <BulletList items={solve.missingInfo} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Known quantities">
          {solve.known.length ? (
            <table className="w-full text-left text-sm">
              <tbody>
                {solve.known.map((k, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-2 font-mono">
                      <Katex tex={k.symbol} display={false} />
                    </td>
                    <td className="py-1 pr-2">
                      {k.value} {k.unit}
                    </td>
                    <td className="py-1 text-xs text-slate-500">
                      {k.label}
                      {k.source === "assumed" && (
                        <span className="ml-1 chip !border-amber-400 !text-amber-600">assumed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-400">—</p>
          )}
        </Section>
        <Section title="Unknowns">
          <BulletList items={solve.unknown.map((u) => `${u.symbol} — ${u.label}`)} />
        </Section>
      </div>

      {solve.assumptions.length > 0 && (
        <Section title="Assumptions">
          <BulletList items={solve.assumptions} />
        </Section>
      )}

      {solve.diagram && solve.diagram.type !== "none" && <Diagram diagram={solve.diagram} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Governing principles">
          <BulletList items={solve.governingPrinciples} />
        </Section>
        <Section title="Equations">
          <EquationList equations={solve.equations} />
        </Section>
      </div>

      <Section title="Solution steps">
        {hintMode && (
          <div className="mb-3 flex items-center gap-2">
            <button
              className="btn-primary !py-1.5"
              onClick={() => setRevealed((r) => Math.min(r + 1, solve.steps.length))}
              disabled={revealed >= solve.steps.length}
            >
              {revealed === 0 ? "Reveal first hint" : "Next step"}
            </button>
            <button className="btn-ghost !py-1.5" onClick={() => setRevealed(solve.steps.length)}>
              Reveal all
            </button>
            <button className="btn-ghost !py-1.5" onClick={() => setRevealed(0)}>
              Reset
            </button>
            <span className="text-xs text-slate-500">
              {revealed}/{solve.steps.length} revealed
            </span>
          </div>
        )}
        <ol className="space-y-3">
          {solve.steps.slice(0, revealed).map((s, i) => (
            <li key={i} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
              <div className="text-sm font-semibold">
                Step {i + 1}: {s.title}
              </div>
              <MarkdownMath>{s.detail}</MarkdownMath>
              {s.latex && (
                <div className="mt-1">
                  <Katex tex={s.latex} />
                </div>
              )}
            </li>
          ))}
        </ol>
        {hintMode && revealed < solve.steps.length && (
          <p className="mt-2 text-xs text-slate-400">
            {solve.steps.length - revealed} more step(s) hidden — reveal when you&apos;re ready.
          </p>
        )}
      </Section>

      {calc && <CalcBadge calc={calc} />}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Unit / dimensional check">
          <MarkdownMath>{solve.unitCheck || "—"}</MarkdownMath>
        </Section>
        <Section title="Final answer">
          <div className="rounded-lg bg-brand-50 p-3 dark:bg-brand-900/30">
            {solve.finalAnswer.latex ? (
              <Katex tex={solve.finalAnswer.latex} />
            ) : (
              <span className="text-lg font-semibold">
                {solve.finalAnswer.value} {solve.finalAnswer.unit}
              </span>
            )}
            {solve.finalAnswer.sigFigs != null && (
              <p className="mt-1 text-xs text-slate-500">
                Reported to {solve.finalAnswer.sigFigs} significant figures.
              </p>
            )}
          </div>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section title="Sanity check">
          <MarkdownMath>{solve.sanityCheck || "—"}</MarkdownMath>
        </Section>
        <Section title="Physical interpretation">
          <MarkdownMath>{solve.physicalInterpretation || "—"}</MarkdownMath>
        </Section>
      </div>

      {solve.commonMistakes.length > 0 && (
        <Section title="Common mistakes">
          <BulletList items={solve.commonMistakes} />
        </Section>
      )}

      {solve.practiceProblem && (
        <Section title="Practice problem">
          <MarkdownMath>{solve.practiceProblem}</MarkdownMath>
        </Section>
      )}

      <Section title="Relevant videos">
        <VideoPanel queries={solve.videoQueries} />
      </Section>

      <Section title="Ask a follow-up">
        <FollowUp context={solve} controls={controls} />
      </Section>
    </div>
  );
}
