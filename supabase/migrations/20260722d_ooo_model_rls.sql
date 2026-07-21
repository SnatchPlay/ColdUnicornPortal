-- RLS for the OOO model (ADR-0015, ADR-0006).
--
-- WHY RLS IS THE REAL GUARD HERE: the orm-gateway connects with a privileged DATABASE_URL but
-- executes `set_config('role', <caller role>, true)` + the caller's JWT claims INSIDE every
-- transaction (supabase/functions/orm-gateway/index.ts, executeAsCaller). A portal user is always
-- `authenticated`, so these policies genuinely restrict the rows — the gateway does not carry a
-- second authorization layer, by design (ADR-0008).
--
-- Consequence, and the reason UPDATE below has BOTH `using` and `with check`: without `with check`
-- an authenticated caller could move a row it can see into a client it cannot, and a mutation aimed
-- at a guessed UUID from another client would not be stopped by the WHERE clause of the gateway
-- query alone. Never rely on the action's WHERE for isolation — that is a UI convenience.
--
-- Predicates are SET-BASED (ADR-0006): one semijoin through client_sequencers → clients, never a
-- per-row private.* call on a growing table.
--
-- SCOPE DECISION — both tables are INTERNAL-ONLY (`can_manage_client`, which is false for the
-- `client` role), including `sequencer_contacts`. The plan sketched `can_access_client` for
-- contacts; that is tightened here deliberately: an OOO/NRR contact is precisely a person who is
-- NOT yet a CRM lead, and exposing that population to the client role would reintroduce through the
-- side door exactly what §17 ("outreach separated from CRM") removes from the leads table. No UI
-- needs it either: the portal has no episode list at all (OoS-16) — these policies exist because
-- `recover_skipped_ooo_followups` runs as the CALLER from the client-drawer routing editor.
--
-- NO INSERT and NO DELETE policies: rows are created only by the SECURITY DEFINER RPCs in
-- 20260722e running as service_role (which bypasses RLS), and follow-ups are never hard-deleted
-- (cancel is a status change — §6). The UPDATE policy is NOT dead code despite there being no
-- episode editor: recover_skipped_ooo_followups updates episodes on the caller's behalf.

begin;

-- Idempotent: RLS is already ON from 20260722_ooo_model_tables.sql, which enables it at CREATE time
-- so a partially-applied migration sequence can never expose these tables. Repeated here only so
-- this file stands alone if it is ever replayed against an older schema.
alter table public.sequencer_contacts enable row level security;
alter table public.ooo_followups      enable row level security;

-- --- sequencer_contacts -----------------------------------------------------------------------
drop policy if exists sequencer_contacts_select_scoped on public.sequencer_contacts;
create policy sequencer_contacts_select_scoped
  on public.sequencer_contacts
  for select
  to authenticated
  using (
    client_sequencer_id in (
      select cs.id
      from public.client_sequencers cs
      where cs.client_id in (
        select id from public.clients where private.can_manage_client(id)
      )
    )
  );

-- --- ooo_followups ----------------------------------------------------------------------------
drop policy if exists ooo_followups_select_scoped on public.ooo_followups;
create policy ooo_followups_select_scoped
  on public.ooo_followups
  for select
  to authenticated
  using (
    sequencer_contact_id in (
      select sc.id
      from public.sequencer_contacts sc
      where sc.client_sequencer_id in (
        select cs.id
        from public.client_sequencers cs
        where cs.client_id in (
          select id from public.clients where private.can_manage_client(id)
        )
      )
    )
  );

-- `using` gates which rows may be updated; `with check` gates what they may become. Both use the
-- same predicate, so a follow-up can never be re-parented into an inaccessible client.
drop policy if exists ooo_followups_update_scoped on public.ooo_followups;
create policy ooo_followups_update_scoped
  on public.ooo_followups
  for update
  to authenticated
  using (
    sequencer_contact_id in (
      select sc.id
      from public.sequencer_contacts sc
      where sc.client_sequencer_id in (
        select cs.id
        from public.client_sequencers cs
        where cs.client_id in (
          select id from public.clients where private.can_manage_client(id)
        )
      )
    )
  )
  with check (
    sequencer_contact_id in (
      select sc.id
      from public.sequencer_contacts sc
      where sc.client_sequencer_id in (
        select cs.id
        from public.client_sequencers cs
        where cs.client_id in (
          select id from public.clients where private.can_manage_client(id)
        )
      )
    )
  );

commit;
