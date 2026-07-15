import type { CostBand, Difficulty, SafetyLevel } from "@/lib/types";

/** Format a US-cents value as an estimated dollar string. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** Format a cost range, collapsing equal endpoints. */
export function formatCostRange(lowCents: number, highCents: number): string {
  if (lowCents === highCents) return formatCents(lowCents);
  return `${formatCents(lowCents)}–${formatCents(highCents)}`;
}

/** Human-friendly duration from minutes: "45 min", "2 hr", "1 hr 30 min", "1 day". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem === 0 ? `${hours} hr` : `${hours} hr ${rem} min`;
  }
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "1 day" : `${days} days`;
}

const COST_BAND_LABELS: Record<CostBand, string> = {
  under_25: "Under $25",
  "25_75": "$25–$75",
  "75_200": "$75–$200",
  "200_plus": "$200+",
};

export function formatCostBand(band: CostBand): string {
  return COST_BAND_LABELS[band];
}

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export function formatDifficulty(d: Difficulty): string {
  return DIFFICULTY_LABELS[d];
}

const SAFETY_LABELS: Record<SafetyLevel, string> = {
  low: "Low risk",
  moderate: "Moderate risk",
  elevated: "Elevated risk",
};

export function formatSafetyLevel(level: SafetyLevel): string {
  return SAFETY_LABELS[level];
}

/** Convert inches to a metric string when the user prefers metric units. */
export function formatLength(inches: number, unit: "us" | "metric"): string {
  if (unit === "metric") {
    const cm = inches * 2.54;
    return `${cm.toFixed(cm < 10 ? 1 : 0)} cm`;
  }
  return `${inches} in`;
}
