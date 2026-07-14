import { NextResponse } from "next/server";
import { evaluate, type CalcRequest } from "@/lib/calc";
import { checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

/** Deterministic calculation endpoint (proxies to the Python SymPy/Pint service). */
export async function POST(req: Request) {
  const limited = checkRate(req, "calc");
  if (limited) return limited;
  try {
    const body = (await req.json()) as CalcRequest;
    if (!body?.expression) {
      return NextResponse.json({ error: "expression is required", code: "bad_input" }, { status: 400 });
    }
    const result = await evaluate({
      expression: String(body.expression).slice(0, 2000),
      variables: body.variables || {},
      expectedUnit: body.expectedUnit,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Calculation failed";
    return NextResponse.json({ error: msg, code: "internal" }, { status: 500 });
  }
}
