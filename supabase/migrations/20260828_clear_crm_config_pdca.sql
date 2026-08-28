-- Empties clients.crm_config of the PDCA/Sheets metadata that has been squatting in it.
--
-- WHAT WAS IN THERE, AND WHY IT IS WRONG: the column's declared contract is CrmIntegrationConfig —
-- a status mirror of the client's CRM connection (docs/reference/functional/11-integrations.md).
-- What production actually held, in 46 of 63 rows, was `{"pdca": {...}}`: spreadsheet_id,
-- report_link, growth_head, dod_schedule, dod_daily_sent, cold_emails, setup_exchange,
-- smartlead_id, folder_link — Google Sheets bookkeeping that has nothing to do with a CRM.
--
-- Two things broke because of it:
--   * the CRM status badge never rendered — crm-integration-card.tsx requires `provider` + `status`
--     and always got neither;
--   * crm-integration-card.tsx REPLACES the whole column on connect and NULLs it on disconnect, so
--     the first successful CRM connection would have destroyed that client's PDCA metadata.
--
-- WHY IT IS SAFE TO EMPTY: nothing reads it. Verified 2026-08-28 against both sides —
--   * repository: 0 hits for crm_config / growth_head / setup_exchange / dod_schedule /
--     dod_daily_sent / smartlead_id / folder_link across src/, supabase/ and automation/;
--   * n8n: all 76 workflows on the instance (37 active + archived) pulled via the public REST API
--     and scanned for the same needles — 0 hits.
-- The owner confirmed the same day that the Sheets config is not wanted in Postgres at all.
--
-- The column itself is dropped separately, and only after the gateway stops mapping it:
-- supabase/migrations/deferred/20260828z_drop_clients_crm_config.sql.

begin;

-- Backup lives in `private`, which has no USAGE grant for `authenticated` (see the note at
-- supabase/functions/orm-gateway/index.ts:1890), so the gateway cannot reach it even by accident.
-- RLS on top is belt-and-braces: no policy exists, so no non-owner role selects a row.
create table if not exists private.crm_config_pdca_backup_20260828 (
  client_id   uuid primary key references public.clients(id) on delete cascade,
  crm_config  jsonb not null,
  updated_at  timestamptz not null,   -- the client's updated_at as it stood before this migration
  captured_at timestamptz not null default now()
);

alter table private.crm_config_pdca_backup_20260828 enable row level security;

comment on table private.crm_config_pdca_backup_20260828 is
  'Pre-clear snapshot of clients.crm_config (PDCA/Sheets metadata, 2026-08-28). Retain until the deferred column drop has shipped and settled; then drop this table.';

insert into private.crm_config_pdca_backup_20260828 (client_id, crm_config, updated_at)
select c.id, c.crm_config, c.updated_at
from public.clients c
where c.crm_config is not null
  and c.crm_config <> '{}'::jsonb
on conflict (client_id) do nothing;

-- clients carries a BEFORE UPDATE trigger (set_updated_at -> handle_updated_at). Left alone, this
-- cleanup would stamp a fresh updated_at on 46 clients and make a data-hygiene migration look like
-- 46 people edited 46 clients. Nothing reads clients.updated_at for logic — it is echoed back to
-- the drawer after a save — but a migration should not forge an edit history either way.
alter table public.clients disable trigger set_updated_at;

update public.clients
set crm_config = '{}'::jsonb
where crm_config is not null
  and crm_config <> '{}'::jsonb;

alter table public.clients enable trigger set_updated_at;

commit;
