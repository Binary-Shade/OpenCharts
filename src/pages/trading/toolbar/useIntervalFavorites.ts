import { useCallback, useState } from "react";
import { safeStorage } from "../../../lib/safe-storage.ts";
import { TIMEFRAMES, type Timeframe } from "../constants.ts";

const FAVORITES_KEY = "oc_interval_favorites";

function readFavorites(): Timeframe[] {
  try {
    const raw = safeStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (tf): tf is Timeframe => typeof tf === "string" && TIMEFRAMES.includes(tf as Timeframe),
    );
  } catch {
    return [];
  }
}

/**
 * Favorite intervals, persisted device-side. Shared by the interval dropdown
 * (star toggles) and the flat quick-pick row beside it, so starring a menu
 * item immediately surfaces it in the toolbar.
 */
export function useIntervalFavorites() {
  const [favorites, setFavorites] = useState<Timeframe[]>(readFavorites);

  const toggleFavorite = useCallback((tf: Timeframe) => {
    setFavorites((prev) => {
      const next = prev.includes(tf) ? prev.filter((f) => f !== tf) : [...prev, tf];
      safeStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { favorites, toggleFavorite };
}
