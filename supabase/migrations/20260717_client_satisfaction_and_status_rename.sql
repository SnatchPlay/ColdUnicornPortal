-- Manual customer-satisfaction rating + client_status renames.
--
-- Product change (two parts):
--
-- 1. `clients.satisfaction` — a manually-set 1..3 rating ("hearts"), replacing the automatic
--    condition-engine severity rollup as the Customer Success signal on the Clients grid. The
--    rollup badge, the health filter and the drawer's "Operational issues" / "Setup gaps"
--    sections are removed in the same change; the `condition_rules` engine itself stays and keeps
--    tinting individual mega-table cells. NULL = not rated yet, which is where every existing
--    client starts — the UI exposes it as a "Not rated" filter chip.
--
-- 2. Status renames. `Abo` -> `Subscription` (plain English), `Sales` -> `Onboarding` (the stage
--    is a signed client being set up, not a pre-sale prospect). Both are `RENAME VALUE`, which
--    rewrites every existing row's label in place — no backfill, no type recreate, no downtime.
--    Verified before writing this: no row uses `Sales` at all, 2 use `Abo`, and no
--    `condition_rules.severity_rules` JSON references either label, so no rule needs re-pointing.
--
-- Enum sort order is deliberately NOT reordered to match the new display order. Postgres cannot
-- reorder enum labels in place (it would need a full type recreate), and nothing sorts by this
-- enum in SQL — the display order is owned by the `CLIENT_STATUSES` tuple in src/app/types/core.ts.
--
-- RLS: no policy change. `clients_update_scoped` gates UPDATE with `private.can_manage_client(id)`
-- (USING + WITH CHECK) — a row-level predicate that is column-agnostic — and `authenticated` holds
-- a table-level (not column-list) UPDATE grant on `public.clients`, so the new column is covered
-- by both the grant and the policy the moment it exists. Who may set a rating is therefore exactly
-- who may already change `clients.status`: the owning manager, plus admin / master_admin.

begin;

alter type public.client_status rename value 'Abo' to 'Subscription';
alter type public.client_status rename value 'Sales' to 'Onboarding';

alter table public.clients
  add column satisfaction smallint
    constraint clients_satisfaction_range check (satisfaction between 1 and 3);

comment on column public.clients.satisfaction is
  'Manual customer-satisfaction rating, 1..3 ("hearts"). NULL = not rated. Set by the owning CS manager or an admin; replaces the automatic condition-engine health rollup on the Clients grid.';

commit;
