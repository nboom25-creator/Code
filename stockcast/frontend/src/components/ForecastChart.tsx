"use client";
import React, { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ForecastPoint, OHLCV } from "@/lib/types";
import { useChartColors } from "@/lib/chart";
import { fmtDate, fmtPrice } from "@/lib/format";

export function ForecastChart({
  history,
  horizon,
  lastPrice,
  intervalConfidence,
  currency = "USD",
}: {
  history: OHLCV[];
  horizon: ForecastPoint;
  lastPrice: number;
  intervalConfidence: number;
  currency?: string;
}) {
  const c = useChartColors();

  const data = useMemo(() => {
    // Show ~2x the horizon of history for context, then the forecast fan.
    const ctx = Math.min(history.length, Math.max(60, horizon.horizon_days * 3));
    const hist = history.slice(-ctx).map((b) => ({
      date: b.date,
      actual: b.adj_close,
      base: null as number | null,
      band: null as [number, number] | null,
      bull: null as number | null,
      bear: null as number | null,
    }));
    const lastDate = new Date(history[history.length - 1].date);
    // Linear interpolation from last price to the horizon target for the path.
    const steps = 8;
    const forecast = [];
    for (let i = 1; i <= steps; i++) {
      const frac = i / steps;
      const d = new Date(lastDate);
      d.setDate(d.getDate() + Math.round((horizon.horizon_days * 365) / 252 * frac));
      const base = lastPrice + (horizon.base - lastPrice) * frac;
      const lower = lastPrice + (horizon.lower - lastPrice) * Math.sqrt(frac);
      const upper = lastPrice + (horizon.upper - lastPrice) * Math.sqrt(frac);
      const bull = lastPrice + (horizon.bull - lastPrice) * frac;
      const bear = lastPrice + (horizon.bear - lastPrice) * frac;
      forecast.push({
        date: d.toISOString().slice(0, 10),
        actual: null,
        base,
        band: [lower, upper] as [number, number],
        bull,
        bear,
      });
    }
    // Bridge: repeat last actual as base start so lines connect.
    if (hist.length) {
      hist[hist.length - 1] = { ...hist[hist.length - 1], base: lastPrice, bull: lastPrice, bear: lastPrice, band: [lastPrice, lastPrice] };
    }
    return [...hist, ...forecast];
  }, [history, horizon, lastPrice]);

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: c.muted }}
            minTickGap={44}
            tickFormatter={(d) => fmtDate(d)}
          />
          <YAxis
            orientation="right"
            domain={["auto", "auto"]}
            tick={{ fontSize: 11, fill: c.muted }}
            tickFormatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)}
            width={48}
          />
          <Tooltip
            contentStyle={{ background: c.card, border: `1px solid ${c.grid}`, borderRadius: 12, fontSize: 12 }}
            labelFormatter={(d) => fmtDate(d as string)}
            formatter={(value: any, name: string) => {
              if (name === "band" && Array.isArray(value))
                return [`${fmtPrice(value[0], currency)} – ${fmtPrice(value[1], currency)}`, `${Math.round(intervalConfidence * 100)}% interval`];
              const labels: Record<string, string> = { actual: "Historical", base: "Base forecast", bull: "Bull", bear: "Bear" };
              return value == null ? [null, null] : [fmtPrice(value, currency), labels[name] || name];
            }}
          />
          <ReferenceLine y={lastPrice} stroke={c.muted} strokeDasharray="3 3" />
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill={c.band}
            fillOpacity={0.15}
            isAnimationActive={false}
            connectNulls
          />
          <Line type="monotone" dataKey="actual" stroke={c.fg} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="base" stroke={c.brand} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="bull" stroke={c.up} strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
          <Line type="monotone" dataKey="bear" stroke={c.down} strokeWidth={1} dot={false} isAnimationActive={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <Legend color={c.fg} label="Historical" />
        <Legend color={c.brand} label="Base forecast" dashed />
        <Legend color={c.up} label="Bull" />
        <Legend color={c.down} label="Bear" />
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-4 rounded-sm" style={{ background: c.band, opacity: 0.3 }} />
          {Math.round(intervalConfidence * 100)}% prediction interval
        </span>
      </div>
    </div>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-0 w-4"
        style={{ borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}` }}
      />
      {label}
    </span>
  );
}
