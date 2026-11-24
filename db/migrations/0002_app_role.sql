-- The application connects as a role that inherits these grants. It must not
-- own tables or hold BYPASSRLS, so every policy in 0001_saas_foundation.sql
-- actually applies. Provision logins by granting membership:
--   create role app_prod login password '...';
--   grant opencharts_app to app_prod;
begin;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'opencharts_app') then
    create role opencharts_app nologin;
  end if;
end
$$;

grant usage on schema public to opencharts_app;

grant select, insert, update, delete on all tables in schema public to opencharts_app;
grant usage, select on all sequences in schema public to opencharts_app;

alter default privileges in schema public
  grant select, insert, update, delete on tables to opencharts_app;
alter default privileges in schema public
  grant usage, select on sequences to opencharts_app;

commit;
