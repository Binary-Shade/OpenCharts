import type { EntitlementSet, SubscriptionPlan, SubscriptionStatus } from "./model.ts";

const PLAN_FEATURES: Record<SubscriptionPlan, readonly string[]> = {
  free: ["chart.single", "drawings.basic", "data.delayed"],
  pro: ["chart.multi", "drawings.full", "data.realtime", "alerts.cloud"],
  premium: ["chart.multi", "drawings.full", "data.realtime", "alerts.cloud", "scripts", "backtests"],
  enterprise: ["chart.multi", "drawings.full", "data.realtime", "alerts.cloud", "scripts", "backtests", "api", "sso"],
};

const PLAN_LIMITS: Record<SubscriptionPlan, Readonly<Record<string, number>>> = {
  free: { chartLayouts: 1, alerts: 3, watchlists: 1 },
  pro: { chartLayouts: 4, alerts: 100, watchlists: 20 },
  premium: { chartLayouts: 8, alerts: 500, watchlists: 100 },
  enterprise: { chartLayouts: 32, alerts: 10_000, watchlists: 1_000 },
};

export function createEntitlements(
  plan: SubscriptionPlan,
  status: SubscriptionStatus,
): EntitlementSet {
  const enabled = status === "active" || status === "trialing";
  return {
    plan,
    status,
    features: new Set(enabled ? PLAN_FEATURES[plan] : PLAN_FEATURES.free),
    limits: enabled ? PLAN_LIMITS[plan] : PLAN_LIMITS.free,
  };
}

export function hasEntitlement(set: EntitlementSet, feature: string): boolean {
  return set.features.has(feature);
}
