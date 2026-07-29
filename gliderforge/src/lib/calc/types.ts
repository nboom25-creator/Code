import type { Quantity } from "@/lib/units";

/** Severity ladder used by every calculation's warning list. */
export type Severity = "info" | "warning" | "error";

export interface CalcWarning {
  severity: Severity;
  message: string;
  /** Which input triggered it, when identifiable. */
  field?: string;
}

/** One line of shown work: equation -> numeric substitution -> result. */
export interface CalcStep {
  label: string;
  equation?: string;
  substitution?: string;
  result?: string;
  note?: string;
}

export interface CalcAssumption {
  text: string;
  /** Where the assumed value came from (library entry, textbook, guess). */
  basis: string;
  /** True when the user has explicitly confirmed the assumption. */
  confirmed?: boolean;
}

/**
 * The envelope returned by every function in the calculation engine.
 *
 * `inputs` is a literal snapshot of the arguments so that a stored
 * CalculationRun can be replayed and reproduced exactly.
 */
export interface CalcResult<TValues extends Record<string, Quantity | undefined>> {
  /** Stable identifier, e.g. "buoyancy.net". Used for traceability links. */
  id: string;
  title: string;
  values: TValues;
  steps: CalcStep[];
  equations: string[];
  assumptions: CalcAssumption[];
  warnings: CalcWarning[];
  /**
   * Literal snapshot of the arguments so a stored CalculationRun can be
   * replayed and reproduced exactly. Typed as `object` so each calculation can
   * store its own strongly-typed input interface without a cast.
   */
  inputs: object;
  /** Confidence in the *model*, not the arithmetic. */
  confidence: "high" | "medium" | "low";
  /** Plain-language statement of what this result may NOT be used for. */
  limitations?: string[];
}

export function ok(): CalcWarning[] {
  return [];
}

export function warn(message: string, field?: string): CalcWarning {
  return { severity: "warning", message, field };
}

export function err(message: string, field?: string): CalcWarning {
  return { severity: "error", message, field };
}

export function info(message: string, field?: string): CalcWarning {
  return { severity: "info", message, field };
}

export function hasErrors(result: { warnings: CalcWarning[] }): boolean {
  return result.warnings.some((w) => w.severity === "error");
}

/** Guard used by every entry point: reject non-finite or nonsensical inputs. */
export function requireFinite(
  warnings: CalcWarning[],
  label: string,
  value: number | undefined,
  opts: { min?: number; max?: number; allowZero?: boolean; field?: string } = {},
): boolean {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    warnings.push(err(`${label} is missing or not a finite number.`, opts.field));
    return false;
  }
  if (opts.min !== undefined && value < opts.min) {
    warnings.push(
      err(`${label} = ${value} is below the physically valid minimum ${opts.min}.`, opts.field),
    );
    return false;
  }
  if (opts.max !== undefined && value > opts.max) {
    warnings.push(
      err(`${label} = ${value} exceeds the valid maximum ${opts.max}.`, opts.field),
    );
    return false;
  }
  if (!opts.allowZero && value === 0 && opts.min === undefined) {
    warnings.push(info(`${label} is zero.`, opts.field));
  }
  return true;
}
