import type { Timeframe } from "./constants.ts";

export interface RangeTab {
  tab: string;
  /** TradingView-style description, e.g. "1 month in 30 minutes intervals". */
  title: string;
  /** Interval the range pairs with; switches the chart if it differs. */
  tf: Timeframe;
  /** Approximate bar count to reveal at the paired interval ("All" = fit). */
  bars: number | null;
}

/**
 * Range quick tabs paired with suggested intervals, mirroring TradingView's
 * bottom bar. Pairs adapt to the intervals OpenCharts supports (4h stands in
 * for TV's 2h on the 6-month tab).
 */
export const RANGE_TABS: RangeTab[] = [
  { tab: "1D", title: "1 day in 1 minute intervals", tf: "1m", bars: 1440 },
  { tab: "5D", title: "5 days in 5 minutes intervals", tf: "5m", bars: 1440 },
  { tab: "1M", title: "1 month in 30 minutes intervals", tf: "30m", bars: 1440 },
  { tab: "3M", title: "3 months in 1 hour intervals", tf: "1h", bars: 2160 },
  { tab: "6M", title: "6 months in 4 hour intervals", tf: "4h", bars: 1080 },
  { tab: "YTD", title: "Year to date in 1 day intervals", tf: "1d", bars: 365 },
  { tab: "1Y", title: "1 year in 1 day intervals", tf: "1d", bars: 365 },
  { tab: "5Y", title: "5 years in 1 week intervals", tf: "1w", bars: 260 },
  { tab: "All", title: "All loaded data", tf: "1w", bars: null },
];
