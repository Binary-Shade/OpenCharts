// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  createPostgresProvisioningRepository,
  createPostgresUserDocumentRepository,
  createPostgresWatchlistRepository,
  createPostgresWorkspaceLayoutRepository,
} from "../packages/saas-server/index.ts";

/**
 * Integration suite for revisioned user documents, workspace layouts, and
 * cloud watchlists. Skipped unless OPENCHARTS_TEST_DATABASE_URL points at a
 * disposable database (the schema is dropped and reapplied).
 */
const adminUrl = process.env.OPENCHARTS_TEST_DATABASE_URL;
const migrationsDir = path.resolve(fileURLToPath(new URL("../../db/migrations", import.meta.url)));
const loginRole = { name: "opencharts_it", password: "opencharts_it" };

describe.skipIf(adminUrl === undefined)("saas user content", () => {
  let admin: Pool;
  let scoped: Pool;
  let documents: ReturnType<typeof createPostgresUserDocumentRepository>;
  let layouts: ReturnType<typeof createPostgresWorkspaceLayoutRepository>;
  let watchlists: ReturnType<typeof createPostgresWatchlistRepository>;
  let tenantA: { userId: string };
  let tenantB: { userId: string };
  let workspaceA: string;
  let organizationA: string;
  let organizationB: string;
  const runId = randomUUID().slice(0, 8);
  const orgIds: string[] = [];

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 2 });
    await admin.query("drop schema if exists public cascade; create schema public;");
    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (!file.endsWith(".sql")) continue;
      await admin.query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    }

    const provisioning = createPostgresProvisioningRepository(admin);
    tenantA = await provisioning.provisionUser({ authSubject: `it-doc-a-${runId}` });
    tenantB = await provisioning.provisionUser({ authSubject: `it-doc-b-${runId}` });

    const slug = `doc-org-${runId}`;
    orgIds.push(slug);
    organizationA = (
      await provisioning.createOrganization({ name: slug, slug, ownerId: tenantA.userId })
    ).id;
    workspaceA = (
      await admin.query<{ public_id: string }>(
        "insert into public.workspaces (organization_id, name, created_by) values ((select id from public.organizations where slug = $1), 'Doc WS', $2) returning public_id::text",
        [slug, tenantA.userId],
      )
    ).rows[0]!.public_id;

    const slugB = `doc-org-b-${runId}`;
    orgIds.push(slugB);
    organizationB = (
      await provisioning.createOrganization({ name: slugB, slug: slugB, ownerId: tenantB.userId })
    ).id;

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
    documents = createPostgresUserDocumentRepository(scoped);
    layouts = createPostgresWorkspaceLayoutRepository(scoped);
    watchlists = createPostgresWatchlistRepository(scoped);
  });

  afterAll(async () => {
    for (const slug of orgIds) {
      await admin.query("delete from public.organizations where slug = $1", [slug]);
    }
    await admin.query(`revoke opencharts_app from ${loginRole.name}`);
    await admin.query(`drop role if exists ${loginRole.name}`);
    await scoped.end();
    await admin.end();
  });

  it("stores user documents with revisions and explicit conflicts", async () => {
    const key = `oc_drawings:v1:SYM-${runId}`;
    const created = await documents.save(tenantA, key, 0, { drawings: [{ id: "d1" }] });
    expect(created.kind).toBe("updated");
    if (created.kind !== "updated") return;
    expect(created.resource.revision).toBe(1);

    const current = await documents.get(tenantA, key);
    expect(current?.revision).toBe(1);

    const conflict = await documents.save(tenantA, key, 0, { drawings: [] });
    expect(conflict.kind).toBe("revision-conflict");
    if (conflict.kind !== "revision-conflict") return;
    expect(conflict.current.revision).toBe(1);
    expect(conflict.current.value).toEqual({ drawings: [{ id: "d1" }] });

    expect(await documents.remove(tenantA, key)).toBe(true);
    expect(await documents.get(tenantA, key)).toBeNull();
  });

  it("keeps user documents private to their owner", async () => {
    const key = `oc_journal_${runId}`;
    await documents.save(tenantA, key, 0, { entries: 3 });
    expect(await documents.get(tenantB, key)).toBeNull();
  });

  it("versions the workspace layout under the workspace revision", async () => {
    const saved = await layouts.save(tenantA, workspaceA, 0, { panes: ["main"] });
    expect(saved.kind).toBe("updated");
    if (saved.kind !== "updated") return;
    expect(saved.resource.revision).toBe(1);

    const current = await layouts.get(tenantA, workspaceA);
    expect(current?.value).toEqual({ panes: ["main"] });

    const conflict = await layouts.save(tenantA, workspaceA, 0, { panes: [] });
    expect(conflict.kind).toBe("revision-conflict");
    if (conflict.kind !== "revision-conflict") return;
    expect(conflict.current.revision).toBe(1);

    await expect(layouts.get(tenantB, workspaceA)).resolves.toBeNull();
    await expect(layouts.save(tenantB, workspaceA, 1, { panes: [] })).rejects.toMatchObject({
      code: "40001",
    });
  });

  it("manages watchlists with replace-all item writes", async () => {
    const created = await watchlists.create(tenantA, organizationA, `Watch ${runId}`);
    expect(created.revision).toBe(0);

    const saved = await watchlists.saveItems(tenantA, created.id, 0, ["BTCUSD", "ETHUSD", "SOLUSD"]);
    expect(saved.kind).toBe("updated");
    if (saved.kind !== "updated") return;
    expect(saved.resource.revision).toBe(1);

    const items = await watchlists.getItems(tenantA, created.id);
    expect(items?.value).toEqual(["BTCUSD", "ETHUSD", "SOLUSD"]);

    // Replace-all semantics: the previous list is gone after a smaller write.
    const shrunk = await watchlists.saveItems(tenantA, created.id, 1, ["BTCUSD"]);
    expect(shrunk.kind).toBe("updated");
    expect((await watchlists.getItems(tenantA, created.id))?.value).toEqual(["BTCUSD"]);

    const conflict = await watchlists.saveItems(tenantA, created.id, 1, []);
    expect(conflict.kind).toBe("revision-conflict");
    if (conflict.kind !== "revision-conflict") return;
    expect(conflict.current.value).toEqual(["BTCUSD"]);

    const foreign = await watchlists.create(tenantB, organizationB, `Foreign ${runId}`);
    await watchlists.saveItems(tenantB, foreign.id, 0, ["XRPUSD"]);
    expect(await watchlists.getItems(tenantA, foreign.id)).toBeNull();
    expect(await watchlists.getItems(tenantB, created.id)).toBeNull();
  });
});
