-- Generic revisioned documents for user-scoped content the terminal stores as
-- opaque blobs today (drawings keyed per symbol, journal exports, chart
-- templates, device preferences). Structured querying arrives when a feature
-- needs it; the revision contract is identical to chart_documents.
begin;

create table public.user_documents (
  user_id bigint not null references public.app_users(id) on delete cascade,
  document_key text not null check (length(trim(document_key)) between 1 and 200),
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, document_key)
);
create index user_documents_user_updated_idx on public.user_documents (user_id, updated_at desc);

alter table public.user_documents enable row level security;
alter table public.user_documents force row level security;

create policy user_documents_self on public.user_documents
  using (user_id = private.current_user_id())
  with check (user_id = private.current_user_id());

commit;
