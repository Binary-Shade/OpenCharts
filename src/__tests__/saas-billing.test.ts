import { describe, expect, it, vi } from "vitest";
import {
  createBillingWebhookHandler,
  createCheckoutHandler,
  createManualBillingProvider,
  createSubscriptionHandler,
  type BillingRepository,
  type MembershipRepository,
  type SubscriptionReader,
  type TenantProvisioningRepository,
} from "../packages/saas-server/index.ts";

const authenticate = async () => ({ authSubject: "auth0|it", email: null, displayName: null });

function provisioning(): TenantProvisioningRepository {
  return {
    provisionUser: vi.fn().mockResolvedValue({ userId: "9", userPublicId: "u-9" }),
    createOrganization: vi.fn(),
    listOrganizations: vi.fn().mockResolvedValue([]),
  };
}

const validEvent = {
  eventId: "evt_001",
  organizationId: "o-1",
  providerSubscriptionId: "sub_001",
  plan: "pro" as const,
  status: "active" as const,
  currentPeriodEnd: "2027-01-01T00:00:00.000Z",
};

describe("billing webhook handler", () => {
  it("rejects unverifiable signatures before parsing", async () => {
    const provider = {
      ...createManualBillingProvider(),
      verifyWebhook: vi.fn().mockResolvedValue(false),
    };
    const billing: BillingRepository = {
      recordEvent: vi.fn(),
      applySubscription: vi.fn(),
    };
    const handler = createBillingWebhookHandler(provider, billing);
    const response = await handler(
      new Request("https://api.test/billing/webhook", {
        method: "POST",
        body: JSON.stringify(validEvent),
      }),
    );
    expect(response.status).toBe(401);
    expect(billing.recordEvent).not.toHaveBeenCalled();
  });

  it("records, applies, and treats replays as no-ops", async () => {
    const provider = createManualBillingProvider();
    const billing: BillingRepository = {
      recordEvent: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      applySubscription: vi.fn().mockResolvedValue({
        plan: "pro",
        status: "active",
        currentPeriodEnd: "2027-01-01T00:00:00.000Z",
      }),
    };
    const handler = createBillingWebhookHandler(provider, billing);
    const send = () =>
      handler(
        new Request("https://api.test/billing/webhook", {
          method: "POST",
          body: JSON.stringify(validEvent),
        }),
      );

    const first = (await (await send()).json()) as { applied: boolean };
    expect(first.applied).toBe(true);
    expect(billing.recordEvent).toHaveBeenCalledWith("manual", validEvent, JSON.stringify(validEvent));
    expect(billing.applySubscription).toHaveBeenCalledWith("manual", validEvent);

    const replay = (await (await send()).json()) as { applied: boolean; replay?: boolean };
    expect(replay.applied).toBe(false);
    expect(replay.replay).toBe(true);
    expect(billing.applySubscription).toHaveBeenCalledTimes(1);
  });

  it("rejects unparseable payloads with 400", async () => {
    const handler = createBillingWebhookHandler(createManualBillingProvider(), {
      recordEvent: vi.fn(),
      applySubscription: vi.fn(),
    });
    const response = await handler(
      new Request("https://api.test/billing/webhook", {
        method: "POST",
        body: "not-json",
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("subscription handler", () => {
  it("falls back to an active free subscription when none is stored", async () => {
    const subscriptions: SubscriptionReader = {
      getSubscription: vi.fn().mockResolvedValue(null),
    };
    const handler = createSubscriptionHandler(provisioning(), subscriptions, authenticate);
    const response = await handler(
      new Request("https://api.test/subscription?organizationId=o-1"),
    );
    const body = (await response.json()) as {
      subscription: { plan: string };
      entitlements: { features: string[]; limits: Record<string, number> };
    };
    expect(body.subscription.plan).toBe("free");
    expect(body.entitlements.features).toContain("chart.single");
    expect(body.entitlements.limits.chartLayouts).toBe(1);
  });

  it("returns stored subscription state and entitlements", async () => {
    const subscriptions: SubscriptionReader = {
      getSubscription: vi.fn().mockResolvedValue({
        plan: "premium",
        status: "trialing",
        currentPeriodEnd: "2027-02-01T00:00:00.000Z",
      }),
    };
    const handler = createSubscriptionHandler(provisioning(), subscriptions, authenticate);
    const body = (await (
      await handler(new Request("https://api.test/subscription?organizationId=o-1"))
    ).json()) as { entitlements: { features: string[] } };
    expect(body.entitlements.features).toContain("scripts");
    expect(body.entitlements.features).toContain("backtests");
  });
});

describe("checkout handler", () => {
  const memberships: MembershipRepository = {
    isMember: vi.fn().mockResolvedValue(true),
  };

  it("requires membership, a paid plan, and https urls", async () => {
    const handler = createCheckoutHandler(
      createManualBillingProvider(),
      provisioning(),
      memberships,
      authenticate,
    );
    expect(
      (await handler(new Request("https://api.test/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ organizationId: "o-1", plan: "free", successUrl: "https://a", cancelUrl: "https://b" }),
      }))).status,
    ).toBe(400);
    expect(
      (await handler(new Request("https://api.test/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ organizationId: "o-1", plan: "pro", successUrl: "http://a", cancelUrl: "https://b" }),
      }))).status,
    ).toBe(400);

    vi.mocked(memberships.isMember).mockResolvedValueOnce(false);
    expect(
      (await handler(new Request("https://api.test/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ organizationId: "o-x", plan: "pro", successUrl: "https://a", cancelUrl: "https://b" }),
      }))).status,
    ).toBe(404);
  });

  it("returns the provider checkout session", async () => {
    const handler = createCheckoutHandler(
      createManualBillingProvider(),
      provisioning(),
      memberships,
      authenticate,
    );
    const response = await handler(
      new Request("https://api.test/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          organizationId: "o-1",
          plan: "pro",
          successUrl: "https://app.test/welcome",
          cancelUrl: "https://app.test/billing",
        }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { checkoutUrl: string };
    expect(body.checkoutUrl).toContain("plan=pro");
  });
});
