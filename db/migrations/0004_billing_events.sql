-- Idempotent webhook ingestion log. Events are recorded before they are
-- applied so provider retries and replays never double-apply a transition.
-- Application happens on the service-role connection: webhooks carry no user
-- identity, so no insert policy is granted to tenant roles.
begin;

create table public.billing_events (
  id bigint generated always as identity primary key,
  provider text not null check (provider in ('paddle', 'stripe', 'manual')),
  event_id text not null check (length(event_id) between 1 and 200),
  organization_id bigint references public.organizations(id) on delete set null,
  payload jsonb not null,
  applied boolean not null default false,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
create index billing_events_received_idx on public.billing_events (received_at desc);

alter table public.billing_events enable row level security;
alter table public.billing_events force row level security;

-- Members may inspect their organization's billing history; the service role
-- bypasses row level security for ingestion and application.
create policy billing_events_member_select on public.billing_events
  for select using (
    organization_id is null or private.is_organization_member(organization_id)
  );

commit;
