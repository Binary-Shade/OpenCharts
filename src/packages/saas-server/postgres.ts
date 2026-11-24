import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import type { DrawingDocument } from "../drawing-engine/model.ts";
import type { RevisionWriteResult, VersionedResource } from "../saas-core/model.ts";

export interface AuthenticatedPrincipal {
  /** Internal `app_users.id`, resolved only after the host verifies its auth token. */
  userId: string;
}

export interface ChartDocumentRepository {
  get(
    principal: AuthenticatedPrincipal,
    workspaceId: string,
    symbolId: string,
  ): Promise<VersionedResource<DrawingDocument> | null>;
  save(
    principal: AuthenticatedPrincipal,
    workspaceId: string,
    symbolId: string,
    expectedRevision: number,
    document: DrawingDocument,
  ): Promise<RevisionWriteResult<DrawingDocument>>;
}

interface ChartDocumentRow extends QueryResultRow {
  revision: string;
  updated_at: Date;
  document: DrawingDocument;
}

function versioned(row: ChartDocumentRow): VersionedResource<DrawingDocument> {
  return {
    revision: Number(row.revision),
    updatedAt: row.updated_at.toISOString(),
    value: row.document,
  };
}

export async function withTenantTransaction<T>(
  pool: Pool,
  principal: AuthenticatedPrincipal,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!/^\d+$/.test(principal.userId)) throw new Error("Invalid authenticated user id");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_user_id', $1, true)", [principal.userId]);
    await client.query("select set_config('statement_timeout', '5000', true)");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function createPostgresPool(config: PoolConfig): Pool {
  return new Pool({
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...config,
  });
}

/**
 * Runs a compare-and-swap write in its own tenant transaction. A revision
 * conflict raise aborts that transaction, so the current resource is read in
 * a fresh tenant transaction before the conflict is reported.
 */
export async function casTenantWrite<T>(args: {
  pool: Pool;
  principal: AuthenticatedPrincipal;
  attempt: (client: PoolClient) => Promise<VersionedResource<T>>;
  readCurrent: (client: PoolClient) => Promise<VersionedResource<T> | null>;
  expectedRevision: number;
}): Promise<RevisionWriteResult<T>> {
  try {
    const resource = await withTenantTransaction(args.pool, args.principal, args.attempt);
    return { kind: "updated", resource };
  } catch (error) {
    if (!isPostgresError(error, "40001")) throw error;
    const current = await withTenantTransaction(args.pool, args.principal, args.readCurrent);
    if (!current) throw error;
    return { kind: "revision-conflict", expectedRevision: args.expectedRevision, current };
  }
}

export function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

export function createPostgresChartDocumentRepository(pool: Pool): ChartDocumentRepository {
  const read = async (
    client: PoolClient,
    workspaceId: string,
    symbolId: string,
  ): Promise<VersionedResource<DrawingDocument> | null> => {
    const result = await client.query<ChartDocumentRow>(
      `select chart.revision, chart.updated_at, chart.document
       from public.chart_documents chart
       join public.workspaces workspace on workspace.id = chart.workspace_id
       where workspace.public_id = $1::uuid and chart.symbol_id = $2`,
      [workspaceId, symbolId],
    );
    const row = result.rows[0];
    return row ? versioned(row) : null;
  };

  return {
    get: (principal, workspaceId, symbolId) =>
      withTenantTransaction(pool, principal, (client) => read(client, workspaceId, symbolId)),

    save: (principal, workspaceId, symbolId, expectedRevision, document) =>
      casTenantWrite({
        pool,
        principal,
        expectedRevision,
        attempt: async (client) => {
          const result = await client.query<{ revision: string; updated_at: Date }>(
            "select revision, updated_at from public.save_chart_document($1::uuid, $2, $3, $4::jsonb)",
            [workspaceId, symbolId, expectedRevision, JSON.stringify(document)],
          );
          const row = result.rows[0];
          if (!row) throw new Error("Chart document save returned no revision");
          return {
            revision: Number(row.revision),
            updatedAt: row.updated_at.toISOString(),
            value: document,
          };
        },
        readCurrent: (client) => read(client, workspaceId, symbolId),
      }),
  };
}
