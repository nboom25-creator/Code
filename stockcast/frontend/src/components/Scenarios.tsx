"use client";
import React from "react";
import type { ForecastPoint } from "@/lib/types";
import { fmtPct, fmtPrice } from "@/lib/format";
import { InfoTip } from "./ui";

export function ScenarioCards({ point, currency = "USD" }: { point: ForecastPoint; currency?: string }) {
  // Recover the current price from the base case so each scenario return is
  // expressed relative to today's price (exact, no extra inputs needed).
  const lastPrice = point.base / (1 + point.expected_return_pct / 100);
  const ret = (p: number) => (lastPrice > 0 ? (p / lastPrice - 1) * 100 : 0);

  const rows = [
    { label: "Bull", price: point.bull, tone: "up", hint: "Optimistic path (~+1 std. dev of modelled uncertainty)." },
    { label: "Base", price: point.base, tone: "brand", hint: "Central model forecast for this horizon." },
    { label: "Bear", price: point.bear, tone: "down", hint: "Pessimistic path (~−1 std. dev of modelled uncertainty)." },
  ] as const;

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rows.map((r) => {
        const border = r.tone === "up" ? "border-up/40" : r.tone === "down" ? "border-down/40" : "border-brand/40";
        const text = r.tone === "up" ? "text-up" : r.tone === "down" ? "text-down" : "text-brand";
        return (
          <div key={r.label} className={`rounded-xl border ${border} bg-card p-4`}>
            <div className="flex items-center text-xs font-semibold uppercase tracking-wide text-muted">
              {r.label}
              <InfoTip text={r.hint} />
            </div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${text}`}>{fmtPrice(r.price, currency)}</div>
            <div className={`text-sm tabular-nums ${text}`}>{fmtPct(ret(r.price))}</div>
          </div>
        );
      })}
    </div>
  );
}
