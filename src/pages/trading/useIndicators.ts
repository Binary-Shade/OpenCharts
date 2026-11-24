import { useEffect, useRef } from "react";
import type { IChartApi, ISeriesApi, CandlestickData, Time } from "lightweight-charts";
import { LineStyle } from "lightweight-charts";
import {
  INDICATOR_REGISTRY,
  type IndicatorType,
} from "../../packages/indicators/calculations.ts";
import { evaluateIndicatorAsync } from "../../packages/indicators/client.ts";
import { toIndicatorCandles } from "./utils.ts";
import { CHART_COLORS } from "./constants.ts";

export function useIndicators(
  chartRef: React.RefObject<IChartApi | null>,
  candleSeriesRef: React.RefObject<ISeriesApi<"Candlestick"> | null>,
  chartData: CandlestickData<Time>[],
  activeIndicators: IndicatorType[],
  isDark: boolean,
): void {
  const indicatorSeriesRef = useRef<Map<string, ISeriesApi<"Line"> | ISeriesApi<"Histogram">>>(
    new Map(),
  );
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light;

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || chartData.length === 0) return;

    const chart = chartRef.current;
    const indCandles = toIndicatorCandles(chartData);

    // Remove old indicator series
    for (const [_key, series] of indicatorSeriesRef.current) {
      try {
        chart.removeSeries(series);
      } catch {
        /* already removed */
      }
    }
    indicatorSeriesRef.current.clear();
    let cancelled = false;

    void Promise.all(
      activeIndicators.map(async (type) => {
        const config = INDICATOR_REGISTRY.find((candidate) => candidate.type === type);
        if (!config) return null;
        const response = await evaluateIndicatorAsync({
          requestId: type,
          type,
          candles: indCandles,
          params: config.defaultParams,
        });
        return { type, config, data: response.series };
      }),
    ).then((results) => {
      if (cancelled) return;
      for (const result of results) {
        if (!result) continue;
        const { type, config, data } = result;

        switch (type) {
        case "SMA": {
          const values = data.value ?? [];
          const s = chart.addLineSeries({
            color: config.color,
            lineWidth: 1,
            priceScaleId: "right",
          });
          s.setData(values.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("SMA", s);
          break;
        }
        case "EMA": {
          const values = data.value ?? [];
          const s = chart.addLineSeries({
            color: config.color,
            lineWidth: 1,
            priceScaleId: "right",
          });
          s.setData(values.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("EMA", s);
          break;
        }
        case "RSI": {
          const values = data.value ?? [];
          const s = chart.addLineSeries({ color: config.color, lineWidth: 1, priceScaleId: "rsi" });
          s.setData(values.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("RSI", s);
          const refHigh = chart.addLineSeries({
            color: "#555",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceScaleId: "rsi",
          });
          refHigh.setData(values.map((p) => ({ time: p.time as Time, value: 70 })));
          indicatorSeriesRef.current.set("RSI-70", refHigh);
          const refLow = chart.addLineSeries({
            color: "#555",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            priceScaleId: "rsi",
          });
          refLow.setData(values.map((p) => ({ time: p.time as Time, value: 30 })));
          indicatorSeriesRef.current.set("RSI-30", refLow);
          break;
        }
        case "MACD": {
          const mLine = chart.addLineSeries({
            color: "#2196f3",
            lineWidth: 1,
            priceScaleId: "macd",
          });
          mLine.setData((data.macd ?? []).map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("MACD-line", mLine);
          const sLine = chart.addLineSeries({
            color: "#ff9800",
            lineWidth: 1,
            priceScaleId: "macd",
          });
          sLine.setData((data.signal ?? []).map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("MACD-signal", sLine);
          const histo = chart.addHistogramSeries({ priceScaleId: "macd" });
          histo.setData(
            (data.histogram ?? []).map((p) => ({
              time: p.time as Time,
              value: p.value,
              color: p.value >= 0 ? colors.up + "99" : colors.down + "99",
            })),
          );
          indicatorSeriesRef.current.set("MACD-hist", histo);
          break;
        }
        case "BOLL": {
          const upper = chart.addLineSeries({
            color: config.color + "80",
            lineWidth: 1,
            priceScaleId: "right",
          });
          upper.setData((data.upper ?? []).map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("BOLL-upper", upper);
          const mid = chart.addLineSeries({
            color: config.color,
            lineWidth: 1,
            priceScaleId: "right",
          });
          mid.setData((data.middle ?? []).map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("BOLL-mid", mid);
          const lower = chart.addLineSeries({
            color: config.color + "80",
            lineWidth: 1,
            priceScaleId: "right",
          });
          lower.setData((data.lower ?? []).map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("BOLL-lower", lower);
          break;
        }
        case "ATR": {
          const values = data.value ?? [];
          const s = chart.addLineSeries({ color: config.color, lineWidth: 1, priceScaleId: "atr" });
          s.setData(values.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("ATR", s);
          break;
        }
        case "STOCH": {
          const kLine = chart.addLineSeries({
            color: "#ab47bc",
            lineWidth: 1,
            priceScaleId: "stoch",
          });
          kLine.setData((data.k ?? []).map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("STOCH-K", kLine);
          const dLine = chart.addLineSeries({
            color: "#ff7043",
            lineWidth: 1,
            priceScaleId: "stoch",
          });
          dLine.setData((data.d ?? []).map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("STOCH-D", dLine);
          break;
        }
        case "VWAP": {
          const values = data.value ?? [];
          const s = chart.addLineSeries({
            color: config.color,
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            priceScaleId: "right",
          });
          s.setData(values.map((p) => ({ time: p.time as Time, value: p.value })));
          indicatorSeriesRef.current.set("VWAP", s);
          break;
        }
        }
      }
    });
    return () => {
      cancelled = true;
    };
    // chartRef/candleSeriesRef are stable refs; colors derived from isDark dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndicators, chartData, isDark]);
}
