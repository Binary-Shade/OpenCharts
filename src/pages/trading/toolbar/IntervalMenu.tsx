import { useState } from "react";
import { safeStorage } from "../../../lib/safe-storage.ts";
import { TIMEFRAMES, type Timeframe } from "../constants.ts";
import { cn } from "../../../lib/utils.ts";
import { INTERVAL_GROUPS } from "../chartTypes.ts";
import {
  MenuDivider,
  MenuRow,
  MenuSection,
  ToolbarMenu,
} from "./primitives.tsx";

const FAVORITES_KEY = "oc_interval_favorites";

function readFavorites(): string[] {
  try {
    const raw = safeStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((tf): tf is string => typeof tf === "string") : [];
  } catch {
    return [];
  }
}

interface IntervalMenuProps {
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  disabled?: boolean;
}

/**
 * Interval dropdown grouped like TradingView's (minutes / hours / days),
 * with per-interval favorites and a selected check.
 */
export function IntervalMenu({ timeframe, onTimeframeChange, disabled }: IntervalMenuProps) {
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

  const toggleFavorite = (tf: string) => {
    setFavorites((prev) => {
      const next = prev.includes(tf) ? prev.filter((f) => f !== tf) : [...prev, tf];
      safeStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  };

  const current = INTERVAL_GROUPS.flatMap((g) => g.items).find((i) => i.tf === timeframe);

  return (
    <ToolbarMenu
      label="Change interval"
      value={current?.label ?? timeframe}
      disabled={disabled}
      panelClassName="w-52"
    >
      {(close) => (
        <>
          {favorites.length > 0 && (
            <>
              <MenuSection label="Favorites" />
              {favorites.map((tf) => {
                const item = INTERVAL_GROUPS.flatMap((g) => g.items).find((i) => i.tf === tf);
                return (
                  <MenuRow
                    key={`fav-${tf}`}
                    label={item?.label ?? tf}
                    selected={tf === timeframe}
                    starred
                    onPick={() => {
                      if (TIMEFRAMES.includes(tf as Timeframe)) onTimeframeChange(tf as Timeframe);
                      close();
                    }}
                    onToggleStar={() => toggleFavorite(tf)}
                  />
                );
              })}
              <MenuDivider />
            </>
          )}
          {INTERVAL_GROUPS.map((group, index) => (
            <div key={group.label}>
              {index > 0 && <MenuDivider />}
              <MenuSection label={group.label} />
              {group.items.map((item) => (
                <MenuRow
                  key={item.tf}
                  label={item.label}
                  selected={item.tf === timeframe}
                  starred={favorites.includes(item.tf)}
                  onPick={() => {
                    if (TIMEFRAMES.includes(item.tf as Timeframe)) {
                      onTimeframeChange(item.tf as Timeframe);
                    }
                    close();
                  }}
                  onToggleStar={() => toggleFavorite(item.tf)}
                />
              ))}
            </div>
          ))}
          <div className={cn("px-3 pb-1.5 pt-1 text-[10px] text-muted-foreground/60")}>
            Timeframe is locked during replay
          </div>
        </>
      )}
    </ToolbarMenu>
  );
}
