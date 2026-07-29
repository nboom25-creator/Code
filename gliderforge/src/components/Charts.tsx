"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
  LabelList,
} from "recharts";
import { downloadText, toCsv } from "./client";

/**
 * Engineering plots.
 *
 * Colour follows the validated categorical palette (see globals.css). Three of
 * the light-mode slots sit below 3:1 contrast against the light surface, so the
 * data-viz method requires "relief": every chart here ships a legend for two or
 * more series and a data-table / CSV affordance, and single-series charts are
 * named by their title rather than relying on a colour key.
 *
 * One y-axis per chart, always. Where two quantities of different scale need
 * comparing they get two charts, never two scales on one.
 */

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

const axisStyle = { fill: "var(--label)", fontSize: 11 };

function TooltipBox({ active, payload, label, xLabel, formatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border bg-panel p-2 text-xs shadow-lg">
      {label !== undefined && (
        <div className="mb-1 font-semibold">
          {xLabel ? `${xLabel}: ` : ""}
          {typeof label === "number" ? label.toPrecision(4) : label}
        </div>
      )}
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted">{p.name}</span>
          <span className="ml-auto gf-num font-medium">{formatter ? formatter(p.value) : typeof p.value === "number" ? p.value.toPrecision(4) : String(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface SeriesSpec {
  key: string;
  label: string;
  unit?: string;
}

export function ChartFrame({
  title,
  subtitle,
  data,
  filename,
  children,
  note,
  height = 260,
}: {
  title: string;
  subtitle?: string;
  data: Record<string, unknown>[];
  filename: string;
  children: React.ReactNode;
  note?: string;
  height?: number;
}) {
  const [showTable, setShowTable] = React.useState(false);
  const cols = data.length > 0 ? Object.keys(data[0]) : [];
  return (
    <figure className="gf-panel p-3">
      <figcaption className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        <div className="gf-no-print flex gap-1.5">
          <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
            {showTable ? "Hide data" : "Show data"}
          </button>
          <button className="gf-btn px-2 py-1 text-[11px]" onClick={() => downloadText(`${filename}.csv`, toCsv(data), "text/csv")}>
            CSV
          </button>
        </div>
      </figcaption>
      {data.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded border border-dashed text-xs text-muted">
          No data to plot yet.
        </div>
      ) : (
        <div style={{ width: "100%", height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        </div>
      )}
      {note && <p className="mt-2 text-[11px] leading-snug text-muted">{note}</p>}
      {showTable && (
        <div className="gf-scroll-x mt-3 max-h-72 overflow-y-auto rounded border">
          <table className="gf-table">
            <thead className="sticky top-0 bg-panel">
              <tr>
                {cols.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 500).map((r, i) => (
                <tr key={i}>
                  {cols.map((c) => (
                    <td key={c}>{typeof r[c] === "number" ? (r[c] as number).toPrecision(5) : String(r[c] ?? "")}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {data.length > 500 && <p className="p-2 text-[11px] text-muted">Showing the first 500 of {data.length} rows. Download the CSV for all of them.</p>}
        </div>
      )}
    </figure>
  );
}

export function LinePlot({
  title,
  subtitle,
  data,
  xKey,
  xLabel,
  yLabel,
  series,
  filename,
  note,
  height,
  invertY,
  referenceLines,
}: {
  title: string;
  subtitle?: string;
  data: Record<string, number | string>[];
  xKey: string;
  xLabel: string;
  yLabel: string;
  series: SeriesSpec[];
  filename: string;
  note?: string;
  height?: number;
  invertY?: boolean;
  referenceLines?: { y?: number; x?: number; label: string }[];
}) {
  return (
    <ChartFrame title={title} subtitle={subtitle} data={data} filename={filename} note={note} height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="var(--grid)" strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey={xKey}
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={axisStyle}
          stroke="var(--axis)"
          label={{ value: xLabel, position: "insideBottom", offset: -14, fill: "var(--label)", fontSize: 11 }}
          tickFormatter={(v) => (typeof v === "number" ? String(Number(v.toPrecision(3))) : v)}
        />
        <YAxis
          tick={axisStyle}
          stroke="var(--axis)"
          reversed={invertY}
          width={62}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "var(--label)", fontSize: 11, style: { textAnchor: "middle" } }}
          tickFormatter={(v) => (typeof v === "number" ? String(Number(v.toPrecision(3))) : v)}
        />
        <Tooltip content={<TooltipBox xLabel={xLabel} />} cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--label)" }} />}
        {referenceLines?.map((r, i) => (
          <ReferenceLine
            key={i}
            y={r.y}
            x={r.x}
            stroke="var(--status-warning)"
            strokeDasharray="4 3"
            label={{ value: r.label, fill: "var(--label)", fontSize: 10, position: "insideTopRight" }}
          />
        ))}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.unit ? `${s.label} (${s.unit})` : s.label}
            stroke={SERIES[i % SERIES.length]}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function AreaPlot({
  title,
  subtitle,
  data,
  xKey,
  xLabel,
  yLabel,
  series,
  filename,
  note,
  height,
  invertY,
}: {
  title: string;
  subtitle?: string;
  data: Record<string, number | string>[];
  xKey: string;
  xLabel: string;
  yLabel: string;
  series: SeriesSpec[];
  filename: string;
  note?: string;
  height?: number;
  invertY?: boolean;
}) {
  return (
    <ChartFrame title={title} subtitle={subtitle} data={data} filename={filename} note={note} height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey={xKey}
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={axisStyle}
          stroke="var(--axis)"
          label={{ value: xLabel, position: "insideBottom", offset: -14, fill: "var(--label)", fontSize: 11 }}
          tickFormatter={(v) => (typeof v === "number" ? String(Number(v.toPrecision(3))) : v)}
        />
        <YAxis
          tick={axisStyle}
          stroke="var(--axis)"
          reversed={invertY}
          width={62}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fill: "var(--label)", fontSize: 11, style: { textAnchor: "middle" } }}
        />
        <Tooltip content={<TooltipBox xLabel={xLabel} />} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: "var(--label)" }} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.unit ? `${s.label} (${s.unit})` : s.label}
            stroke={SERIES[i % SERIES.length]}
            fill={SERIES[i % SERIES.length]}
            fillOpacity={0.18}
            strokeWidth={2}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

export function BarPlot({
  title,
  subtitle,
  data,
  categoryKey,
  valueKey,
  valueLabel,
  filename,
  note,
  height,
  colorByIndex,
  labelFormatter,
}: {
  title: string;
  subtitle?: string;
  data: Record<string, number | string>[];
  categoryKey: string;
  valueKey: string;
  valueLabel: string;
  filename: string;
  note?: string;
  height?: number;
  colorByIndex?: boolean;
  labelFormatter?: (v: number) => string;
}) {
  return (
    <ChartFrame title={title} subtitle={subtitle} data={data} filename={filename} note={note} height={height ?? Math.max(200, data.length * 26 + 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 60, bottom: 20, left: 8 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--grid)" horizontal={false} />
        <XAxis
          type="number"
          tick={axisStyle}
          stroke="var(--axis)"
          label={{ value: valueLabel, position: "insideBottom", offset: -12, fill: "var(--label)", fontSize: 11 }}
        />
        <YAxis type="category" dataKey={categoryKey} tick={{ ...axisStyle, fontSize: 10 }} stroke="var(--axis)" width={150} interval={0} />
        <Tooltip content={<TooltipBox />} cursor={{ fill: "var(--grid)" }} />
        <Bar dataKey={valueKey} name={valueLabel} radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={colorByIndex ? SERIES[i % SERIES.length] : "var(--series-1)"} />
          ))}
          <LabelList
            dataKey={valueKey}
            position="right"
            style={{ fill: "var(--label)", fontSize: 10 }}
            formatter={(v) => {
              const n = Number(v);
              if (!Number.isFinite(n)) return "";
              return labelFormatter ? labelFormatter(n) : n.toPrecision(3);
            }}
          />
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

/** Predicted-versus-measured scatter with the 1:1 line, drawn with a line chart. */
export function ParityPlot({
  title,
  data,
  filename,
  unit,
  note,
}: {
  title: string;
  data: { predicted: number; measured: number; label?: string }[];
  filename: string;
  unit: string;
  note?: string;
}) {
  const all = data.flatMap((d) => [d.predicted, d.measured]).filter((n) => Number.isFinite(n));
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const pad = (max - min) * 0.1 || 1;
  const line = [
    { predicted: min - pad, ideal: min - pad },
    { predicted: max + pad, ideal: max + pad },
  ];
  const merged = [...data.map((d) => ({ predicted: d.predicted, measured: d.measured })), ...line];
  return (
    <ChartFrame title={title} data={data as unknown as Record<string, unknown>[]} filename={filename} note={note}>
      <LineChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }} data={merged}>
        <CartesianGrid stroke="var(--grid)" />
        <XAxis
          type="number"
          dataKey="predicted"
          domain={[min - pad, max + pad]}
          tick={axisStyle}
          stroke="var(--axis)"
          label={{ value: `Predicted (${unit})`, position: "insideBottom", offset: -14, fill: "var(--label)", fontSize: 11 }}
        />
        <YAxis
          type="number"
          domain={[min - pad, max + pad]}
          tick={axisStyle}
          stroke="var(--axis)"
          width={62}
          label={{ value: `Measured (${unit})`, angle: -90, position: "insideLeft", fill: "var(--label)", fontSize: 11, style: { textAnchor: "middle" } }}
        />
        <Tooltip content={<TooltipBox />} />
        <Legend wrapperStyle={{ fontSize: 11, color: "var(--label)" }} />
        <Line dataKey="ideal" name="Perfect agreement (1:1)" stroke="var(--axis)" strokeDasharray="4 3" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
        <Line dataKey="measured" name="Measured" stroke="var(--series-1)" strokeWidth={0} dot={{ r: 4, fill: "var(--series-1)", stroke: "var(--panel)", strokeWidth: 2 }} isAnimationActive={false} />
      </LineChart>
    </ChartFrame>
  );
}

/** Residual plot: residual versus fitted, with a zero line. */
export function ResidualPlot({
  data,
  filename,
  unit,
  title = "Residuals",
  note,
}: {
  data: { x: number; residual: number }[];
  filename: string;
  unit: string;
  title?: string;
  note?: string;
}) {
  return (
    <ChartFrame title={title} data={data as unknown as Record<string, unknown>[]} filename={filename} note={note} height={200}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
        <CartesianGrid stroke="var(--grid)" />
        <XAxis
          type="number"
          dataKey="x"
          domain={["dataMin", "dataMax"]}
          tick={axisStyle}
          stroke="var(--axis)"
          label={{ value: "Independent variable", position: "insideBottom", offset: -14, fill: "var(--label)", fontSize: 11 }}
        />
        <YAxis
          tick={axisStyle}
          stroke="var(--axis)"
          width={62}
          label={{ value: `Residual (${unit})`, angle: -90, position: "insideLeft", fill: "var(--label)", fontSize: 11, style: { textAnchor: "middle" } }}
        />
        <ReferenceLine y={0} stroke="var(--axis)" strokeWidth={2} />
        <Tooltip content={<TooltipBox />} />
        <Line
          dataKey="residual"
          name="Residual"
          stroke="var(--series-2)"
          strokeWidth={0}
          dot={{ r: 4, fill: "var(--series-2)", stroke: "var(--panel)", strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartFrame>
  );
}
