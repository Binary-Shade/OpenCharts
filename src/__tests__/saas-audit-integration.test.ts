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
  createPostgresAuditSink,
  createPostgresBillingRepository,
  createPostgresProvisioningRepository,
} from "../packages/saas-server/index.ts";

/**
 * Integration suite for the audit trail on privileged mutations. Skipped
 * unless OPENCHARTS_TEST_DATABASE_URL points at a disposable database.
 */
const adminUrl = process.env.OPENCHARTS_TEST_DATABASE_URL;
const migrationsDir = path.resolve(fileURLToPath(new URL("../../db/migrations", import.meta.url)));

describe.skipIf(adminUrl === undefined)("saas audit trail", () => {
  let admin: Pool;
  const runId = randomUUID().slice(0, 8);
  const orgIds: string[] = [];

  beforeAll(async () => {
    admin = new Pool({ connectionString: adminUrl, max: 2 });
    await admin.query("drop schema if exists public cascade; create schema public;");
    for (const file of fs.readdirSync(migrationsDir).sort()) {
      if (!file.endsWith(".sql")) continue;
      await admin.query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
    }
  });

  afterAll(async () => {
    for (const slug of orgIds) {
      await admin.query("delete from public.organizations where slug = $1", [slug]);
    }
    await admin.end();
  });

  it("audits first-time provisioning, organization creation, and billing changes", async () => {
    const audit = createPostgresAuditSink(admin);
    const provisioning = createPostgresProvisioningRepository(admin, audit);

    const authSubject = `it-audit-${runId}`;
    const first = await provisioning.provisionUser({ authSubject, email: "audit@example.com" });
    // Second sign-in is not a privileged event.
    await provisioning.provisionUser({ authSubject, email: "audit@example.com" });

    const slug = `audit-org-${runId}`;
    orgIds.push(slug);
    const organization = await provisioning.createOrganization({
      name: slug,
      slug,
      ownerId: first.userId,
      ownerPublicId: first.userPublicId,
    });

    const billing = createPostgresBillingRepository(admin, audit);
    const handler = createBillingWebhookHandler(createManualBillingProvider(), billing);
    await handler(
      new Request("https://api.test/billing/webhook", {
        method: "POST",
        body: JSON.stringify({
          eventId: `evt_${runId}`,
          organizationId: organization.id,
          providerSubscriptionId: `sub_${runId}`,
          plan: "pro",
          status: "active",
          currentPeriodEnd: "2027-01-01T00:00:00.000Z",
        }),
      }),
    );

    const events = await admin.query<{ action: string; target_public_id: string | null }>(
      "select action, target_public_id::text as target_public_id from public.audit_events order by id",
    );
    expect(events.rows.map((row) => row.action)).toEqual([
      "user.provisioned",
      "organization.created",
      "billing.subscription.changed",
    ]);
    expect(events.rows[0]?.target_public_id).toBe(first.userPublicId);
    expect(events.rows[1]?.target_public_id).toBe(organization.id);
    expect(events.rows[2]?.target_public_id).toBe(organization.id);
  });
});
