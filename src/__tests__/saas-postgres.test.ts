// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createDrawingDocument } from "../packages/drawing-engine/schema.ts";
import {
  createPostgresChartDocumentRepository,
  type AuthenticatedPrincipal,
} from "../packages/saas-server/postgres.ts";

/**
 * Integration suite for the tenant-safe Postgres layer. Skipped unless
 * OPENCHARTS_TEST_DATABASE_URL points at a disposable database whose owner
 * may apply migrations and seed tenants (the schema is dropped first).
 */
const adminUrl = process.env.OPENCHARTS_TEST_DATABASE_URL;
const migrationsDir = path.resolve(fileURLToPath(new URL("../../db/migrations", import.meta.url)));
const loginRole = { name: "opencharts_it", password: "opencharts_it" };

describe.skipIf(adminUrl === undefined)("saas postgres repository", () => {
  let admin: Pool;
  let scoped: Pool;
  let repo: ReturnType<typeof createPostgresChartDocumentRepository>;
  let tenantA: AuthenticatedPrincipal;
  let tenantB: AuthenticatedPrincipal;
  let workspaceA: string;
  let workspaceB: string;
  const runId = randomUUID().slice(0, 8);

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 2 });
    // Recreate a clean schema so reruns against a shared disposable database are safe.
    await admin.query("drop schema if exists public cascade; create schema public;");
    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (!file.endsWith(".sql")) continue;
      await admin.query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    }

    tenantA = { userId: (await seedUser("a")).toString() };
    tenantB = { userId: (await seedUser("b")).toString() };
    workspaceA = await seedWorkspace(tenantA, `ws-a-${runId}`);
    workspaceB = await seedWorkspace(tenantB, `ws-b-${runId}`);

    await admin.query(
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname = '${loginRole.name}') then
           create role ${loginRole.name} login password '${loginRole.password}';
         end if;
       end $$;
       grant opencharts_app to ${loginRole.name};`,
    );
    const url = new URL(adminUrl as string);
    url.username = loginRole.name;
    url.password = loginRole.password;
    scoped = new Pool({ connectionString: url.toString(), max: 2 });
    repo = createPostgresChartDocumentRepository(scoped);
  });

  afterAll(async () => {
    await admin.query(`revoke opencharts_app from ${loginRole.name}`);
    await admin.query(`drop role if exists ${loginRole.name}`);
    await scoped.end();
    await admin.end();
  });

  function firstRow<T extends Record<string, unknown>>(result: {
    rows: T[];
  }): T {
    const row = result.rows[0];
    if (!row) throw new Error("Query returned no rows");
    return row;
  }

  async function seedUser(tag: string): Promise<number> {
    const result = await admin.query<{ id: number }>(
      "insert into public.app_users (auth_subject, email, display_name) values ($1, $2, $3) returning id",
      [`it-${tag}-${runId}@test`, `it-${tag}-${runId}@test`, `IT ${tag}`],
    );
    return firstRow(result).id;
  }

  async function seedWorkspace(principal: AuthenticatedPrincipal, name: string): Promise<string> {
    const org = await admin.query<{ id: number }>(
      "insert into public.organizations (name, slug) values ($1, $2) returning id",
      [name, name],
    );
    await admin.query(
      "insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'owner')",
      [firstRow(org).id, principal.userId],
    );
    const workspace = await admin.query<{ public_id: string }>(
      "insert into public.workspaces (organization_id, name, created_by) values ($1, $2, $3) returning public_id",
      [firstRow(org).id, name, principal.userId],
    );
    return firstRow(workspace).public_id;
  }

  it("rejects tenant data before identity is set", async () => {
    const result = await scoped.query<{ count: string }>(
      "select count(*)::text as count from public.workspaces",
    );
    expect(firstRow(result).count).toBe("0");
  });

  it("creates, reads, and versions chart documents", async () => {
    const symbolId = `SYM-${runId}-a`;
    const document = createDrawingDocument(symbolId);
    const created = await repo.save(tenantA, workspaceA, symbolId, 0, document);
    expect(created.kind).toBe("updated");
    if (created.kind !== "updated") return;
    expect(created.resource.revision).toBe(1);

    const current = await repo.get(tenantA, workspaceA, symbolId);
    expect(current).toEqual(created.resource);

    const next = await repo.save(tenantA, workspaceA, symbolId, 1, document);
    expect(next.kind).toBe("updated");
    if (next.kind !== "updated") return;
    expect(next.resource.revision).toBe(2);
  });

  it("maps stale revisions to a conflict carrying the current document", async () => {
    const symbolId = `SYM-${runId}-b`;
    const document = createDrawingDocument(symbolId);
    await repo.save(tenantA, workspaceA, symbolId, 0, document);
    const conflict = await repo.save(tenantA, workspaceA, symbolId, 0, document);
    expect(conflict.kind).toBe("revision-conflict");
    if (conflict.kind !== "revision-conflict") return;
    expect(conflict.expectedRevision).toBe(0);
    expect(conflict.current.revision).toBe(1);
    expect(conflict.current.value.symbolId).toBe(symbolId);
  });

  it("hides other tenants' workspaces from reads and writes", async () => {
    const symbolId = `SYM-${runId}-c`;
    await repo.save(tenantB, workspaceB, symbolId, 0, createDrawingDocument(symbolId));

    await expect(repo.get(tenantA, workspaceB, symbolId)).resolves.toBeNull();
    await expect(
      repo.save(tenantA, workspaceB, symbolId, 0, createDrawingDocument(symbolId)),
    ).rejects.toThrow();
    await expect(repo.get(tenantB, workspaceB, symbolId)).resolves.not.toBeNull();
  });
});
