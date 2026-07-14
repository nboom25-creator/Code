"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SearchResult } from "@/lib/types";

export function TickerSearch({
  onAnalyze,
  loading,
}: {
  onAnalyze: (ticker: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [randomLoading, setRandomLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!value.trim()) {
      setResults([]);
      return;
    }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const r = await api.search(value.trim());
        setResults(r);
        setOpen(true);
        setActive(-1);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(debounce.current);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const submit = (ticker?: string) => {
    const t = (ticker ?? value).trim().toUpperCase();
    if (!t) return;
    setOpen(false);
    setValue(t);
    onAnalyze(t);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) {
      if (e.key === "Enter") submit();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      submit(active >= 0 ? results[active].ticker : value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const pickRandom = async () => {
    setRandomLoading(true);
    try {
      const { ticker } = await api.random();
      submit(ticker);
    } catch {
      /* handled by page */
    } finally {
      setRandomLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div ref={boxRef} className="relative flex-1">
        <label htmlFor="ticker-input" className="sr-only">
          Ticker symbol
        </label>
        <input
          id="ticker-input"
          role="combobox"
          aria-expanded={open}
          aria-controls="ticker-listbox"
          aria-autocomplete="list"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search ticker or company (e.g. AAPL, Microsoft)…"
          className="w-full rounded-xl border border-border bg-card px-4 py-2.5 text-fg placeholder:text-muted focus:border-brand"
          autoComplete="off"
        />
        {open && results.length > 0 && (
          <ul
            id="ticker-listbox"
            role="listbox"
            className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-card shadow-lg"
          >
            {results.map((r, i) => (
              <li
                key={r.ticker + i}
                role="option"
                aria-selected={i === active}
                onMouseDown={() => submit(r.ticker)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm ${
                  i === active ? "bg-brand/10" : ""
                }`}
              >
                <span className="font-mono font-semibold text-fg">{r.ticker}</span>
                <span className="ml-3 truncate text-muted">{r.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={() => submit()}
        disabled={loading || !value.trim()}
        className="rounded-xl bg-brand px-5 py-2.5 font-medium text-white hover:opacity-90 disabled:opacity-40"
      >
        {loading ? "Analyzing…" : "Analyze"}
      </button>
      <button
        onClick={pickRandom}
        disabled={loading || randomLoading}
        className="rounded-xl border border-border bg-card px-4 py-2.5 font-medium text-fg hover:bg-surface disabled:opacity-40"
        title="Analyze a random well-known stock"
      >
        {randomLoading ? "…" : "🎲 Random"}
      </button>
    </div>
  );
}
