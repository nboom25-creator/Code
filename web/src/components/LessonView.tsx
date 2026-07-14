"use client";

import type { Lesson } from "@/lib/schemas";
import type { Controls } from "@/lib/prompts";
import { Section, BulletList, EquationList, VariableTable } from "./blocks";
import { MarkdownMath } from "./MarkdownMath";
import { Katex } from "./Katex";
import { VideoPanel } from "./VideoPanel";
import { FollowUp } from "./FollowUp";
import { useState } from "react";

const SECTIONS = [
  ["overview", "Overview"],
  ["prerequisites", "Prerequisites"],
  ["objectives", "Objectives"],
  ["definitions", "Definitions"],
  ["principles", "Principles"],
  ["equations", "Equations"],
  ["variables", "Variables & units"],
  ["assumptions", "Assumptions"],
  ["example", "Worked example"],
  ["mistakes", "Common mistakes"],
  ["interpretation", "Physical meaning"],
  ["check", "Knowledge check"],
  ["related", "Related concepts"],
  ["videos", "Videos"],
] as const;

function KnowledgeCheck({ lesson }: { lesson: Lesson }) {
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  if (!lesson.knowledgeCheck.length) return <p className="text-sm text-slate-400">—</p>;
  return (
    <div className="space-y-3">
      {lesson.knowledgeCheck.map((k, i) => (
        <div key={i} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
          <p className="text-sm font-medium">{k.question}</p>
          {k.options.length > 0 && (
            <ul className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {k.options.map((o, j) => (
                <li key={j}>• {o}</li>
              ))}
            </ul>
          )}
          <button
            className="chip mt-2"
            onClick={() => setRevealed((r) => ({ ...r, [i]: !r[i] }))}
          >
            {revealed[i] ? "Hide answer" : "Show answer"}
          </button>
          {revealed[i] && (
            <div className="mt-2 text-sm">
              <span className="font-medium text-green-700 dark:text-green-400">Answer:</span> {k.answer}
              {k.explanation && <p className="mt-1 text-slate-500">{k.explanation}</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function LessonView({ lesson, controls }: { lesson: Lesson; controls: Controls }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[180px_1fr]">
      {/* Left nav */}
      <nav className="hidden lg:block">
        <div className="sticky top-20 space-y-1">
          {SECTIONS.map(([id, label]) => (
            <a
              key={id}
              href={`#sec-${id}`}
              className="block rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-brand-600 dark:hover:bg-slate-800"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{lesson.topic}</h2>
            {lesson.discipline && <span className="chip">{lesson.discipline}</span>}
            <span className="chip">{lesson.level}</span>
            <span className="chip">AI-generated</span>
          </div>
        </div>

        <Section id="sec-overview" title="Overview">
          <MarkdownMath>{lesson.overview}</MarkdownMath>
        </Section>
        <Section id="sec-prerequisites" title="Prerequisite concepts">
          <BulletList items={lesson.prerequisites} />
        </Section>
        <Section id="sec-objectives" title="Learning objectives">
          <BulletList items={lesson.objectives} />
        </Section>
        <Section id="sec-definitions" title="Important definitions">
          {lesson.definitions.length ? (
            <dl className="space-y-2 text-sm">
              {lesson.definitions.map((d, i) => (
                <div key={i}>
                  <dt className="font-medium text-slate-800 dark:text-slate-100">{d.term}</dt>
                  <dd className="text-slate-600 dark:text-slate-300">{d.definition}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-400">—</p>
          )}
        </Section>
        <Section id="sec-principles" title="Governing principles">
          <BulletList items={lesson.principles} />
        </Section>
        <Section id="sec-equations" title="Relevant equations">
          <EquationList equations={lesson.equations} />
        </Section>
        <Section id="sec-variables" title="Variable definitions & SI units">
          <VariableTable variables={lesson.variables} />
        </Section>
        <Section id="sec-assumptions" title="Assumptions & limitations">
          <BulletList items={lesson.assumptions} />
        </Section>
        <Section id="sec-example" title="Step-by-step example">
          <p className="mb-2 text-sm font-medium">{lesson.example.problem}</p>
          <ol className="space-y-3">
            {lesson.example.steps.map((s, i) => (
              <li key={i} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50">
                <div className="text-sm font-medium">
                  {i + 1}. {s.title}
                </div>
                <MarkdownMath>{s.explanation}</MarkdownMath>
                {s.latex && (
                  <div className="mt-1">
                    <Katex tex={s.latex} />
                  </div>
                )}
              </li>
            ))}
          </ol>
          {lesson.example.answer && (
            <div className="mt-2 rounded-lg bg-green-50 p-2 text-sm dark:bg-green-950/40">
              <span className="font-medium text-green-700 dark:text-green-400">Answer:</span>{" "}
              <span className="[&_.katex-display]:my-1">
                <MarkdownMath>{lesson.example.answer}</MarkdownMath>
              </span>
            </div>
          )}
        </Section>
        <Section id="sec-mistakes" title="Common mistakes">
          <BulletList items={lesson.commonMistakes} />
        </Section>
        <Section id="sec-interpretation" title="Physical interpretation">
          <MarkdownMath>{lesson.physicalInterpretation}</MarkdownMath>
        </Section>
        <Section id="sec-check" title="Short knowledge check">
          <KnowledgeCheck lesson={lesson} />
        </Section>
        <Section id="sec-related" title="Related concepts">
          <div className="flex flex-wrap gap-1">
            {lesson.relatedConcepts.map((c, i) => (
              <span key={i} className="chip">
                {c}
              </span>
            ))}
          </div>
        </Section>
        <Section id="sec-videos" title="Relevant videos">
          <VideoPanel queries={lesson.videoQueries} />
        </Section>

        <Section title="Ask a follow-up">
          <FollowUp context={lesson} controls={controls} />
        </Section>
      </div>
    </div>
  );
}
