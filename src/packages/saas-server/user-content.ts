import type { Pool, PoolClient } from "pg";
import type { RevisionWriteResult, VersionedResource } from "../saas-core/model.ts";
import {
  casTenantWrite,
  withTenantTransaction,
  type AuthenticatedPrincipal,
} from "./postgres.ts";

/**
 * Revisioned, user-scoped blob storage. The terminal keeps drawings, journal
 * exports, templates, and preferences under opaque keys, so the cloud bridge
 * keeps the same contract and lets each device resolve conflicts explicitly.
 */
export interface UserDocumentRepository {
  get(principal: AuthenticatedPrincipal, key: string): Promise<VersionedResource<unknown> | null>;
  save(
    principal: AuthenticatedPrincipal,
    key: string,
    expectedRevision: number,
    document: unknown,
  ): Promise<RevisionWriteResult<unknown>>;
  remove(principal: AuthenticatedPrincipal, key: string): Promise<boolean>;
}

interface DocumentRow {
  revision: string;
  updated_at: Date;
  document: unknown;
}

function toVersioned(row: DocumentRow): VersionedResource<unknown> {
  return {
    revision: Number(row.revision),
    updatedAt: row.updated_at.toISOString(),
    value: row.document,
  };
}

const DOCUMENT_SELECT = `
  select revision::text as revision, updated_at, document
  from public.user_documents
  where user_id = private.current_user_id() and document_key = $1`;

export function createPostgresUserDocumentRepository(pool: Pool): UserDocumentRepository {
  const read = async (client: PoolClient, key: string) => {
    const result = await client.query<DocumentRow>(DOCUMENT_SELECT, [key]);
    const row = result.rows[0];
    return row ? toVersioned(row) : null;
  };

  return {
    get: (principal, key) =>
      withTenantTransaction(pool, principal, (client) => read(client, key)),

    save: (principal, key, expectedRevision, document) =>
      casTenantWrite({
        pool,
        principal,
        expectedRevision,
        attempt: async (client) => {
          const updated = await client.query<{ revision: string; updated_at: Date }>(
            `update public.user_documents
             set document = $3::jsonb, revision = revision + 1, updated_at = now()
             where user_id = private.current_user_id() and document_key = $1 and revision = $2
             returning revision::text as revision, updated_at`,
            [key, expectedRevision, JSON.stringify(document ?? null)],
          );
          const row = updated.rows[0];
          if (row) {
            return {
              revision: Number(row.revision),
              updatedAt: row.updated_at.toISOString(),
              value: document,
            };
          }
          if (expectedRevision !== 0) {
            throw Object.assign(new Error("document revision conflict"), { code: "40001" });
          }
          const inserted = await client.query<{ revision: string; updated_at: Date }>(
            `insert into public.user_documents (user_id, document_key, revision, document)
             values (private.current_user_id(), $1, 1, $2::jsonb)
             on conflict (user_id, document_key) do nothing
             returning revision::text as revision, updated_at`,
            [key, JSON.stringify(document ?? null)],
          );
          const insertedRow = inserted.rows[0];
          if (!insertedRow) {
            throw Object.assign(new Error("document revision conflict"), { code: "40001" });
          }
          return {
            revision: Number(insertedRow.revision),
            updatedAt: insertedRow.updated_at.toISOString(),
            value: document,
          };
        },
        readCurrent: (client) => read(client, key),
      }),

    remove: (principal, key) =>
      withTenantTransaction(pool, principal, async (client) => {
        const result = await client.query(
          `delete from public.user_documents
           where user_id = private.current_user_id() and document_key = $1`,
          [key],
        );
        return (result.rowCount ?? 0) > 0;
      }),
  };
}

/** Workspace layout stored on the workspace row itself, CAS via its revision. */
export interface WorkspaceLayoutRepository {
  get(
    principal: AuthenticatedPrincipal,
    workspaceId: string,
  ): Promise<VersionedResource<unknown> | null>;
  save(
    principal: AuthenticatedPrincipal,
    workspaceId: string,
    expectedRevision: number,
    layout: unknown,
  ): Promise<RevisionWriteResult<unknown>>;
}

interface LayoutRow {
  revision: string;
  updated_at: Date;
  layout: unknown;
}

