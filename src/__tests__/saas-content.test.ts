import { describe, expect, it, vi } from "vitest";
import type { StorageDriver } from "../adapter/types.ts";
import { createCloudStorageDriver } from "../packages/saas-core/cloud-storage.ts";
import {
  createDocumentHandler,
  createLayoutHandler,
  createWatchlistHandler,
  type TenantProvisioningRepository,
  type UserDocumentRepository,
  type WatchlistRepository,
  type WorkspaceLayoutRepository,
} from "../packages/saas-server/index.ts";

const endpoint = "https://api.test/documents";
const authenticate = async () => ({
  authSubject: "auth0|it",
  email: "it@example.com",
  displayName: "IT",
});

function provisioning(): TenantProvisioningRepository {
  return {
    provisionUser: vi.fn().mockResolvedValue({ userId: "7", userPublicId: "u-7" }),
    createOrganization: vi.fn(),
    listOrganizations: vi.fn().mockResolvedValue([]),
  };
}

describe("document handler", () => {
  it("requires a key and authenticates before storage access", async () => {
    const documents: UserDocumentRepository = {
      get: vi.fn(),
      save: vi.fn(),
      remove: vi.fn(),
    };
    const unauthenticated = createDocumentHandler(provisioning(), documents, async () => null);
    expect((await unauthenticated(new Request(endpoint))).status).toBe(401);

    const handler = createDocumentHandler(provisioning(), documents, authenticate);
    expect((await handler(new Request(endpoint))).status).toBe(400);
    expect(documents.get).not.toHaveBeenCalled();
  });

  it("round-trips a document and maps conflicts to 409", async () => {
    const documents: UserDocumentRepository = {
      get: vi.fn().mockResolvedValue({
        revision: 3,
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: { drawings: [] },
      }),
      save: vi.fn().mockResolvedValue({
        kind: "updated",
        resource: { revision: 4, updatedAt: "2026-01-02T00:00:00.000Z", value: { a: 1 } },
      }),
      remove: vi.fn().mockResolvedValue(true),
    };
    const handler = createDocumentHandler(provisioning(), documents, authenticate);

    const got = await handler(new Request(`${endpoint}?key=oc_journal_entries`));
    expect(got.status).toBe(200);
    expect(((await got.json()) as { value: unknown }).value).toEqual({ drawings: [] });

    const put = await handler(
      new Request(`${endpoint}?key=oc_journal_entries`, {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 3, value: { a: 1 } }),
      }),
    );
    expect(put.status).toBe(200);
    expect(documents.save).toHaveBeenCalledWith(
      { userId: "7", userPublicId: "u-7" },
      "oc_journal_entries",
      3,
      { a: 1 },
    );

    vi.mocked(documents.save).mockResolvedValueOnce({
      kind: "revision-conflict",
      expectedRevision: 2,
      current: { revision: 5, updatedAt: "2026-01-03T00:00:00.000Z", value: {} },
    });
    const conflict = await handler(
      new Request(`${endpoint}?key=oc_journal_entries`, {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 2, value: {} }),
      }),
    );
    expect(conflict.status).toBe(409);
  });
});

describe("layout handler", () => {
  it("validates the body and forwards saves", async () => {
    const layouts: WorkspaceLayoutRepository = {
      get: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({
        kind: "updated",
        resource: { revision: 1, updatedAt: "2026-01-01T00:00:00.000Z", value: { panes: 1 } },
      }),
    };
    const handler = createLayoutHandler(provisioning(), layouts, authenticate);

    expect(
      (await handler(new Request("https://api.test/layout?workspaceId=w-1", {
        method: "PUT",
        body: JSON.stringify({ value: {} }),
      }))).status,
    ).toBe(400);

    const put = await handler(
      new Request("https://api.test/layout?workspaceId=w-1", {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 0, value: { panes: 1 } }),
      }),
    );
    expect(put.status).toBe(200);
    expect(layouts.save).toHaveBeenCalledWith({ userId: "7", userPublicId: "u-7" }, "w-1", 0, {
      panes: 1,
    });
  });
});

