import type { Pool } from "pg";
import type { OrganizationRole, WorkspaceRef } from "../saas-core/model.ts";
import {
  withTenantTransaction,
  type AuthenticatedPrincipal,
} from "./postgres.ts";

/**
 * Identity resolved by the host from a verified auth token, before any
 * internal user exists. `authSubject` is the stable provider identifier
 * (for example the `sub` claim) and must never be a raw email address.
 */
export interface AuthenticatedSubject {
  authSubject: string;
  email?: string | null;
  displayName?: string | null;
}

export interface ProvisionedUser extends AuthenticatedPrincipal {
  userPublicId: string;
}

export interface OrganizationRef {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
}

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerId: string;
}

/**
 * Runs on the service-role connection. Row-level security cannot admit a
 * brand-new user (`app_users_self` needs a current user id that does not
 * exist yet), so provisioning and organization creation intentionally use
 * the elevated pool. Everything after sign-in stays on the tenant pool.
 */
export interface TenantProvisioningRepository {
  provisionUser(subject: AuthenticatedSubject): Promise<ProvisionedUser>;
  createOrganization(input: CreateOrganizationInput): Promise<OrganizationRef>;
  listOrganizations(userId: string): Promise<OrganizationRef[]>;
}

export interface TenantWorkspaceRepository {
  createWorkspace(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    name: string,
  ): Promise<WorkspaceRef>;
  listWorkspaces(userId: string, organizationId: string): Promise<WorkspaceRef[]>;
}

interface UserRow {
  id: string;
  public_id: string;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
}

interface WorkspaceRow {
  public_id: string;
  name: string;
  revision: string;
}

export function createPostgresProvisioningRepository(pool: Pool): TenantProvisioningRepository {
  return {
    async provisionUser(subject) {
      if (!subject.authSubject?.trim()) throw new Error("Provisioning requires an auth subject");
      const result = await pool.query<UserRow>(
        `insert into public.app_users (auth_subject, email, display_name)
         values ($1, $2, $3)
         on conflict (auth_subject) do update
           set email = coalesce(excluded.email, public.app_users.email),
               display_name = coalesce(excluded.display_name, public.app_users.display_name),
               updated_at = now()
         returning id::text as id, public_id::text as public_id`,
        [subject.authSubject, subject.email ?? null, subject.displayName ?? null],
      );
      const row = result.rows[0];
      if (!row) throw new Error("User provisioning returned no row");
      return { userId: row.id, userPublicId: row.public_id };
    },

    async createOrganization(input) {
      const result = await pool.query<OrganizationRow>(
        `with created as (
           insert into public.organizations (name, slug)
           values ($1, $2)
           returning id, public_id::text as public_uuid, name, slug
         ), owner as (
           insert into public.organization_members (organization_id, user_id, role)
           select created.id, $3::bigint, 'owner' from created
         )
         select created.public_uuid as id, created.name, created.slug, 'owner'::text as role
         from created`,
        [input.name, input.slug, input.ownerId],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Organization creation returned no row");
      return row;
    },

    async listOrganizations(userId) {
      const result = await pool.query<OrganizationRow>(
        `select org.public_id::text as id, org.name, org.slug, member.role
         from public.organization_members member
         join public.organizations org on org.id = member.organization_id
         where member.user_id = $1::bigint
         order by org.created_at, org.id`,
        [userId],
      );
      return result.rows;
    },
  };
}

export function createPostgresWorkspaceRepository(pool: Pool): TenantWorkspaceRepository {
  return {
    // Workspace writes go through the tenant pool: the RLS `with check`
    // admits only members, so membership is enforced by the database.
    createWorkspace: (principal, organizationId, name) =>
      withTenantTransaction(pool, principal, async (client) => {
        const result = await client.query<WorkspaceRow>(
          `insert into public.workspaces (organization_id, name, created_by)
           select org.id, $2, $3::bigint
           from public.organizations org
           where org.public_id = $1::uuid
           returning public_id::text as public_id, name, revision::text as revision`,
          [organizationId, name, principal.userId],
        );
        const row = result.rows[0];
        if (!row) {
          throw Object.assign(new Error("Organization not found or not a member"), {
            code: "42501",
          });
        }
        return { id: row.public_id, organizationId, name: row.name, revision: Number(row.revision) };
      }),

    listWorkspaces: (userId, organizationId) =>
      withTenantTransaction(pool, { userId }, async (client) => {
        const result = await client.query<WorkspaceRow>(
          `select workspace.public_id::text as public_id, workspace.name, workspace.revision::text as revision
           from public.workspaces workspace
           join public.organizations org on org.id = workspace.organization_id
           where org.public_id = $1::uuid
           order by workspace.created_at, workspace.id`,
          [organizationId],
        );
        return result.rows.map((row) => ({
          id: row.public_id,
          organizationId,
          name: row.name,
          revision: Number(row.revision),
        }));
      }),
  };
}
