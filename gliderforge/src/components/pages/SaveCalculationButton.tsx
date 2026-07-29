"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "../client";
import { Spinner } from "../ui";

/**
 * Store an immutable snapshot of a calculation run.
 *
 * Calculation runs are insert-only: the API refuses updates to them. That is
 * what makes a number you quoted in a report last month still reproducible
 * after you change the inputs today.
 */
export function SaveCalculationButton({
  projectId,
  calcId,
  title,
  inputs,
  results,
  warnings,
  assumptions,
  steps,
  confidence,
  label = "Save this run",
}: {
  projectId: string;
  calcId: string;
  title: string;
  inputs: unknown;
  results: unknown;
  warnings?: unknown;
  assumptions?: unknown;
  steps?: unknown;
  confidence?: string;
  label?: string;
}) {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = React.useState<string | null>(null);

  const save = async () => {
    setState("busy");
    setMessage(null);
    try {
      await api.create(projectId, "calculation_runs", {
        calc_id: calcId,
        title,
        label: new Date().toISOString().slice(0, 16).replace("T", " "),
        inputs_json: JSON.stringify(inputs),
        results_json: JSON.stringify(results),
        warnings_json: JSON.stringify(warnings ?? []),
        assumptions_json: JSON.stringify(assumptions ?? []),
        steps_json: JSON.stringify(steps ?? []),
        confidence: confidence ?? null,
      });
      setState("done");
      router.refresh();
      setTimeout(() => setState("idle"), 3000);
    } catch (e) {
      setState("error");
      setMessage(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="gf-btn"
        onClick={save}
        disabled={state === "busy"}
        title="Stores an immutable snapshot of these inputs and results, so this run stays reproducible after you change the inputs."
      >
        {state === "busy" ? <Spinner label="Saving…" /> : state === "done" ? "Snapshot saved" : label}
      </button>
      {message && <span className="text-[11px] text-[#d03b3b]">{message}</span>}
    </span>
  );
}
