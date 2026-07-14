"use client";
import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";
import type { BacktestResult } from "@/lib/types";
import { Card, InfoTip, Stat } from "@/components/ui";
import { DemoBanner, ErrorState } from "@/components/states";
import { useChartColors } from "@/lib/chart";
import { fmtDate, fmtNum, fmtPct, fmtPrice } from "@/lib/format";

const MODELS = [
  { value: "auto", label: "Auto (best validated)" },
  { value: "naive", label: "Naive (random walk)" },
  { value: "drift", label: "EWMA drift" },
  { value: "ridge", label: "Ridge regression" },
  { value: "gradient_boosting", label: "Gradient boosting" },
];
const HORIZONS = [
  { value: 1, label: "1 day" },
  { value: 5, label: "1 week" },
  { value: 21, label: "1 month" },
  { value: 63, label: "3 months" },
];

function BacktestInner() {
  const params = useSearchParams();
  const c = useChartColors();
  const [ticker, setTicker] = useState(params.get("ticker") || "AAPL");
  const [model, setModel] = useState("gradient_boosting");
  const [horizon, setHorizon] = useState(5);
  const [lookback, setLookback] = useState(5);
  const [investment, setInvestment] = useState(10000);
  const [cost, setCost] = useState(5);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.backtest({
        ticker: ticker.trim().toUpperCase(),
        model,
        horizon_days: horizon,
        lookback_years: lookback,
        initial_investment: investment,
        transaction_cost_bps: cost,
      });
      setResult(res);
    } catch (e) {
      setError(e);
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const outperformed = result && result.strategy_return_after_costs_pct > result.buy_and_hold_return_pct;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-fg">Backtesting</h1>
        <p className="mt-1 text-sm text-muted">
          Walk-forward simulation: at each date the model trains only on the past, predicts the
          {" "}
          <span className="font-medium">h-day-ahead</span> return, and goes long when it&apos;s positive.
          Results are shown before and after transaction costs.
        </p>
      </div>

      <Card title="Parameters">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Ticker">
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-fg"
            />
          </Field>
          <Field label="Model">
            <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg">
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Forecast horizon">
            <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg">
              {HORIZONS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Test period (years)">
            <input type="number" min={2} max={20} value={lookback} onChange={(e) => setLookback(Number(e.target.value))} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg" />
          </Field>
          <Field label="Initial investment ($)">
            <input type="number" min={100} step={100} value={investment} onChange={(e) => setInvestment(Number(e.target.value))} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg" />
          </Field>
          <Field label={<>Transaction cost (bps)<InfoTip text="Basis points charged per trade (round-trip modelled on position changes). 5 bps = 0.05%." /></>}>
            <input type="number" min={0} max={100} value={cost} onChange={(e) => setCost(Number(e.target.value))} className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg" />
          </Field>
        </div>
        <button
          onClick={run}
          disabled={loading || !ticker.trim()}
          className="mt-4 rounded-lg bg-brand px-5 py-2 font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {loading ? "Running…" : "Run backtest"}
        </button>
      </Card>

      {error ? <ErrorState error={error} onRetry={run} /> : null}

      {result && (
        <div className="space-y-6">
          {result.is_demo && <DemoBanner />}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Strategy return (net)" value={fmtPct(result.strategy_return_after_costs_pct)} tone={result.strategy_return_after_costs_pct >= 0 ? "up" : "down"} hint="Cumulative return after transaction costs." />
            <Stat label="Buy & hold" value={fmtPct(result.buy_and_hold_return_pct)} tone={result.buy_and_hold_return_pct >= 0 ? "up" : "down"} />
            <Stat label="Directional accuracy" value={`${(result.directional_accuracy * 100).toFixed(0)}%`} hint="How often the up/down call was correct." />
            <Stat label="Sharpe ratio" value={fmtNum(result.sharpe_ratio, 2)} hint="Annualised return per unit of risk." tone={result.sharpe_ratio >= 0 ? "up" : "down"} />
            <Stat label="Max drawdown" value={fmtPct(result.max_drawdown_pct)} tone="down" />
            <Stat label="Number of trades" value={result.n_trades} />
            <Stat label="Final value (net)" value={fmtPrice(result.final_value_after_costs)} />
            <Stat label="Strategy return (gross)" value={fmtPct(result.strategy_return_pct)} hint="Before transaction costs." />
          </div>

          <div className={`rounded-xl border px-4 py-3 text-sm ${outperformed ? "border-up/40 bg-up/10 text-up" : "border-warn/40 bg-warn/10 text-warn"}`}>
            {outperformed
              ? `After costs, the ${result.model} strategy outperformed buy-and-hold over this window.`
              : `After costs, the ${result.model} strategy did NOT beat buy-and-hold over this window. We show this honestly — many models fail to beat simply holding.`}
          </div>

          <Card title="Equity curve" subtitle="Strategy (net of costs) vs buy-and-hold">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={result.equity_curve.filter((d) => d.date)}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: c.muted }} minTickGap={40} tickFormatter={(d) => fmtDate(d)} />
                <YAxis orientation="right" tick={{ fontSize: 11, fill: c.muted }} width={56} tickFormatter={(v) => `$${Intl.NumberFormat("en", { notation: "compact" }).format(v)}`} />
                <Tooltip
                  contentStyle={{ background: c.card, border: `1px solid ${c.grid}`, borderRadius: 12, fontSize: 12 }}
                  labelFormatter={(d) => fmtDate(d as string)}
                  formatter={(v: number, n: string) => [fmtPrice(v), n === "strategy" ? "Strategy" : "Buy & hold"]}
                />
                <Line type="monotone" dataKey="strategy" stroke={c.brand} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="buy_hold" stroke={c.muted} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Predicted vs actual price" subtitle={`Forecast errors over ${result.points.length} out-of-sample points`}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={result.points}>
                <CartesianGrid stroke={c.grid} vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: c.muted }} minTickGap={40} tickFormatter={(d) => fmtDate(d)} />
                <YAxis orientation="right" tick={{ fontSize: 11, fill: c.muted }} width={48} />
                <Tooltip
                  contentStyle={{ background: c.card, border: `1px solid ${c.grid}`, borderRadius: 12, fontSize: 12 }}
                  labelFormatter={(d) => fmtDate(d as string)}
                  formatter={(v: number, n: string) => [fmtPrice(v), n === "actual" ? "Actual" : "Predicted"]}
                />
                <Line type="monotone" dataKey="actual" stroke={c.fg} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="predicted" stroke={c.brand} strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-3 gap-3 text-center text-sm">
              <div><span className="text-muted">MAE </span><span className="font-mono text-fg">{fmtNum(result.mae, 2)}</span></div>
              <div><span className="text-muted">RMSE </span><span className="font-mono text-fg">{fmtNum(result.rmse, 2)}</span></div>
              <div><span className="text-muted">MAPE </span><span className="font-mono text-fg">{result.mape != null ? `${result.mape.toFixed(2)}%` : "—"}</span></div>
            </div>
          </Card>

          <Card title="Limitations & biases">
            <ul className="list-inside list-disc space-y-1 text-sm text-muted">
              {result.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

export default function BacktestPage() {
  return (
    <Suspense fallback={<div className="text-sm text-muted">Loading…</div>}>
      <BacktestInner />
    </Suspense>
  );
}
