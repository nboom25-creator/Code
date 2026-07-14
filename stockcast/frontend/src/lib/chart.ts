"use client";
import { useTheme } from "@/components/theme";
import type { OHLCV } from "./types";

export interface ChartColors {
  brand: string;
  up: string;
  down: string;
  muted: string;
  grid: string;
  band: string;
  bench: string;
  fg: string;
  card: string;
}

// Recharts sets colors as SVG attributes, which do not resolve CSS var(); so we
// map the theme to concrete hex values here.
export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  if (theme === "dark") {
    return {
      brand: "#60a5fa",
      up: "#22c55e",
      down: "#f87171",
      muted: "#94a3b8",
      grid: "#1e293b",
      band: "#60a5fa",
      bench: "#a78bfa",
      fg: "#e2e8f0",
      card: "#0f172a",
    };
  }
  return {
    brand: "#2563eb",
    up: "#16a34a",
    down: "#dc2626",
    muted: "#64748b",
    grid: "#e2e8f0",
    band: "#2563eb",
    bench: "#7c3aed",
    fg: "#0f172a",
    card: "#ffffff",
  };
}

export type Range = "1M" | "3M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";

export function sliceByRange(bars: OHLCV[], range: Range): OHLCV[] {
  if (!bars.length || range === "MAX") return bars;
  const last = new Date(bars[bars.length - 1].date);
  let start: Date;
  if (range === "YTD") {
    start = new Date(last.getFullYear(), 0, 1);
  } else {
    const days: Record<Exclude<Range, "YTD" | "MAX">, number> = {
      "1M": 31,
      "3M": 93,
      "6M": 186,
      "1Y": 366,
      "5Y": 1830,
    };
    start = new Date(last);
    start.setDate(start.getDate() - days[range as keyof typeof days]);
  }
  return bars.filter((b) => new Date(b.date) >= start);
}
