"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Quote } from "./types";

/**
 * Poll the latest quote for a ticker so the price card updates in near real-time.
 * Polling pauses when the browser tab is hidden to respect provider rate limits.
 * Returns the freshest quote (or null before the first refresh).
 */
export function useLiveQuote(ticker: string | null, intervalMs = 20000, enabled = true): Quote | null {
  const [quote, setQuote] = useState<Quote | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    setQuote(null);
    if (!ticker || !enabled) return;

    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const q = await api.quote(ticker);
        if (!cancelled) setQuote(q);
      } catch {
        /* transient; keep last known price */
      }
    };
    timer.current = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer.current);
    };
  }, [ticker, intervalMs, enabled]);

  return quote;
}
