"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, StockCastError } from "@/lib/api";
import type { AnalysisResponse, HealthInfo } from "@/lib/types";
import { useRecents, useWatchlist } from "@/lib/storage";
import { TickerSearch } from "@/components/TickerSearch";
import { CompanyHeader } from "@/components/CompanyHeader";
import { PriceChart } from "@/components/PriceChart";
import { ForecastChart } from "@/components/ForecastChart";
import { ScenarioCards } from "@/components/Scenarios";
import { RatingCard, WhyThisRating } from "@/components/RatingCard";
import {
  FundamentalsSection,
  ModelPerformance,
  NewsSection,
  RiskSection,
  SourcesSection,
  TechnicalSection,
} from "@/components/Sections";
import { ListCard } from "@/components/Sidebar";
import { Card, InfoTip } from "@/components/ui";
import { DemoBanner, EmptyState, ErrorState, LoadingState } from "@/components/states";
import { fmtPct } from "@/lib/format";

export default function Dashboard() {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [horizonIdx, setHorizonIdx] = useState(2); // default 1 month
  const [health, setHealth] = useState<HealthInfo | null>(null);

  const watchlist = useWatchlist();
  const recents = useRecents();

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const analyze = useCallback(
    async (ticker: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.analyze(ticker);
        setData(res);
        recents.add(res.ticker);
        setHorizonIdx(2);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e) {
        setError(e);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const currency = data?.profile.currency || "USD";
  const horizon = data?.forecast.horizons[horizonIdx];

  return (
    <div className="space-y-6">
      {/* Search + setup banner */}
      <div className="space-y-3">
        <TickerSearch onAnalyze={analyze} loading={loading} />
        {health && !health.configured && !health.allow_demo_fallback && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">
            <span className="font-semibold">Setup needed:</span> {health.setup_hint}
          </div>
        )}
        {health && health.is_demo && (
          <div className="text-xs text-muted">
            Active data source: <span className="font-semibold text-warn">{health.provider_name}</span>. Add a
            provider key in <span className="font-mono">backend/.env</span> for live data — see README.
          </div>
        )}
      </div>

      {/* Watchlist + recents */}
      <div className="grid gap-4 md:grid-cols-2">
        <ListCard
          title="⭐ Watchlist"
          items={watchlist.items}
          onPick={analyze}
          onRemove={watchlist.remove}
          empty="Add stocks with the ☆ Watch button on any analysis."
        />
        <ListCard
          title="🕘 Recently analyzed"
          items={recents.items}
          onPick={analyze}
          empty="Your recently analyzed tickers will appear here."
        />
      </div>

      {/* Main content */}
      {loading && <LoadingState />}
      {!loading && error ? (
        <ErrorState error={error} onRetry={data ? () => analyze(data.ticker) : undefined} />
      ) : null}
      {!loading && !error && !data && <EmptyState />}

      {!loading && !error && data && horizon && (
        <div className="space-y-6">
          {data.is_demo && <DemoBanner reason={data.demo_reason} />}

          <CompanyHeader
            data={data}
            inWatchlist={watchlist.has(data.ticker)}
            onToggleWatch={() => watchlist.toggle(data.ticker)}
          />

          {/* Charts row */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Price & volume" subtitle="Interactive history with selectable ranges">
              <PriceChart history={data.history} benchmark={data.benchmark_history} currency={currency} />
            </Card>
            <Card
              title={
                <span className="flex items-center">
                  Forecast
                  <InfoTip text="Historical price, the model's central path, and the shaded prediction interval. Wider bands mean more uncertainty." />
                </span>
              }
              subtitle={`${horizon.horizon_label} horizon · ${data.forecast.selected_model}`}
            >
              {/* Horizon selector */}
              <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Forecast horizon">
                {data.forecast.horizons.map((h, i) => (
                  <button
                    key={h.horizon_days}
                    role="tab"
                    aria-selected={i === horizonIdx}
                    onClick={() => setHorizonIdx(i)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                      i === horizonIdx ? "bg-brand text-white" : "border border-border bg-card text-muted hover:text-fg"
                    }`}
                  >
                    {h.horizon_label}
                  </button>
                ))}
              </div>
              <ForecastChart
                history={data.history}
                horizon={horizon}
                lastPrice={data.quote.price}
                intervalConfidence={data.forecast.interval_confidence}
                currency={currency}
              />
              <div className="mt-2 text-center text-sm">
                <span className="text-muted">Base case {horizon.horizon_label}: </span>
                <span className="font-semibold text-fg">
                  {new Intl.NumberFormat("en-US", { style: "currency", currency }).format(horizon.base)}
                </span>
                <span className={horizon.expected_return_pct >= 0 ? "text-up" : "text-down"}>
                  {" "}
                  ({fmtPct(horizon.expected_return_pct)})
                </span>
              </div>
            </Card>
          </div>

          {/* Scenarios */}
          <Card
            title={
              <span className="flex items-center">
                Bull / Base / Bear scenarios — {horizon.horizon_label}
                <InfoTip text="Scenario prices bound the base case using the modelled uncertainty. They are illustrative ranges, not targets." />
              </span>
            }
          >
            <ScenarioCards point={horizon} currency={currency} />
          </Card>

          {/* Rating + why */}
          <div className="grid gap-6 lg:grid-cols-2">
            <RatingCard rating={data.rating} />
            <WhyThisRating rating={data.rating} />
          </div>

          {/* Technical + fundamental */}
          <div className="grid gap-6 lg:grid-cols-2">
            <TechnicalSection tech={data.technical} />
            <FundamentalsSection f={data.fundamentals} />
          </div>

          {/* News + risk */}
          <div className="grid gap-6 lg:grid-cols-2">
            <NewsSection news={data.news} />
            <RiskSection risk={data.risk} />
          </div>

          {/* Model performance */}
          <ModelPerformance forecast={data.forecast} />

          {/* Backtest CTA */}
          <Card title="Backtesting">
            <p className="text-sm text-muted">
              See how this forecasting approach would have performed historically for {data.ticker}, with
              transaction costs, drawdown and Sharpe ratio.
            </p>
            <Link
              href={`/backtest?ticker=${encodeURIComponent(data.ticker)}`}
              className="mt-3 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Open backtest for {data.ticker} →
            </Link>
          </Card>

          {/* Sources */}
          <SourcesSection
            sources={data.sources}
            assumptions={data.assumptions}
            limitations={data.limitations}
            disclaimer={data.disclaimer}
            generatedAt={data.generated_at}
          />
        </div>
      )}
    </div>
  );
}
