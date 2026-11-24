// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  createBillingWebhookHandler,
  createManualBillingProvider,
  createPostgresBillingRepository,
  createPostgresMembershipRepository,
  createPostgresProvisioningRepository,
  createPostgresSubscriptionReader,
} from "../packages/saas-server/index.ts";

/**
 * Integration suite for idempotent billing ingestion and member-scoped
 * subscription reads. Skipped unless OPENCHARTS_TEST_DATABASE_URL points at
 * a disposable database (the schema is dropped and reapplied).
 */
const adminUrl = process.env.OPENCHARTS_TEST_DATABASE_URL;
const migrationsDir = path.resolve(fileURLToPath(new URL("../../db/migrations", import.meta.url)));
const loginRole = { name: "opencharts_it", password: "opencharts_it" };

describe.skipIf(adminUrl === undefined)("saas billing", () => {
  let admin: Pool;
  let scoped: Pool;
  let organizationId: string;
  let tenantA: { userId: string };
  let tenantB: { userId: string };
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
    tenantA = await provisioning.provisionUser({ authSubject: `it-bill-a-${runId}` });
    tenantB = await provisioning.provisionUser({ authSubject: `it-bill-b-${runId}` });
    const slug = `bill-org-${runId}`;
    orgIds.push(slug);
    organizationId = (
      await provisioning.createOrganization({ name: slug, slug, ownerId: tenantA.userId })
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

  it("applies webhooks idempotently and exposes subscriptions to members only", async () => {
    const provider = createManualBillingProvider();
    const billing = createPostgresBillingRepository(admin);
    const handler = createBillingWebhookHandler(provider, billing);

    const event = {
      eventId: `evt_${runId}`,
      organizationId,
      providerSubscriptionId: `sub_${runId}`,
      plan: "pro",
      status: "active",
      currentPeriodEnd: "2027-01-01T00:00:00.000Z",
    };
    const first = (await (
      await handler(
        new Request("https://api.test/billing/webhook", {
          method: "POST",
          body: JSON.stringify(event),
        }),
      )
    ).json()) as { applied: boolean };
    expect(first.applied).toBe(true);

    const reader = createPostgresSubscriptionReader(scoped);
    const subscription = await reader.getSubscription(tenantA, organizationId);
    expect(subscription?.plan).toBe("pro");
    expect(subscription?.status).toBe("active");

    // A provider replay must not double-apply or insert a duplicate event.
    const replay = (await (
      await handler(
        new Request("https://api.test/billing/webhook", {
          method: "POST",
          body: JSON.stringify(event),
        }),
      )
    ).json()) as { applied: boolean; replay?: boolean };
    expect(replay.applied).toBe(false);
    expect(replay.replay).toBe(true);
    const events = await admin.query<{ count: string }>(
      "select count(*)::text as count from public.billing_events",
    );
    expect(events.rows[0]?.count).toBe("1");

    // Upgrades flow through later events for the same organization.
    await handler(
      new Request("https://api.test/billing/webhook", {
        method: "POST",
        body: JSON.stringify({ ...event, eventId: `evt_${runId}_2`, plan: "premium" }),
      }),
    );
    expect((await reader.getSubscription(tenantA, organizationId))?.plan).toBe("premium");

    // Non-members never see the subscription; the handler falls back to free.
    expect(await reader.getSubscription(tenantB, organizationId)).toBeNull();

    const memberships = createPostgresMembershipRepository(scoped);
    expect(await memberships.isMember(tenantA, organizationId)).toBe(true);
    expect(await memberships.isMember(tenantB, organizationId)).toBe(false);
  });
});
