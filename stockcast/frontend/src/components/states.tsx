"use client";
import React from "react";
import { StockCastError } from "@/lib/api";

export function DemoBanner({ reason }: { reason?: string | null }) {
  return (
    <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">
      <span className="font-bold">⚠ DEMO DATA</span> — figures below are synthetic and{" "}
      <span className="font-semibold">not real market prices</span>. For research illustration only.
      {reason ? <span className="ml-1 opacity-80">{reason}</span> : null}
    </div>
  );
}

export function LoadingState({ label = "Analyzing…" }: { label?: string }) {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      <div className="skeleton h-24 rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="skeleton h-72 rounded-2xl lg:col-span-2" />
        <div className="skeleton h-72 rounded-2xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-32 rounded-2xl" />
      </div>
      <p className="text-center text-sm text-muted">{label}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error as StockCastError;
  const code = e?.code || "error";
  const messages: Record<string, { title: string; hint: string }> = {
    symbol_not_found: { title: "Ticker not found", hint: "Check the symbol and try again (e.g. AAPL, MSFT)." },
    rate_limited: { title: "Rate limit reached", hint: "The data provider throttled the request. Wait a moment and retry." },
    provider_not_configured: { title: "Provider not configured", hint: e?.setupHint || "Add an API key in backend/.env." },
    invalid_ticker: { title: "Invalid ticker", hint: "Tickers are letters/numbers, e.g. AAPL, BRK.B." },
    insufficient_data: { title: "Not enough history", hint: "This symbol lacks enough data to analyze." },
    network_error: { title: "Cannot reach the API", hint: "Start the backend: uvicorn app.main:app --port 8000." },
  };
  const m = messages[code] || { title: "Something went wrong", hint: e?.message || "Unknown error." };
  return (
    <div className="rounded-2xl border border-down/40 bg-down/5 p-6 text-center" role="alert">
      <div className="text-2xl">⚠️</div>
      <h3 className="mt-2 text-lg font-semibold text-fg">{m.title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">{m.hint}</p>
      {e?.setupHint && code !== "provider_not_configured" && (
        <p className="mx-auto mt-1 max-w-md text-xs text-muted">{e.setupHint}</p>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center">
      <div className="text-4xl">📈</div>
      <h3 className="mt-3 text-lg font-semibold text-fg">Analyze a stock to begin</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">
        Search a ticker (e.g. <span className="font-mono">AAPL</span>) or press{" "}
        <span className="font-semibold">Random Stock</span>. You&apos;ll get live-data forecasts,
        a transparent research rating, technicals, fundamentals, risk and backtests.
      </p>
    </div>
  );
}
