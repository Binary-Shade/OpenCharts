import type { AuthenticatedPrincipal } from "./postgres.ts";
import type {
  AuthenticatedSubject,
  TenantProvisioningRepository,
  TenantWorkspaceRepository,
} from "./provisioning.ts";
import type { WorkspaceRef } from "../saas-core/model.ts";

export type AuthenticateSubjectRequest = (request: Request) => Promise<AuthenticatedSubject | null>;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? { ok: true, body } : { ok: false };
  } catch {
    return { ok: false };
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "org";
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.trim().length <= 120;
}

function validSlug(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 120
    && SLUG_PATTERN.test(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

/**
 * Resolves the verified subject to an internal user, creating the row on
 * first sign-in. Returns null for unauthenticated requests.
 */
export async function resolvePrincipal(
  provisioning: TenantProvisioningRepository,
  authenticate: AuthenticateSubjectRequest,
  request: Request,
): Promise<AuthenticatedPrincipal | null> {
  const subject = await authenticate(request);
  if (!subject) return null;
  const principal = await provisioning.provisionUser(subject);
  return principal;
}

export function createSessionHandler(
  provisioning: TenantProvisioningRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const subject = await authenticate(request);
    if (!subject) return json({ error: "unauthorized" }, 401);
    const user = await provisioning.provisionUser(subject);
    const organizations = await provisioning.listOrganizations(user.userId);
    return json({ user: { id: user.userPublicId }, organizations });
  };
}

export function createOrganizationHandler(
  provisioning: TenantProvisioningRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);

    const parsed = await readJson(request);
    if (!parsed.ok) return json({ error: "invalid-json" }, 400);
    const body = parsed.body as { name?: unknown; slug?: unknown };
    if (!validName(body.name)) return json({ error: "name must be 1-120 characters" }, 400);

    const slug = body.slug === undefined ? slugify(body.name) : body.slug;
    if (!validSlug(slug)) {
      return json({ error: "slug must be lowercase letters, digits and dashes" }, 400);
    }

    try {
      const organization = await provisioning.createOrganization({
        name: body.name.trim(),
        slug,
        ownerId: principal.userId,
      });
      return json(organization, 201);
    } catch (error) {
      if (isUniqueViolation(error)) return json({ error: "slug already in use" }, 409);
      throw error;
    }
  };
}

export function createWorkspaceHandler(
  provisioning: TenantProvisioningRepository,
  workspaces: TenantWorkspaceRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);

    const parsed = await readJson(request);
    if (!parsed.ok) return json({ error: "invalid-json" }, 400);
    const body = parsed.body as { organizationId?: unknown; name?: unknown };
    if (typeof body.organizationId !== "string" || !body.organizationId.trim()) {
      return json({ error: "organizationId is required" }, 400);
    }
    if (!validName(body.name)) return json({ error: "name must be 1-120 characters" }, 400);

    const name = body.name;
    try {
      const workspace = await workspaces.createWorkspace(
        principal,
        body.organizationId,
        name.trim(),
      );
      return json(workspace satisfies WorkspaceRef, 201);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "42501"
      ) {
        return json({ error: "organization not found" }, 404);
      }
      throw error;
    }
  };
}

export function createWorkspaceListHandler(
  provisioning: TenantProvisioningRepository,
  workspaces: TenantWorkspaceRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) return json({ error: "organizationId is required" }, 400);
    const list = await workspaces.listWorkspaces(principal.userId, organizationId);
    return json({ workspaces: list });
  };
}
