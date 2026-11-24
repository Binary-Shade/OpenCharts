import type { CandlestickData, LineData, Time } from "lightweight-charts";
import {
  Activity,
  type LucideIcon,
  Minus,
  Mountain,
  TrendingUp,
} from "lucide-react";

/**
 * Main-series chart types. TradingView groups its chart-type menu into six
 * sections; we expose the subset the Lightweight Charts engine renders today,
 * keeping the same grouping so more types slot in without redesigning the menu.
 */
export const CHART_TYPES = [
  "bars",
  "candles",
  "line",
  "line-markers",
  "area",
  "baseline",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

export const DEFAULT_CHART_TYPE: ChartType = "candles";

export function isChartType(value: unknown): value is ChartType {
  return typeof value === "string" && (CHART_TYPES as readonly string[]).includes(value);
}

export interface ChartTypeGroup {
  label: string;
  items: Array<{
    type: ChartType;
    label: string;
    icon: LucideIcon;
  }>;
}

export const CHART_TYPE_GROUPS: ChartTypeGroup[] = [
  {
    label: "Bars & candles",
    items: [
      { type: "bars", label: "Bars", icon: Activity },
      { type: "candles", label: "Candles", icon: TrendingUp },
    ],
  },
  {
    label: "Line",
    items: [
      { type: "line", label: "Line", icon: Minus },
      { type: "line-markers", label: "Line with markers", icon: Activity },
    ],
  },
  {
    label: "Overlays",
    items: [
      { type: "area", label: "Area", icon: Mountain },
      { type: "baseline", label: "Baseline", icon: Activity },
    ],
  },
];

export function chartTypeLabel(type: ChartType): string {
  for (const group of CHART_TYPE_GROUPS) {
    const item = group.items.find((candidate) => candidate.type === type);
    if (item) return item.label;
  }
  return "Candles";
}

/** True when the series paints wicks/bodies, so candle styling applies. */
export function isCandleFamily(type: ChartType): boolean {
  return type === "candles" || type === "bars";
}

/** Data shapes the supported main series accept. */
export type MainSeriesData = CandlestickData<Time> | LineData<Time>;

/**
 * Lightweight Charts line-style series take `{time, value}`, not OHLC. Every
 * main-series write funnels through this mapper so switching the chart type
 * never sends the wrong shape to the engine.
 */
export function toMainSeriesData(type: ChartType, bar: CandlestickData<Time>): MainSeriesData {
  if (isCandleFamily(type)) return bar;
  return { time: bar.time, value: bar.close };
}

/** The engine series kind each chart type renders as. */
export type ChartSeriesType =
  | "Bar"
  | "Candlestick"
  | "Line"
  | "Area"
  | "Baseline";

export function chartSeriesType(type: ChartType): ChartSeriesType {
  switch (type) {
    case "bars":
      return "Bar";
    case "candles":
      return "Candlestick";
    case "area":
      return "Area";
    case "baseline":
      return "Baseline";
    default:
      return "Line";
  }
}

/** Long label for the interval trigger, TradingView style ("1 day" not "1d"). */
export const TIMEFRAME_LONG_LABELS: Record<string, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "15m": "15 minutes",
  "30m": "30 minutes",
  "1h": "1 hour",
  "4h": "4 hours",
  "1d": "1 day",
  "1w": "1 week",
};

export const INTERVAL_GROUPS: Array<{
  label: string;
  items: Array<{ tf: string; label: string }>;
}> = [
  {
    label: "Minutes",
    items: [
      { tf: "1m", label: "1 minute" },
      { tf: "5m", label: "5 minutes" },
      { tf: "15m", label: "15 minutes" },
      { tf: "30m", label: "30 minutes" },
    ],
  },
  {
    label: "Hours",
    items: [
      { tf: "1h", label: "1 hour" },
      { tf: "4h", label: "4 hours" },
    ],
  },
  {
    label: "Days & weeks",
    items: [
      { tf: "1d", label: "1 day" },
      { tf: "1w", label: "1 week" },
    ],
  },
];
