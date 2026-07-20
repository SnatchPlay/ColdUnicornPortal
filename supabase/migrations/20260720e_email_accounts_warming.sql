-- Email accounts (mailboxes) + warming history. Winnr binds warming to a mailbox, not a domain:
-- one domain has many email accounts, each with its own health score, inbox/spam rate and warm-up
-- progress. This adds two ingestion-only tables (n8n populates them from Winnr as service_role;
-- the portal only reads) plus a domain-level aggregation view. Additive only.
--
-- RLS is ingestion-only, mirroring replies / campaign_daily_stats (20260601b, 20260421): only a
-- set-based SELECT policy for `authenticated` (ADR-0006 — scope through the parent domain to the
-- caller's accessible clients in ONE subquery, never a per-row private.* call). No insert/update/
-- delete policy for authenticated — writes are done by n8n via service_role, which bypasses RLS.
--
-- Warming status columns are plain `text` (not an enum) because the values originate in an external
-- API (Winnr) whose taxonomy we do not control; an unexpected value must round-trip, not error.

-- --- email_accounts (mailbox + current warming state) ----------------------------------------
create table if not exists public.email_accounts (
  id                     uuid primary key default gen_random_uuid(),
  domain_id              uuid not null references public.domains(id) on delete cascade,
  winnr_email_user_id    text not null unique,        -- idempotent upsert key from n8n
  email_address          text not null,
  username               text,
  display_name           text,
  status                 text,                        -- mailbox status in Winnr
  -- current warming snapshot (latest values; history lives in email_account_warming_daily)
  warming_status         text,
  warming_health_score   numeric,
  warming_inbox_rate     numeric,
  warming_spam_rate      numeric,
  warming_daily_volume   integer,
  warming_progress       numeric,
  winnr_created_at       timestamptz,
  last_seen_at           timestamptz not null default now(),
  last_synced_at         timestamptz,
  missing_since          timestamptz,                 -- set by n8n when a mailbox drops out of the feed
  raw_payload            jsonb not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index if not exists email_accounts_email_uq          on public.email_accounts (lower(email_address));
create index        if not exists email_accounts_domain_id_idx     on public.email_accounts (domain_id);
create index        if not exists email_accounts_warming_status_idx on public.email_accounts (warming_status);

-- --- email_account_warming_daily (per-mailbox daily warming history) --------------------------
create table if not exists public.email_account_warming_daily (
  email_account_id  uuid not null references public.email_accounts(id) on delete cascade,
  metric_date       date not null,
  warming_status    text,
  emails_sent       integer,
  health_score      numeric,
  inbox_rate        numeric,
  spam_rate         numeric,
  daily_volume      integer,
  warmup_progress   numeric,
  raw_payload       jsonb not null default '{}'::jsonb,
  synced_at         timestamptz not null default now(),
  primary key (email_account_id, metric_date)
);
create index if not exists email_account_warming_date_idx on public.email_account_warming_daily (metric_date);

-- --- updated_at trigger (shared repo function) -----------------------------------------------
create or replace trigger set_updated_at before update on public.email_accounts for each row execute function public.handle_updated_at();

-- --- RLS: ingestion-only, set-based SELECT for authenticated (ADR-0006) -----------------------
alter table public.email_accounts             enable row level security;
alter table public.email_account_warming_daily enable row level security;

-- email_accounts: scoped through domain → client, one subquery (hash semijoin), no per-row call.
drop policy if exists email_accounts_select_scoped on public.email_accounts;
create policy email_accounts_select_scoped
  on public.email_accounts
  for select
  to authenticated
  using (
    domain_id in (
      select d.id
      from public.domains d
      where d.client_id in (
        select id from public.clients where private.can_access_client(id)
      )
    )
  );

-- warming_daily: scoped through email_account → domain → client, still set-based.
drop policy if exists email_account_warming_daily_select_scoped on public.email_account_warming_daily;
create policy email_account_warming_daily_select_scoped
  on public.email_account_warming_daily
  for select
  to authenticated
  using (
    email_account_id in (
      select ea.id
      from public.email_accounts ea
      where ea.domain_id in (
        select d.id
        from public.domains d
        where d.client_id in (
          select id from public.clients where private.can_access_client(id)
        )
      )
    )
  );

-- --- domain_warming_summary: domain-level aggregation (security_invoker so RLS still applies) --
-- Computed from email_accounts rather than duplicating columns onto domains. Runs with the
-- caller's privileges, so the underlying email_accounts RLS scopes the rows.
create or replace view public.domain_warming_summary
with (security_invoker = on) as
select
  d.id                                                                    as domain_id,
  count(ea.id)::integer                                                   as email_accounts_count,
  count(ea.id) filter (where ea.warming_status = 'active')::integer       as active_warming_accounts_count,
  avg(ea.warming_health_score)                                            as average_health_score,
  min(ea.warming_inbox_rate)                                              as lowest_inbox_rate,
  max(ea.warming_spam_rate)                                               as highest_spam_rate
from public.domains d
left join public.email_accounts ea on ea.domain_id = d.id
group by d.id;
