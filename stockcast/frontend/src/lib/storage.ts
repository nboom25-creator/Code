"use client";
import { useCallback, useEffect, useState } from "react";

// A tiny localStorage-backed list hook for the watchlist and recents.
function useList(key: string, max = 50) {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setItems(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [key]);

  const persist = useCallback(
    (next: string[]) => {
      setItems(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
    },
    [key],
  );

  const add = useCallback(
    (t: string) => {
      const up = t.toUpperCase();
      persist([up, ...items.filter((x) => x !== up)].slice(0, max));
    },
    [items, persist, max],
  );

  const remove = useCallback((t: string) => persist(items.filter((x) => x !== t.toUpperCase())), [items, persist]);
  const toggle = useCallback(
    (t: string) => {
      const up = t.toUpperCase();
      items.includes(up) ? remove(up) : add(up);
    },
    [items, add, remove],
  );

  return { items, add, remove, toggle, has: (t: string) => items.includes(t.toUpperCase()) };
}

export const useWatchlist = () => useList("sc-watchlist");
export const useRecents = () => useList("sc-recents", 8);
