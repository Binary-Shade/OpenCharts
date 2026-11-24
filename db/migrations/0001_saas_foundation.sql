begin;

create extension if not exists pgcrypto;
create schema if not exists private;

create table public.app_users (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  auth_subject text not null unique,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  name text not null check (length(trim(name)) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id bigint not null references public.organizations(id) on delete cascade,
  user_id bigint not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_id_idx on public.organization_members (user_id, organization_id);

create table public.workspaces (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  revision bigint not null default 0 check (revision >= 0),
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object'),
  created_by bigint not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index workspaces_organization_updated_idx on public.workspaces (organization_id, updated_at desc);
create index workspaces_created_by_idx on public.workspaces (created_by);

create table public.chart_documents (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id) on delete cascade,
  symbol_id text not null check (length(trim(symbol_id)) between 1 and 160),
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, symbol_id)
);
create index chart_documents_workspace_updated_idx on public.chart_documents (workspace_id, updated_at desc);

create table public.watchlists (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  revision bigint not null default 0 check (revision >= 0),
  created_by bigint not null references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index watchlists_organization_updated_idx on public.watchlists (organization_id, updated_at desc);
create index watchlists_created_by_idx on public.watchlists (created_by);

create table public.watchlist_items (
  watchlist_id bigint not null references public.watchlists(id) on delete cascade,
  instrument_id text not null check (length(trim(instrument_id)) between 1 and 160),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (watchlist_id, instrument_id),
  unique (watchlist_id, position)
);

create table public.subscriptions (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete cascade unique,
  provider text not null check (provider in ('paddle', 'stripe', 'manual')),
  provider_customer_id text,
  provider_subscription_id text unique,
  plan text not null check (plan in ('free', 'pro', 'premium', 'enterprise')),
  status text not null check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  organization_id bigint references public.organizations(id) on delete cascade,
  actor_user_id bigint references public.app_users(id) on delete set null,
  action text not null check (length(action) between 1 and 160),
  target_type text not null check (length(target_type) between 1 and 80),
  target_public_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_events_organization_created_idx on public.audit_events (organization_id, created_at desc, id desc);
create index audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at desc);

create or replace function private.current_user_id()
returns bigint
language sql
stable
set search_path = ''
as $$
  select nullif(current_setting('app.current_user_id', true), '')::bigint
$$;

create or replace function private.is_organization_member(target_organization_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = target_organization_id
      and member.user_id = private.current_user_id()
  )
$$;

create or replace function private.can_access_workspace(target_workspace_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces workspace
    where workspace.id = target_workspace_id
      and private.is_organization_member(workspace.organization_id)
  )
$$;

create or replace function public.save_chart_document(
  target_workspace_public_id uuid,
  target_symbol_id text,
  expected_revision bigint,
  next_document jsonb
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_workspace_id bigint;
begin
  if expected_revision < 0 or jsonb_typeof(next_document) <> 'object' then
    raise exception 'invalid chart document write' using errcode = '22023';
  end if;

  select workspace.id into target_workspace_id
  from public.workspaces workspace
  where workspace.public_id = target_workspace_public_id;

  if target_workspace_id is null or not private.can_access_workspace(target_workspace_id) then
    raise exception 'workspace not found' using errcode = '42501';
  end if;

  update public.chart_documents chart
  set document = next_document,
      revision = chart.revision + 1,
      updated_at = now()
  where chart.workspace_id = target_workspace_id
    and chart.symbol_id = target_symbol_id
    and chart.revision = expected_revision
  returning chart.revision, chart.updated_at into revision, updated_at;

  if found then
    return next;
    return;
  end if;

  if expected_revision = 0 then
    insert into public.chart_documents (workspace_id, symbol_id, revision, document)
    values (target_workspace_id, target_symbol_id, 1, next_document)
    on conflict (workspace_id, symbol_id) do nothing
    returning chart_documents.revision, chart_documents.updated_at into revision, updated_at;
    if found then
      return next;
      return;
    end if;
  end if;

  raise exception 'chart document revision conflict' using errcode = '40001';
end
$$;

revoke all on schema private from public;
grant usage on schema private to public;
revoke all on function private.current_user_id() from public;
revoke all on function private.is_organization_member(bigint) from public;
revoke all on function private.can_access_workspace(bigint) from public;
grant execute on function private.current_user_id() to public;
grant execute on function private.is_organization_member(bigint) to public;
grant execute on function private.can_access_workspace(bigint) to public;
revoke all on function public.save_chart_document(uuid, text, bigint, jsonb) from public;
grant execute on function public.save_chart_document(uuid, text, bigint, jsonb) to public;

alter table public.app_users enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.workspaces enable row level security;
alter table public.chart_documents enable row level security;
alter table public.watchlists enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_events enable row level security;

alter table public.app_users force row level security;
alter table public.organizations force row level security;
alter table public.organization_members force row level security;
alter table public.workspaces force row level security;
alter table public.chart_documents force row level security;
alter table public.watchlists force row level security;
alter table public.watchlist_items force row level security;
alter table public.subscriptions force row level security;
alter table public.audit_events force row level security;

create policy app_users_self on public.app_users
  using (id = private.current_user_id())
  with check (id = private.current_user_id());
create policy organizations_member on public.organizations
  using (private.is_organization_member(id));
create policy organization_members_member on public.organization_members
  using (private.is_organization_member(organization_id));
create policy workspaces_member on public.workspaces
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));
create policy chart_documents_member on public.chart_documents
  using (private.can_access_workspace(workspace_id))
  with check (private.can_access_workspace(workspace_id));
create policy watchlists_member on public.watchlists
  using (private.is_organization_member(organization_id))
  with check (private.is_organization_member(organization_id));
create policy watchlist_items_member on public.watchlist_items
  using (exists (
    select 1 from public.watchlists watchlist
    where watchlist.id = watchlist_id
      and private.is_organization_member(watchlist.organization_id)
  ));
create policy subscriptions_member on public.subscriptions
  for select using (private.is_organization_member(organization_id));
create policy audit_events_member on public.audit_events
  for select using (private.is_organization_member(organization_id));
create policy audit_events_insert_member on public.audit_events
  for insert with check (
    private.is_organization_member(organization_id)
    and actor_user_id = private.current_user_id()
  );

commit;
