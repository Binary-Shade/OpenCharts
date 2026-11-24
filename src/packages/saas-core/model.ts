export type OrganizationRole = "owner" | "admin" | "member" | "viewer";
export type SubscriptionPlan = "free" | "pro" | "premium" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "paused" | "canceled";

export interface TenantIdentity {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
}

export interface WorkspaceRef {
  id: string;
  organizationId: string;
  name: string;
  revision: number;
}

export interface VersionedResource<T> {
  revision: number;
  updatedAt: string;
  value: T;
}

export interface RevisionWrite<T> {
  expectedRevision: number;
  value: T;
}

export interface RevisionConflict<T> {
  kind: "revision-conflict";
  expectedRevision: number;
  current: VersionedResource<T>;
}

export type RevisionWriteResult<T> =
  | { kind: "updated"; resource: VersionedResource<T> }
  | RevisionConflict<T>;

export interface EntitlementSet {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  features: ReadonlySet<string>;
  limits: Readonly<Record<string, number>>;
}
