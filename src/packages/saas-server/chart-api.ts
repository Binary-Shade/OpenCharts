import { parseDrawingDocument } from "../drawing-engine/schema.ts";
import type { ChartDocumentRepository, AuthenticatedPrincipal } from "./postgres.ts";

export type AuthenticateRequest = (request: Request) => Promise<AuthenticatedPrincipal | null>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function routeInput(request: Request): { workspaceId: string; symbolId: string } | null {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId")?.trim();
  const symbolId = url.searchParams.get("symbolId")?.trim();
  return workspaceId && symbolId ? { workspaceId, symbolId } : null;
}

export function createChartDocumentHandler(
  repository: ChartDocumentRepository,
  authenticate: AuthenticateRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await authenticate(request);
    if (!principal) return json({ error: "unauthorized" }, 401);
    const input = routeInput(request);
    if (!input) return json({ error: "workspaceId and symbolId are required" }, 400);

    if (request.method === "GET") {
      const current = await repository.get(principal, input.workspaceId, input.symbolId);
      return current ? json(current) : json({ error: "not-found" }, 404);
    }

    if (request.method === "PUT") {
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid-json" }, 400);
      }
      if (!body || typeof body !== "object" || !("expectedRevision" in body) || !("document" in body)) {
        return json({ error: "expectedRevision and document are required" }, 400);
      }
      const expectedRevision = (body as { expectedRevision?: unknown }).expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 0) {
        return json({ error: "expectedRevision must be a non-negative integer" }, 400);
      }
      const document = parseDrawingDocument(
        (body as { document: unknown }).document,
        input.symbolId,
      );
      const result = await repository.save(
        principal,
        input.workspaceId,
        input.symbolId,
        expectedRevision as number,
        document,
      );
      return result.kind === "updated" ? json(result.resource) : json(result, 409);
    }

    return json({ error: "method-not-allowed" }, 405);
  };
}
