import { describe, expect, it, vi } from "vitest";
import {
  createInMemoryRequestObserver,
  withObservability,
  type AuditSink,
} from "../packages/saas-server/index.ts";

describe("withObservability", () => {
  it("propagates gateway request ids and records timings", async () => {
    const observer = createInMemoryRequestObserver();
    const handler = withObservability(
      async () => Response.json({ ok: true }),
      { route: "/documents", observer },
    );
    const response = await handler(
      new Request("https://api.test/documents?key=abc", {
        headers: { "x-request-id": "gw-123" },
      }),
    );
    expect(response.headers.get("x-request-id")).toBe("gw-123");
    expect(observer.requests).toEqual([
      { method: "GET", route: "/documents", status: 200, durationMs: expect.any(Number) },
    ]);
  });

  it("converts unhandled failures into JSON 500s with an error observation", async () => {
    const observer = createInMemoryRequestObserver();
    const handler = withObservability(
      async () => {
        throw new Error("database exploded");
      },
      { route: "/layout", observer },
    );
    const response = await handler(new Request("https://api.test/layout"));
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("internal");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(observer.requests[0]?.error).toBeInstanceOf(Error);
    expect(observer.requests[0]?.status).toBeUndefined();
  });
});

describe("audit wiring", () => {
  it("records only first-time provisioning", async () => {
    const pool = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: "1", public_id: "u-1", inserted: true }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ id: "1", public_id: "u-1", inserted: false }],
          rowCount: 1,
        }),
    };
    const audit: AuditSink = { record: vi.fn().mockResolvedValue(undefined) };
    const { createPostgresProvisioningRepository } = await import(
      "../packages/saas-server/provisioning.ts"
    );
    const repo = createPostgresProvisioningRepository(
      pool as unknown as Parameters<typeof createPostgresProvisioningRepository>[0],
      audit,
    );
    await repo.provisionUser({ authSubject: "auth0|first", email: "a@example.com" });
    await repo.provisionUser({ authSubject: "auth0|first", email: "a@example.com" });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.provisioned", targetType: "user", targetId: "u-1" }),
    );
  });
});
