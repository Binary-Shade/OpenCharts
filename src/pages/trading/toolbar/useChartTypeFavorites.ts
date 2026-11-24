import { useCallback, useState } from "react";
import { safeStorage } from "../../../lib/safe-storage.ts";
import { CHART_TYPES, type ChartType } from "../chartTypes.ts";

const FAVORITES_KEY = "oc_charttype_favorites";

function readFavorites(): ChartType[] {
  try {
    const raw = safeStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (type): type is ChartType =>
        typeof type === "string" && (CHART_TYPES as readonly string[]).includes(type),
    );
  } catch {
    return [];
  }
}

/**
 * Favorite chart types, persisted device-side. Shared by the chart-type
 * dropdown (star toggles) and the flat quick-pick row beside it.
 */
export function useChartTypeFavorites() {
  const [favorites, setFavorites] = useState<ChartType[]>(readFavorites);

  const toggleFavorite = useCallback((type: ChartType) => {
    setFavorites((prev) => {
      const next = prev.includes(type) ? prev.filter((f) => f !== type) : [...prev, type];
      safeStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { favorites, toggleFavorite };
}
