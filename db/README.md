# OpenCharts SaaS database

The migrations in this directory target PostgreSQL 15 or newer. They are provider-neutral and can
run on managed Postgres, Supabase, Neon, RDS, or a self-hosted cluster.

## Request identity

Every application transaction must set the authenticated internal user ID before querying tenant
data:

```sql
begin;
set local app.current_user_id = '42';
-- tenant-scoped reads/writes
commit;
```

Use `set local` inside a short transaction so pooled connections never leak identity between
requests. Do not expose the database directly with an owner or `bypassrls` role.

## Optimistic writes

Chart documents use compare-and-swap revisions. Call `public.save_chart_document` with the last
revision seen by the client. SQLSTATE `40001` means another device wrote first; fetch the current
document, reconcile, and retry explicitly. A new document starts with `expected_revision = 0`.

## Migration order

Apply files in lexical order and record each successful filename in the deployment system's
migration table. Never edit an applied migration; add a new migration instead.
