/**
 * Provider-neutral request observability. Handlers are wrapped once at
 * composition time; the host decides which sink receives the measurements
 * (logs, OpenTelemetry, a metrics backend). Trace and request ids are
 * propagated from `x-request-id` when a gateway already assigned one.
 */
export interface RequestObservationInput {
  method: string;
  route: string;
  requestId: string;
  traceId: string;
}

export interface RequestObserver {
  onRequest(input: RequestObservationInput): void;
  onResponse(input: RequestObservationInput & { status: number; durationMs: number }): void;
  onError(input: RequestObservationInput & { error: unknown; durationMs: number }): void;
}

export function createNoopRequestObserver(): RequestObserver {
  return { onRequest() {}, onResponse() {}, onError() {} };
}

/** In-memory observer for tests and single-process deployments. */
export function createInMemoryRequestObserver(): RequestObserver & {
  requests: { method: string; route: string; status?: number; durationMs?: number; error?: unknown }[];
} {
  const requests: { method: string; route: string; status?: number; durationMs?: number; error?: unknown }[] = [];
  return {
    requests,
    onRequest(input) {
      requests.push({ method: input.method, route: input.route });
    },
    onResponse(input) {
      const entry = requests.find(
        (candidate) => candidate.method === input.method && candidate.route === input.route && candidate.status === undefined,
      );
      if (entry) {
        entry.status = input.status;
        entry.durationMs = input.durationMs;
      }
    },
    onError(input) {
      const entry = requests.find(
        (candidate) => candidate.method === input.method && candidate.route === input.route && candidate.error === undefined && candidate.status === undefined,
      );
      if (entry) {
        entry.error = input.error;
        entry.durationMs = input.durationMs;
      }
    },
  };
}

export interface ObservableHandlerOptions {
  /** Static route label for metrics, e.g. "/documents" or "/billing/webhook". */
  route: string;
  observer?: RequestObserver;
}

/**
 * Wraps a fetch-style handler with request/response observations and turns
 * unhandled repository failures into JSON 500 responses instead of dropped
 * connections.
 */
export function withObservability(
  handler: (request: Request) => Promise<Response>,
  options: ObservableHandlerOptions,
): (request: Request) => Promise<Response> {
  const observer = options.observer ?? createNoopRequestObserver();
  return async (request) => {
    const requestId =
      request.headers.get("x-request-id")?.slice(0, 128) || globalThis.crypto.randomUUID();
    const traceId = requestId;
    const input = { method: request.method, route: options.route, requestId, traceId };
    const startedAt = Date.now();
    observer.onRequest(input);
    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      observer.onError({ ...input, error, durationMs: Date.now() - startedAt });
      response = Response.json(
        { error: "internal" },
        { status: 500, headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
      return response;
    }
    const observed: Response = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers([
        ...response.headers,
        ["x-request-id", requestId],
      ]),
    });
    observer.onResponse({ ...input, status: observed.status, durationMs: Date.now() - startedAt });
    return observed;
  };
}
