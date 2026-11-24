import type {
  CheckoutRequest,
  CheckoutSession,
  SubscriptionView,
} from "../saas-core/billing.ts";
import type { SubscriptionPlan, SubscriptionStatus } from "../saas-core/model.ts";
import type { Pool } from "pg";
import { withTenantTransaction } from "./postgres.ts";

/**
 * The vendor contract every billing provider implements, mirroring the
 * OpenChartsAdapter boundary: the server core stays provider-neutral and the
 * host installs one provider (Paddle, Stripe, or the manual provider for
 * self-hosted deployments and tests).
 */
export interface BillingProvider {
  name: "paddle" | "stripe" | "manual";
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  verifyWebhook(headers: Headers, rawBody: string): Promise<boolean>;
  parseWebhook(rawBody: string): BillingWebhookEvent;
}

export interface BillingWebhookEvent {
  eventId: string;
  /** Vendor metadata resolution to the organization's public id, if present. */
  organizationId: string | null;
  providerSubscriptionId: string | null;
  plan: SubscriptionPlan | null;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null;
}

/** Dev and self-hosted provider: unsigned bodies in the neutral event shape. */
export function createManualBillingProvider(): BillingProvider {
  return {
    name: "manual",
    async createCheckout(request) {
      return {
        checkoutUrl: `${request.successUrl}${request.successUrl.includes("?") ? "&" : "?"}plan=${request.plan}`,
      };
    },
    async verifyWebhook() {
      return true;
    },
    parseWebhook(rawBody) {
      const body = JSON.parse(rawBody) as Partial<BillingWebhookEvent>;
      return {
        eventId: String(body.eventId ?? ""),
        organizationId: body.organizationId ?? null,
        providerSubscriptionId: body.providerSubscriptionId ?? null,
        plan: body.plan ?? null,
        status: body.status ?? null,
        currentPeriodEnd: body.currentPeriodEnd ?? null,
      };
    },
  };
}

export interface BillingRepository {
  /** Records an event idempotently; returns false for provider replays. */
  recordEvent(
    provider: BillingProvider["name"],
    event: BillingWebhookEvent,
    rawBody: string,
  ): Promise<boolean>;
  /** Applies the subscription transition for the event's organization. */
  applySubscription(
    provider: BillingProvider["name"],
    event: BillingWebhookEvent,
  ): Promise<SubscriptionView | null>;
}

interface SubscriptionRow {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  current_period_end: Date | null;
}

/**
 * Runs on the service-role connection: webhook ingestion has no user
 * identity, and subscription reads for members go through the tenant pool.
 */
export function createPostgresBillingRepository(pool: Pool): BillingRepository {
  return {
    async recordEvent(provider, event, rawBody) {
      const organization = event.organizationId
        ? await pool.query<{ id: number }>(
            "select id from public.organizations where public_id = $1::uuid",
            [event.organizationId],
          )
        : { rows: [] as { id: number }[] };
      const organizationId = organization.rows[0]?.id ?? null;

      const inserted = await pool.query<{ id: number }>(
        `insert into public.billing_events (provider, event_id, organization_id, payload, applied)
         values ($1, $2, $3, $4::jsonb, true)
         on conflict (provider, event_id) do nothing
         returning id`,
        [provider, event.eventId, organizationId, rawBody],
      );
      return inserted.rows.length > 0;
    },

    async applySubscription(provider, event) {
      if (!event.organizationId || !event.plan || !event.status) return null;
      const organization = await pool.query<{ id: number }>(
        "select id from public.organizations where public_id = $1::uuid",
        [event.organizationId],
      );
      const row = organization.rows[0];
      if (!row) return null;

      const result = await pool.query<SubscriptionRow>(
        `insert into public.subscriptions
           (organization_id, provider, provider_subscription_id, plan, status, current_period_end)
         values ($1, $6, $2, $3, $4, $5::timestamptz)
         on conflict (organization_id) do update
           set provider_subscription_id = excluded.provider_subscription_id,
               plan = excluded.plan,
               status = excluded.status,
               current_period_end = excluded.current_period_end,
               updated_at = now()
         returning plan, status, current_period_end`,
        [
          row.id,
          event.providerSubscriptionId,
          event.plan,
          event.status,
          event.currentPeriodEnd,
          provider,
        ],
      );
      const subscription = result.rows[0];
      if (!subscription) return null;
      return {
        plan: subscription.plan,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end?.toISOString() ?? null,
      };
    },
  };
}

/**
 * Member-facing subscription reads. The query runs on the tenant pool so
 * row-level security answers the membership question, not this code.
 */
export interface SubscriptionReader {
  getSubscription(
    principal: { userId: string },
    organizationPublicId: string,
  ): Promise<SubscriptionView | null>;
}

export function createPostgresSubscriptionReader(pool: Pool): SubscriptionReader {
  return {
    getSubscription: (principal, organizationPublicId) =>
      withTenantTransaction(pool, principal, async (client) => {
        const result = await client.query<SubscriptionRow>(
          `select subscription.plan, subscription.status, subscription.current_period_end
           from public.subscriptions subscription
           join public.organizations org on org.id = subscription.organization_id
           where org.public_id = $1::uuid`,
          [organizationPublicId],
        );
        const row = result.rows[0];
        if (!row) return null;
        return {
          plan: row.plan,
          status: row.status,
          currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
        };
      }),
  };
}
