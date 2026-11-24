import { isPostgresError } from "./postgres.ts";
import { resolvePrincipal, type AuthenticateSubjectRequest } from "./identity-api.ts";
import type { TenantProvisioningRepository } from "./provisioning.ts";
import type {
  UserDocumentRepository,
  WatchlistRepository,
  WorkspaceLayoutRepository,
} from "./user-content.ts";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

const DOCUMENT_KEY_PATTERN = /^[\x21-\x7e]{1,200}$/;

function validDocumentKey(value: unknown): value is string {
  return typeof value === "string" && DOCUMENT_KEY_PATTERN.test(value);
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

async function parseConflictBody(
  request: Request,
): Promise<{ ok: true; expectedRevision: number; value: unknown } | { ok: false }> {
  let body: { expectedRevision?: unknown; value?: unknown };
  try {
    body = (await request.json()) as { expectedRevision?: unknown; value?: unknown };
  } catch {
    return { ok: false };
  }
  if (!validRevision(body.expectedRevision)) return { ok: false };
  if (!("value" in body)) return { ok: false };
  return { ok: true, expectedRevision: body.expectedRevision, value: body.value };
}

function isMembershipRejection(error: unknown): boolean {
  return isPostgresError(error, "42501");
}

/** GET/PUT/DELETE /documents?key=... — revisioned, user-scoped blobs. */
export function createDocumentHandler(
  provisioning: TenantProvisioningRepository,
  documents: UserDocumentRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);
    const key = new URL(request.url).searchParams.get("key");
    if (!validDocumentKey(key)) return json({ error: "valid key is required" }, 400);

    if (request.method === "GET") {
      const current = await documents.get(principal, key);
      return current ? json(current) : json({ error: "not-found" }, 404);
    }

    if (request.method === "DELETE") {
      return json({ removed: await documents.remove(principal, key) });
    }

    if (request.method === "PUT") {
      const parsed = await parseConflictBody(request);
      if (!parsed.ok) return json({ error: "expectedRevision and value are required" }, 400);
      const result = await documents.save(principal, key, parsed.expectedRevision, parsed.value);
      return result.kind === "updated" ? json(result.resource) : json(result, 409);
    }

    return json({ error: "method-not-allowed" }, 405);
  };
}

/** GET/PUT /layout?workspaceId=... — the workspace layout under its revision. */
export function createLayoutHandler(
  provisioning: TenantProvisioningRepository,
  layouts: WorkspaceLayoutRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return json({ error: "workspaceId is required" }, 400);

    if (request.method === "GET") {
      const current = await layouts.get(principal, workspaceId);
      return current ? json(current) : json({ error: "not-found" }, 404);
    }

    if (request.method === "PUT") {
      const parsed = await parseConflictBody(request);
      if (!parsed.ok) return json({ error: "expectedRevision and value are required" }, 400);
      const result = await layouts.save(principal, workspaceId, parsed.expectedRevision, parsed.value);
      return result.kind === "updated" ? json(result.resource) : json(result, 409);
    }

    return json({ error: "method-not-allowed" }, 405);
  };
}

/**
 * Watchlist management: POST/GET /watchlists?organizationId=...,
 * GET/PUT/DELETE /watchlists?watchlistId=... with the item list under CAS.
 */
export function createWatchlistHandler(
  provisioning: TenantProvisioningRepository,
  watchlists: WatchlistRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);
    const url = new URL(request.url);
    const watchlistId = url.searchParams.get("watchlistId")?.trim();
    const organizationId = url.searchParams.get("organizationId")?.trim();

    if (request.method === "POST" && organizationId) {
      const parsed = await parseConflictBody(request);
      if (!parsed.ok || typeof parsed.value !== "string" || parsed.value.trim().length === 0) {
        return json({ error: "value must be the watchlist name" }, 400);
      }
      try {
        const created = await watchlists.create(principal, organizationId, parsed.value.trim());
        return json(created, 201);
      } catch (error) {
        if (isMembershipRejection(error)) return json({ error: "organization not found" }, 404);
        throw error;
      }
    }

    if (request.method === "GET" && organizationId && !watchlistId) {
      return json({ watchlists: await watchlists.list(principal, organizationId) });
    }

    if (!watchlistId) return json({ error: "watchlistId or organizationId is required" }, 400);

    if (request.method === "GET") {
      const current = await watchlists.getItems(principal, watchlistId);
      return current ? json(current) : json({ error: "not-found" }, 404);
    }

    if (request.method === "DELETE") {
      return json({ removed: await watchlists.remove(principal, watchlistId) });
    }

    if (request.method === "PUT") {
      const parsed = await parseConflictBody(request);
      if (!parsed.ok || !Array.isArray(parsed.value)) {
        return json({ error: "expectedRevision and value (instrument array) are required" }, 400);
      }
      const items = parsed.value as unknown[];
      if (items.some((item) => typeof item !== "string")) {
        return json({ error: "value must be an array of instrument ids" }, 400);
      }
      const result = await watchlists.saveItems(
        principal,
        watchlistId,
        parsed.expectedRevision,
        items as string[],
      );
      return result.kind === "updated" ? json(result.resource) : json(result, 409);
    }

    return json({ error: "method-not-allowed" }, 405);
  };
}
