-- DESTRUCTIVE follow-up to 20260828_clear_crm_config_pdca.sql (ADR-0019).
-- Drops clients.crm_config, whose contents were emptied and backed up by that migration.
--
-- !! DEFERRED ON PURPOSE — this file lives in supabase/migrations/deferred/ so the runner cannot
-- !! see it (scripts/db-apply-migrations.mjs filters on isFile() at the top level). A "do not apply
-- !! yet" comment in a header is documentation, not a guard: 20260704b carried exactly such a
-- !! header and CI applied it anyway.
--
-- WHY IT CANNOT SHIP WITH THE CODE CHANGE. The gateway reads clients through
-- `tx.select().from(schema.clients)`, and Drizzle expands that into an explicit column list from
-- supabase/drizzle/schema.ts. A deploy applies migrations BEFORE it deploys the edge function, so
-- dropping the column in the same merge leaves a window in which the still-running gateway asks for
-- crm_config and every clients read fails with 42703 — every page, every role.
--
-- Preconditions (runbook):
--   1. 20260828_clear_crm_config_pdca.sql applied, and
--      private.crm_config_pdca_backup_20260828 holds the pre-clear snapshot (46 rows expected).
--   2. orm-gateway REDEPLOYED from a build whose supabase/drizzle/schema.ts no longer declares
--      crmConfig and whose index.ts no longer maps it in toClientRecord / mapClientPatch /
--      mapClientInsert. Confirm against the deployed function, not against main.
--   3. The frontend deploy carrying the ClientRecord change has landed.
--
-- How to apply, once all three hold:
--   git mv supabase/migrations/deferred/20260828z_drop_clients_crm_config.sql supabase/migrations/
--   pnpm db:migrate:local        # verify locally FIRST
--   # then let CI apply it to the cloud on merge
--
-- The backup table is NOT dropped here. Retire it in a later migration once this has settled.

begin;

alter table public.clients drop column if exists crm_config;

commit;
