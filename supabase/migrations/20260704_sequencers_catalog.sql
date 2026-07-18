-- Multi-sequencer model (ADR-0012): global sequencer catalog, per-client sequencer
-- credentials (replacing clients.external_api_key / external_workspace_id /
-- linkedin_api_key), campaign/lead sequencer attribution, and the LinkedIn/Aimfox
-- PDCA ingestion stats table.
--
-- The fixed UUIDs below are LOAD-BEARING: they are the column DEFAULTs on
-- campaigns.sequencer_id / leads.sequencer_id and the constants n8n uses.
-- Never change them.
--   smartlead  00000000-0000-4000-a000-000000000001
--   emailbison 00000000-0000-4000-a000-000000000002
--   aimfox     00000000-0000-4000-a000-000000000003
--
-- Backfill decisions (2026-07-04, confirmed with the user):
--   * ALL existing campaigns/leads attribute to EmailBison (via column DEFAULT).
--   * clients.external_api_key/external_workspace_id copy to the emailbison row;
--     clients.linkedin_api_key copies to the aimfox row (0 non-null at migration time).
--
-- Companion DESTRUCTIVE migration: 20260704b_drop_client_sequencer_credentials.sql —
-- apply ONLY after the gateway/portal deploy and the n8n cutover (see its header).
--
-- RLS: sequencers is a public (no-secret) catalog; client_sequencers holds API keys
-- and is manager/admin-only via private.can_manage_client (small table, per-row
-- helper acceptable); sequencer_daily_stats is ingestion-only (n8n service role
-- writes) with a set-based SELECT policy per ADR-0006 because it grows unbounded
-- (clients x profiles x days).

begin;

-- 1. Catalog --------------------------------------------------------------------

