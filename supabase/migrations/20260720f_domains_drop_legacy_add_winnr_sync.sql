-- Drop legacy per-domain business columns and add the Winnr synchronization surface.
--
-- Winnr is now stored in a normalized shape: domains (domain + current technical state),
-- email_accounts (per-mailbox current warming), email_account_warming_daily (daily history).
-- The old domain-level fields below are superseded and were never real Winnr data:
--   reputation           -> current warming lives per-mailbox in email_accounts; history in _warming_daily
--   warmup_verified_at    -> derive "warming done" from email_accounts.warming_status / warming_progress
--   campaign_verified_at  -> NOT a Winnr signal; agency campaign-verification field, no longer used
--   exchange_date         -> agency exchange bookkeeping, dependent UI removed
--   exchange_cost         -> agency exchange bookkeeping, dependent UI removed
-- Winnr status is kept SEPARATELY in domains.winnr_status; it must never overwrite the local
-- domain_status enum (domains.status), which stays.
--
-- Forward-only. Portal code that referenced the dropped columns is updated in the same change
-- (schema.ts, orm-gateway toDomainRecord/mapDomainPatch/mapDomainInsert, DomainRecord, domains-page).

begin;

-- ── 1. Drop legacy per-domain business columns ────────────────────────────────────────────────
alter table public.domains
  drop column if exists reputation,
  drop column if exists exchange_date,
  drop column if exists exchange_cost,
  drop column if exists campaign_verified_at,
  drop column if exists warmup_verified_at;

-- ── 2. Winnr sync columns on domains (n8n writes these via service_role) ──────────────────────
alter table public.domains
  add column if not exists winnr_domain_id         text,
  add column if not exists winnr_status            text,
  add column if not exists dns_provider            text,
  add column if not exists winnr_tags              text[] not null default '{}'::text[],
  add column if not exists winnr_email_user_count  integer,
  add column if not exists winnr_created_at        timestamptz,
  add column if not exists winnr_updated_at        timestamptz,
  add column if not exists last_seen_at            timestamptz,
  add column if not exists last_synced_at          timestamptz,
  add column if not exists missing_since           timestamptz,
  add column if not exists raw_payload             jsonb not null default '{}'::jsonb;

-- ── 3. email_accounts: Winnr sync timestamps ─────────────────────────────────────────────────
-- (last_seen_at / raw_payload / created_at / updated_at and warming_daily's raw_payload / synced_at
--  already carry these defaults from 20260720e — not re-set here.)
alter table public.email_accounts
  add column if not exists winnr_updated_at    timestamptz,
  add column if not exists warming_updated_at  timestamptz;

-- ── 4. Uniqueness guards — fail loudly on ambiguous data instead of silent bad sync ────────────
do $$
begin
  if exists (
    select 1 from public.domains
    group by lower(trim(domain_name))
    having count(*) > 1
  ) then
    raise exception 'Duplicate domains exist when compared case-insensitively. Clean them before enabling Winnr sync.';
  end if;

  if exists (
    select 1 from public.email_accounts
    group by lower(trim(email_address))
    having count(*) > 1
  ) then
    raise exception 'Duplicate email accounts exist when compared case-insensitively. Clean them before enabling Winnr sync.';
  end if;
end
$$;

-- ── 5. Indexes ────────────────────────────────────────────────────────────────────────────────
create unique index if not exists domains_domain_name_ci_uq
  on public.domains (lower(trim(domain_name)));

create unique index if not exists domains_winnr_domain_id_uq
  on public.domains (winnr_domain_id)
  where winnr_domain_id is not null;

create index if not exists domains_last_seen_at_idx
  on public.domains (last_seen_at)
  where winnr_domain_id is not null;

-- Reconcile the email uniqueness: replace the 20260720e lower(email) index with the stricter
-- lower(trim(email)) one used by the Winnr sync (create first, then drop the old to stay covered).
create unique index if not exists email_accounts_email_address_ci_uq
  on public.email_accounts (lower(trim(email_address)));
drop index if exists public.email_accounts_email_uq;

create index if not exists email_accounts_last_seen_at_idx
  on public.email_accounts (last_seen_at);

-- NOTE: email_accounts_domain_id_idx, email_accounts_warming_status_idx (20260720e) and the
-- metric_date index (email_account_warming_date_idx, 20260720e) already exist — not recreated here.

-- ── 6. integration_sync_runs — n8n run bookkeeping ───────────────────────────────────────────
create table if not exists public.integration_sync_runs (
  id                        uuid primary key default gen_random_uuid(),
  provider                  text not null,
  sync_type                 text not null default 'daily',
  n8n_execution_id          text not null unique,
  status                    text not null check (status in ('running', 'success', 'failed')),
  started_at                timestamptz not null default now(),
  finished_at               timestamptz,

  domains_seen              integer not null default 0,
  domains_updated           integer not null default 0,
  domains_unmatched         integer not null default 0,

  email_accounts_seen       integer not null default 0,
  email_accounts_resolved   integer not null default 0,
  email_accounts_upserted   integer not null default 0,
  email_accounts_unmatched  integer not null default 0,

  warming_seen              integer not null default 0,
  warming_resolved          integer not null default 0,
  warming_daily_upserted    integer not null default 0,
  warming_disabled          integer not null default 0,
  warming_unmatched         integer not null default 0,

  missing_domains           integer not null default 0,
  missing_email_accounts    integer not null default 0,

  error_message             text,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now()
);

create index if not exists integration_sync_runs_provider_started_idx
  on public.integration_sync_runs (provider, started_at desc);

-- integration_sync_runs is n8n-owned operational telemetry (service_role writes). It carries no
-- client data, so it is not exposed through RLS to authenticated users. Enable RLS with no policy
-- so authenticated/anon get nothing while service_role (RLS-exempt) can read/write.
alter table public.integration_sync_runs enable row level security;

commit;
