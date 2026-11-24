import { evaluateIndicator, type IndicatorRequest, type IndicatorResponse } from "./runtime.ts";

interface IndicatorWorkerScope {
  onmessage: ((event: MessageEvent<IndicatorRequest>) => void) | null;
  postMessage(message: IndicatorResponse): void;
}

const workerScope = self as unknown as IndicatorWorkerScope;

workerScope.onmessage = (event) => {
  workerScope.postMessage(evaluateIndicator(event.data));
};
