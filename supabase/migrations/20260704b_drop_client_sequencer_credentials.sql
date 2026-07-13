-- DESTRUCTIVE half of 20260704_sequencers_catalog.sql (ADR-0008).
-- Drops the per-client sequencer credential columns that moved to client_sequencers.
--
-- !! DO NOT APPLY with a no-arg `node scripts/db-apply-migrations.mjs` run until the
-- !! preconditions below hold. Apply explicitly:
-- !!   node scripts/db-apply-migrations.mjs 20260704b_drop_client_sequencer_credentials.sql
--
-- Preconditions (runbook):
--   1. 20260704_sequencers_catalog.sql applied and backfill row-counts verified
--      (35 emailbison client_sequencers rows expected as of 2026-07-04).
--   2. orm-gateway redeployed from a build whose drizzle schema no longer maps
--      externalApiKey / externalWorkspaceId / linkedinApiKey on clients
--      (otherwise every clients select fails with 42703).
--   3. n8n owner confirmed all workflows read client_sequencers
--      (join sequencers on key = 'emailbison' / 'aimfox') instead of clients.*.

begin;

alter table public.clients drop column if exists external_api_key;
alter table public.clients drop column if exists external_workspace_id;  -- also drops clients_external_workspace_id_key
alter table public.clients drop column if exists linkedin_api_key;

commit;
