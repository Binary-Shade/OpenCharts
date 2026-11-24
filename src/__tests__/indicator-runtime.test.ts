import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disposeIndicatorWorker,
  evaluateIndicator,
  evaluateIndicatorAsync,
  type CandleData,
  type IndicatorRequest,
  type IndicatorResponse,
} from "../packages/indicators/index.ts";

const candles: CandleData[] = [
  { time: 1, open: 1, high: 2, low: 0, close: 1, volume: 10 },
  { time: 2, open: 1, high: 3, low: 1, close: 2, volume: 20 },
  { time: 3, open: 2, high: 4, low: 2, close: 3, volume: 30 },
];

describe("indicator runtime protocol", () => {
  afterEach(() => {
    disposeIndicatorWorker();
    vi.unstubAllGlobals();
  });

  it("evaluates an indicator through a serializable request/response boundary", () => {
    const response = evaluateIndicator({
      requestId: "request-1",
      type: "SMA",
      candles,
      params: { period: 2 },
    });
    expect(response).toEqual({
      requestId: "request-1",
      type: "SMA",
      series: { value: [{ time: 2, value: 1.5 }, { time: 3, value: 2.5 }] },
    });
  });

  it("preserves caller ids across concurrent worker requests", async () => {
    class FakeWorker {
      onmessage: ((event: MessageEvent<IndicatorResponse>) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(request: IndicatorRequest) {
        queueMicrotask(() => this.onmessage?.({ data: evaluateIndicator(request) } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", FakeWorker);
    disposeIndicatorWorker();

    const request = { type: "SMA" as const, candles, params: { period: 2 } };
    const [first, second] = await Promise.all([
      evaluateIndicatorAsync({ ...request, requestId: "shared" }),
      evaluateIndicatorAsync({ ...request, requestId: "shared" }),
    ]);

    expect(first.requestId).toBe("shared");
    expect(second.requestId).toBe("shared");
    expect(first.series).toEqual(second.series);
  });
});
