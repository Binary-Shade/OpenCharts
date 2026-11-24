import { Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { INDICATOR_REGISTRY, type IndicatorType } from "../../../packages/indicators/index.ts";
import { cn } from "../../../lib/utils.ts";
import { MenuDivider, ToolbarMenu } from "./primitives.tsx";

interface IndicatorsMenuProps {
  active: IndicatorType[];
  onToggle: (type: IndicatorType) => void;
}

/**
 * Indicator picker with a search box and overlay/pane grouping — the menu
 * sibling of TradingView's indicators dialog. Selecting an entry toggles it
 * and keeps the menu open so several can be stacked at once.
 */
export function IndicatorsMenu({ active, onToggle }: IndicatorsMenuProps) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = INDICATOR_REGISTRY.filter(
      (ind) => !q || ind.label.toLowerCase().includes(q) || ind.type.toLowerCase().includes(q),
    );
    return {
      overlays: matches.filter((ind) => ind.pane === "overlay"),
      panes: matches.filter((ind) => ind.pane !== "overlay"),
    };
  }, [query]);

  return (
    <ToolbarMenu
      label="Indicators, metrics, and strategies"
      value="Indicators"
      active={active.length > 0}
      panelClassName="w-72"
    >
      {() => (
        <>
          <div className="flex items-center gap-2 mx-2 mt-1.5 px-2 py-1.5 rounded-md border border-border bg-background/60">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search indicators…"
              className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/60"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="p-0.5 rounded hover:bg-secondary"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {groups.overlays.length === 0 && groups.panes.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No indicators match &ldquo;{query}&rdquo;
            </div>
          )}

          {groups.overlays.length > 0 && (
            <>
              <MenuDivider />
              <div className="px-3 pt-1 pb-1 text-[10px] font-medium text-muted-foreground/80">
                Overlays
              </div>
              {groups.overlays.map((ind) => (
                <IndicatorRow key={ind.type} ind={ind} active={active} onToggle={onToggle} />
              ))}
            </>
          )}
          {groups.panes.length > 0 && (
            <>
              <MenuDivider />
              <div className="px-3 pt-1 pb-1 text-[10px] font-medium text-muted-foreground/80">
                Panes
              </div>
              {groups.panes.map((ind) => (
                <IndicatorRow key={ind.type} ind={ind} active={active} onToggle={onToggle} />
              ))}
            </>
          )}
        </>
      )}
    </ToolbarMenu>
  );
}

function IndicatorRow({
  ind,
  active,
  onToggle,
}: {
  ind: (typeof INDICATOR_REGISTRY)[number];
  active: IndicatorType[];
  onToggle: (type: IndicatorType) => void;
}) {
  const isActive = active.includes(ind.type);
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={isActive}
      onClick={() => onToggle(ind.type)}
      className={cn(
        "w-full flex items-center gap-2 mx-1 px-2 py-1.5 rounded-md text-xs text-left cursor-pointer",
        isActive ? "bg-secondary text-foreground" : "hover:bg-secondary/70",
      )}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0 border border-background/40"
        style={{ backgroundColor: ind.color }}
      />
      <span className="flex-1 truncate">{ind.label}</span>
      <span
        className={cn(
          "text-[9px] font-medium tracking-wide",
          isActive ? "text-primary" : "text-muted-foreground/50",
        )}
      >
        {isActive ? "ON" : (ind.pane === "overlay" ? "OVERLAY" : "PANE")}
      </span>
    </button>
  );
}
