import { useQueryClient } from "@tanstack/react-query";
import { isHyperliquidMode } from "../../hyperliquid/ui/mode.ts";
import {
  type CandlestickData,
  ColorType,
  CrosshairMode,
  createChart,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesPrimitive,
  LineStyle,
  type LogicalRange,
  type SeriesMarker,
  SeriesType,
  type Time,
} from "lightweight-charts";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Clock,
  Eye,
  EyeOff,
  ListTree,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { INDICATOR_REGISTRY } from "../../packages/indicators/index.ts";
import { SymbolSearch } from "./toolbar/SymbolSearch.tsx";
import { IntervalMenu } from "./toolbar/IntervalMenu.tsx";
import {
  chartSeriesType,
  isCandleFamily,
  type ChartType,
  type MainSeriesData,
  toMainSeriesData,
} from "./chartTypes.ts";
import {
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChartPreferences } from "../../hooks/useChartPreferences.ts";
import { BandsIndicator } from "../../lib/chart-plugins/bands-indicator/bands-indicator.ts";
import { DeltaTooltipPrimitive } from "../../lib/chart-plugins/delta-tooltip/delta-tooltip.ts";
import {
  detectCrossings,
  playAlertBeep,
} from "../../lib/chart-plugins/drawing-tools/line-alerts.ts";
import { DrawingToolsManager } from "../../lib/chart-plugins/drawing-tools/manager.ts";
import { CrosshairHighlightPrimitive } from "../../lib/chart-plugins/highlight-bar-crosshair/highlight-bar-crosshair.ts";
import { SessionBreaks } from "../../lib/chart-plugins/session-breaks/session-breaks.ts";
import { SessionHighlighting } from "../../lib/chart-plugins/session-highlighting/session-highlighting.ts";
import { TooltipPrimitive } from "../../lib/chart-plugins/tooltip/tooltip.ts";
import type { IndicatorType } from "../../packages/indicators/index.ts";
import { cn } from "../../lib/utils.ts";
import { api } from "../../services/api.ts";
import { queryKeys } from "../../services/queries.ts";
import type { Candle, Order, Position, Symbol } from "../../services/schemas.ts";
import { toast } from "../../services/toast.ts";
import {
  CHART_COLORS,
  type DrawingLine,
  type DrawingTool,
  type MagnetMode,
  mergeChartColors,
  TF_INTERVAL_MS,
  type Timeframe,
} from "./constants.ts";
import { ChartContextMenu } from "./ChartContextMenu.tsx";
import { ChartSettingsDialog } from "./ChartSettingsDialog.tsx";
import {
  DrawingContextMenu,
  DrawingFloatingToolbar,
  DrawingSettingsDialog,
} from "./DrawingToolsOverlay.tsx";
import { DrawingToolRail } from "./DrawingToolRail.tsx";
import { BottomToolbar } from "./toolbar/BottomToolbar.tsx";
import { DRAWING_STYLES_EVENT, getStyleDefaults } from "./drawingStyles.ts";
import { NewsOverlay } from "./NewsOverlay.tsx";
import { ObjectTreePanel } from "./ObjectTreePanel.tsx";
import { useChallengeLevels } from "./useChallengeLevels.ts";
import { useIndicators } from "./useIndicators.ts";
import { useNewsOverlay } from "./useNewsOverlay.ts";
import { useSlTpDrag } from "./useSlTpDrag.ts";
import {
  formatCountdown,
  getCandleBucketTime,
  getMinMove,
  toUnixMs,
  toUnixSeconds,
} from "./utils.ts";

// ── Staleness recovery ─────────────────────────────────────────────────────
// Shared by the live-candle and tick-smoothing effects so either path can
// trigger a REST refetch when the chart falls more than 1.5 intervals behind
// wall-clock. Throttled to ≤1 refetch per 3 s across both callers.
function requestGapRefetch(
  refAtRef: { current: number },
  qc: ReturnType<typeof useQueryClient>,
  symbol: string,
  timeframe: string,
): void {
  const now = Date.now();
  if (now - refAtRef.current <= 3_000) return;
  refAtRef.current = now;
  qc.invalidateQueries({ queryKey: queryKeys.market.candles(symbol, timeframe) });
}

// ── Scroll-triggered history loading ─────────────────────────
// When the user scrolls to the left edge of loaded data, fetch the preceding
// window from the candle API and prepend it so the chart extends seamlessly.

const LOAD_MORE_THRESHOLD = 20; // trigger when fewer than N bars remain on the left
const LOAD_MORE_WINDOW = 500; // how many interval-widths to fetch per extension

type LoadMoreState = {
  loading: boolean;
  noMoreData: boolean;
  lastFetchedBeforeMs: number;
  // When > 0, use this as toMs for the next fetch instead of getSeriesOldestMs.
  // Set after an empty-range response so we skip over gaps (e.g. Forex weekends)
  // rather than permanently locking noMoreData on the first empty window.
  fetchFromMs: number;
  /** Consecutive empty windows; bounded so we stop probing past the dataset. */
  emptyWindows: number;
};

// A Forex weekend spans at most ~3 days, so a handful of empty windows in a row
// means the history really has ended rather than a gap. Without this bound the
// loader kept walking backwards one window per scroll forever.
const MAX_EMPTY_WINDOWS = 4;

function getSeriesOldestMs(series: ISeriesApi<SeriesType>): number {
  const data = series.data();
  return data.length === 0 ? 0 : (data[0]!.time as number) * 1_000;
}

function isLoadMoreEligible(
  state: LoadMoreState,
  series: ISeriesApi<SeriesType>,
  range: LogicalRange,
): boolean {
  if (state.loading || state.noMoreData) return false;
  const barsInfo = series.barsInLogicalRange(range);
  if ((barsInfo?.barsBefore ?? Number.POSITIVE_INFINITY) > LOAD_MORE_THRESHOLD) return false;
  // A shifted window from a previous empty-range response is always eligible —
  // we need to try the window before the gap (e.g. before a Forex weekend).
  if (state.fetchFromMs > 0) return true;
  const oldestMs = getSeriesOldestMs(series);
  if (oldestMs === 0) return false;
  return state.lastFetchedBeforeMs === 0 || oldestMs < state.lastFetchedBeforeMs;
}

function fetchOlderRange(
  symbol: string,
  timeframe: string,
  toMs: number,
  state: LoadMoreState,
  onLoaded: (bars: Candle[]) => void,
): void {
  const windowMs = LOAD_MORE_WINDOW * (TF_INTERVAL_MS[timeframe as Timeframe] ?? 60_000);
  api
    .getCandles(symbol, timeframe, undefined, { fromMs: toMs - windowMs, toMs })
    .then((bars) => {
      if (bars.length === 0) {
        // Empty window — could be a gap (e.g. Forex weekend) rather than true
        // end of history. Shift the fetch boundary back one more window so the
        // next scroll event tries the range before this gap instead of stopping,
        // but give up once several windows in a row come back empty.
        state.emptyWindows += 1;
        const nextToMs = toMs - windowMs;
        if (nextToMs > 0 && state.emptyWindows < MAX_EMPTY_WINDOWS) {
          state.fetchFromMs = nextToMs;
        } else {
          state.noMoreData = true;
        }
      } else {
        state.emptyWindows = 0;
        onLoaded(bars as Candle[]);
      }
    })
    .catch(() => {
      // Reset the fetch boundary so the user can retry by scrolling again.
      // Without this, a transient network error permanently blocks history
      // loading for the current view (lastFetchedBeforeMs stays set but no
      // bars were prepended, so the eligibility guard never clears).
      state.lastFetchedBeforeMs = 0;
    })
    .finally(() => {
      state.loading = false;
    });
}

function makeHistoryLoader(
  symbol: string,
  timeframeRef: { current: string },
  seriesRef: { current: ISeriesApi<SeriesType> | null },
  stateRef: { current: LoadMoreState },
  onLoaded: (bars: Candle[]) => void,
): (range: LogicalRange | null) => void {
  return (range) => {
    const series = seriesRef.current;
    if (!range || !series) return;
    const state = stateRef.current;
    if (!isLoadMoreEligible(state, series, range)) return;
    // Use the shifted boundary from a prior empty-range response when present,
    // otherwise fall back to the series' current oldest bar.
    const toMs = state.fetchFromMs > 0 ? state.fetchFromMs : getSeriesOldestMs(series);
    if (toMs === 0) return;
    state.loading = true;
    state.lastFetchedBeforeMs = toMs;
    state.fetchFromMs = 0;
    // Read the timeframe from a ref: the chart (and this subscription) persists
    // across TF changes, so the loader must always fetch the *current* TF.
    fetchOlderRange(symbol, timeframeRef.current, toMs, state, onLoaded);
  };
}

// ── Props ────────────────────────────────────────────────────

export interface ChartPanelProps {
  candles: Candle[];
  selectedSymbol: string;
  timeframe: Timeframe;
  onTimeframeChange?: (tf: Timeframe) => void;
  isDark: boolean;
  activeIndicators: IndicatorType[];
  symbols?: Array<{ id?: string; name: string; displayName?: string | null; category?: string; assetClass?: string }>;
  onToggleIndicator?: (type: IndicatorType) => void;
  intervalFavorites?: Timeframe[];
  onToggleIntervalFavorite?: (tf: Timeframe) => void;
  drawingTool: DrawingTool;
  drawings: DrawingLine[];
  onAddDrawing: (d: DrawingLine) => void;
  onUpdateDrawing?: (d: DrawingLine) => void;
  onUpdateDrawings?: (drawings: DrawingLine[]) => void;
  onRemoveDrawing?: (id: string) => void;
  /** Called when a drawing completes/cancels so the parent can disarm the tool. */
  onDrawingComplete?: () => void;
  /** Alt+T/H/F/R keyboard shortcut pressed — arm the given tool. */
  onDrawingToolSelect?: (t: DrawingTool) => void;
  onUndoDrawing?: () => void;
  onRedoDrawing?: () => void;
  /** Snap drawing anchors to candle O/H/L/C — off / weak (near) / strong (always). */
  magnetMode?: MagnetMode;
  onSetMagnet?: (mode: MagnetMode) => void;
  onToggleStayInDrawingMode?: () => void;
  /** Keep the drawing tool armed after each placement. */
  stayInDrawingMode?: boolean;
  positions: Position[];
  orders: Order[];
  tick?: { bid: number; ask: number; timestamp: number };
  liveCandle?: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
  };
  pipDigits: number;
  symbolInfo?: Symbol;
  onModifyPosition?: (
    positionId: string,
    mods: { takeProfit?: number | null; stopLoss?: number | null },
  ) => void;
  replayTradeEvents?: Array<{
    id: string;
    type: "entry" | "exit" | "violation";
    timestamp: string;
    symbolName: string | null;
    side: string | null;
    price: number | null;
    pnl: number | null;
    ruleCode?: string;
  }>;
  activePlugins?: string[];
  /** Toggle a chart plugin (session breaks etc.) — used by the settings dialog. */
  onTogglePlugin?: (id: string) => void;
  /** Account equity — feeds the position tool's $-risk / size readout. */
  accountEquity?: number;
  /** Active account — enables the challenge-aware level overlay. */
  accountId?: string | null;
  /** Context-menu quick order at the clicked price (opens the confirm dialog). */
  onQuickOrder?: (side: "BUY" | "SELL", type: "LIMIT" | "STOP", price: number) => void;
  /** Context-menu "Remove N drawings". */
  onClearDrawings?: () => void;
  /** Context-menu "Remove N indicators". */
  onClearIndicators?: () => void;
  /**
   * Session replay is active — candles are a historical slice, so the
   * staleness watchdog must not treat the old last-bar as a data gap.
   */
  isReplaying?: boolean;
}

