import { describe, expect, it } from "vitest";
import {
  applyRevisionWrite,
  createEntitlements,
  hasEntitlement,
} from "../packages/saas-core/index.ts";

describe("SaaS revision control", () => {
  const current = { revision: 4, updatedAt: "2026-01-01T00:00:00.000Z", value: { name: "Main" } };

  it("increments matching revisions", () => {
    expect(
      applyRevisionWrite(current, { expectedRevision: 4, value: { name: "Desk" } }, "2026-02-01T00:00:00.000Z"),
    ).toEqual({
      kind: "updated",
      resource: { revision: 5, updatedAt: "2026-02-01T00:00:00.000Z", value: { name: "Desk" } },
    });
  });

  it("returns the current resource for stale writes", () => {
    expect(applyRevisionWrite(current, { expectedRevision: 3, value: { name: "Stale" } })).toEqual({
      kind: "revision-conflict",
      expectedRevision: 3,
      current,
    });
  });
});

describe("SaaS entitlements", () => {
  it("enables plan features only for usable subscriptions", () => {
    expect(hasEntitlement(createEntitlements("premium", "active"), "backtests")).toBe(true);
    expect(hasEntitlement(createEntitlements("premium", "past_due"), "backtests")).toBe(false);
  });
});
