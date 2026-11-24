import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../../lib/utils.ts";
import { RANGE_TABS, type RangeTab } from "../rangeTabs.ts";
import type { Timeframe } from "../constants.ts";

interface BottomToolbarProps {
  timeframe: Timeframe;
  activeTab: string | null;
  onRangePick: (tab: RangeTab) => void;
  onGoToDate: (date: string) => void;
  goToDateOpen: boolean;
  onGoToDateToggle: () => void;
}

function utcClock(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
}

/** Bottom bar: range tabs, go-to-date, live UTC clock. */
export function BottomToolbar({
  timeframe,
  activeTab,
  onRangePick,
  onGoToDate,
  goToDateOpen,
  onGoToDateToggle,
}: BottomToolbarProps) {
  const [clock, setClock] = useState(utcClock);
  const [date, setDate] = useState("");

  useEffect(() => {
    const id = setInterval(() => setClock(utcClock()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative z-30 flex items-center gap-0.5 px-2 h-8 border-t border-border bg-card text-[11px] shrink-0 overflow-visible no-scrollbar">
      {RANGE_TABS.map((range) => (
        <button
          key={range.tab}
          type="button"
          title={range.title}
          aria-pressed={activeTab === range.tab}
          data-pair-tf={range.tf === timeframe ? "" : undefined}
          onClick={() => onRangePick(range)}
          className={cn(
            "px-2 py-0.5 rounded font-medium whitespace-nowrap transition-colors",
            activeTab === range.tab
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {range.tab}
        </button>
      ))}

      <div className="h-4 w-px bg-border mx-1 shrink-0" aria-hidden />

      <div className="relative shrink-0">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={goToDateOpen}
          aria-label="Go to date (Alt+G)"
          title="Go to date (Alt+G)"
          onClick={onGoToDateToggle}
          className={cn(
            "flex items-center gap-1 px-2 py-0.5 rounded font-medium text-muted-foreground hover:bg-secondary hover:text-foreground",
            goToDateOpen && "bg-secondary text-foreground",
          )}
        >
          <CalendarClock className="h-3 w-3" />
          Go to
        </button>
        {goToDateOpen && (
          <div
            role="dialog"
            aria-label="Go to date"
            className="absolute bottom-full left-0 z-50 mb-2 flex items-center gap-2 bg-popover border border-border rounded-lg shadow-xl px-2 py-2"
          >
            <input
              autoFocus
              type="date"
              aria-label="Target date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-transparent text-xs border border-border rounded px-2 py-1"
            />
            <button
              type="button"
              onClick={() => {
                if (date) onGoToDate(date);
              }}
              className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-medium"
            >
              Go
            </button>
          </div>
        )}
      </div>

      <div className="flex-1" />
      <span
        className="text-muted-foreground tabular-nums shrink-0 px-1"
        aria-label="Current UTC time"
      >
        {clock}
      </span>
    </div>
  );
}