// ── Chart plugin overlays ─────────────────────────────────────────────────────

function getForexSessionColor(utcHour: number): string {
  if (utcHour >= 22 || utcHour < 8) return "rgba(255,200,50,0.04)";
  if (utcHour >= 8 && utcHour < 16) return "rgba(50,200,255,0.04)";
  if (utcHour >= 13) return "rgba(255,80,80,0.04)";
  return "transparent";
}

const forexSessionHighlighter = (date: Time): string =>
  getForexSessionColor(new Date((date as number) * 1000).getUTCHours());

interface PluginBuildCtx {
  isDark: boolean;
  timeframe: Timeframe;
  symbolCategory?: string;
}

const EQUITY_CATEGORY = /stock|equit|share|etf|index|indices/i;

// Session breaks are intraday-only — on daily+ charts every bar is already a
// full session. Equities/indices reset at 09:30 New York (RTH open); forex,
// crypto and everything else reset at 00:00 UTC.
function buildSessionBreaks(ctx: PluginBuildCtx): ISeriesPrimitive<Time> | null {
  const intervalMs = TF_INTERVAL_MS[ctx.timeframe] ?? 60_000;
  if (intervalMs >= 86_400_000) return null;
  return new SessionBreaks({
    color: ctx.isDark ? "rgba(130, 150, 190, 0.5)" : "rgba(90, 110, 150, 0.45)",
    sessionStart: EQUITY_CATEGORY.test(ctx.symbolCategory ?? "") ? "ny-0930" : "utc-midnight",
  });
}

const PLUGIN_FACTORIES: Record<string, (ctx: PluginBuildCtx) => ISeriesPrimitive<Time> | null> = {
  crosshair: ({ isDark }) =>
    new CrosshairHighlightPrimitive({
      color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)",
    }),
  session: () => new SessionHighlighting(forexSessionHighlighter),
  "session-breaks": buildSessionBreaks,
  bands: () => new BandsIndicator(),
  tooltip: () => new TooltipPrimitive({}),
  "delta-tooltip": () => new DeltaTooltipPrimitive({}),
};

function buildPlugin(id: string, ctx: PluginBuildCtx): ISeriesPrimitive<Time> | null {
  return PLUGIN_FACTORIES[id]?.(ctx) ?? null;
}

// Shared OHLCV legend shape — derive the percent change once at the call site
// so the crosshair, candle, and tick paths all produce identical legend objects.
interface OhlcvLegend {
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  change: number;
}

function candleToLegend(c: CandlestickData<Time>, volume: number): OhlcvLegend {
  const change = c.open ? ((c.close - c.open) / c.open) * 100 : 0;
  return { o: c.open, h: c.high, l: c.low, c: c.close, v: volume, change };
}

// ── Real-time series update helpers ──────────────────────────────────────────
// Extracted from the live-candle / tick / bid-ask effects so each effect body
// stays under the cognitive-complexity limit. Behaviour is unchanged — these are
// pure relocations that operate on a shared context handed in by the effect.

type ChartColors = (typeof CHART_COLORS)["dark"];
type Ref<T> = { current: T };
type LiveCandleData = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
};
type TickData = { bid: number; ask: number; timestamp: number };

interface RtCtx {
  series: ISeriesApi<SeriesType>;
  /** Maps an OHLC bar to the data shape the active main series accepts. */
  toData: (bar: CandlestickData<Time>) => MainSeriesData;
  volume: ISeriesApi<"Histogram"> | null;
  lastCandle: Ref<CandlestickData<Time> | null>;
  liveCandleTs: Ref<number>;
  legendVol: Ref<number>;
  gapAt: Ref<number>;
  bidLine: Ref<IPriceLine | null>;
  askLine: Ref<IPriceLine | null>;
  midLine: Ref<IPriceLine | null>;
  colors: ChartColors;
  timeframe: Timeframe;
  symbol: string;
  qc: ReturnType<typeof useQueryClient>;
  setLegend: Dispatch<SetStateAction<OhlcvLegend | null>>;
}

function intervalSecOf(tf: Timeframe): number {
  return (TF_INTERVAL_MS[tf] ?? 60_000) / 1000;
}

/**
 * Creates the main series for the selected chart type. Candle/bar types share
 * OHLC data and up/down styling; line-family types render the close series
 * with a single stroke. Bid/Ask price lines stay authoritative on every kind,
 * so the series' own last-value label is always suppressed.
 */
function createMainSeries(
  chart: IChartApi,
  kind: ReturnType<typeof chartSeriesType>,
  opts: {
    colors: ChartColors;
    precision: number;
    minMove: number;
    showWicks: boolean;
    showBorders: boolean;
  },
): ISeriesApi<SeriesType> {
  const priceFormat = { type: "price" as const, precision: opts.precision, minMove: opts.minMove };
  switch (kind) {
    case "Bar":
      return chart.addBarSeries({
        upColor: opts.colors.up,
        downColor: opts.colors.down,
        thinBars: false,
        priceFormat,
        lastValueVisible: false,
        priceLineVisible: false,
      });
    case "Line": {
      return chart.addLineSeries({
        color: opts.colors.up || "#2962FF",
        lineWidth: 2,
        priceFormat,
        lastValueVisible: false,
        priceLineVisible: false,
      });
    }
    case "Area":
      return chart.addAreaSeries({
        lineColor: opts.colors.up || "#2962FF",
        topColor: `${opts.colors.up || "#2962FF"}33`,
        bottomColor: `${opts.colors.up || "#2962FF"}00`,
        lineWidth: 2,
        priceFormat,
        lastValueVisible: false,
        priceLineVisible: false,
      });
    case "Baseline":
      return chart.addBaselineSeries({
        baseValue: { type: "price", price: 0 },
        topLineColor: opts.colors.up,
        topFillColor1: `${opts.colors.up}33`,
        topFillColor2: `${opts.colors.up}00`,
        bottomLineColor: opts.colors.down,
        bottomFillColor1: `${opts.colors.down}00`,
        bottomFillColor2: `${opts.colors.down}33`,
        priceFormat,
        lastValueVisible: false,
        priceLineVisible: false,
      });
    default:
      return chart.addCandlestickSeries({
        upColor: opts.colors.up,
        downColor: opts.colors.down,
        borderUpColor: opts.colors.up,
        borderDownColor: opts.colors.down,
        wickUpColor: opts.colors.up,
        wickDownColor: opts.colors.down,
        wickVisible: opts.showWicks,
        borderVisible: opts.showBorders,
        priceFormat,
        lastValueVisible: false,
        priceLineVisible: false,
        priceLineWidth: 1,
        priceLineColor: "",
        priceLineStyle: LineStyle.Dotted,
      });
  }
}

// Paint the authoritative server volume bar for the current candle.
function paintServerVolume(live: LiveCandleData, barTime: Time, ctx: RtCtx): void {
  if (!ctx.volume || live.volume == null) return;
  ctx.legendVol.current = live.volume;
  try {
    ctx.volume.update({
      time: barTime,
      value: live.volume,
      color: live.close >= live.open ? ctx.colors.volumeUp : ctx.colors.volumeDown,
    });
  } catch {
    /* safe to ignore */
  }
}

// Primary: server-aggregated CandleUpdate (authoritative OHLCV).
function applyServerCandle(live: LiveCandleData, ctx: RtCtx): void {
  const ts = toUnixSeconds(live.timestamp);
  if (Number.isNaN(ts) || ts <= 0 || !ctx.lastCandle.current) return;
  if (ts - (ctx.lastCandle.current.time as number) > intervalSecOf(ctx.timeframe) * 1.5) {
    requestGapRefetch(ctx.gapAt, ctx.qc, ctx.symbol, ctx.timeframe);
  }
  const bar: CandlestickData<Time> = {
    time: ts as Time,
    open: live.open,
    high: live.high,
    low: live.low,
    close: live.close,
  };
  ctx.lastCandle.current = bar;
  ctx.liveCandleTs.current = toUnixMs(live.timestamp);
  try {
    ctx.series.update(ctx.toData(bar) as CandlestickData<Time>);
  } catch {
    /* timestamp older than series — safe to ignore */
  }
  paintServerVolume(live, ts as Time, ctx);
  ctx.setLegend(candleToLegend(bar, live.volume || 0));
}

// Build the tick-smoothed bar for the current bucket (continuation or fresh).
function buildTickBar(
  prev: CandlestickData<Time>,
  isContinuation: boolean,
  bucketTime: Time,
  mid: number,
  ctx: RtCtx,
): CandlestickData<Time> | null {
  if (isContinuation) {
    return {
      time: bucketTime,
      open: prev.open,
      high: Math.max(prev.high, mid),
      low: Math.min(prev.low, mid),
      close: mid,
    };
  }
  if ((bucketTime as number) <= (prev.time as number)) return null;
  if ((bucketTime as number) - (prev.time as number) > intervalSecOf(ctx.timeframe) * 1.5) {
    requestGapRefetch(ctx.gapAt, ctx.qc, ctx.symbol, ctx.timeframe);
  }
  const seedOpen = prev.close;
  return {
    time: bucketTime,
    open: seedOpen,
    high: Math.max(seedOpen, mid),
    low: Math.min(seedOpen, mid),
    close: mid,
  };
}

// A new bucket has no aggregated volume yet — seed it at 0 so a fresh candle
// never inherits the previous bar's full-height volume.
function paintTickVolume(
  bar: CandlestickData<Time>,
  isContinuation: boolean,
  bucketTime: Time,
  ctx: RtCtx,
): void {
  if (!ctx.volume) return;
  if (!isContinuation) ctx.legendVol.current = 0;
  try {
    ctx.volume.update({
      time: bucketTime,
      value: ctx.legendVol.current,
      color: bar.close >= bar.open ? ctx.colors.volumeUp : ctx.colors.volumeDown,
    });
  } catch {
    /* safe to ignore */
  }
}

// Secondary: tick smoothing between server CandleUpdate pulses.
function applyTick(tick: TickData, ctx: RtCtx): void {
  if (!tick.timestamp) return;
  const tickMs = toUnixMs(tick.timestamp);
  if (ctx.liveCandleTs.current && tickMs <= ctx.liveCandleTs.current) return;
  const prev = ctx.lastCandle.current;
  if (!prev) return;
  const mid = (tick.bid + tick.ask) / 2;
  const bucketTime = getCandleBucketTime(tickMs, ctx.timeframe) as Time;
  const isContinuation = prev.time === bucketTime;
  const bar = buildTickBar(prev, isContinuation, bucketTime, mid, ctx);
  if (!bar) return;
  ctx.lastCandle.current = bar;
  try {
    ctx.series.update(ctx.toData(bar) as CandlestickData<Time>);
  } catch {
    /* safe to ignore */
  }
  paintTickVolume(bar, isContinuation, bucketTime, ctx);
  ctx.setLegend((prevLegend) => ({
    ...candleToLegend(bar, 0),
    v: isContinuation ? (prevLegend?.v ?? 0) : 0,
  }));
}

