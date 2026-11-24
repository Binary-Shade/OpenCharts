import { createEntitlements } from "../saas-core/entitlements.ts";
import type { SubscriptionView } from "../saas-core/billing.ts";
import type { CheckoutRequest } from "../saas-core/billing.ts";
import type { SubscriptionPlan } from "../saas-core/model.ts";
import { isPostgresError } from "./postgres.ts";
import { resolvePrincipal, type AuthenticateSubjectRequest } from "./identity-api.ts";
import type { TenantProvisioningRepository } from "./provisioning.ts";
import type { MembershipRepository } from "./user-content.ts";
import type { BillingProvider, BillingRepository, SubscriptionReader } from "./billing.ts";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

const PLANS: readonly SubscriptionPlan[] = ["free", "pro", "premium", "enterprise"];

function validPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === "string" && (PLANS as readonly string[]).includes(value);
}

function validUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("https://");
}

/**
 * POST /billing/webhook — verifies the provider signature, records the event
 * idempotently, and applies the subscription transition. Provider replays
 * return 200 with applied: false so vendors stop retrying.
 */
export function createBillingWebhookHandler(
  provider: BillingProvider,
  billing: BillingRepository,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let rawBody: string;
    try {
      rawBody = await request.text();
    } catch {
      return json({ error: "unreadable-body" }, 400);
    }

    let verified: boolean;
    try {
      verified = await provider.verifyWebhook(request.headers, rawBody);
    } catch {
      verified = false;
    }
    if (!verified) return json({ error: "invalid-signature" }, 401);

    let event;
    try {
      event = provider.parseWebhook(rawBody);
    } catch {
      return json({ error: "invalid-payload" }, 400);
    }
    if (!event.eventId) return json({ error: "invalid-payload" }, 400);

    const applied = await billing.recordEvent(provider.name, event, rawBody);
    if (!applied) return json({ applied: false, replay: true });

    const subscription = await billing.applySubscription(provider.name, event);
    return json({ applied: true, subscription });
  };
}

/** GET /subscription?organizationId=... — member-visible subscription state. */
export function createSubscriptionHandler(
  provisioning: TenantProvisioningRepository,
  subscriptions: SubscriptionReader,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);
    const organizationId = new URL(request.url).searchParams.get("organizationId")?.trim();
    if (!organizationId) return json({ error: "organizationId is required" }, 400);

    const subscription = await subscriptions.getSubscription(principal, organizationId);
    const view: SubscriptionView = subscription ?? {
      plan: "free",
      status: "active",
      currentPeriodEnd: null,
    };
    const entitlements = createEntitlements(view.plan, view.status);
    // EntitlementSet.features is a Set, which Response.json would flatten to
    // an empty object, so the wire format spells it out as an array.
    return json({
      subscription: view,
      entitlements: {
        plan: entitlements.plan,
        status: entitlements.status,
        features: [...entitlements.features],
        limits: entitlements.limits,
      },
    });
  };
}

/**
 * POST /billing/checkout — starts a provider checkout for an organization the
 * caller belongs to.
 */
export function createCheckoutHandler(
  provider: BillingProvider,
  provisioning: TenantProvisioningRepository,
  memberships: MembershipRepository,
  authenticate: AuthenticateSubjectRequest,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const principal = await resolvePrincipal(provisioning, authenticate, request);
    if (!principal) return json({ error: "unauthorized" }, 401);

    let body: Partial<CheckoutRequest>;
    try {
      body = (await request.json()) as Partial<CheckoutRequest>;
    } catch {
      return json({ error: "invalid-json" }, 400);
    }
    if (typeof body.organizationId !== "string" || !body.organizationId.trim()) {
      return json({ error: "organizationId is required" }, 400);
    }
    if (!validPlan(body.plan) || body.plan === "free") {
      return json({ error: "plan must be a paid plan" }, 400);
    }
    if (!validUrl(body.successUrl) || !validUrl(body.cancelUrl)) {
      return json({ error: "successUrl and cancelUrl must be https URLs" }, 400);
    }

    if (!(await memberships.isMember(principal, body.organizationId))) {
      return json({ error: "organization not found" }, 404);
    }

    try {
      const checkout = await provider.createCheckout({
        organizationId: body.organizationId,
        plan: body.plan,
        successUrl: body.successUrl,
        cancelUrl: body.cancelUrl,
      });
      return json(checkout, 201);
    } catch (error) {
      if (isPostgresError(error, "42501")) return json({ error: "organization not found" }, 404);
      throw error;
    }
  };
}
