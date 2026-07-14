"use client";
import React, { useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OHLCV } from "@/lib/types";
import { Range, sliceByRange, useChartColors } from "@/lib/chart";
import { fmtDate, fmtPrice } from "@/lib/format";

const RANGES: Range[] = ["1M", "3M", "6M", "YTD", "1Y", "5Y", "MAX"];

export function PriceChart({
  history,
  benchmark,
  currency = "USD",
}: {
  history: OHLCV[];
  benchmark?: OHLCV[];
  currency?: string;
}) {
  const c = useChartColors();
  const [range, setRange] = useState<Range>("1Y");
  const [showBench, setShowBench] = useState(false);

  const data = useMemo(() => {
    const bars = sliceByRange(history, range);
    const benchMap = new Map((benchmark || []).map((b) => [b.date, b.adj_close]));
    // Normalise benchmark to the asset's starting price for a comparable overlay.
    const first = bars[0]?.adj_close ?? 1;
    let benchFirst: number | undefined;
    return bars.map((b) => {
      const raw = benchMap.get(b.date);
      if (raw !== undefined && benchFirst === undefined) benchFirst = raw;
      const benchNorm =
        raw !== undefined && benchFirst ? (raw / benchFirst) * first : undefined;
      return {
        date: b.date,
        close: b.adj_close,
        volume: b.volume,
        bench: benchNorm,
      };
    });
  }, [history, benchmark, range]);

  const positive = data.length > 1 && data[data.length - 1].close >= data[0].close;
  const lineColor = positive ? c.up : c.down;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Chart range">
          {RANGES.map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={range === r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                range === r ? "bg-brand text-white" : "border border-border bg-card text-muted hover:text-fg"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        {benchmark && benchmark.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showBench} onChange={(e) => setShowBench(e.target.checked)} />
            Compare S&amp;P 500
          </label>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: c.muted }}
            minTickGap={40}
            tickFormatter={(d) => fmtDate(d)}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            domain={["auto", "auto"]}
            tick={{ fontSize: 11, fill: c.muted }}
            tickFormatter={(v) => (typeof v === "number" ? v.toFixed(0) : v)}
            width={48}
          />
          <YAxis yAxisId="vol" hide domain={[0, (dataMax: number) => dataMax * 4]} />
          <Tooltip
            contentStyle={{ background: c.card, border: `1px solid ${c.grid}`, borderRadius: 12, fontSize: 12 }}
            labelFormatter={(d) => fmtDate(d as string)}
            formatter={(value: number, name: string) => {
              if (name === "volume") return [Intl.NumberFormat("en", { notation: "compact" }).format(value), "Volume"];
              if (name === "bench") return [fmtPrice(value, currency), "S&P 500 (norm.)"];
              return [fmtPrice(value, currency), "Close"];
            }}
          />
          <Bar yAxisId="vol" dataKey="volume" fill={c.muted} opacity={0.28} isAnimationActive={false} />
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="close"
            stroke={lineColor}
            strokeWidth={2}
            fill="url(#priceFill)"
            isAnimationActive={false}
          />
          {showBench && (
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="bench"
              stroke={c.bench}
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[11px] text-muted">
        Adjusted close (splits/dividends applied). Volume shown as bars.
      </p>
    </div>
  );
}
