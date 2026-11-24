// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  createPostgresProvisioningRepository,
  createPostgresWorkspaceRepository,
} from "../packages/saas-server/index.ts";

/**
 * Integration suite for user/organization provisioning and the tenant-scoped
 * workspace repository. Skipped unless OPENCHARTS_TEST_DATABASE_URL points at
 * a disposable database (the schema is dropped and reapplied).
 */
const adminUrl = process.env.OPENCHARTS_TEST_DATABASE_URL;
const migrationsDir = path.resolve(fileURLToPath(new URL("../../db/migrations", import.meta.url)));
const loginRole = { name: "opencharts_it", password: "opencharts_it" };

describe.skipIf(adminUrl === undefined)("saas provisioning", () => {
  let admin: Pool;
  let scoped: Pool;
  let provisioningRepo: ReturnType<typeof createPostgresProvisioningRepository>;
  let workspaceRepo: ReturnType<typeof createPostgresWorkspaceRepository>;
  const runId = randomUUID().slice(0, 8);
  const orgIds: string[] = [];

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 2 });
    await admin.query("drop schema if exists public cascade; create schema public;");
    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (!file.endsWith(".sql")) continue;
      await admin.query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    }

    provisioningRepo = createPostgresProvisioningRepository(admin);

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
    workspaceRepo = createPostgresWorkspaceRepository(scoped);
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

  it("provisions a user once and updates profile fields on later sign-ins", async () => {
    const authSubject = `it-prov-${runId}`;
    const first = await provisioningRepo.provisionUser({
      authSubject,
      email: "first@example.com",
      displayName: "First",
    });
    const second = await provisioningRepo.provisionUser({
      authSubject,
      email: "second@example.com",
    });
    expect(second.userId).toBe(first.userId);
    const row = await admin.query<{ email: string | null; display_name: string | null }>(
      "select email, display_name from public.app_users where auth_subject = $1",
      [authSubject],
    );
    expect(row.rows[0]?.email).toBe("second@example.com");
    expect(row.rows[0]?.display_name).toBe("First");
  });

  it("creates an organization with the creator as owner", async () => {
    const user = await provisioningRepo.provisionUser({ authSubject: `it-org-${runId}` });
    const slug = `org-${runId}`;
    orgIds.push(slug);
    const organization = await provisioningRepo.createOrganization({
      name: "Integration Desk",
      slug,
      ownerId: user.userId,
    });
    expect(organization.slug).toBe(slug);
    expect(organization.role).toBe("owner");

    const organizations = await provisioningRepo.listOrganizations(user.userId);
    expect(organizations.map((org) => org.slug)).toContain(slug);

    await expect(
      provisioningRepo.createOrganization({ name: "Dup", slug, ownerId: user.userId }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("creates workspaces through the tenant role and enforces membership", async () => {
    const owner = await provisioningRepo.provisionUser({ authSubject: `it-ws-a-${runId}` });
    const outsider = await provisioningRepo.provisionUser({ authSubject: `it-ws-b-${runId}` });
    const slug = `ws-org-${runId}`;
    orgIds.push(slug);
    const organization = await provisioningRepo.createOrganization({
      name: slug,
      slug,
      ownerId: owner.userId,
    });

    const workspace = await workspaceRepo.createWorkspace(
      owner,
      organization.id,
      "Primary",
    );
    expect(workspace.revision).toBe(0);
    expect(workspace.name).toBe("Primary");

    await expect(
      workspaceRepo.createWorkspace(outsider, organization.id, "Sneaky"),
    ).rejects.toMatchObject({ code: "42501" });

    const ownerView = await workspaceRepo.listWorkspaces(owner.userId, organization.id);
    expect(ownerView).toHaveLength(1);
    const outsiderView = await workspaceRepo.listWorkspaces(outsider.userId, organization.id);
    expect(outsiderView).toHaveLength(0);
  });
});
