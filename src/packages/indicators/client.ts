import {
  evaluateIndicator,
  type IndicatorRequest,
  type IndicatorResponse,
} from "./runtime.ts";

interface PendingRequest {
  request: IndicatorRequest;
  resolve: (response: IndicatorResponse) => void;
}

let indicatorWorker: Worker | null | undefined;
const pending = new Map<string, PendingRequest>();
let transportSequence = 0;

function fallbackAll(): void {
  indicatorWorker?.terminate();
  indicatorWorker = null;
  for (const [requestId, item] of pending) {
    pending.delete(requestId);
    item.resolve(evaluateIndicator(item.request));
  }
}

function getWorker(): Worker | null {
  if (indicatorWorker !== undefined) return indicatorWorker;
  if (typeof Worker === "undefined") {
    indicatorWorker = null;
    return null;
  }
  try {
    indicatorWorker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
      name: "opencharts-indicators",
    });
    indicatorWorker.onmessage = (event: MessageEvent<IndicatorResponse>) => {
      const item = pending.get(event.data.requestId);
      if (!item) return;
      pending.delete(event.data.requestId);
      item.resolve({ ...event.data, requestId: item.request.requestId });
    };
    indicatorWorker.onerror = fallbackAll;
  } catch {
    indicatorWorker = null;
  }
  return indicatorWorker;
}

/** Evaluates off the main thread when workers are available, with a synchronous fallback. */
export function evaluateIndicatorAsync(request: IndicatorRequest): Promise<IndicatorResponse> {
  const worker = getWorker();
  if (!worker) return Promise.resolve(evaluateIndicator(request));
  return new Promise((resolve) => {
    const transportId = `indicator:${transportSequence++}`;
    pending.set(transportId, { request, resolve });
    worker.postMessage({ ...request, requestId: transportId });
  });
}

/** Releases the shared worker; useful when a host tears down its chart workspace. */
export function disposeIndicatorWorker(): void {
  fallbackAll();
  indicatorWorker = undefined;
}