create table if not exists public.sequencers (
  id         uuid primary key,
  key        text not null unique check (key ~ '^[a-z0-9_]+$'),
  name       text not null,
  channel    text not null check (channel in ('email', 'linkedin')),
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.sequencers is
  'Catalog of external sending tools (sequencers). Fixed UUIDs are load-bearing (column defaults + n8n constants). ADR-0012.';

insert into public.sequencers (id, key, name, channel) values
  ('00000000-0000-4000-a000-000000000001', 'smartlead',  'Smartlead',  'email'),
  ('00000000-0000-4000-a000-000000000002', 'emailbison', 'EmailBison', 'email'),
  ('00000000-0000-4000-a000-000000000003', 'aimfox',     'Aimfox',     'linkedin')
on conflict (key) do nothing;

-- 2. Per-client sequencer settings ------------------------------------------------

create table if not exists public.client_sequencers (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  sequencer_id          uuid not null references public.sequencers(id) on delete restrict,
  api_key               text,
  external_workspace_id text,  -- text, not int: platform-agnostic (EmailBison ints survive ::text)
  settings              jsonb not null default '{}'::jsonb,
  enabled               boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (client_id, sequencer_id)
);

comment on table public.client_sequencers is
  'Per-client sequencer connection settings (API keys, workspace ids). Portal-owned config; n8n reads. Replaces clients.external_api_key/external_workspace_id/linkedin_api_key. ADR-0012.';

create index if not exists idx_client_sequencers_sequencer
  on public.client_sequencers (sequencer_id);

-- Preserves the old clients_external_workspace_id_key guarantee, per platform.
create unique index if not exists client_sequencers_workspace_uk
  on public.client_sequencers (sequencer_id, external_workspace_id)
  where external_workspace_id is not null;

-- 3. Attribution FKs ---------------------------------------------------------------
-- DEFAULT emailbison instantly backfills every existing row (no table rewrite,
-- default is applied at read for existing rows on PG11+; FK validated by scan).

alter table public.campaigns add column if not exists sequencer_id uuid not null
  default '00000000-0000-4000-a000-000000000002'
  references public.sequencers(id) on delete restrict;

alter table public.leads add column if not exists sequencer_id uuid not null
  default '00000000-0000-4000-a000-000000000002'
  references public.sequencers(id) on delete restrict;

create index if not exists idx_leads_client_sequencer
  on public.leads (client_id, sequencer_id);

-- 4. Credential backfill ------------------------------------------------------------

insert into public.client_sequencers (client_id, sequencer_id, api_key, external_workspace_id)
select c.id, s.id, c.external_api_key, c.external_workspace_id::text
from public.clients c
join public.sequencers s on s.key = 'emailbison'
where c.external_api_key is not null or c.external_workspace_id is not null
on conflict (client_id, sequencer_id) do nothing;

insert into public.client_sequencers (client_id, sequencer_id, api_key)
select c.id, s.id, c.linkedin_api_key
from public.clients c
join public.sequencers s on s.key = 'aimfox'
where c.linkedin_api_key is not null
on conflict (client_id, sequencer_id) do nothing;

-- 5. LinkedIn/Aimfox PDCA ingestion stats -------------------------------------------
-- n8n (service role) UPSERTs on (client_id, sequencer_id, profile_id, report_date);
-- the portal only reads. profile_id is the Aimfox LinkedIn profile/seat id;
-- '' (empty string, NOT null) means account-level rollup so the unique key stays honest.

create table if not exists public.sequencer_daily_stats (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid not null references public.clients(id) on delete cascade,
  sequencer_id            uuid not null references public.sequencers(id) on delete restrict,
  profile_id              text not null default '',
  report_date             date not null,
  invites_sent            integer not null default 0,
  invites_accepted        integer not null default 0,
  remaining_database_size integer,
  invite_limit            integer,  -- platform invite cap snapshot (~195/week on LinkedIn)
  created_at              timestamptz not null default now(),
  unique (client_id, sequencer_id, profile_id, report_date)
);

comment on table public.sequencer_daily_stats is
  'Ingestion-only daily sequencer stats (LinkedIn invites, remaining database, invite limits). n8n service-role writes; portal reads. ADR-0012.';

create index if not exists idx_sequencer_daily_stats_date
  on public.sequencer_daily_stats (report_date desc);

-- 6. RLS -----------------------------------------------------------------------------

alter table public.sequencers            enable row level security;
alter table public.client_sequencers     enable row level security;
alter table public.sequencer_daily_stats enable row level security;

-- sequencers: static no-secret catalog, readable by every authenticated role
-- (future UI shows channel labels on campaigns/leads). Writes master_admin only
-- (client_custom_fields precedent).
drop policy if exists "sequencers_select_authenticated" on public.sequencers;
create policy "sequencers_select_authenticated"
on public.sequencers
for select
to authenticated
using (true);

drop policy if exists "sequencers_write_master" on public.sequencers;
create policy "sequencers_write_master"
on public.sequencers
for all
to authenticated
using (private.current_app_role() = 'master_admin')
with check (private.current_app_role() = 'master_admin');

-- client_sequencers: contains API keys -> manager(own)/admin only, never client role.
-- can_manage_client matches the old drawer editability. Table stays tiny
-- (<= sequencers x clients rows), per-row helper acceptable.
drop policy if exists "client_sequencers_select_scoped" on public.client_sequencers;
create policy "client_sequencers_select_scoped"
on public.client_sequencers
for select
to authenticated
using (private.can_manage_client(client_id));

drop policy if exists "client_sequencers_insert_scoped" on public.client_sequencers;
create policy "client_sequencers_insert_scoped"
on public.client_sequencers
for insert
to authenticated
with check (private.can_manage_client(client_id));

drop policy if exists "client_sequencers_update_scoped" on public.client_sequencers;
create policy "client_sequencers_update_scoped"
on public.client_sequencers
for update
to authenticated
using (private.can_manage_client(client_id))
with check (private.can_manage_client(client_id));

drop policy if exists "client_sequencers_delete_scoped" on public.client_sequencers;
create policy "client_sequencers_delete_scoped"
on public.client_sequencers
for delete
to authenticated
using (private.can_manage_client(client_id));

-- sequencer_daily_stats: ingestion-only (no write policies; n8n service role
-- bypasses RLS). SELECT is set-based per ADR-0006. Clients see their own rows
-- (no secrets; PDCA stats are ultimately client-facing) — mirrors daily_stats.
drop policy if exists "sequencer_daily_stats_select_scoped" on public.sequencer_daily_stats;
create policy "sequencer_daily_stats_select_scoped"
on public.sequencer_daily_stats
for select
to authenticated
using (client_id in (select id from public.clients where private.can_access_client(id)));

commit;