export function createPostgresWorkspaceLayoutRepository(pool: Pool): WorkspaceLayoutRepository {
  const read = async (client: PoolClient, workspaceId: string) => {
    const result = await client.query<LayoutRow>(
      `select workspace.revision::text as revision, workspace.updated_at, workspace.layout
       from public.workspaces workspace
       where workspace.public_id = $1::uuid`,
      [workspaceId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      revision: Number(row.revision),
      updatedAt: row.updated_at.toISOString(),
      value: row.layout,
    };
  };

  return {
    get: (principal, workspaceId) =>
      withTenantTransaction(pool, principal, (client) => read(client, workspaceId)),

    save: (principal, workspaceId, expectedRevision, layout) =>
      casTenantWrite({
        pool,
        principal,
        expectedRevision,
        attempt: async (client) => {
          const result = await client.query<{ revision: string; updated_at: Date }>(
            `update public.workspaces workspace
             set layout = $2::jsonb, revision = workspace.revision + 1, updated_at = now()
             where workspace.public_id = $1::uuid and workspace.revision = $3
             returning workspace.revision::text as revision, workspace.updated_at`,
            [workspaceId, JSON.stringify(layout ?? null), expectedRevision],
          );
          const row = result.rows[0];
          if (!row) {
            throw Object.assign(new Error("workspace layout revision conflict"), {
              code: "40001",
            });
          }
          return {
            revision: Number(row.revision),
            updatedAt: row.updated_at.toISOString(),
            value: layout,
          };
        },
        readCurrent: (client) => read(client, workspaceId),
      }),
  };
}

/**
 * Answers "is this principal a member of this organization" through the
 * tenant pool, so row-level security is the enforcement point.
 */
export interface MembershipRepository {
  isMember(principal: AuthenticatedPrincipal, organizationId: string): Promise<boolean>;
}

export function createPostgresMembershipRepository(pool: Pool): MembershipRepository {
  return {
    isMember: (principal, organizationId) =>
      withTenantTransaction(pool, principal, async (client) => {
        const result = await client.query<{ ok: number }>(
          "select 1 as ok from public.organizations where public_id = $1::uuid limit 1",
          [organizationId],
        );
        return result.rows.length > 0;
      }),
  };
}

export interface WatchlistRef {
  id: string;
  organizationId: string;
  name: string;
  revision: number;
}

export interface WatchlistRepository {
  create(
    principal: AuthenticatedPrincipal,
    organizationId: string,
    name: string,
  ): Promise<WatchlistRef>;
  list(principal: AuthenticatedPrincipal, organizationId: string): Promise<WatchlistRef[]>;
  remove(principal: AuthenticatedPrincipal, watchlistId: string): Promise<boolean>;
  getItems(
    principal: AuthenticatedPrincipal,
    watchlistId: string,
  ): Promise<VersionedResource<string[]> | null>;
  saveItems(
    principal: AuthenticatedPrincipal,
    watchlistId: string,
    expectedRevision: number,
    items: string[],
  ): Promise<RevisionWriteResult<string[]>>;
}

interface WatchlistRow {
  public_id: string;
  name: string;
  revision: string;
  updated_at: Date;
}

export function createPostgresWatchlistRepository(pool: Pool): WatchlistRepository {
  const readItems = async (client: PoolClient, watchlistId: string) => {
    const meta = await client.query<WatchlistRow>(
      `select watchlist.public_id::text as public_id, watchlist.name,
              watchlist.revision::text as revision, watchlist.updated_at
       from public.watchlists watchlist
       where watchlist.public_id = $1::uuid`,
      [watchlistId],
    );
    const row = meta.rows[0];
    if (!row) return null;
    const items = await client.query<{ instrument_id: string }>(
      `select item.instrument_id
       from public.watchlist_items item
       join public.watchlists watchlist on watchlist.id = item.watchlist_id
       where watchlist.public_id = $1::uuid
       order by item.position`,
      [watchlistId],
    );
    return {
      revision: Number(row.revision),
      updatedAt: row.updated_at.toISOString(),
      value: items.rows.map((item) => item.instrument_id),
    };
  };

  return {
    create: (principal, organizationId, name) =>
      withTenantTransaction(pool, principal, async (client) => {
        const result = await client.query<WatchlistRow>(
          `insert into public.watchlists (organization_id, name, created_by)
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
        return {
          id: row.public_id,
          organizationId,
          name: row.name,
          revision: Number(row.revision),
        };
      }),

    list: (principal, organizationId) =>
      withTenantTransaction(pool, principal, async (client) => {
        const result = await client.query<WatchlistRow>(
          `select watchlist.public_id::text as public_id, watchlist.name, watchlist.revision::text as revision
           from public.watchlists watchlist
           join public.organizations org on org.id = watchlist.organization_id
           where org.public_id = $1::uuid
           order by watchlist.created_at, watchlist.id`,
          [organizationId],
        );
        return result.rows.map((row) => ({
          id: row.public_id,
          organizationId,
          name: row.name,
          revision: Number(row.revision),
        }));
      }),

    remove: (principal, watchlistId) =>
      withTenantTransaction(pool, principal, async (client) => {
        const result = await client.query(
          "delete from public.watchlists where public_id = $1::uuid",
          [watchlistId],
        );
        return (result.rowCount ?? 0) > 0;
      }),

    getItems: (principal, watchlistId) =>
      withTenantTransaction(pool, principal, (client) => readItems(client, watchlistId)),

    saveItems: (principal, watchlistId, expectedRevision, items) =>
      casTenantWrite({
        pool,
        principal,
        expectedRevision,
        attempt: async (client) => {
          for (const instrument of items) {
            if (!instrument.trim() || instrument.length > 160) {
              throw new Error("Watchlist instruments must be 1-160 characters");
            }
          }
          const updated = await client.query<{ revision: string }>(
            `update public.watchlists watchlist
             set revision = watchlist.revision + 1, updated_at = now()
             where watchlist.public_id = $1::uuid and watchlist.revision = $2
             returning watchlist.revision::text as revision`,
            [watchlistId, expectedRevision],
          );
          const row = updated.rows[0];
          if (!row) {
            throw Object.assign(new Error("watchlist revision conflict"), { code: "40001" });
          }
          await client.query(
            "delete from public.watchlist_items where watchlist_id = (select id from public.watchlists where public_id = $1::uuid)",
            [watchlistId],
          );
          if (items.length > 0) {
            await client.query(
              `insert into public.watchlist_items (watchlist_id, instrument_id, position)
               select (select id from public.watchlists where public_id = $1::uuid),
                      instrument, position - 1
               from jsonb_array_elements_text($2::jsonb) with ordinality as t(instrument, position)`,
              [watchlistId, JSON.stringify(items)],
            );
          }
          return { revision: Number(row.revision), updatedAt: new Date().toISOString(), value: items };
        },
        readCurrent: (client) => readItems(client, watchlistId),
      }),
  };
}
