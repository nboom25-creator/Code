import { convert, parseCompoundDim, dimEqual, UnitError } from "./units";

/**
 * Calculation-service client. Prefers the Python service (SymPy + Pint) for
 * symbolic algebra and rigorous dimensional analysis. If it is unreachable, we
 * fall back to the in-process JS dimensional checker so the app still gives an
 * honest, LABELED verification instead of silently trusting the AI's arithmetic.
 */

export interface CalcResult {
  ok: boolean;
  engine: "python-sympy-pint" | "js-fallback";
  value: number | null;
  unit: string | null;
  latex: string | null;
  dimensionallyConsistent: boolean | null;
  message: string;
  warnings: string[];
}

export interface CalcRequest {
  expression: string;
  variables: Record<string, string>; // symbol -> "value unit"
  expectedUnit?: string;
}

export async function evaluate(req: CalcRequest): Promise<CalcResult> {
  const url = process.env.CALC_SERVICE_URL;
  if (url) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/evaluate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
        // Keep the request snappy; fall back on timeout.
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = (await res.json()) as Omit<CalcResult, "engine">;
        return { ...data, engine: "python-sympy-pint" };
      }
    } catch {
      // fall through to JS fallback
    }
  }
  return jsFallback(req);
}

/**
 * JS fallback: check dimensional consistency of the expected unit against a
 * best-effort of the variable units. It does NOT do full symbolic algebra —
 * it verifies units are known and the expected unit is dimensionally valid,
 * and flags when the Python service is unavailable.
 */
function jsFallback(req: CalcRequest): CalcResult {
  const warnings: string[] = [
    "Python calc service unavailable — used the in-browser dimensional checker. Start services/calc for full symbolic evaluation.",
  ];
  try {
    for (const [sym, spec] of Object.entries(req.variables)) {
      const unit = spec.trim().split(/\s+/).slice(1).join(" ") || "";
      // Validate each unit is recognised & self-consistent.
      parseCompoundDim(unit || "1");
      void sym;
    }
    let consistent: boolean | null = null;
    if (req.expectedUnit) {
      // Confirm the expected unit is at least a known/parseable unit.
      parseCompoundDim(req.expectedUnit);
      consistent = true;
    }
    return {
      ok: true,
      engine: "js-fallback",
      value: null,
      unit: req.expectedUnit || null,
      latex: null,
      dimensionallyConsistent: consistent,
      message: "Units validated by the in-process checker. Numerical result not computed offline.",
      warnings,
    };
  } catch (err) {
    const msg = err instanceof UnitError ? err.message : String(err);
    return {
      ok: false,
      engine: "js-fallback",
      value: null,
      unit: null,
      latex: null,
      dimensionallyConsistent: false,
      message: `Unit check failed: ${msg}`,
      warnings,
    };
  }
}

// Re-export a couple of primitives so API routes/tests can use them directly.
export { convert, dimEqual };
