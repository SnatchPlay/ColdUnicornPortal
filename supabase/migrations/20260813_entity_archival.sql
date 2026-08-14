-- Archival (soft delete) for the six portal-owned entities: clients, campaigns, leads, domains,
-- invoices, email_accounts.
--
-- WHY NOT A HARD DELETE. The portal is a read + config surface over data that n8n ingests
-- (CLAUDE.md §1). Two facts make `DELETE FROM` the wrong verb here:
--
--   1. FK topology. Only `client_users.*` cascades. `campaigns.client_id`, `leads.client_id`,
--      `daily_stats.client_id` (RESTRICT), `domains.client_id`, … all block the delete on purpose
--      (03-data-model.md §6). Deleting a client would either fail, or — if the FKs were relaxed to
--      CASCADE — silently destroy the ingested counters every historical metric is derived from.
--   2. Re-ingestion. Leads are promoted from `sequencer_contacts` by service_role RPCs (ADR-0015);
--      domains and mailboxes are Winnr-synced. A deleted row comes back on the next run, or leaves
--      `sequencer_contacts.lead_id` / `replies.lead_id` pointing at nothing.
--
-- The product already answers this question for users: accounts are deactivated, never hard-deleted
-- (BUSINESS_LOGIC.md, decision of 2026-06-18). This migration applies the same answer to the rest of
-- the entity graph. `archived_at` is the tombstone; the row, its children and its history stay.
--
-- SEMANTICS. An archived row is "as if deleted" for every reading surface: it is excluded from the
-- list pages, the pickers, the dashboards and the aggregates. It stays reachable through the
-- `includeArchived` flag on the list actions, which is what powers "Show archived" + Restore. All of
-- that filtering lives in the gateway (supabase/functions/orm-gateway/index.ts), not in RLS —
-- archived rows must remain visible to whoever is allowed to restore them.
--
-- RLS. Archiving is an UPDATE of two columns, so it inherits the table's existing UPDATE policy and
-- needs no new predicate on five of the six tables. That inheritance is exactly the permission model
-- asked for — admin tier plus the assigned manager:
--
--   clients        clients_update_scoped     private.can_manage_client(id)
--   campaigns      campaigns_update_scoped   private.can_manage_client(client_id)
--   leads          leads_update_scoped       private.can_manage_client(client_id)   -- client role write-blocked
--   domains        domains_update_scoped     private.can_manage_client(client_id)
--   invoices       invoices_update_admin     private.is_admin_user()                -- managers cannot archive invoices
--
-- `email_accounts` is the exception: it is ingestion-only and carries SELECT but no UPDATE policy, so
-- this migration adds one. It is set-based per ADR-0006 (subquery through domains → clients, never a
-- per-row private.fn(col)), and mirrors the shape of the existing email_accounts_select_scoped.
--
-- The gateway's mapLeadPatch / mapClientPatch / … whitelists do not accept `archived_at`; the only
-- writer is the `setEntityArchived` action. n8n keeps writing through service_role and is unaffected
-- — a Winnr sync will keep updating an archived mailbox's columns, it just never clears the
-- tombstone. That is intended: archiving a synced entity means "hide it from the portal".
--
-- MEASURED on the local stack (61 clients / 5 286 leads / 2 092 mailboxes / 445 domains), as the
-- `authenticated` role with a real JWT sub — never superuser. EXPLAIN (ANALYZE, BUFFERS), same
-- session, the same query with and without the new predicate, median of two warm runs:
--
--   query (admin caller)          before      after     plan change
--   leads stage counts           12.6/7.5    10.6/7.4   Seq Scan → Bitmap Index Scan on
--                                                        idx_leads_client_active (the new index)
--   clients overview              2.21/1.60   2.04/1.60  Seq Scan + one extra filter term
--   mailbox list                 30.6/25.2   27.5/25.4  Seq Scan + one extra filter term
--
-- Row counts are identical on both sides (nothing is archived yet), which is the number that
-- matters: the predicate changes what is *scanned*, not what is returned, until a row is archived.
-- The differences are run-to-run noise except on `leads`, where the partial index is a real
-- improvement. No policy predicate was rewritten, so no RLS plan regressed.
--
-- Permissions were probed the same way — nine cases inside BEGIN/ROLLBACK, each running the exact
-- UPDATE the gateway runs, under that caller's JWT: manager archives own client's lead (1 row) /
-- another manager's lead (0) / own client row (1) / another manager's client (0); a synthetic
-- client-role user archives a lead (0) and a mailbox (0); admin archives a mailbox (1); manager
-- archives an invoice (0) and admin archives the same invoice (1). All nine matched.
--
-- Sections 3–4 were probed the same way after code review: as `authenticated`, writing
-- `email_accounts.archived_at` succeeds (1 row) while `warming_status` and `raw_payload` fail with
-- 42501; `resolve_ooo_routing` returns the campaign before archiving and NULL after — and still NULL
-- when the routing rule is re-activated by hand, which is the point of putting the predicate here
-- rather than in the gateway.

