"use client";
import React from "react";
import type {
  Forecast,
  Fundamentals,
  NewsItem,
  RiskAnalysis,
  TechnicalAnalysis,
} from "@/lib/types";
import { Badge, Card, InfoTip, Stat } from "./ui";
import { fmtLargeMoney, fmtNum, fmtPct, fmtRatio, signalColor } from "@/lib/format";

// -------------------------------------------------------------------------- //
export function TechnicalSection({ tech }: { tech: TechnicalAnalysis }) {
  return (
    <Card
      title={
        <span className="flex items-center">
          Technical analysis
          <InfoTip text="Indicators summarising recent price behaviour. Technicals describe momentum and trend; they are not a forecast on their own." />
        </span>
      }
      action={
        <Badge tone={tech.overall_signal === "bullish" ? "up" : tech.overall_signal === "bearish" ? "down" : "warn"}>
          {tech.overall_signal}
        </Badge>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {tech.indicators.map((ind) => (
          <div key={ind.name} className="rounded-xl border border-border bg-surface/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-fg">{ind.name}</span>
              <span className={`text-xs font-semibold capitalize ${signalColor(ind.signal)}`}>{ind.signal}</span>
            </div>
            {ind.latest !== null && ind.latest !== undefined && (
              <div className="mt-0.5 font-mono text-sm text-fg">{fmtNum(ind.latest, 3)}</div>
            )}
            <p className="mt-1 text-xs text-muted">{ind.explanation}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">{tech.summary}</p>
    </Card>
  );
}

// -------------------------------------------------------------------------- //
export function FundamentalsSection({ f }: { f?: Fundamentals | null }) {
  if (!f) {
    return (
      <Card title="Fundamentals">
        <p className="text-sm text-muted">
          Fundamental data is not available from the active provider. Configure Alpha Vantage or
          Finnhub in <span className="font-mono">backend/.env</span> to populate revenue, margins and
          valuation ratios.
        </p>
      </Card>
    );
  }
  const src = f.provenance;
  return (
    <Card
      title="Fundamentals"
      subtitle={`Source: ${src.source} · as of ${new Date(src.as_of).toLocaleDateString()}`}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Revenue (TTM)" value={fmtLargeMoney(f.revenue)} />
        <Stat label="Free cash flow" value={fmtLargeMoney(f.free_cash_flow)} tone={num(f.free_cash_flow) >= 0 ? "up" : "down"} />
        <Stat label="Net margin" value={f.net_margin != null ? fmtPct(f.net_margin * 100) : "—"} hint="Net income ÷ revenue." />
        <Stat label="P/E" value={fmtRatio(f.pe_ratio)} hint="Price ÷ trailing earnings per share." />
        <Stat label="Forward P/E" value={fmtRatio(f.forward_pe)} hint="Price ÷ next-year expected EPS." />
        <Stat label="PEG" value={fmtRatio(f.peg_ratio)} hint="P/E ÷ earnings growth. <1 can indicate value." />
        <Stat label="P/S" value={fmtRatio(f.price_to_sales)} hint="Price ÷ sales per share." />
        <Stat label="EV/EBITDA" value={fmtRatio(f.ev_to_ebitda)} hint="Enterprise value ÷ EBITDA." />
        <Stat label="Rev. growth YoY" value={f.revenue_growth_yoy != null ? fmtPct(f.revenue_growth_yoy * 100) : "—"} tone={num(f.revenue_growth_yoy) >= 0 ? "up" : "down"} />
        <Stat label="Earnings growth" value={f.earnings_growth_yoy != null ? fmtPct(f.earnings_growth_yoy * 100) : "—"} tone={num(f.earnings_growth_yoy) >= 0 ? "up" : "down"} />
        <Stat label="Total debt" value={fmtLargeMoney(f.total_debt)} />
        <Stat label="Dividend yield" value={f.dividend_yield != null ? fmtPct(f.dividend_yield * 100) : "—"} />
      </div>
    </Card>
  );
}
const num = (v?: number | null) => (v == null ? 0 : v);

// -------------------------------------------------------------------------- //
export function NewsSection({ news }: { news: NewsItem[] }) {
  const avg = news.length
    ? news.reduce((s, n) => s + (n.sentiment_score ?? 0), 0) / news.length
    : 0;
  return (
    <Card
      title={
        <span className="flex items-center">
          News &amp; sentiment
          <InfoTip text="Recent headlines with a sentiment score. Lexicon-based unless the provider supplies its own scores — treat as a soft signal." />
        </span>
      }
      action={
        news.length ? (
          <Badge tone={avg > 0.1 ? "up" : avg < -0.1 ? "down" : "warn"}>avg {avg.toFixed(2)}</Badge>
        ) : undefined
      }
    >
      {news.length === 0 ? (
        <p className="text-sm text-muted">No recent news available from the active provider.</p>
      ) : (
        <ul className="divide-y divide-border">
          {news.map((n, i) => (
            <li key={i} className="py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-fg hover:text-brand hover:underline">
                      {n.headline}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-fg">{n.headline}</span>
                  )}
                  <div className="mt-0.5 text-[11px] text-muted">
                    {n.source} {n.published_at ? `· ${new Date(n.published_at).toLocaleDateString()}` : ""}
                  </div>
                </div>
                {n.sentiment_label && (
                  <Badge tone={n.sentiment_label === "positive" ? "up" : n.sentiment_label === "negative" ? "down" : "warn"}>
                    {n.sentiment_label}
                  </Badge>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// -------------------------------------------------------------------------- //
export function RiskSection({ risk }: { risk: RiskAnalysis }) {
  return (
    <Card
      title={
        <span className="flex items-center">
          Risk
          <InfoTip text="Downside and dispersion measures. Higher volatility and deeper drawdowns mean the point forecast is less reliable." />
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Annualised volatility" value={fmtPct(risk.annualized_volatility * 100)} hint="Std. dev of daily returns, annualised." tone="warn" />
        <Stat label="Max drawdown (5y)" value={fmtPct(risk.max_drawdown_5y * 100)} hint="Largest peak-to-trough drop." tone="down" />
        <Stat label="Daily VaR (95%)" value={fmtPct(risk.value_at_risk_95_daily * 100)} hint="On the worst 5% of days, the return has been at least this bad." tone="down" />
        <Stat label="Beta vs S&P 500" value={fmtRatio(risk.beta_vs_benchmark)} hint="Sensitivity to broad-market moves. 1 = moves with the market." />
        <Stat label="Sharpe (1y)" value={fmtRatio(risk.sharpe_ratio_1y)} hint="Return per unit of risk (higher is better)." />
      </div>
      <ul className="mt-3 list-inside list-disc text-xs text-muted">
        {risk.downside_notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </Card>
  );
}

// -------------------------------------------------------------------------- //
export function ModelPerformance({ forecast }: { forecast: Forecast }) {
  return (
    <Card
      title={
        <span className="flex items-center">
          Model performance &amp; validation
          <InfoTip text="Walk-forward (out-of-sample) results. 'Skill vs naive' > 0 means the model beat a random walk. Directional accuracy is how often the up/down call was right." />
        </span>
      }
      subtitle={`Selected model: ${forecast.selected_model}`}
    >
      <p className="mb-3 text-sm text-muted">{forecast.model_rationale}</p>
      {forecast.low_confidence_warning && (
        <div className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          ⚠ {forecast.low_confidence_warning}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3">Model</th>
              <th className="px-3">RMSE</th>
              <th className="px-3">MAE</th>
              <th className="px-3">MAPE</th>
              <th className="px-3">Dir. acc.</th>
              <th className="px-3">Skill vs naive</th>
            </tr>
          </thead>
          <tbody>
            {forecast.validation.map((m) => {
              const sel = m.model === forecast.selected_model;
              return (
                <tr key={m.model} className={`border-t border-border ${sel ? "bg-brand/5" : ""}`}>
                  <td className="py-1.5 pr-3 font-medium text-fg">
                    {m.model} {sel && <Badge tone="brand">selected</Badge>}
                  </td>
                  <td className="px-3 font-mono tabular-nums">{fmtNum(m.rmse, 3)}</td>
                  <td className="px-3 font-mono tabular-nums">{fmtNum(m.mae, 3)}</td>
                  <td className="px-3 font-mono tabular-nums">{m.mape != null ? `${m.mape.toFixed(2)}%` : "—"}</td>
                  <td className="px-3 font-mono tabular-nums">{(m.directional_accuracy * 100).toFixed(0)}%</td>
                  <td className={`px-3 font-mono tabular-nums ${m.skill_vs_naive > 0 ? "text-up" : "text-down"}`}>
                    {m.skill_vs_naive >= 0 ? "+" : ""}
                    {m.skill_vs_naive.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        Metrics computed on price at each horizon over {forecast.validation[0]?.n_folds ?? 0} walk-forward
        folds. Past out-of-sample accuracy does not guarantee future results.
      </p>
    </Card>
  );
}

// -------------------------------------------------------------------------- //
export function SourcesSection({
  sources,
  assumptions,
  limitations,
  disclaimer,
  generatedAt,
}: {
  sources: string[];
  assumptions: string[];
  limitations: string[];
  disclaimer: string;
  generatedAt: string;
}) {
  return (
    <Card title="Data sources, assumptions & limitations">
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Sources</div>
          <ul className="space-y-1 text-sm text-fg">
            {sources.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-muted">Generated {new Date(generatedAt).toLocaleString()}</div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Assumptions</div>
          <ul className="space-y-1 text-xs text-muted">
            {assumptions.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Limitations</div>
          <ul className="space-y-1 text-xs text-muted">
            {limitations.map((s, i) => (
              <li key={i}>• {s}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-surface/60 p-3 text-xs text-muted">{disclaimer}</div>
    </Card>
  );
}
