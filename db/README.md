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
Because the conflict raise aborts the failed transaction, the current document must be read in a
fresh transaction (the `saas-server` repository already does this).

## Application role

`0002_app_role.sql` creates the `opencharts_app` group role holding the minimal table and sequence
grants. Application logins must not own tables or hold `BYPASSRLS`, otherwise the row-level security
policies in `0001_saas_foundation.sql` never apply:

```sql
create role app_prod login password '...';
grant opencharts_app to app_prod;
```

Every request then runs inside a transaction that sets `app.current_user_id` as above.

## Integration tests

`src/__tests__/saas-postgres.test.ts` applies these migrations to a disposable database, seeds two
tenants, connects as a member of `opencharts_app`, and verifies tenant isolation plus revision
conflicts. Run it against a local disposable instance:

```sh
/usr/lib/postgresql/16/bin/initdb -D /tmp/pgdata -U postgres --auth=trust
/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pgdata -o "-p 5433 -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp" -l /tmp/pg.log start
/usr/lib/postgresql/16/bin/createdb -h 127.0.0.1 -p 5433 -U postgres opencharts_test
OPENCHARTS_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5433/opencharts_test' npm run test:postgres
```

CI runs the same suite as the `database` job against a `postgres:16` service.

## Migration order

Apply files in lexical order and record each successful filename in the deployment system's
migration table. Never edit an applied migration; add a new migration instead.
