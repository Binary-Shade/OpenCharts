import type { Pool } from "pg";

/**
 * Privileged mutations run on the service role (user provisioning,
 * organization creation, billing transitions) and must leave an audit trail.
 * Tenant-scoped content writes are ordinary user actions and are covered by
 * the revision history instead.
 */
export interface AuditEvent {
  /** Public organization id, resolved internally by the sink. */
  organizationId: string | null;
  /** Public user id, resolved internally by the sink. */
  actorUserId: string | null;
  /** Dot-namespaced verb, e.g. "user.provisioned" or "billing.subscription.changed". */
  action: string;
  targetType: "user" | "organization" | "subscription";
  /** Public id of the affected resource (uuid columns only). */
  targetId: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditSink {
  record(event: AuditEvent): Promise<void>;
}

/**
 * Runs on the service-role connection: privileged mutations have no tenant
 * identity to satisfy the insert policy with.
 */
export function createPostgresAuditSink(pool: Pool): AuditSink {
  return {
    async record(event) {
      await pool.query(
        `insert into public.audit_events
           (organization_id, actor_user_id, action, target_type, target_public_id, metadata)
         values (
           case when $1::uuid is null then null
                else (select id from public.organizations where public_id = $1::uuid) end,
           case when $2::text is null then null
                else (select id from public.app_users where public_id = $2::uuid) end,
           $3, $4, $5, $6::jsonb
         )`,
        [
          event.organizationId,
          event.actorUserId,
          event.action,
          event.targetType,
          event.targetId,
          JSON.stringify(event.metadata ?? {}),
        ],
      );
    },
  };
}
