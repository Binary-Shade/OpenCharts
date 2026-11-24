import type { SubscriptionPlan, SubscriptionStatus } from "./model.ts";

/** The subscription state a client is allowed to see. */
export interface SubscriptionView {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: string | null;
}

export interface CheckoutRequest {
  organizationId: string;
  plan: SubscriptionPlan;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
}
