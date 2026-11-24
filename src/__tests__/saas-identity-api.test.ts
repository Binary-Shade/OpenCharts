import { describe, expect, it, vi } from "vitest";
import {
  createOrganizationHandler,
  createSessionHandler,
  createWorkspaceHandler,
  createWorkspaceListHandler,
  type AuthenticatedSubject,
  type TenantProvisioningRepository,
  type TenantWorkspaceRepository,
} from "../packages/saas-server/index.ts";

const subject: AuthenticatedSubject = {
  authSubject: "auth0|507f1f77bcf86cd799439011",
  email: "trader@example.com",
  displayName: "Trader",
};

function provisioning(): TenantProvisioningRepository {
  return {
    provisionUser: vi.fn().mockResolvedValue({ userId: "42", userPublicId: "u-abc" }),
    createOrganization: vi.fn().mockResolvedValue({
      id: "o-1",
      name: "Desk",
      slug: "desk",
      role: "owner",
    }),
    listOrganizations: vi.fn().mockResolvedValue([
      { id: "o-1", name: "Desk", slug: "desk", role: "owner" },
    ]),
  };
}

function workspaces(): TenantWorkspaceRepository {
  return {
    createWorkspace: vi.fn().mockResolvedValue({
      id: "w-1",
      organizationId: "o-1",
      name: "Main",
      revision: 0,
    }),
    listWorkspaces: vi.fn().mockResolvedValue([
      { id: "w-1", organizationId: "o-1", name: "Main", revision: 0 },
    ]),
  };
}

describe("session handler", () => {
  it("rejects unauthenticated requests", async () => {
    const repo = provisioning();
    const handler = createSessionHandler(repo, async () => null);
    const response = await handler(new Request("https://api.test/session"));
    expect(response.status).toBe(401);
    expect(repo.provisionUser).not.toHaveBeenCalled();
  });

  it("provisions the user and returns public identity with organizations", async () => {
    const repo = provisioning();
    const handler = createSessionHandler(repo, async () => subject);
    const response = await handler(new Request("https://api.test/session"));
    expect(response.status).toBe(200);
    expect(repo.provisionUser).toHaveBeenCalledWith(subject);
    const body = (await response.json()) as {
      user: { id: string };
      organizations: { id: string }[];
    };
    expect(body.user.id).toBe("u-abc");
    expect(body.organizations[0]?.id).toBe("o-1");
  });
});

describe("organization handler", () => {
  it("validates the name before provisioning touches organizations", async () => {
    const repo = provisioning();
    const handler = createOrganizationHandler(repo, async () => subject);
    const response = await handler(
      new Request("https://api.test/organizations", {
        method: "POST",
        body: JSON.stringify({ name: "   " }),
      }),
    );
    expect(response.status).toBe(400);
    expect(repo.createOrganization).not.toHaveBeenCalled();
  });

  it("derives the slug from the name and returns the created organization", async () => {
    const repo = provisioning();
    const handler = createOrganizationHandler(repo, async () => subject);
    const response = await handler(
      new Request("https://api.test/organizations", {
        method: "POST",
        body: JSON.stringify({ name: "Alpha Desk!" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(repo.createOrganization).toHaveBeenCalledWith({
      name: "Alpha Desk!",
      slug: "alpha-desk",
      ownerId: "42",
    });
  });

  it("rejects caller-provided slugs outside the allowed shape", async () => {
    const repo = provisioning();
    const handler = createOrganizationHandler(repo, async () => subject);
    const response = await handler(
      new Request("https://api.test/organizations", {
        method: "POST",
        body: JSON.stringify({ name: "Desk", slug: "Not_Valid" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it("maps duplicate slugs to 409", async () => {
    const repo = provisioning();
    vi.mocked(repo.createOrganization).mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" }));
    const handler = createOrganizationHandler(repo, async () => subject);
    const response = await handler(
      new Request("https://api.test/organizations", {
        method: "POST",
        body: JSON.stringify({ name: "Desk", slug: "desk" }),
      }),
    );
    expect(response.status).toBe(409);
  });
});

describe("workspace handlers", () => {
  it("creates workspaces through the tenant repository", async () => {
    const prov = provisioning();
    const ws = workspaces();
    const handler = createWorkspaceHandler(prov, ws, async () => subject);
    const response = await handler(
      new Request("https://api.test/workspaces", {
        method: "POST",
        body: JSON.stringify({ organizationId: "o-1", name: "Main" }),
      }),
    );
    expect(response.status).toBe(201);
    expect(ws.createWorkspace).toHaveBeenCalledWith(
      { userId: "42", userPublicId: "u-abc" },
      "o-1",
      "Main",
    );
  });

  it("maps a membership rejection to 404", async () => {
    const prov = provisioning();
    const ws = workspaces();
    vi.mocked(ws.createWorkspace).mockRejectedValue(
      Object.assign(new Error("denied"), { code: "42501" }),
    );
    const handler = createWorkspaceHandler(prov, ws, async () => subject);
    const response = await handler(
      new Request("https://api.test/workspaces", {
        method: "POST",
        body: JSON.stringify({ organizationId: "o-unknown", name: "Main" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("lists workspaces for an organization", async () => {
    const prov = provisioning();
    const ws = workspaces();
    const handler = createWorkspaceListHandler(prov, ws, async () => subject);
    const response = await handler(
      new Request("https://api.test/workspaces?organizationId=o-1"),
    );
    expect(response.status).toBe(200);
    expect(ws.listWorkspaces).toHaveBeenCalledWith("42", "o-1");
    const body = (await response.json()) as { workspaces: { id: string }[] };
    expect(body.workspaces[0]?.id).toBe("w-1");
  });

  it("requires organizationId for listings", async () => {
    const prov = provisioning();
    const ws = workspaces();
    const handler = createWorkspaceListHandler(prov, ws, async () => subject);
    const response = await handler(new Request("https://api.test/workspaces"));
    expect(response.status).toBe(400);
    expect(ws.listWorkspaces).not.toHaveBeenCalled();
  });
});
