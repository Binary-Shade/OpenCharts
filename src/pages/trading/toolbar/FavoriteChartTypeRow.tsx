import { cn } from "../../../lib/utils.ts";
import { type ChartType, CHART_TYPE_GROUPS } from "../chartTypes.ts";

interface FavoriteChartTypeRowProps {
  favorites: ChartType[];
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
}

/**
 * Flat quick-pick buttons for favorited chart types, rendered beside the
 * chart-type dropdown — same pattern as favorite intervals, so starred types
 * are one click away.
 */
export function FavoriteChartTypeRow({
  favorites,
  chartType,
  onChartTypeChange,
}: FavoriteChartTypeRowProps) {
  const items = CHART_TYPE_GROUPS.flatMap((g) => g.items);
  const visible = favorites.filter((type) => items.some((i) => i.type === type));
  if (visible.length === 0) return null;

  return (
    <div role="group" aria-label="Favorite chart types" className="flex items-center gap-0.5 shrink-0">
      {visible.map((type) => {
        const item = items.find((i) => i.type === type)!;
        const Icon = item.icon;
        return (
          <button
            key={type}
            type="button"
            aria-label={`Switch to ${item.label}`}
            aria-pressed={type === chartType}
            title={item.label}
            onClick={() => onChartTypeChange(type)}
            className={cn(
              "px-1.5 py-1 rounded-md transition-colors",
              type === chartType
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
