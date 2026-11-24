import type { ChartType } from "../chartTypes.ts";
import { CHART_TYPE_GROUPS } from "../chartTypes.ts";
import { MenuDivider, MenuRow, MenuSection, ToolbarMenu } from "./primitives.tsx";

interface ChartTypeMenuProps {
  chartType: ChartType;
  onChartTypeChange: (type: ChartType) => void;
  /** Owned by the toolbar so the flat quick-pick row stays in sync. */
  favorites: ChartType[];
  onToggleFavorite: (type: ChartType) => void;
}

/**
 * Chart-style dropdown following TradingView's grouped layout — bars &
 * candles, line styles, overlays. Only types the engine renders are listed.
 */
export function ChartTypeMenu({
  chartType,
  onChartTypeChange,
  favorites,
  onToggleFavorite,
}: ChartTypeMenuProps) {
  const current = CHART_TYPE_GROUPS.flatMap((g) => g.items).find((i) => i.type === chartType);

  return (
    <ToolbarMenu
      label="Change chart type"
      value={current?.label ?? "Candles"}
      panelClassName="w-56"
    >
      {(close) => (
        <>
          {CHART_TYPE_GROUPS.map((group, index) => (
            <div key={group.label}>
              {index > 0 && <MenuDivider />}
              <MenuSection label={group.label} />
              {group.items.map((item) => (
                <MenuRow
                  key={item.type}
                  icon={item.icon}
                  label={item.label}
                  selected={item.type === chartType}
                  starred={favorites.includes(item.type)}
                  onPick={() => {
                    onChartTypeChange(item.type);
                    close();
                  }}
                  onToggleStar={() => onToggleFavorite(item.type)}
                />
              ))}
            </div>
          ))}
        </>
      )}
    </ToolbarMenu>
  );
}
