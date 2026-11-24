import { describe, expect, it, vi } from "vitest";
import { createChartDocumentClient } from "../packages/saas-core/chart-client.ts";
import { createDrawingDocument } from "../packages/drawing-engine/schema.ts";
import { createChartDocumentHandler } from "../packages/saas-server/chart-api.ts";
import type { ChartDocumentRepository } from "../packages/saas-server/postgres.ts";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const endpoint = `https://charts.test/document?workspaceId=${workspaceId}&symbolId=BTC`;

function repository(): ChartDocumentRepository {
  return {
    get: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue({
      kind: "updated",
      resource: {
        revision: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
        value: createDrawingDocument("BTC"),
      },
    }),
  };
}

describe("chart document API", () => {
  it("rejects unauthenticated requests before repository access", async () => {
    const repo = repository();
    const handler = createChartDocumentHandler(repo, async () => null);
    const response = await handler(new Request(endpoint));
    expect(response.status).toBe(401);
    expect(repo.get).not.toHaveBeenCalled();
  });

  it("sanitizes writes and forwards authenticated identity", async () => {
    const repo = repository();
    const handler = createChartDocumentHandler(repo, async () => ({ userId: "42" }));
    const response = await handler(
      new Request(endpoint, {
        method: "PUT",
        body: JSON.stringify({
          expectedRevision: 0,
          document: [{ id: "line", type: "horizontal", price: 100, color: "#fff" }],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(repo.save).toHaveBeenCalledWith(
      { userId: "42" },
      workspaceId,
      "BTC",
      0,
      expect.objectContaining({ schemaVersion: 1, symbolId: "BTC" }),
    );
  });

  it("maps revision conflicts to HTTP 409", async () => {
    const repo = repository();
    vi.mocked(repo.save).mockResolvedValue({
      kind: "revision-conflict",
      expectedRevision: 1,
      current: {
        revision: 2,
        updatedAt: "2026-01-02T00:00:00.000Z",
        value: createDrawingDocument("BTC"),
      },
    });
    const handler = createChartDocumentHandler(repo, async () => ({ userId: "42" }));
    const response = await handler(
      new Request(endpoint, {
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 1, document: createDrawingDocument("BTC") }),
      }),
    );
    expect(response.status).toBe(409);
  });
});

describe("chart document HTTP client", () => {
  it("sends bearer auth and preserves conflict responses", async () => {
    const conflict = {
      kind: "revision-conflict" as const,
      expectedRevision: 1,
      current: { revision: 2, updatedAt: "2026-01-02T00:00:00.000Z", value: createDrawingDocument("BTC") },
    };
    const fetch = vi.fn().mockResolvedValue(Response.json(conflict, { status: 409 }));
    const client = createChartDocumentClient({ endpoint: "https://charts.test/document", getAccessToken: () => "token", fetch });
    await expect(client.save(workspaceId, "BTC", 1, createDrawingDocument("BTC"))).resolves.toEqual(conflict);
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.stringContaining("workspaceId=") }),
      expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer token" }) }),
    );
  });
});
