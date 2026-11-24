import {
  atr,
  bollingerBands,
  ema,
  macd,
  rsi,
  sma,
  stochastic,
  vwap,
  type CandleData,
  type IndicatorPoint,
  type IndicatorType,
} from "./calculations.ts";

export interface IndicatorRequest {
  requestId: string;
  type: IndicatorType;
  candles: CandleData[];
  params?: Record<string, number>;
}

export interface IndicatorResponse {
  requestId: string;
  type: IndicatorType;
  series: Record<string, IndicatorPoint[]>;
}

/** Pure request/response boundary suitable for Web Workers or server workers. */
export function evaluateIndicator(request: IndicatorRequest): IndicatorResponse {
  const p = request.params ?? {};
  let series: Record<string, IndicatorPoint[]>;
  switch (request.type) {
    case "SMA":
      series = { value: sma(request.candles, p.period ?? 20) };
      break;
    case "EMA":
      series = { value: ema(request.candles, p.period ?? 20) };
      break;
    case "RSI":
      series = { value: rsi(request.candles, p.period ?? 14) };
      break;
    case "MACD": {
      const result = macd(request.candles, p.fast ?? 12, p.slow ?? 26, p.signal ?? 9);
      series = { macd: result.macd, signal: result.signal, histogram: result.histogram };
      break;
    }
    case "BOLL": {
      const result = bollingerBands(request.candles, p.period ?? 20, p.stdDev ?? 2);
      series = { upper: result.upper, middle: result.middle, lower: result.lower };
      break;
    }
    case "ATR":
      series = { value: atr(request.candles, p.period ?? 14) };
      break;
    case "STOCH": {
      const result = stochastic(request.candles, p.kPeriod ?? 14, p.dPeriod ?? 3);
      series = { k: result.k, d: result.d };
      break;
    }
    case "VWAP":
      series = { value: vwap(request.candles) };
      break;
  }
  return { requestId: request.requestId, type: request.type, series };
}