function removePriceLineSafe(ref: Ref<IPriceLine | null>, series: ISeriesApi<SeriesType>): void {
  if (!ref.current) return;
  try {
    series.removePriceLine(ref.current);
  } catch {
    /* ignore */
  }
  ref.current = null;
}

// Move an existing price line in place (applyOptions) or create it — avoids the
// remove+create churn that flickers the chart at tick rate.
function upsertPriceLine(
  ref: Ref<IPriceLine | null>,
  series: ISeriesApi<SeriesType>,
  enabled: boolean,
  opts: Parameters<ISeriesApi<SeriesType>["createPriceLine"]>[0],
): void {
  if (!enabled) {
    removePriceLineSafe(ref, series);
    return;
  }
  if (ref.current) {
    try {
      ref.current.applyOptions(opts);
      return;
    } catch {
      ref.current = null;
    }
  }
  ref.current = series.createPriceLine(opts);
}

function applyBidAskLines(
  tick: TickData | undefined,
  prefs: { showBidLine: boolean; showAskLine: boolean },
  ctx: RtCtx,
): void {
  const series = ctx.series;
  if (!tick) {
    removePriceLineSafe(ctx.bidLine, series);
    removePriceLineSafe(ctx.askLine, series);
    removePriceLineSafe(ctx.midLine, series);
    return;
  }
  upsertPriceLine(ctx.bidLine, series, prefs.showBidLine, {
    price: tick.bid,
    color: ctx.colors.bidLine,
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: "Bid",
    axisLabelColor: ctx.colors.bidLabelBg,
    axisLabelTextColor: "#ffffff",
  });
  upsertPriceLine(ctx.askLine, series, prefs.showAskLine, {
    price: tick.ask,
    color: ctx.colors.askLine,
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: "Ask",
    axisLabelColor: ctx.colors.askLabelBg,
    axisLabelTextColor: "#ffffff",
  });
  // Mid line only when both bid+ask are hidden — otherwise it overlaps them.
  upsertPriceLine(ctx.midLine, series, !prefs.showBidLine && !prefs.showAskLine, {
    price: (tick.bid + tick.ask) / 2,
    color: "#7aa2ff99",
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: "",
    axisLabelColor: "#3b5ab5",
    axisLabelTextColor: "#ffffff",
  });
}

function detachPlugins(series: ISeriesApi<SeriesType>, list: ISeriesPrimitive<Time>[]): void {
  for (const p of list) {
    try {
      series.detachPrimitive(p);
    } catch {
      /* stale ref */
    }
  }
}

function attachPlugins(
  series: ISeriesApi<SeriesType>,
  ids: string[],
  ctx: PluginBuildCtx,
  list: ISeriesPrimitive<Time>[],
): void {
  for (const id of ids) {
    const p = buildPlugin(id, ctx);
    if (p) {
      try {
        series.attachPrimitive(p);
        list.push(p);
      } catch {
        /* ignore */
      }
    }
  }
}

// ── Server-data (setData) helpers ────────────────────────────────────────────
// Extracted from the historical-fetch / periodic-sync effect so its body stays
// under the complexity limit. Pure relocations — behaviour is unchanged.

function liveBarFrom(live: LiveCandleData): CandlestickData<Time> | null {
  const ts = toUnixSeconds(live.timestamp);
  if (Number.isNaN(ts) || ts <= 0) return null;
  return { time: ts as Time, open: live.open, high: live.high, low: live.low, close: live.close };
}

function legendFromSeries(
  chartData: CandlestickData<Time>[],
  volumeData: HistogramData<Time>[],
): OhlcvLegend | null {
  const last = chartData[chartData.length - 1];
  if (!last) return null;
  const vol = volumeData.length > 0 ? (volumeData[volumeData.length - 1]?.value ?? 0) : 0;
  return candleToLegend(last, vol);
}

function scrollOrFit(chart: IChartApi | null, barCount: number): void {
  const ts = chart?.timeScale();
  if (!ts) return;
  if (barCount > 150) ts.scrollToPosition(8, false);
  else ts.fitContent();
}

// Re-apply the latest live bar after a periodic refetch (viewport preserved).
function reapplyLive(live: LiveCandleData | undefined, ctx: RtCtx): void {
  if (!live) return;
  const bar = liveBarFrom(live);
  if (!bar) return;
  try {
    ctx.series.update(ctx.toData(bar) as CandlestickData<Time>);
  } catch {
    /* safe to ignore */
  }
  ctx.lastCandle.current = bar;
}

// Replay the buffered live candle immediately after history is painted so the
// last bar isn't stuck at the final historical close until the next tick.
function replayBufferedLive(
  buffered: LiveCandleData | undefined,
  chartData: CandlestickData<Time>[],
  ctx: RtCtx,
): void {
  if (!buffered) return;
  const liveTs = toUnixSeconds(buffered.timestamp);
  const lastHistBarSec = (chartData[chartData.length - 1]?.time as number) ?? 0;
  if (Number.isNaN(liveTs) || liveTs <= 0 || liveTs < lastHistBarSec) return;
  const liveBar = liveBarFrom(buffered);
  if (!liveBar) return;
  try {
    ctx.series.update(ctx.toData(liveBar) as CandlestickData<Time>);
    ctx.lastCandle.current = liveBar;
    ctx.liveCandleTs.current = toUnixMs(buffered.timestamp);
  } catch {
    /* safe to ignore — timestamp may be older than series */
  }
}

// If the freshest bar is >2 intervals stale, schedule one delayed refetch to
// close the gap before any live CandleUpdate paints over it. Throttled to 3 s.
function scheduleStaleRefetch(
  chartData: CandlestickData<Time>[],
  ctx: RtCtx,
): (() => void) | undefined {
  const lastBarSec = (chartData[chartData.length - 1]?.time as number) ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);
  if (lastBarSec <= 0 || nowSec - lastBarSec <= intervalSecOf(ctx.timeframe) * 2) return undefined;
  const now = Date.now();
  if (now - ctx.gapAt.current <= 3_000) return undefined;
  ctx.gapAt.current = now;
  const { symbol, timeframe, qc } = ctx;
  const timer = window.setTimeout(() => {
    qc.invalidateQueries({ queryKey: queryKeys.market.candles(symbol, timeframe) });
  }, 1_500);
  return () => window.clearTimeout(timer);
}

// ── Position / order overlay helpers ─────────────────────────────────────────

type SlTpField = "takeProfit" | "stopLoss";
interface SlTpEntry {
  line: IPriceLine;
  price: number;
  positionId: string;
  field: SlTpField;
  side: string;
  entryPrice: number;
  quantity: number;
}
type SlTpMap = Map<string, SlTpEntry>;
interface OverlayOpts {
  symbol: string;
  colors: ChartColors;
  contractSize: number;
}

function clearPriceLines(series: ISeriesApi<SeriesType>, list: IPriceLine[]): void {
  for (const pl of list) {
    try {
      series.removePriceLine(pl);
    } catch {
      /* ignore */
    }
  }
}

