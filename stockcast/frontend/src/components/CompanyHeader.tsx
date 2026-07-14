"use client";
import React from "react";
import type { AnalysisResponse, Quote } from "@/lib/types";
import { Badge, InfoTip } from "./ui";
import { fmtLargeMoney, fmtPct, fmtPrice, timeAgo } from "@/lib/format";

export function CompanyHeader({
  data,
  inWatchlist,
  onToggleWatch,
  liveQuote,
}: {
  data: AnalysisResponse;
  inWatchlist: boolean;
  onToggleWatch: () => void;
  liveQuote?: Quote | null;
}) {
  const { profile } = data;
  // Prefer the freshest polled quote when available (near real-time updates).
  const quote = liveQuote ?? data.quote;
  const isLive = !!liveQuote && !data.is_demo;
  const up = quote.change >= 0;
  const currency = profile.currency || "USD";

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-bold text-fg">{profile.name || quote.ticker}</h1>
            <Badge tone="brand">{quote.ticker}</Badge>
            {data.is_demo && <Badge tone="warn">DEMO DATA</Badge>}
            <button
              onClick={onToggleWatch}
              aria-pressed={inWatchlist}
              className="rounded-lg border border-border px-2 py-0.5 text-sm hover:bg-surface"
              title={inWatchlist ? "Remove from watchlist" : "Add to watchlist"}
            >
              {inWatchlist ? "★ Watching" : "☆ Watch"}
            </button>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            {profile.exchange && <span>{profile.exchange}</span>}
            {profile.sector && <span>{profile.sector}</span>}
            {profile.industry && <span>· {profile.industry}</span>}
            {profile.market_cap ? <span>· Mkt cap {fmtLargeMoney(profile.market_cap)}</span> : null}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <div className="flex items-center justify-end gap-2">
            {isLive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-up/15 px-2 py-0.5 text-[10px] font-bold text-up">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-up" />
                </span>
                LIVE
              </span>
            )}
            <div className="text-3xl font-bold tabular-nums text-fg">{fmtPrice(quote.price, currency)}</div>
          </div>
          <div className={`text-sm font-semibold tabular-nums ${up ? "text-up" : "text-down"}`}>
            {up ? "▲" : "▼"} {fmtPrice(Math.abs(quote.change), currency)} ({fmtPct(quote.change_percent)})
          </div>
          <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">
            <span title={quote.provenance.as_of}>
              {quote.provenance.source} · {timeAgo(quote.provenance.as_of)}
            </span>
            <InfoTip
              text={`Source: ${quote.provenance.source}. As of ${new Date(
                quote.provenance.as_of,
              ).toLocaleString()}. ${quote.provenance.delay_note || ""}`}
              label="Data source and freshness"
            />
          </div>
          {quote.provenance.delay_note && (
            <div className="text-[11px] text-warn">{quote.provenance.delay_note}</div>
          )}
        </div>
      </div>

      {profile.description && (
        <p className="mt-3 line-clamp-3 text-sm text-muted">{profile.description}</p>
      )}
    </div>
  );
}
