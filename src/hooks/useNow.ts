import { useEffect, useState } from 'react';

/**
 * Returns the current time, updating on an interval. Useful for live timers.
 * @param intervalMs how often to tick (default 1000ms). Pass 0 to disable.
 */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
