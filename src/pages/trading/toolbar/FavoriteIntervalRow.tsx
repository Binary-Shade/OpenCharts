import { cn } from "../../../lib/utils.ts";
import { TIMEFRAMES, type Timeframe } from "../constants.ts";

interface FavoriteIntervalRowProps {
  favorites: Timeframe[];
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  disabled?: boolean;
}

/**
 * Flat quick-pick buttons for favorited intervals, rendered beside the
 * interval dropdown — TradingView surfaces starred intervals this way so
 * switching never needs the menu.
 */
export function FavoriteIntervalRow({
  favorites,
  timeframe,
  onTimeframeChange,
  disabled,
}: FavoriteIntervalRowProps) {
  const visible = favorites.filter((tf) => TIMEFRAMES.includes(tf));
  if (visible.length === 0) return null;

  return (
    <div role="group" aria-label="Favorite intervals" className="flex items-center gap-0.5 shrink-0">
      {visible.map((tf) => (
        <button
          key={tf}
          type="button"
          aria-label={`Switch to ${tf}`}
          aria-pressed={tf === timeframe}
          disabled={disabled}
          onClick={() => onTimeframeChange(tf)}
          className={cn(
            "px-1.5 py-1 rounded-md text-xs font-medium transition-colors",
            tf === timeframe
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            disabled && "opacity-40 cursor-default",
          )}
        >
          {tf}
        </button>
      ))}
    </div>
  );
}
