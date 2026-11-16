import { useEffect, useState } from "react";
import { markElyAvatarsStale } from "../lib/avatar";

const MIN_REFRESH_INTERVAL_MS = 15_000;

export function useElySkinRefreshTick(enabled: boolean): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let lastRefreshAt = Date.now();
    const onFocus = () => {
      const now = Date.now();
      if (now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return;
      lastRefreshAt = now;
      markElyAvatarsStale();
      setTick((value) => value + 1);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [enabled]);

  return tick;
}
