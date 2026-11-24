import type { Timeframe } from "../constants.ts";
import { INTERVAL_GROUPS } from "../chartTypes.ts";
import {
  MenuDivider,
  MenuRow,
  MenuSection,
  ToolbarMenu,
} from "./primitives.tsx";

interface IntervalMenuProps {
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  /** Owned by the toolbar so the flat quick-pick row stays in sync. */
  favorites: Timeframe[];
  onToggleFavorite: (tf: Timeframe) => void;
  disabled?: boolean;
}

/**
 * Interval dropdown grouped like TradingView's (minutes / hours / days),
 * with per-interval favorites and a selected check.
 */
export function IntervalMenu({
  timeframe,
  onTimeframeChange,
  favorites,
  onToggleFavorite,
  disabled,
}: IntervalMenuProps) {
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
                      onTimeframeChange(tf);
                      close();
                    }}
                    onToggleStar={() => onToggleFavorite(tf)}
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
                  starred={favorites.includes(item.tf as Timeframe)}
                  onPick={() => {
                    onTimeframeChange(item.tf as Timeframe);
                    close();
                  }}
                  onToggleStar={() => onToggleFavorite(item.tf as Timeframe)}
                />
              ))}
            </div>
          ))}
          <div className="px-3 pb-1.5 pt-1 text-[10px] text-muted-foreground/60">
            Star an interval to pin it to the toolbar
          </div>
        </>
      )}
    </ToolbarMenu>
  );
}
