import { NextResponse } from "next/server";
import { structuredCall } from "@/lib/anthropic";
import { SolveSchema } from "@/lib/schemas";
import { SOLVE_TOOL } from "@/lib/toolSchemas";
import { solveSystem, solveUser, DEFAULT_CONTROLS, type Controls } from "@/lib/prompts";
import { evaluate } from "@/lib/calc";
import { errorResponse, checkRate } from "@/lib/routeHelpers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const limited = checkRate(req, "solve");
  if (limited) return limited;
  try {
    const body = await req.json();
    const problem: string = (body.problem || "").toString().slice(0, 6000);
    if (!problem.trim()) {
      return NextResponse.json({ error: "Please enter a problem.", code: "bad_input" }, { status: 400 });
    }
    const controls: Controls = { ...DEFAULT_CONTROLS, ...(body.controls || {}) };
    const solve = await structuredCall({
      system: solveSystem(),
      user: solveUser(problem, controls),
      tool: SOLVE_TOOL,
      schema: SolveSchema,
      maxTokens: 5000,
    });

    // Deterministically verify the calculation when the model asked for it.
    let calc = null;
    if (solve.calcRequest && solve.calcRequest.expression) {
      calc = await evaluate({
        expression: solve.calcRequest.expression,
        variables: solve.calcRequest.variables ?? {},
        expectedUnit: solve.calcRequest.expectedUnit,
      });
    }

    return NextResponse.json({ solve, calc });
  } catch (err) {
    return errorResponse(err);
  }
}
