"use client";
import React from "react";
import type { ResearchRating } from "@/lib/types";
import { Bar, Card, InfoTip } from "./ui";
import { fmtPct, ratingColor } from "@/lib/format";

export function RatingCard({ rating }: { rating: ResearchRating }) {
  const confPct = Math.round(rating.confidence * 100);
  return (
    <Card
      title={
        <span className="flex items-center">
          Research rating
          <InfoTip text="A transparent, weighted score across nine components. A price forecast alone can never produce a Buy — it is only one weighted input." />
        </span>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className={`text-3xl font-extrabold ${ratingColor(rating.rating)}`}>{rating.rating}</div>
          <div className="mt-1 text-xs text-muted">
            Composite score <span className="font-mono">{rating.composite_score.toFixed(2)}</span> (−1…+1)
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted">Confidence</div>
          <div className="text-lg font-semibold capitalize text-fg">
            {rating.confidence_label} <span className="text-sm text-muted">({confPct}%)</span>
          </div>
          <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-border">
            <div className="h-full bg-brand" style={{ width: `${confPct}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-surface/60 p-2 text-xs text-muted">
        Expected 6-month return range:{" "}
        <span className="font-semibold text-fg">
          {fmtPct(rating.expected_return_low_pct)} to {fmtPct(rating.expected_return_high_pct)}
        </span>{" "}
        (bear–bull scenario band; not a promise)
      </div>

      {/* Component breakdown */}
      <div className="mt-4">
        <div className="mb-2 flex items-center text-xs font-semibold uppercase tracking-wide text-muted">
          Score components
          <InfoTip text="Each component is scored −1…+1, multiplied by its weight; the sum is the composite score." />
        </div>
        <ul className="space-y-2">
          {rating.components.map((cmp) => (
            <li key={cmp.name} className="grid grid-cols-[1fr,auto] items-center gap-x-3 gap-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-fg">{cmp.name}</span>
                <span className="ml-2 text-xs text-muted">w {(cmp.weight * 100).toFixed(0)}%</span>
              </div>
              <span
                className={`text-right font-mono text-xs tabular-nums ${
                  cmp.contribution > 0 ? "text-up" : cmp.contribution < 0 ? "text-down" : "text-muted"
                }`}
              >
                {cmp.contribution >= 0 ? "+" : ""}
                {cmp.contribution.toFixed(3)}
              </span>
              <div className="col-span-2">
                <Bar value={cmp.score} />
              </div>
              <p className="col-span-2 text-[11px] text-muted">{cmp.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function WhyThisRating({ rating }: { rating: ResearchRating }) {
  return (
    <Card title="Why this rating?">
      <p className="text-sm text-fg">{rating.explanation}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <FactorList title="Bullish factors" tone="up" items={rating.bullish_factors} />
        <FactorList title="Bearish factors" tone="down" items={rating.bearish_factors} />
        <FactorList title="Upcoming catalysts" tone="brand" items={rating.catalysts} />
        <FactorList title="Key risks" tone="warn" items={rating.key_risks} />
      </div>
      <div className="mt-4 rounded-lg border border-border bg-surface/50 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">
          What would invalidate this forecast
        </div>
        <ul className="mt-1 list-inside list-disc text-sm text-muted">
          {rating.invalidation_conditions.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function FactorList({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "up" | "down" | "brand" | "warn";
}) {
  const dot = tone === "up" ? "bg-up" : tone === "down" ? "bg-down" : tone === "warn" ? "bg-warn" : "bg-brand";
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      <ul className="space-y-1">
        {items.map((x, i) => (
          <li key={i} className="flex gap-2 text-sm text-fg">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{x}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
