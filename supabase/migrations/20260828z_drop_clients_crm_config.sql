-- DESTRUCTIVE follow-up to 20260828_clear_crm_config_pdca.sql (ADR-0019).
-- Drops clients.crm_config, whose contents were emptied and backed up by that migration.
--
-- HELD IN supabase/migrations/deferred/ UNTIL 2026-08-28, then moved here and applied. It was kept
-- out of the runner's sight on purpose (scripts/db-apply-migrations.mjs filters on isFile() at the
-- top level): a "do not apply yet" comment in a header is documentation, not a guard — 20260704b
-- carried exactly such a header and CI applied it anyway.
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
-- APPLIED to production 2026-08-28, after all three were verified:
--   1. private.crm_config_pdca_backup_20260828 held 47 rows.
--   2. The DEPLOYED orm-gateway (commit 81b654d, CI deploy-functions green) contains zero
--      occurrences of crmConfig / crm_config, so no live query names the column.
--   3. A pre-flight dependency check found 0 dependent objects, indexes, policies, constraints or
--      functions referencing it — so the drop needed no CASCADE and could take nothing with it.
-- The same statement had already been exercised on a local restore of the production schema, where
-- clients went 25 -> 24 columns and the pre-drop column list then failed with 42703 — the exact
-- hazard the preconditions above exist to prevent. Post-drop, the gateway's real column list was
-- re-run against production and returned rows normally.
--
-- The backup table is NOT dropped here. Retire it in a later migration once this has settled.

begin;

alter table public.clients drop column if exists crm_config;

commit;
