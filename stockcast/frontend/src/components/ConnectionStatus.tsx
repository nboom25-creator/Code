"use client";
import React, { useState } from "react";
import { api, Diagnostics } from "@/lib/api";
import type { HealthInfo } from "@/lib/types";
import { fmtPrice } from "@/lib/format";

/**
 * Shows the active data source and a one-click live-connection self-test, so a
 * user can instantly tell whether real-time data is flowing or the provider host
 * is blocked / unconfigured.
 */
export function ConnectionStatus({ health }: { health: HealthInfo | null }) {
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    setDiag(null);
    try {
      setDiag(await api.diagnostics());
    } catch (e: any) {
      setDiag({ provider: "?", symbol: "AAPL", reachable: false, configured: false, detail: e?.message || "Failed" });
    } finally {
      setTesting(false);
    }
  };

  const live = !health?.is_demo && health?.configured;
  const dotColor = health?.is_demo ? "bg-warn" : live ? "bg-up" : "bg-down";

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2 w-2 rounded-full ${dotColor}`} />
          <span className="text-muted">Data source:</span>
          <span className="font-semibold text-fg">{health?.provider_name || "—"}</span>
          {health?.is_demo && <span className="text-xs font-semibold text-warn">DEMO DATA</span>}
          {live && <span className="text-xs font-semibold text-up">live-capable</span>}
        </div>
        <button
          onClick={test}
          disabled={testing}
          className="rounded-lg border border-border px-3 py-1 text-xs font-medium text-fg hover:bg-surface disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test live connection"}
        </button>
      </div>

      {diag && (
        <div
          className={`mt-2 rounded-lg px-3 py-2 text-xs ${
            diag.reachable
              ? "bg-up/10 text-up"
              : diag.reachable === null
              ? "bg-warn/10 text-warn"
              : "bg-down/10 text-down"
          }`}
        >
          {diag.reachable ? (
            <>
              ✅ Live data is flowing from <b>{diag.source}</b> — {diag.symbol}{" "}
              {diag.live_price != null ? fmtPrice(diag.live_price) : ""}{" "}
              {diag.as_of ? `(as of ${new Date(diag.as_of).toLocaleString()})` : ""}
            </>
          ) : diag.reachable === null ? (
            <>ℹ️ {diag.detail} {diag.setup_hint || ""}</>
          ) : (
            <>
              ❌ {diag.detail}
              {diag.likely_network_policy && (
                <div className="mt-1 opacity-90">{diag.hint}</div>
              )}
              {!diag.likely_network_policy && diag.hint && <div className="mt-1 opacity-90">{diag.hint}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