describe("watchlist handler", () => {
  const watchlists: WatchlistRepository = {
    create: vi.fn().mockResolvedValue({ id: "wl-1", organizationId: "o-1", name: "Crypto", revision: 0 }),
    list: vi.fn().mockResolvedValue([{ id: "wl-1", organizationId: "o-1", name: "Crypto", revision: 0 }]),
    remove: vi.fn().mockResolvedValue(true),
    getItems: vi.fn().mockResolvedValue({
      revision: 2,
      updatedAt: "2026-01-01T00:00:00.000Z",
      value: ["BTCUSD", "ETHUSD"],
    }),
    saveItems: vi.fn().mockResolvedValue({
      kind: "updated",
      resource: { revision: 3, updatedAt: "2026-01-02T00:00:00.000Z", value: ["BTCUSD"] },
    }),
  };

  it("creates watchlists and lists them by organization", async () => {
    const handler = createWatchlistHandler(provisioning(), watchlists, authenticate);
    const created = await handler(
      new Request("https://api.test/watchlists?organizationId=o-1", {
        method: "POST",
        body: JSON.stringify({ expectedRevision: 0, value: "Crypto" }),
      }),
    );
    expect(created.status).toBe(201);

    const listed = await handler(
      new Request("https://api.test/watchlists?organizationId=o-1"),
    );
    expect(((await listed.json()) as { watchlists: unknown[] }).watchlists).toHaveLength(1);
  });

  it("validates item arrays before saving", async () => {
    const handler = createWatchlistHandler(provisioning(), watchlists, authenticate);
    const bad = await handler(
      new Request("https://api.test/watchlists?watchlistId=wl-1", {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 2, value: [1, 2] }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(watchlists.saveItems).not.toHaveBeenCalled();

    const put = await handler(
      new Request("https://api.test/watchlists?watchlistId=wl-1", {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 2, value: ["BTCUSD"] }),
      }),
    );
    expect(put.status).toBe(200);
    expect(watchlists.saveItems).toHaveBeenCalledWith(
      { userId: "7", userPublicId: "u-7" },
      "wl-1",
      2,
      ["BTCUSD"],
    );
  });
});

describe("cloud storage driver", () => {
  function memoryStorage(): StorageDriver & { store: Map<string, string> } {
    const store = new Map<string, string>();
    return {
      store,
      get: (key) => store.get(key) ?? null,
      set: (key, value) => void store.set(key, value),
      remove: (key) => void store.delete(key),
    };
  }

  it("prefers the cloud and caches revisions locally", async () => {
    const local = memoryStorage();
    const fetchFn = vi.fn().mockResolvedValue(
      Response.json({ revision: 4, updatedAt: "2026-01-01T00:00:00.000Z", value: { a: 1 } }),
    );
    const driver = createCloudStorageDriver({
      endpoint,
      getAccessToken: () => "token",
      local,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(driver.get("oc_drawings:v1:BTCUSD")).resolves.toBe('{"a":1}');
    expect(local.store.get("oc_cloud_rev:v1:oc_drawings:v1:BTCUSD")).toBe("4");
    const [, init] = fetchFn.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token");
  });

  it("falls back locally when offline and never clobbers a newer revision", async () => {
    const local = memoryStorage();
    const fallbacks: { key: string; reason: string }[] = [];
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        Response.json(
          {
            kind: "revision-conflict",
            expectedRevision: 2,
            current: { revision: 9, updatedAt: "2026-01-01T00:00:00.000Z", value: {} },
          },
          { status: 409 },
        ),
      );
    const driver = createCloudStorageDriver({
      endpoint,
      getAccessToken: () => "token",
      local,
      fetch: fetchFn as unknown as typeof fetch,
      onWriteFallback: (key, reason) => fallbacks.push({ key, reason }),
    });

    await driver.set("oc_drawings:v1:BTCUSD", '{"price":1}');
    expect(local.store.get("oc_drawings:v1:BTCUSD")).toBe('{"price":1}');
    expect(fallbacks).toEqual([{ key: "oc_drawings:v1:BTCUSD", reason: "offline" }]);

    await driver.set("oc_drawings:v1:BTCUSD", '{"price":2}');
    expect(fallbacks).toEqual([
      { key: "oc_drawings:v1:BTCUSD", reason: "offline" },
      { key: "oc_drawings:v1:BTCUSD", reason: "conflict" },
    ]);
    expect(local.store.get("oc_cloud_rev:v1:oc_drawings:v1:BTCUSD")).toBe("9");
    // The conflicting local value is still present for the caller to merge.
    expect(local.store.get("oc_drawings:v1:BTCUSD")).toBe('{"price":2}');
  });

  it("reads through to local storage on cloud failures", async () => {
    const local = memoryStorage();
    local.set("oc_drawings:v1:ETHUSD", '["line"]');
    const fetchFn = vi.fn().mockRejectedValue(new Error("down"));
    const driver = createCloudStorageDriver({
      endpoint,
      getAccessToken: () => "token",
      local,
      fetch: fetchFn as unknown as typeof fetch,
    });
    await expect(driver.get("oc_drawings:v1:ETHUSD")).resolves.toBe('["line"]');
  });
});