// One SL or TP line for a position, registered in the drag-to-edit map.
function addSlTpLine(
  series: ISeriesApi<SeriesType>,
  pos: Position,
  field: SlTpField,
  price: number,
  pnl: number,
  out: IPriceLine[],
  map: SlTpMap,
  colors: ChartColors,
): void {
  const isTp = field === "takeProfit";
  const line = series.createPriceLine({
    price,
    color: isTp ? colors.tpLine : colors.slLine,
    lineWidth: 2,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: `${isTp ? "TP" : "SL"}  ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
  });
  out.push(line);
  map.set(`${pos.id}:${isTp ? "tp" : "sl"}`, {
    line,
    price,
    positionId: pos.id,
    field,
    side: pos.side,
    entryPrice: pos.entryPrice,
    quantity: pos.quantity,
  });
}

function addPositionOverlay(
  series: ISeriesApi<SeriesType>,
  pos: Position,
  opts: OverlayOpts,
  out: IPriceLine[],
  map: SlTpMap,
): void {
  if (pos.symbolName !== opts.symbol || !Number.isFinite(pos.entryPrice)) return;
  out.push(
    series.createPriceLine({
      price: pos.entryPrice,
      color: pos.side === "LONG" ? opts.colors.up : opts.colors.down,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: `${pos.side === "LONG" ? "buy" : "sell"} ${pos.quantity.toFixed(2)}`,
    }),
  );
  const direction = pos.side === "LONG" ? 1 : -1;
  const pnlAt = (target: number) =>
    parseFloat(
      ((target - pos.entryPrice) * direction * pos.quantity * opts.contractSize).toFixed(2),
    );
  if (typeof pos.takeProfit === "number" && Number.isFinite(pos.takeProfit)) {
    addSlTpLine(
      series,
      pos,
      "takeProfit",
      pos.takeProfit,
      pnlAt(pos.takeProfit),
      out,
      map,
      opts.colors,
    );
  }
  if (typeof pos.stopLoss === "number" && Number.isFinite(pos.stopLoss)) {
    addSlTpLine(series, pos, "stopLoss", pos.stopLoss, pnlAt(pos.stopLoss), out, map, opts.colors);
  }
}

function addOrderOverlay(
  series: ISeriesApi<SeriesType>,
  ord: Order,
  symbol: string,
  orderColor: string,
  out: IPriceLine[],
): void {
  if (
    ord.symbolName !== symbol ||
    ord.status !== "PENDING" ||
    !Number.isFinite(ord.price as number)
  ) {
    return;
  }
  out.push(
    series.createPriceLine({
      price: ord.price as number,
      color: orderColor,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `[P] ${ord.side} ${ord.type} ${ord.quantity}`,
    }),
  );
}

// ── Chart interaction handlers ───────────────────────────────────────────────

// Crosshair left the series — restore the legend to the latest live bar exactly
// once so it doesn't stay frozen on the last hovered candle.
function restoreLegendOnLeave(
  restored: Ref<boolean>,
  lastCandle: Ref<CandlestickData<Time> | null>,
  legendVol: Ref<number>,
  setLegend: Dispatch<SetStateAction<OhlcvLegend | null>>,
): void {
  if (!restored.current && lastCandle.current) {
    setLegend(candleToLegend(lastCandle.current, legendVol.current));
  }
  restored.current = true;
}

// ── Replay trade-event marker helpers ────────────────────────────────────────

type ReplayTradeEvent = NonNullable<ChartPanelProps["replayTradeEvents"]>[number];

function entryMarker(ev: ReplayTradeEvent, time: Time): SeriesMarker<Time> {
  const isBuy = ev.side === "BUY";
  return {
    time,
    position: isBuy ? "belowBar" : "aboveBar",
    color: isBuy ? "#2196F3" : "#FF9800",
    shape: isBuy ? "arrowUp" : "arrowDown",
    text: isBuy ? "B" : "S",
  };
}

function exitMarker(ev: ReplayTradeEvent, time: Time): SeriesMarker<Time> {
  const profit = ev.pnl != null && ev.pnl >= 0;
  const text = ev.pnl != null ? `${ev.pnl >= 0 ? "+" : ""}$${Math.abs(ev.pnl).toFixed(0)}` : "Exit";
  return {
    time,
    position: profit ? "aboveBar" : "belowBar",
    color: profit ? "#0ecb81" : "#f6465d",
    shape: "circle",
    text,
  };
}

function buildReplayMarker(ev: ReplayTradeEvent, timeframe: Timeframe): SeriesMarker<Time> | null {
  const evMs = new Date(ev.timestamp).getTime();
  if (Number.isNaN(evMs)) return null;
  const time = getCandleBucketTime(evMs, timeframe) as Time;
  if (ev.type === "entry") return entryMarker(ev, time);
  if (ev.type === "exit") return exitMarker(ev, time);
  return {
    time,
    position: "aboveBar",
    color: "#FF1744",
    shape: "square",
    text: ev.ruleCode ?? "Rule",
  };
}

// ── HUD presentational sub-components ────────────────────────────────────────
// Extracted so the legend's per-value colour ternaries live here instead of
// inflating the ChartPanel render function's cognitive complexity.

function OhlcvCell({
  label,
  value,
  digits,
  up,
  bold,
}: {
  label: string;
  value: number;
  digits: number;
  up: boolean;
  bold?: boolean;
}) {
  return (
    <>
      <span className="text-muted-foreground/70">{label}</span>
      <span
        className={cn(
          up ? "text-[#0ecb81]" : "text-[#f6465d]",
          bold ? "font-semibold" : "font-medium",
        )}
      >
        {typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"}
      </span>
    </>
  );
}

function OhlcvLegendRow({ legend, pipDigits }: { legend: OhlcvLegend; pipDigits: number }) {
  const up = legend.c >= legend.o;
  return (
    <>
      <OhlcvCell label="O" value={legend.o} digits={pipDigits} up={up} />
      <OhlcvCell label="H" value={legend.h} digits={pipDigits} up={up} />
      <OhlcvCell label="L" value={legend.l} digits={pipDigits} up={up} />
      <OhlcvCell label="C" value={legend.c} digits={pipDigits} up={up} bold />
      <span
        className={cn("font-semibold", legend.change >= 0 ? "text-[#0ecb81]" : "text-[#f6465d]")}
      >
        {typeof legend.change === "number" && Number.isFinite(legend.change)
          ? `${legend.change >= 0 ? "+" : ""}${legend.change.toFixed(2)}%`
          : "—"}
      </span>
      {legend.v > 0 && (
        <>
          <span className="text-muted-foreground/70">V</span>
          <span className="text-foreground/60">{legend.v.toLocaleString()}</span>
        </>
      )}
    </>
  );
}

function BidAskRow({ tick, pipDigits }: { tick: TickData; pipDigits: number }) {
  const spread = ((tick.ask - tick.bid) * 10 ** pipDigits).toFixed(1);
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="text-muted-foreground/50">Bid</span>
      <span className="text-[#0ecb81]/80">{tick.bid.toFixed(pipDigits)}</span>
      <span className="text-muted-foreground/50">Ask</span>
      <span className="text-[#f6465d]/80">{tick.ask.toFixed(pipDigits)}</span>
      <span className="text-muted-foreground/50">Spread</span>
      <span className="text-foreground/50">{spread}</span>
    </div>
  );
}

// Interactive TradingView-style legend: symbol search, interval menu, market
// status, OHLCV row, per-indicator rows with hide/remove, and a navigation
// toolbar. Extracted so the visibility branching doesn't inflate ChartPanel.
function ChartLegendHeader({
  selectedSymbol,
  timeframe,
  onTimeframeChange,
  intervalFavorites,
  onToggleIntervalFavorite,
  symbols,
  legend,
  countdown,
  tick,
  pipDigits,
  showOhlcLegend,
  showCountdown,
  symbolCategory,
  activeIndicators,
  hiddenIndicators,
  onToggleIndicatorHidden,
  onToggleIndicator,
  collapsed,
  onToggleCollapsed,
}: {
  selectedSymbol: string;
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  intervalFavorites: Timeframe[];
  onToggleIntervalFavorite?: (tf: Timeframe) => void;
  symbols: Array<{ id?: string; name: string; displayName?: string | null; category?: string; assetClass?: string }>;
  legend: OhlcvLegend | null;
  countdown: string;
  tick?: TickData;
  pipDigits: number;
  showOhlcLegend: boolean;
  showCountdown: boolean;
  symbolCategory?: string;
  activeIndicators: IndicatorType[];
  hiddenIndicators: IndicatorType[];
  onToggleIndicatorHidden: (type: IndicatorType) => void;
  onToggleIndicator?: (type: IndicatorType) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const upper = (symbolCategory || "").toUpperCase();
  const marketLabel =
    upper === "CRYPTO"
      ? "Market open · 24/7"
      : tick
        ? "Market open · live"
        : "Waiting for data";

  return (
    <div className="absolute top-2 left-3 z-10 select-none flex flex-col items-start gap-1 max-w-[calc(100%-6rem)]">
      <div
        role="toolbar"
        aria-label="Chart legend"
        className="flex items-center gap-1.5 text-[11px] font-mono leading-none bg-background/40 backdrop-blur-[2px] rounded-md px-1 py-0.5"
      >
        <SymbolSearch
          symbols={symbols}
          selectedSymbol={selectedSymbol}
          onSymbolChange={() => {}}
          compact
          align="left"
        />
        <span className="text-muted-foreground/50">·</span>
        <IntervalMenu
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange ?? (() => {})}
          favorites={intervalFavorites}
          onToggleFavorite={onToggleIntervalFavorite ?? (() => {})}
        />
        <span
          className="hidden md:inline text-[10px] text-muted-foreground/70 px-1.5 py-0.5 rounded bg-secondary/60"
          title={marketLabel}
        >
          {marketLabel}
        </span>
        {legend && showOhlcLegend && <OhlcvLegendRow legend={legend} pipDigits={pipDigits} />}
        {countdown && showCountdown && (
          <span className="text-muted-foreground/60 flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5 opacity-50" />
            {countdown}
          </span>
        )}
        <button
          type="button"
          aria-label={collapsed ? "Show indicator legend" : "Hide indicator legend"}
          title={collapsed ? "Show indicator legend" : "Hide indicator legend"}
          onClick={onToggleCollapsed}
          className="p-0.5 rounded text-muted-foreground/60 hover:bg-secondary/70 hover:text-foreground"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {tick && <BidAskRow tick={tick} pipDigits={pipDigits} />}

      {!collapsed && activeIndicators.length > 0 && (
        <div className="flex flex-col items-start gap-0.5 bg-background/40 backdrop-blur-[2px] rounded-md px-1 py-0.5">
          {activeIndicators.map((type) => {
            const meta = INDICATOR_REGISTRY.find((ind) => ind.type === type);
            if (!meta) return null;
            const isHidden = hiddenIndicators.includes(type);
            return (
              <div
                key={type}
                className="flex items-center gap-1.5 text-[10px] font-mono leading-none px-0.5"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ backgroundColor: meta.color, opacity: isHidden ? 0.3 : 1 }}
                />
                <span className={cn("font-medium", isHidden && "text-muted-foreground/50 line-through")}>
                  {meta.label}
                </span>
                <span className="text-muted-foreground/50 hidden md:inline">
                  {meta.pane === "overlay" ? "overlay" : "pane"}
                </span>
                <button
                  type="button"
                  aria-label={isHidden ? `Show ${meta.label}` : `Hide ${meta.label}`}
                  title={isHidden ? "Show" : "Hide"}
                  onClick={() => onToggleIndicatorHidden(type)}
                  className="p-0.5 rounded text-muted-foreground/60 hover:bg-secondary/70 hover:text-foreground"
                >
                  {isHidden ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                </button>
                {onToggleIndicator && (
                  <button
                    type="button"
                    aria-label={`Remove ${meta.label}`}
                    title="Remove"
                    onClick={() => onToggleIndicator(type)}
                    className="p-0.5 rounded text-muted-foreground/60 hover:bg-secondary/70 hover:text-foreground"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

// Zoom/scroll controls, bottom-right like TradingView's — kept out of the
// top-left legend because the floating drawing toolbar owns that corner.
function ChartNavToolbar({
  onZoomIn,
  onZoomOut,
  onScrollLeft,
  onScrollRight,
  onScrollToRealTime,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onScrollLeft: () => void;
  onScrollRight: () => void;
  onScrollToRealTime: () => void;
}) {
  const items = [
    { label: "Zoom in", icon: ZoomIn, action: onZoomIn },
    { label: "Zoom out", icon: ZoomOut, action: onZoomOut },
    { label: "Scroll to the left", icon: ChevronLeft, action: onScrollLeft },
    { label: "Scroll to the right", icon: ChevronRight, action: onScrollRight },
    { label: "Scroll to the most recent bar", icon: ChevronsRight, action: onScrollToRealTime },
  ];
  return (
    <div
      role="toolbar"
      aria-label="Chart navigation"
      className="absolute bottom-9 right-3 z-10 flex items-center gap-0.5 bg-background/60 backdrop-blur-[2px] border border-border/60 rounded-md px-0.5 py-0.5"
    >
      {items.map(({ label, icon: Icon, action }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          onClick={action}
          className="p-1 rounded text-muted-foreground/70 hover:bg-secondary/70 hover:text-foreground"
        >
          <Icon className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}

// Floating toolbar / settings dialog for the currently selected drawing.
// Extracted so the selection branching doesn't inflate ChartPanel's CC.
function DrawingOverlays({
  drawing,
  showSettings,
  currentTf,
  onUpdate,
  onClone,
  onRemove,
  onOpenSettings,
  onCloseSettings,
}: {
  drawing: DrawingLine | null;
  showSettings: boolean;
  currentTf: string;
  onUpdate: (d: DrawingLine) => void;
  onClone: () => void;
  onRemove: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  if (!drawing) return null;
  if (showSettings) {
    return (
      <DrawingSettingsDialog
        drawing={drawing}
        currentTf={currentTf}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onClose={onCloseSettings}
      />
    );
  }
  return (
    <DrawingFloatingToolbar
      drawing={drawing}
      onUpdate={onUpdate}
      onClone={onClone}
      onRemove={onRemove}
      onOpenSettings={onOpenSettings}
    />
  );
}

// Object-tree toggle button + panel. Extracted so the open/close branching
// doesn't inflate ChartPanel's cognitive complexity.
function ObjectTreeOverlay({
  drawings,
  selectedIds,
  pipDigits,
  currentTf,
  open,
  onToggle,
  onSelect,
  onUpdate,
  onRemove,
  onReorder,
}: {
  drawings: DrawingLine[];
  selectedIds: string[];
  pipDigits: number;
  currentTf: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (d: DrawingLine) => void;
  onUpdate: (d: DrawingLine) => void;
  onRemove: (id: string) => void;
  onReorder: (d: DrawingLine, dir: "front" | "back") => void;
}) {
  if (drawings.length === 0) return null;
  return (
    <>
      <button
        type="button"
        title="Object tree (drawings)"
        onClick={onToggle}
        className={cn(
          "absolute bottom-2 left-2 z-10 p-1.5 rounded-md border border-border bg-card/90 shadow",
          open ? "text-primary" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <ListTree className="h-3.5 w-3.5" />
      </button>
      {open && (
        <ObjectTreePanel
          drawings={drawings}
          selectedIds={selectedIds}
          pipDigits={pipDigits}
          currentTf={currentTf}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onReorder={onReorder}
          onClose={onToggle}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// CHART PANEL (lightweight-charts)
// ═══════════════════════════════════════════════════════════

export function ChartPanel({
  candles,
  selectedSymbol,
  timeframe,
  isDark,
  activeIndicators,
  onTimeframeChange,
  symbols = [],
  onToggleIndicator,
  intervalFavorites = [],
  onToggleIntervalFavorite,
  drawingTool,
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onUpdateDrawings,
  onRemoveDrawing,
  onDrawingComplete,
  onDrawingToolSelect,
  onUndoDrawing,
  onRedoDrawing,
  magnetMode = "none",
  onSetMagnet,
  onToggleStayInDrawingMode,
  stayInDrawingMode = false,
  positions,
  orders,
  tick,
  liveCandle,
  pipDigits,
  symbolInfo,
  onModifyPosition,
  replayTradeEvents,
  activePlugins = [],
  onTogglePlugin,
  accountEquity = 0,
  accountId,
  onQuickOrder,
  onClearDrawings,
  onClearIndicators,
  isReplaying = false,
}: ChartPanelProps) {
  const queryClient = useQueryClient();
  const lastGapRefetchAtRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // Maps OHLC bars to the shape the active main series consumes (line-style
  // series take {time, value}). Kept beside the ref so every write path —
  // setData, live updates, replay — uses the same mapping.
  const mainSeriesAdapterRef = useRef<(bar: CandlestickData<Time>) => MainSeriesData>(
    (bar) => bar,
  );

  // Scroll-triggered historical extension — older bars prepended as the user
  // scrolls left past what the initial deep-fetch already loaded.
  const [historicalExtra, setHistoricalExtra] = useState<{ view: string; bars: Candle[] }>({
    view: `${selectedSymbol}:${timeframe}`,
    bars: [],
  });
  const loadMoreRef = useRef<LoadMoreState>({
    loading: false,
    noMoreData: false,
    lastFetchedBeforeMs: 0,
    fetchFromMs: 0,
    emptyWindows: 0,
  });
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLineRef = useRef<IPriceLine[]>([]);
  const drawingManagerRef = useRef<DrawingToolsManager | null>(null);
  // Current timeframe mirrored in a ref so the persistent chart's history
  // loader always fetches the active TF (the chart is no longer recreated on
  // TF change — see the TF-change effect below).
  const timeframeRef = useRef(timeframe);
  const chartPluginsRef = useRef<ISeriesPrimitive<Time>[]>([]);
  const bidLineRef = useRef<IPriceLine | null>(null);
  const askLineRef = useRef<IPriceLine | null>(null);
  const midLineRef = useRef<IPriceLine | null>(null);

  // ── SL/TP drag-to-edit state ──
  const slTpLinesRef = useRef<SlTpMap>(new Map());

  // Increments every time the chart instance is (re)created. Hooks that bind
  // DOM/series listeners (SL/TP drag, challenge levels) depend on this so they
  // re-bind against the live chart — without it they'd capture null refs on
  // mount (the create-effect runs after them) and never attach.
  const [chartEpoch, setChartEpoch] = useState(0);

  // OHLCV legend state
  const [legend, setLegend] = useState<OhlcvLegend | null>(null);
  // Indicator legend controls: hidden series stay computed but unpainted,
  // and the whole rows block can collapse like TradingView's legend.
  const [hiddenIndicators, setHiddenIndicators] = useState<IndicatorType[]>([]);
  const [indicatorLegendCollapsed, setIndicatorLegendCollapsed] = useState(false);
  const toggleIndicatorHidden = useCallback((type: IndicatorType) => {
    setHiddenIndicators((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);
  const paintedIndicators = useMemo(
    () => activeIndicators.filter((t) => !hiddenIndicators.includes(t)),
    [activeIndicators, hiddenIndicators],
  );
  // Bottom bar: active range tab + go-to-date popover. The pending range is
  // applied from the data effect once the paired interval's history lands.
  const [activeRangeTab, setActiveRangeTab] = useState<string | null>(null);
  const [goToDateOpen, setGoToDateOpen] = useState(false);
  const pendingRangeRef = useRef<{ bars: number | null } | null>(null);
  const barsForNavRef = useRef<CandlestickData<Time>[]>([]);
  // Candle countdown state. `countdownText` blanks it for timeframes that have
  // no meaningful countdown (1d, 1w) instead of the timer effect clearing state.
  const [countdown, setCountdown] = useState("");
  const countdownIntervalMs = TF_INTERVAL_MS[timeframe];
  const countdownText =
    countdownIntervalMs && countdownIntervalMs < 86_400_000 ? countdown : "";
  // True once the legend has been restored to the latest bar after the crosshair
  // left the series — prevents re-setting (and re-rendering) on every off-series
  // mouse move while the cursor sits outside the plotted data.
  const legendRestoredRef = useRef(true);

  const chartPrefs = useChartPreferences();
  // Mirror of chartPrefs.chartType read inside imperative chart callbacks.
  // Declared before the chart-creation effect so the sync runs first and the
  // created series matches the preference on the same commit.
  const chartTypeRef = useRef<ChartType>(chartPrefs.chartType);
  useEffect(() => {
    chartTypeRef.current = chartPrefs.chartType;
  }, [chartPrefs.chartType]);
  // Theme palette with the user's Chart Settings color overrides applied.
  // Everything downstream (chart options, bid/ask lines, position overlays,
  // volume bars) reads from this merged object.
  const colors = useMemo(
    () => mergeChartColors(isDark ? CHART_COLORS.dark : CHART_COLORS.light, chartPrefs),
    [isDark, chartPrefs],
  );

  // Scroll-loaded history is tagged with the view it belongs to, so a symbol
  // or timeframe change drops it during render rather than from a reset effect
  // — stale out-of-range candles can never be mixed into the new view, not even
  // for one frame. The imperative loader state is reset in the same effect that
  // rebuilds the loader (below).
  useEffect(() => {
    // Async so the mutation happens after commit rather than in the body.
    const id = setTimeout(() => {
      loadMoreRef.current = {
        loading: false,
        noMoreData: false,
        lastFetchedBeforeMs: 0,
        fetchFromMs: 0,
        emptyWindows: 0,
      };
      lastGapRefetchAtRef.current = 0;
    }, 0);
    return () => clearTimeout(id);
  }, [selectedSymbol, timeframe]);

  // ── Drawing selection (floating toolbar / settings dialog / object tree) ──
  const [selectedDrawingIds, setSelectedDrawingIds] = useState<string[]>([]);
  const [showDrawingSettings, setShowDrawingSettings] = useState(false);
  const [showObjectTree, setShowObjectTree] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  // ── Chart-wide context menu + settings dialog ──
  // When a right-click lands on a drawing the DrawingToolsManager opens the
  // drawing menu and sets this flag synchronously (native listeners fire before
  // React's delegated onContextMenu), so the chart menu stays closed.
  const drawingMenuOpenedRef = useRef(false);
  const [chartMenu, setChartMenu] = useState<{ x: number; y: number; price: number | null } | null>(
    null,
  );
  const [showChartSettings, setShowChartSettings] = useState(false);
  // The style toolbar / settings dialog only apply to a single selection.
  const selectedDrawing = useMemo(
    () =>
      selectedDrawingIds.length === 1
        ? (drawings.find((d) => d.id === selectedDrawingIds[0]) ?? null)
        : null,
    [drawings, selectedDrawingIds],
  );

  // Drawings actually shown on this chart: not hidden, and either visible on
  // all timeframes or scoped to the current one.
  const visibleDrawings = useMemo(
    () => drawings.filter((d) => !d.hidden && (d.visibility !== "tf" || d.createdTf === timeframe)),
    [drawings, timeframe],
  );

  // Stable refs so the chart-create effect doesn't re-run on every parent render
  // when these props are unstable (e.g. inline onAddDrawing).
  const drawingToolRef = useRef(drawingTool);
  const drawingsRef = useRef(visibleDrawings);
  const magnetRef = useRef(magnetMode);
  const stayInModeRef = useRef(stayInDrawingMode);
  const accountEquityRef = useRef(accountEquity);
  const styleDefaultsRef = useRef(getStyleDefaults());
  const onAddDrawingRef = useRef(onAddDrawing);
  const onUpdateDrawingRef = useRef(onUpdateDrawing);
  const onUpdateDrawingsRef = useRef(onUpdateDrawings);
  const onRemoveDrawingRef = useRef(onRemoveDrawing);
  const onDrawingCompleteRef = useRef(onDrawingComplete);
  const onDrawingToolSelectRef = useRef(onDrawingToolSelect);
  const onUndoDrawingRef = useRef(onUndoDrawing);
  const onRedoDrawingRef = useRef(onRedoDrawing);
  useEffect(() => {
    drawingToolRef.current = drawingTool;
    drawingManagerRef.current?.setTool(drawingTool);
  }, [drawingTool]);
  useEffect(() => {
    drawingsRef.current = visibleDrawings;
    drawingManagerRef.current?.setDrawings(visibleDrawings);
  }, [visibleDrawings]);
  useEffect(() => {
    magnetRef.current = magnetMode;
    drawingManagerRef.current?.setMagnetMode(magnetMode);
  }, [magnetMode]);
  useEffect(() => {
    accountEquityRef.current = accountEquity;
    drawingManagerRef.current?.setAccountEquity(accountEquity);
  }, [accountEquity]);
  useEffect(() => {
    const refresh = () => {
      styleDefaultsRef.current = getStyleDefaults();
      drawingManagerRef.current?.setStyleDefaults(styleDefaultsRef.current);
    };
    window.addEventListener(DRAWING_STYLES_EVENT, refresh);
    return () => window.removeEventListener(DRAWING_STYLES_EVENT, refresh);
  }, []);
  useEffect(() => {
    stayInModeRef.current = stayInDrawingMode;
    drawingManagerRef.current?.setStayInDrawingMode(stayInDrawingMode);
  }, [stayInDrawingMode]);
  useEffect(() => {
    onAddDrawingRef.current = onAddDrawing;
    onUpdateDrawingRef.current = onUpdateDrawing;
    onUpdateDrawingsRef.current = onUpdateDrawings;
    onRemoveDrawingRef.current = onRemoveDrawing;
    onDrawingCompleteRef.current = onDrawingComplete;
    onDrawingToolSelectRef.current = onDrawingToolSelect;
    onUndoDrawingRef.current = onUndoDrawing;
    onRedoDrawingRef.current = onRedoDrawing;
  });

  // Clone the selected drawing, offset 5 bars right so the copy is visible.
  const handleCloneDrawing = useCallback(() => {
    const d = selectedDrawing;
    if (!d) return;
    const offsetSec = ((TF_INTERVAL_MS[timeframe] ?? 60_000) / 1000) * 5;
    onAddDrawing({
      ...d,
      id: crypto.randomUUID(),
      time: d.time != null ? d.time + offsetSec : undefined,
      time2: d.time2 != null ? d.time2 + offsetSec : undefined,
    });
  }, [selectedDrawing, timeframe, onAddDrawing]);

  // Z-order: bring to front = above the current max, send to back = below min.
  const handleReorderDrawing = useCallback(
    (d: DrawingLine, dir: "front" | "back") => {
      const zs = drawings.map((x) => x.zIndex ?? 0);
      const zIndex = dir === "front" ? Math.max(...zs, 0) + 1 : Math.min(...zs, 0) - 1;
      onUpdateDrawing?.({ ...d, zIndex });
    },
    [drawings, onUpdateDrawing],
  );

  // Object-tree row click → select on the chart (no-op for drawings that are
  // hidden or scoped off this timeframe, since the manager doesn't know them).
  const handleObjectTreeSelect = useCallback((d: DrawingLine) => {
    drawingManagerRef.current?.setSelection([d.id]);
  }, []);

  // ── Extracted hooks ────────────────────────────────────────
  // Merge scroll-loaded historical extension (older) with the live data (newer).
  // useChartData deduplicates by timestamp, so overlap is safe.
  const allCandles = useMemo(() => {
    // Bars loaded for a different symbol/timeframe are discarded during render,
    // so a view switch can never mix stale out-of-range candles into the chart.
    const extra =
      historicalExtra.view === `${selectedSymbol}:${timeframe}` ? historicalExtra.bars : [];
    return extra.length === 0 ? candles : [...extra, ...candles];
  }, [historicalExtra, candles, selectedSymbol, timeframe]);
  const { chartData, volumeData } = useChartData(allCandles, colors);

  const {
    newsConfig,
    setNewsConfig,
    showNewsConfigDialog,
    setShowNewsConfigDialog,
    newsPopup,
    setNewsPopup,
  } = useNewsOverlay(containerRef, chartRef, selectedSymbol, isDark, chartData);

  const dragPrice = useSlTpDrag(
    containerRef,
    chartRef,
    candleSeriesRef,
    slTpLinesRef,
    drawingTool,
    onModifyPosition,
    pipDigits,
    symbolInfo,
    chartEpoch,
  );

  // ── Challenge-aware rule levels (daily loss / max DD / profit target) ──
  const challengeFlags = useMemo(
    () => ({
      enabled: chartPrefs.challengeOverlay && !!accountId && !isHyperliquidMode(),
      dailyLoss: chartPrefs.challengeDailyLossLine,
      maxDrawdown: chartPrefs.challengeMaxDrawdownLine,
      profitTarget: chartPrefs.challengeProfitTargetLine,
    }),
    [
      chartPrefs.challengeOverlay,
      chartPrefs.challengeDailyLossLine,
      chartPrefs.challengeMaxDrawdownLine,
      chartPrefs.challengeProfitTargetLine,
      accountId,
    ],
  );
  useChallengeLevels({
    accountId,
    selectedSymbol,
    positions,
    tick,
    contractSize: symbolInfo?.contractSize || 100000,
    accountEquity,
    candleSeriesRef,
    flags: challengeFlags,
    chartEpoch,
  });

  // ── Chart context-menu actions ──
  const handleChartContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (drawingMenuOpenedRef.current) {
      drawingMenuOpenedRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = candleSeriesRef.current?.coordinateToPrice(e.clientY - rect.top);
    const price = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
    setChartMenu({ x: e.clientX, y: e.clientY, price });
  }, []);

  // ── Legend navigation toolbar (zoom + scroll via the time scale) ──
  const handleLegendZoomIn = useCallback(() => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    ts.applyOptions({ barSpacing: Math.min((ts.options().barSpacing || 6) * 1.3, 120) });
  }, []);
  const handleLegendZoomOut = useCallback(() => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    ts.applyOptions({ barSpacing: Math.max((ts.options().barSpacing || 6) / 1.3, 0.5) });
  }, []);
  const handleLegendScrollLeft = useCallback(() => {
    chartRef.current?.timeScale().scrollToPosition(-120, false);
  }, []);
  const handleLegendScrollRight = useCallback(() => {
    chartRef.current?.timeScale().scrollToPosition(120, false);
  }, []);
  const handleLegendScrollToRealTime = useCallback(() => {
    chartRef.current?.timeScale().scrollToRealTime();
  }, []);

  const handleRangePick = useCallback(
    (tab: { tab: string; tf: Timeframe; bars: number | null }) => {
      pendingRangeRef.current = { bars: tab.bars };
      setActiveRangeTab(tab.tab);
      if (tab.tf !== timeframe && !isReplaying) onTimeframeChange?.(tab.tf);
    },
    [timeframe, isReplaying, onTimeframeChange],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        setGoToDateOpen((v) => !v);
      } else if (e.key === "Escape") {
        setGoToDateOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const handleGoToDate = useCallback(
    (date: string) => {
      const ts = Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
      if (Number.isNaN(ts)) return;
      const bars = barsForNavRef.current;
      const idx = bars.findIndex((bar) => (bar.time as number) >= ts);
      if (idx < 0) {
        toast.info("No loaded data around that date", "Scroll back or pick a closer date.");
        setGoToDateOpen(false);
        return;
      }
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, idx - 10),
        to: Math.min(bars.length + 5, idx + 20),
      });
      setGoToDateOpen(false);
    },
    [],
  );

  const handleResetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.timeScale().resetTimeScale();
    chart.priceScale("right").applyOptions({ autoScale: true });
    chart.timeScale().scrollToRealTime();
  }, []);

  const handleCopyPrice = useCallback(
    (price: number) => {
      const text = price.toFixed(pipDigits);
      void navigator.clipboard
        ?.writeText(text)
        .then(() => toast.success("Copied", text))
        .catch(() => toast.error("Copy failed", "Clipboard unavailable"));
    },
    [pipDigits],
  );

  const handleAddAlert = useCallback(
    (price: number) => {
      const rounded = parseFloat(price.toFixed(pipDigits));
      onAddDrawing({
        id: crypto.randomUUID(),
        type: "horizontal",
        price: rounded,
        color: "#f0b90b",
        alertEnabled: true,
        createdTf: timeframe,
      });
      toast.info("Alert set", `${selectedSymbol} at ${rounded}`);
    },
    [onAddDrawing, pipDigits, timeframe, selectedSymbol],
  );

  useIndicators(chartRef, candleSeriesRef, chartData, paintedIndicators, isDark);

  // ── Replay trade event markers ─────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    if (!replayTradeEvents || replayTradeEvents.length === 0) {
      series.setMarkers([]);
      return;
    }
    const markers: SeriesMarker<Time>[] = [];
    for (const ev of replayTradeEvents) {
      const marker = buildReplayMarker(ev, timeframe);
      if (marker) markers.push(marker);
    }
    // lightweight-charts requires markers sorted by time ascending
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    series.setMarkers(markers);
    return () => {
      series.setMarkers([]);
    };
  }, [replayTradeEvents, timeframe]);

  // ── Candle close countdown timer ───────────────────────────
  // Daily and weekly bars get no countdown; that is decided when rendering the
  // legend (see `countdownText`) so the effect never has to blank the state.
  useEffect(() => {
    const intervalMs = TF_INTERVAL_MS[timeframe];
    if (!intervalMs || intervalMs >= 86_400_000) return;
    const tick = () => {
      const now = Date.now();
      const currentBucketStart = Math.floor(now / intervalMs) * intervalMs;
      const nextBucketStart = currentBucketStart + intervalMs;
      const remainingSec = Math.max(0, (nextBucketStart - now) / 1000);
      setCountdown(formatCountdown(remainingSec));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeframe]);

  // ── Create / destroy the chart instance ────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const minMove = getMinMove(pipDigits);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: colors.grid, style: LineStyle.Dotted },
        horzLines: { color: colors.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: colors.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#363a45",
          labelVisible: true,
        },
        horzLine: {
          color: colors.crosshair,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#363a45",
          labelVisible: true,
        },
      },
      rightPriceScale: {
        borderColor: colors.grid,
        scaleMargins: { top: 0.06, bottom: 0.18 },
        autoScale: true,
        alignLabels: true,
        borderVisible: true,
        entireTextOnly: false,
        ticksVisible: true,
        minimumWidth: 80,
      },
      timeScale: {
        borderColor: colors.grid,
        timeVisible: true,
        secondsVisible: timeframeRef.current === "1m",
        rightOffset: timeframeRef.current === "1m" ? 10 : 6,
        minBarSpacing: 0.5,
        fixLeftEdge: false,
        fixRightEdge: false,
        borderVisible: true,
      },
      watermark: {
        visible: true,
        text: selectedSymbol,
        fontSize: 56,
        color: colors.watermark,
        horzAlign: "center",
        vertAlign: "center",
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
      },
    });

    chartRef.current = chart;

    // Main series — kind follows the chart-type preference. Every write path
    // maps OHLC through mainSeriesAdapterRef, so line-family types receive
    // {time, value} while candle/bar types receive the bar unchanged.
    const kind = chartSeriesType(chartTypeRef.current);
    const candleSeries = createMainSeries(chart, kind, {
      colors,
      precision: pipDigits,
      minMove,
      showWicks: chartPrefs.showWicks,
      showBorders: chartPrefs.showCandleBorders,
    });
    candleSeriesRef.current = candleSeries;
    mainSeriesAdapterRef.current = (bar) => toMainSeriesData(chartTypeRef.current, bar);

    // Volume histogram at the bottom of the chart
    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // Subscribe to crosshair move for OHLCV legend
    chart.subscribeCrosshairMove((param) => {
      if (!param?.time) {
        restoreLegendOnLeave(legendRestoredRef, lastCandleRef, legendVolRef, setLegend);
        return;
      }
      legendRestoredRef.current = false;
      const data = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
      // Line-family chart types return {time, value} points without OHLC —
      // building a legend from those would poison every cell with undefined.
      // Skip the update so the legend keeps showing the latest candle.
      if (data && typeof data.open === "number" && typeof data.close === "number") {
        const vol = param.seriesData.get(volumeSeries) as HistogramData<Time> | undefined;
        setLegend(candleToLegend(data, vol?.value || 0));
      }
    });

    // Handle resize
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(containerRef.current);

    // Interactive drawing layer (place / preview / select / drag / delete) —
    // callbacks go through refs so the create-effect doesn't depend on them.
    const drawingManager = new DrawingToolsManager({
      chart,
      series: candleSeries,
      container: containerRef.current,
      intervalSec: (TF_INTERVAL_MS[timeframeRef.current] ?? 60_000) / 1000,
      timeframe: timeframeRef.current,
      accountEquity: accountEquityRef.current,
      callbacks: {
        onAdd: (d) => onAddDrawingRef.current(d),
        onUpdate: (d) => onUpdateDrawingRef.current?.(d),
        onUpdateMany: (drawings) => {
          if (onUpdateDrawingsRef.current) onUpdateDrawingsRef.current(drawings);
          else for (const drawing of drawings) onUpdateDrawingRef.current?.(drawing);
        },
        onRemove: (id) => onRemoveDrawingRef.current?.(id),
        onToolFinished: () => onDrawingCompleteRef.current?.(),
        onSelectionChange: (ids) => {
          setSelectedDrawingIds(ids);
          setShowDrawingSettings(false);
        },
        onRequestSettings: (id) => {
          setSelectedDrawingIds([id]);
          setShowDrawingSettings(true);
        },
        onContextMenu: (id, clientX, clientY) => {
          drawingMenuOpenedRef.current = true;
          setSelectedDrawingIds([id]);
          setContextMenu({ id, x: clientX, y: clientY });
        },
        onSelectTool: (t) => onDrawingToolSelectRef.current?.(t),
        onUndo: () => onUndoDrawingRef.current?.(),
        onRedo: () => onRedoDrawingRef.current?.(),
      },
    });
    drawingManager.setDrawings(drawingsRef.current);
    drawingManager.setTool(drawingToolRef.current);
    drawingManager.setMagnetMode(magnetRef.current);
    drawingManager.setStyleDefaults(styleDefaultsRef.current);
    drawingManager.setStayInDrawingMode(stayInModeRef.current);
    drawingManagerRef.current = drawingManager;

    // Subscribe to time-scale scrolling so we can load older bars when the
    // user scrolls past the leftmost loaded candle (infinite history pattern).
    // `historyLoadCancelled` guards against a stale fetch resolving after a
    // symbol/timeframe/theme change: the cleanup sets it to true before
    // unsubscribing so any in-flight `onLoaded` callback is silently dropped.
    let historyLoadCancelled = false;
    const handleRangeChange = makeHistoryLoader(
      selectedSymbol,
      timeframeRef,
      candleSeriesRef,
      loadMoreRef,
      (bars) => {
        if (historyLoadCancelled) return;
        const view = `${selectedSymbol}:${timeframeRef.current}`;
        setHistoricalExtra((prev) =>
          prev.view === view
            ? { view, bars: [...bars, ...prev.bars] }
            : { view, bars: [...bars] },
        );
      },
    );
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);

    // Signal listener-binding hooks that a live chart instance now exists.
    setChartEpoch((e) => e + 1);

    return () => {
      historyLoadCancelled = true;
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      ro.disconnect();
      drawingManager.destroy();
      drawingManagerRef.current = null;
      setSelectedDrawingIds([]);
      setShowDrawingSettings(false);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      bidLineRef.current = null;
      askLineRef.current = null;
      midLineRef.current = null;
      chartPluginsRef.current = [];
      // Clear per-chart state so it doesn't bleed into the recreated chart
      // (theme toggle also destroys/recreates the chart instance).
      lastCandleRef.current = null;
      legendVolRef.current = 0;
      liveCandleTsRef.current = 0;
      loadMoreRef.current = {
        loading: false,
        noMoreData: false,
        emptyWindows: 0,
        lastFetchedBeforeMs: 0,
        fetchFromMs: 0,
      };
      lastGapRefetchAtRef.current = 0;
    };
  }, [
    isDark,
    pipDigits,
    colors,
    chartPrefs.chartType,
    chartPrefs.showWicks,
    chartPrefs.showCandleBorders,
    selectedSymbol,
  ]); // Re-create on theme / precision / symbol / chart-type change — NOT
  // timeframe (the chart persists across TF switches so drawings never blink
  // out; the TF-change effect below updates the live state in place,
  // TradingView-style).

  // Update watermark text when symbol changes (visibility comes from settings)
  useEffect(() => {
    chartRef.current?.applyOptions({
      watermark: {
        visible: chartPrefs.showWatermark,
        text: selectedSymbol,
        fontSize: 56,
        color: colors.watermark,
        horzAlign: "center",
        vertAlign: "center",
      },
    });
  }, [selectedSymbol, colors.watermark, chartPrefs.showWatermark, chartEpoch]);

  // ── Live appearance settings (no chart recreation) ──
  useEffect(() => {
    // `colors` already carries the user's overrides (mergeChartColors).
    const up = colors.up;
    const down = colors.down;
    if (!candleSeriesRef.current) return;
    if (!isCandleFamily(chartTypeRef.current)) {
      // Line-family series take a single stroke colour instead of up/down.
      const stroke = isDark ? colors.text : "#2962FF";
      candleSeriesRef.current.applyOptions({
        color: chartPrefs.candleUpColor || stroke,
        lineWidth: 2,
      } as Parameters<ISeriesApi<SeriesType>["applyOptions"]>[0]);
      return;
    }
    candleSeriesRef.current.applyOptions({
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      wickVisible: chartPrefs.showWicks,
      borderVisible: chartPrefs.showCandleBorders,
    } as Parameters<ISeriesApi<SeriesType>["applyOptions"]>[0]);
  }, [
    chartPrefs.chartType,
    chartPrefs.candleUpColor,
    chartPrefs.candleDownColor,
    chartPrefs.showWicks,
    chartPrefs.showCandleBorders,
    colors,
    isDark,
    chartEpoch,
  ]);

  useEffect(() => {
    volumeSeriesRef.current?.applyOptions({ visible: chartPrefs.showVolume });
  }, [chartPrefs.showVolume, chartEpoch]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: {
        vertLines: { visible: chartPrefs.showGrid },
        horzLines: { visible: chartPrefs.showGrid },
      },
    });
  }, [chartPrefs.showGrid, chartEpoch]);

  // Timeframe change — the chart instance is NOT recreated (so drawings stay
  // attached); instead we update the persistent chart's options and re-point
  // the drawing manager's interval/createdTf at the new TF in place.
  useEffect(() => {
    timeframeRef.current = timeframe;
    chartRef.current?.applyOptions({
      timeScale: {
        secondsVisible: timeframe === "1m",
        rightOffset: timeframe === "1m" ? 10 : 6,
        minBarSpacing: 0.5,
      },
    });
    drawingManagerRef.current?.updateTimeframe(
      timeframe,
      (TF_INTERVAL_MS[timeframe] ?? 60_000) / 1000,
    );
  }, [timeframe]);

  // ── Refs for smooth real-time streaming ────────────────
  const lastCandleRef = useRef<CandlestickData<Time> | null>(null);
  const lastLoadKeyRef = useRef<string>("");
  const latestLiveCandleRef = useRef<typeof liveCandle | undefined>(undefined);
  // Authoritative server candle timestamp, normalised to unix MILLISECONDS —
  // used to ignore ticks that pre-date the latest server CandleUpdate (those can
  // pollute H/L after a WS flush delivers a buffered tick *after* its
  // corresponding aggregated candle). Stored in ms so the tick guard compares
  // like-for-like regardless of whether the server emits seconds or ms.
  const liveCandleTsRef = useRef<number>(0);
  // Last known volume — needed to keep the volume bar coloured during tick
  // smoothing without overwriting the value with 0.
  const legendVolRef = useRef<number>(0);

  // Bundle the refs/config the real-time helpers need. Memoised so the live
  // effects can depend on `makeRtCtx` directly — it changes identity exactly when
  // colors / timeframe / symbol / queryClient change, so re-run timing matches
  // listing those values individually (refs and setLegend are stable).
  const makeRtCtx = useCallback(
    (series: ISeriesApi<SeriesType>): RtCtx => ({
      series,
      toData: (bar) => mainSeriesAdapterRef.current(bar),
      volume: volumeSeriesRef.current,
      lastCandle: lastCandleRef,
      liveCandleTs: liveCandleTsRef,
      legendVol: legendVolRef,
      gapAt: lastGapRefetchAtRef,
      bidLine: bidLineRef,
      askLine: askLineRef,
      midLine: midLineRef,
      colors,
      timeframe,
      symbol: selectedSymbol,
      qc: queryClient,
      setLegend,
    }),
    [colors, timeframe, selectedSymbol, queryClient],
  );

  // Keep latest live candle in a ref (avoids stale closure in setData effect)
  useEffect(() => {
    latestLiveCandleRef.current = liveCandle;
  }, [liveCandle]);

  // Update candle data from server (historical fetch / periodic sync)
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || chartData.length === 0) return;
    const ctx = makeRtCtx(series);
    const loadKey = `${selectedSymbol}:${timeframe}`;
    const isNewChart = lastLoadKeyRef.current !== loadKey;

    series.setData(
      chartData.map((bar) => mainSeriesAdapterRef.current(bar)) as CandlestickData<Time>[],
    );
    volumeSeriesRef.current?.setData(volumeData);
    barsForNavRef.current = chartData;
    const pending = pendingRangeRef.current;
    if (pending) {
      pendingRangeRef.current = null;
      if (pending.bars == null) {
        chartRef.current?.timeScale().fitContent();
      } else {
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: Math.max(0, chartData.length - pending.bars),
          to: chartData.length + 5,
        });
      }
    }
    // These two refs are bookkeeping for the lightweight-charts instance — the
    // external system this effect synchronises — not render state. The React
    // Compiler rule cannot tell the difference, and restructuring the real-time
    // sync around it would buy nothing but risk.
    // eslint-disable-next-line react-hooks/immutability
    lastCandleRef.current = chartData[chartData.length - 1] ?? null;
    setLegend(legendFromSeries(chartData, volumeData));

    const buffered = latestLiveCandleRef.current;
    if (!isNewChart) {
      // Periodic refetch — preserve viewport, re-apply latest live data.
      reapplyLive(buffered, ctx);
      return;
    }

    scrollOrFit(chartRef.current, chartData.length);
    lastLoadKeyRef.current = loadKey;
    // eslint-disable-next-line react-hooks/immutability
    liveCandleTsRef.current = 0;
    replayBufferedLive(buffered, chartData, ctx);
    return scheduleStaleRefetch(chartData, ctx);
  }, [chartData, volumeData, selectedSymbol, timeframe, makeRtCtx]);

  // ── Real-time candle updates ──────────────────────────

  // Primary: server-aggregated CandleUpdate events (OHLCV from candle aggregator).
  // No client-side throttle — the WS layer already batches at ~50ms; throttling
  // again here just adds latency without reducing render work (lightweight-charts
  // batches DOM writes internally and series.update is O(1)). The guard below
  // skips painting until history exists so a live WS candle can't render alone.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !liveCandle || !lastCandleRef.current) return;
    applyServerCandle(liveCandle, makeRtCtx(series));
  }, [liveCandle, makeRtCtx]);

  // Secondary: tick-based smoothing between server CandleUpdate pulses.
  // Server CandleUpdate is authoritative — when it arrives next it will
  // overwrite this tick-merged bar via series.update.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !tick) return;
    applyTick(tick, makeRtCtx(series));
  }, [tick, makeRtCtx]);

  // ── Line-cross price alerts (client-side, in-session) ──────────
  // Fire a toast + beep when the live mid price crosses an alert-enabled
  // horizontal line or trendline. Drawings are read from a ref so this runs
  // only on tick changes.
  const alertMidRef = useRef<number | null>(null);
  const alertFiredRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!tick) return;
    const mid = (tick.bid + tick.ask) / 2;
    const prev = alertMidRef.current;
    alertMidRef.current = mid;
    if (prev === null) return;
    const nowSec = Math.floor(tick.timestamp / 1000);
    const crossed = detectCrossings(drawingsRef.current, prev, mid, nowSec, alertFiredRef.current);
    for (const d of crossed) {
      toast.info(
        "Price alert",
        d.alertMessage ?? `${selectedSymbol} crossed your ${d.type} @ ${mid.toFixed(pipDigits)}`,
      );
      playAlertBeep();
    }
  }, [tick, selectedSymbol, pipDigits]);

  // ── Staleness watchdog ────────────────────────────────────────
  // Guards against the case where CandleUpdates stop arriving entirely
  // (data-provider disconnect, aggregator restart). Both the live-candle and
  // tick effects only run when their props change, so this interval is the
  // only recovery path when neither prop is updating.
  useEffect(() => {
    // Replay shows a historical slice — its last bar is hours or days old by
    // design, so the staleness check would fire a refetch loop. Skip it.
    if (isReplaying) return;
    const intervalSec = (TF_INTERVAL_MS[timeframe] ?? 60_000) / 1000;
    const id = setInterval(() => {
      if (!lastCandleRef.current) return;
      const staleSec = Date.now() / 1000 - (lastCandleRef.current.time as number);
      if (staleSec < intervalSec * 2) return;
      requestGapRefetch(lastGapRefetchAtRef, queryClient, selectedSymbol, timeframe);
    }, 30_000);
    return () => clearInterval(id);
  }, [selectedSymbol, timeframe, queryClient, isReplaying]);

  // ── Chart plugin overlays ──────────────────────────────────
  // Re-runs when active plugins change or the chart is recreated (isDark /
  // symbol / timeframe), so primitives are always attached to the live series.
  const symbolCategory = symbolInfo?.category;
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const series = candleSeriesRef.current;
    detachPlugins(series, chartPluginsRef.current);
    chartPluginsRef.current = [];
    attachPlugins(
      series,
      activePlugins,
      { isDark, timeframe, symbolCategory },
      chartPluginsRef.current,
    );
  }, [activePlugins, isDark, selectedSymbol, timeframe, symbolCategory, chartPrefs.chartType]);

  // ── Live bid/ask price tracking lines ──────────────────────
  // applyBidAskLines moves the existing price lines in-place (applyOptions) or
  // creates them — remove+create would force two full chart redraws per tick.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    applyBidAskLines(
      tick,
      { showBidLine: chartPrefs.showBidLine, showAskLine: chartPrefs.showAskLine },
      makeRtCtx(series),
    );
  }, [tick, chartPrefs.showBidLine, chartPrefs.showAskLine, makeRtCtx]);

  // ── Position/order overlays ────────────────────────────────
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const lines = priceLineRef.current;
    clearPriceLines(series, lines);
    priceLineRef.current = [];
    slTpLinesRef.current.clear();
    if (!chartPrefs.overlayPositionsOnChart) return;

    const opts: OverlayOpts = {
      symbol: selectedSymbol,
      colors,
      contractSize: symbolInfo?.contractSize || 100000,
    };
    for (const pos of positions) {
      addPositionOverlay(series, pos, opts, priceLineRef.current, slTpLinesRef.current);
    }
    for (const ord of orders) {
      addOrderOverlay(series, ord, selectedSymbol, colors.orderLine, priceLineRef.current);
    }
  }, [
    positions,
    orders,
    selectedSymbol,
    chartData,
    symbolInfo,
    colors,
    chartPrefs.overlayPositionsOnChart,
  ]);

  return (
    <div className="relative flex flex-col w-full h-full">
      <div className="relative flex-1 min-h-0">
      
      <ChartLegendHeader
        selectedSymbol={selectedSymbol}
        timeframe={timeframe}
        onTimeframeChange={onTimeframeChange ?? (() => {})}
        intervalFavorites={intervalFavorites}
        onToggleIntervalFavorite={onToggleIntervalFavorite}
        symbols={symbols}
        legend={legend}
        countdown={countdownText}
        tick={tick}
        pipDigits={pipDigits}
        showOhlcLegend={chartPrefs.showOhlcLegend}
        showCountdown={chartPrefs.showCountdown}
        symbolCategory={symbolInfo?.category}
        activeIndicators={activeIndicators}
        hiddenIndicators={hiddenIndicators}
        onToggleIndicatorHidden={toggleIndicatorHidden}
        onToggleIndicator={onToggleIndicator}
        collapsed={indicatorLegendCollapsed}
        onToggleCollapsed={() => setIndicatorLegendCollapsed((v) => !v)}
      />

      <ChartNavToolbar
        onZoomIn={handleLegendZoomIn}
        onZoomOut={handleLegendZoomOut}
        onScrollLeft={handleLegendScrollLeft}
        onScrollRight={handleLegendScrollRight}
        onScrollToRealTime={handleLegendScrollToRealTime}
      />

      {/* Drag-to-edit tooltip */}
      {dragPrice && (
        <div
          className="absolute left-1/2 -translate-x-1/2 z-20 pointer-events-none"
          style={{ top: dragPrice.y - 32 }}
        >
          <div
            className={cn(
              "px-2 py-1 rounded text-[11px] font-mono font-bold shadow-lg border",
              dragPrice.field === "TP"
                ? "bg-[#0ecb81]/20 text-[#0ecb81] border-[#0ecb81]/40"
                : "bg-[#f6465d]/20 text-[#f6465d] border-[#f6465d]/40",
            )}
          >
            {dragPrice.field} → {dragPrice.price.toFixed(pipDigits)}
            <span
              className={dragPrice.pnlUsd >= 0 ? "ml-1.5 text-[#0ecb81]" : "ml-1.5 text-[#f6465d]"}
            >
              {dragPrice.pnlUsd >= 0 ? "+" : ""}${dragPrice.pnlUsd.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Selected-drawing floating toolbar / settings dialog */}
      <DrawingOverlays
        drawing={selectedDrawing}
        showSettings={showDrawingSettings}
        currentTf={timeframe}
        onUpdate={(d) => onUpdateDrawing?.(d)}
        onClone={handleCloneDrawing}
        onRemove={() => selectedDrawing && onRemoveDrawing?.(selectedDrawing.id)}
        onOpenSettings={() => setShowDrawingSettings(true)}
        onCloseSettings={() => setShowDrawingSettings(false)}
      />

      {contextMenu && selectedDrawing && (
        <DrawingContextMenu
          drawing={selectedDrawing}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onSettings={() => setShowDrawingSettings(true)}
          onDuplicate={handleCloneDrawing}
          onReorder={(dir) => handleReorderDrawing(selectedDrawing, dir)}
          onToggleLock={() =>
            onUpdateDrawing?.({ ...selectedDrawing, locked: !selectedDrawing.locked })
          }
          onToggleAlert={() =>
            onUpdateDrawing?.({ ...selectedDrawing, alertEnabled: !selectedDrawing.alertEnabled })
          }
          onRemove={() => onRemoveDrawing?.(selectedDrawing.id)}
        />
      )}

      {/* Object tree: toggle button + panel listing every drawing on the symbol */}
      <ObjectTreeOverlay
        drawings={drawings}
        selectedIds={selectedDrawingIds}
        pipDigits={pipDigits}
        currentTf={timeframe}
        open={showObjectTree}
        onToggle={() => setShowObjectTree((v) => !v)}
        onSelect={handleObjectTreeSelect}
        onUpdate={(d) => onUpdateDrawing?.(d)}
        onRemove={(id) => onRemoveDrawing?.(id)}
        onReorder={handleReorderDrawing}
      />

      {/* News overlay (popup, config dialog, button) */}
      {/* No economic-calendar data source exists for Hyperliquid markets. */}
      {!isHyperliquidMode() && (
        <NewsOverlay
          newsConfig={newsConfig}
          setNewsConfig={setNewsConfig}
          showNewsConfigDialog={showNewsConfigDialog}
          setShowNewsConfigDialog={setShowNewsConfigDialog}
          newsPopup={newsPopup}
          setNewsPopup={setNewsPopup}
          isDark={isDark}
          pipDigits={pipDigits}
          containerRef={containerRef}
        />
      )}

      {/* Chart-wide right-click menu (TradingView-style) */}
      {chartMenu && (
        <ChartContextMenu
          x={chartMenu.x}
          y={chartMenu.y}
          price={chartMenu.price}
          pipDigits={pipDigits}
          symbol={selectedSymbol}
          tick={tick}
          drawingsCount={visibleDrawings.length}
          indicatorsCount={activeIndicators.length}
          onClose={() => setChartMenu(null)}
          onResetView={handleResetView}
          onCopyPrice={handleCopyPrice}
          onAddAlert={handleAddAlert}
          onQuickOrder={onQuickOrder}
          onOpenObjectTree={() => setShowObjectTree(true)}
          onRemoveAllDrawings={onClearDrawings}
          onClearIndicators={onClearIndicators}
          onOpenSettings={() => setShowChartSettings(true)}
        />
      )}

      <ChartSettingsDialog
        open={showChartSettings}
        onClose={() => setShowChartSettings(false)}
        prefs={chartPrefs}
        isDark={isDark}
        activePlugins={activePlugins}
        onTogglePlugin={onTogglePlugin}
        onOpenNewsConfig={() => setShowNewsConfigDialog(true)}
        hasAccount={!!accountId}
      />

      {/* Chart container — cursor is managed imperatively by DrawingToolsManager */}
      <div
        ref={containerRef}
        data-testid="chart-canvas"
        className="w-full h-full"
        onContextMenu={handleChartContextMenu}
      />

      {/* Left vertical tool rail (TradingView-style grouped flyouts) */}
      <DrawingToolRail
        drawingTool={drawingTool}
        onDrawingTool={(t) => onDrawingToolSelect?.(t)}
        magnetMode={magnetMode}
        onSetMagnet={onSetMagnet}
        stayInDrawingMode={stayInDrawingMode}
        onToggleStayInDrawingMode={onToggleStayInDrawingMode}
        onClearDrawings={onClearDrawings}
        drawingCount={drawings.length}
      />
      </div>

      {/* Bottom bar: range tabs, go-to-date, UTC clock */}
      <BottomToolbar
        timeframe={timeframe}
        activeTab={activeRangeTab}
        onRangePick={handleRangePick}
        onGoToDate={handleGoToDate}
        goToDateOpen={goToDateOpen}
        onGoToDateToggle={() => setGoToDateOpen((v) => !v)}
      />
    </div>
  );
}

// ── Local helper: Build chart data (candles + volume) ────────

type CandleRow = CandlestickData<Time> & { volume: number };

// Treat values below 1e12 as seconds, at/above as milliseconds.
function secOrMsToMs(v: number): number {
  return v < 1_000_000_000_000 ? v * 1000 : v;
}

// Normalise a raw candle's timestamp (seconds, ms, or ISO string) to unix seconds.
function candleTimeSec(c: Candle): number {
  let tMs = NaN;
  if (typeof c.time === "number" && c.time > 0) tMs = secOrMsToMs(c.time);
  else if (typeof c.timestamp === "number" && c.timestamp > 0) tMs = secOrMsToMs(c.timestamp);
  else if (typeof c.timestamp === "string") tMs = Date.parse(c.timestamp);
  return Number.isNaN(tMs) ? NaN : Math.floor(tMs / 1000);
}

function toCandleRow(c: Candle): CandleRow {
  return {
    time: candleTimeSec(c) as Time,
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
    volume: Number(c.volume) || 0,
  };
}

// Keep the last row for each timestamp (input must be time-sorted ascending).
function dedupeByTime(sorted: CandleRow[]): CandleRow[] {
  const out: CandleRow[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const next = sorted[i + 1];
    if (!next || (cur.time as number) !== (next.time as number)) out.push(cur);
  }
  return out;
}

function useChartData(candles: Candle[], colors: { volumeUp: string; volumeDown: string }) {
  return useMemo(() => {
    const sorted = candles
      .map(toCandleRow)
      .filter((c) => !Number.isNaN(c.time as number) && (c.time as number) > 0)
      .sort((a, b) => (a.time as number) - (b.time as number));
    const deduped = dedupeByTime(sorted);

    const chartData: CandlestickData<Time>[] = deduped.map(({ volume: _v, ...rest }) => rest);
    const volumeData: HistogramData<Time>[] = deduped.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? colors.volumeUp : colors.volumeDown,
    }));

    return { chartData, volumeData };
  }, [candles, colors.volumeUp, colors.volumeDown]);
}