-- ── 1. Tombstone columns ────────────────────────────────────────────────────────────────────────

do $$
declare
  tbl text;
begin
  foreach tbl in array array['clients', 'campaigns', 'leads', 'domains', 'invoices', 'email_accounts']
  loop
    execute format(
      'alter table public.%I
         add column if not exists archived_at timestamptz,
         add column if not exists archived_by uuid references public.users(id)',
      tbl);

    execute format(
      $c$comment on column public.%I.archived_at is
        'Soft-delete tombstone. Non-null = archived: hidden from every list, picker and aggregate in
         the portal, but never removed. Written only by the orm-gateway setEntityArchived action.'$c$,
      tbl);
    execute format(
      $c$comment on column public.%I.archived_by is
        'Who archived the row (users.id). Cleared on restore, together with archived_at.'$c$,
      tbl);
  end loop;
end $$;

-- ── 2. Indexes ──────────────────────────────────────────────────────────────────────────────────
-- Only the two hot tables get partial indexes. Every list query now carries `archived_at is null`,
-- and on leads/campaigns that predicate rides along with the client scoping the pages always apply.
-- The other four tables are small enough that a filter on the existing scan is cheaper than an index.

create index if not exists idx_leads_client_active
  on public.leads (client_id)
  where archived_at is null;

create index if not exists idx_campaigns_client_active
  on public.campaigns (client_id)
  where archived_at is null;

-- ── 3. email_accounts: the one table that needs a new policy ─────────────────────────────────────
-- Set-based per ADR-0006. Same domain → client path as email_accounts_select_scoped, but through
-- can_manage_client (write) instead of can_access_client (read), so the client role and unassigned
-- managers are write-blocked in Postgres and not merely in the UI. Unlinked (client_id is null)
-- mailboxes stay admin-only, matching how the select policy surfaces them.

drop policy if exists email_accounts_update_scoped on public.email_accounts;
create policy email_accounts_update_scoped on public.email_accounts
  for update to authenticated
  using (
    domain_id in (
      select d.id from public.domains d
      where d.client_id in (select id from public.clients where private.can_manage_client(id))
         or (d.client_id is null and private.is_admin_user())
    )
  )
  with check (
    domain_id in (
      select d.id from public.domains d
      where d.client_id in (select id from public.clients where private.can_manage_client(id))
         or (d.client_id is null and private.is_admin_user())
    )
  );

-- A policy answers "which rows", never "which columns". Supabase's default grants give
-- `authenticated` UPDATE on every column of every public table, so the policy above — on its own —
-- would hand every manager a PostgREST PATCH over the ingestion-owned mailbox columns
-- (`warming_status`, `raw_payload`, `last_synced_at`, …). The portal never writes them, but the
-- REST endpoint is reachable with any user JWT, so the grant is the boundary, not the gateway.
-- Narrow it to the two tombstone columns: that is the entire reason this policy exists.
revoke update on public.email_accounts from authenticated, anon;
grant update (archived_at, archived_by) on public.email_accounts to authenticated;

-- ── 4. OOO routing must not resolve to an archived campaign (ADR-0015) ───────────────────────────
-- `client_ooo_routing.campaign_id` has only an FK to campaigns — nothing stopped a route from
-- pointing at a campaign the portal has archived. n8n resolves the target through this function, so
-- without the predicate archiving an `ooo_followup` campaign would remove it from the portal while
-- returning OOO contacts kept being enrolled into it. The invariant belongs here, in the database,
-- not in the workflow (CLAUDE.md §5a rule 4).
--
-- NULL is already the contract for "no routing": the caller records `skipped / routing_missing`, and
-- `recover_skipped_ooo_followups` re-arms those episodes once the operator points the key at a live
-- campaign. Still NOT security definer — under `authenticated` the join sees the campaigns SELECT
-- policy, which scopes to the same client the routing row is already scoped to.
create or replace function public.resolve_ooo_routing(p_client_id uuid, p_routing_key text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select r.campaign_id
  from public.client_ooo_routing r
  join public.campaigns c on c.id = r.campaign_id
  where r.client_id = p_client_id
    and r.is_active
    and c.archived_at is null
    and r.routing_key in (p_routing_key, 'general')
  -- Specific key wins over the general fallback.
  order by (r.routing_key = p_routing_key) desc, r.created_at desc
  limit 1;
$$;

comment on function public.resolve_ooo_routing(uuid, text) is
  'ADR-0015. Resolves the OOO follow-up campaign for (client, routing_key): specific key → general → NULL. NULL means routing_missing; it is never an implicit general. An archived target campaign resolves to NULL (20260813).';
