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

    save: async (principal, workspaceId, symbolId, expectedRevision, document) => {
      try {
        return await withTenantTransaction(pool, principal, async (client) => {
          const result = await client.query<{ revision: string; updated_at: Date }>(
            "select revision, updated_at from public.save_chart_document($1::uuid, $2, $3, $4::jsonb)",
            [workspaceId, symbolId, expectedRevision, JSON.stringify(document)],
          );
          const row = result.rows[0];
          if (!row) throw new Error("Chart document save returned no revision");
          return {
            kind: "updated",
            resource: {
              revision: Number(row.revision),
              updatedAt: row.updated_at.toISOString(),
              value: document,
            },
          };
        });
      } catch (error) {
        // The conflict raise aborts the failed transaction, so the current
        // document must be read in a fresh tenant transaction.
        if (!isPostgresError(error, "40001")) throw error;
        const current = await withTenantTransaction(pool, principal, (client) =>
          read(client, workspaceId, symbolId),
        );
        if (!current) throw error;
        return { kind: "revision-conflict", expectedRevision, current };
      }
    },
  };
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
