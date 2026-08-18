-- ooo_followups: add a fifth skip reason, `stale`, so an overdue episode can be expired honestly.
--
-- Why. `ooo_followups` holds 1462 `pending` episodes — one per contact — and not one has ever been
-- submitted: the only limb that actually enrols anyone reads the OOO Leads sheet, and branch S is a
-- read-only shadow. The Wave 1 worker changes that, and the first thing it has to decide is what to
-- do with a backlog that is not uniformly due. Measured on production 2026-08-15:
--
--     future (not due)      382   2026-08-16 … 2027-07-26
--     due, <= 7d stale      517   2026-08-08 … 2026-08-15
--     due, 8-14d stale      315   2026-08-01 … 2026-08-07
--     due, 15-30d stale     231   2026-07-24 … 2026-07-31
--     due, > 30d stale       17   2023-08-06 … 2026-06-22
--
-- An OOO reply means "I am back on ⟨date⟩". A follow-up sent a month after that date has lost the
-- context that justified it — it is not a late follow-up, it is a cold email with a wrong premise.
-- Owner decision 2026-08-15: with a 14-day cut, expire the 248 oldest and enrol the 832 that are
-- genuinely due; the 382 future ones come due on their own.
--
-- Why a new reason and not an existing one. `skip_ooo_followup` hard-validates against exactly four
-- values, and the table carries the same list as a CHECK constraint. Reusing `contact_ineligible`
-- would silently corrupt the skip-reason breakdown that already holds 273 `automation_disabled` and
-- 67 `routing_missing` — the one place that records WHY an episode never ran. Expiring 248 rows into
-- that bucket would make it useless for exactly the question it exists to answer.
--
-- Both halves are required. The function's whitelist raises first, but the CHECK constraint would
-- reject the write anyway; changing only the function would turn a clear error into a confusing one.
--
-- Deliberately NOT changed: `recover_skipped_ooo_followups` recovers only `routing_missing` and
-- `automation_disabled`. So a routing rule saved later resurrects a parked episode but never an
-- expired one — which is the correct behaviour and is already what the code does. Expiry is final;
-- parking is not. This is worth stating because the two look alike from the portal, which shows
-- neither (OoS-16: there is no follow-up list).
--
-- Verified on 2026-08-15 against production in a rolled-back transaction.
--
-- ADR-0015 (the episode lifecycle is service_role RPCs driven by n8n; the portal has no editor)
-- ADR-0017 (Sheets → Supabase dual-write; this is a precondition for the phase-B enrolment worker)

alter table public.ooo_followups
  drop constraint if exists ooo_followups_skip_reason_check;

alter table public.ooo_followups
  add constraint ooo_followups_skip_reason_check
  check (skip_reason = any (array[
    'routing_missing'::text,
    'campaign_missing'::text,
    'automation_disabled'::text,
    'contact_ineligible'::text,
    'stale'::text
  ]));

-- Business/configuration reason, not a technical error. Stays visible so the reason an episode never
-- ran is answerable later (spec §17).
create or replace function public.skip_ooo_followup(p_id uuid, p_skip_reason text)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ooo_followups;
begin
  if p_skip_reason is null or p_skip_reason not in
     ('routing_missing', 'campaign_missing', 'automation_disabled', 'contact_ineligible', 'stale') then
    raise exception 'Unknown skip_reason %', p_skip_reason;
  end if;
  update public.ooo_followups
     set status = 'skipped', skip_reason = p_skip_reason
   where id = p_id and status in ('pending', 'failed')
  returning * into v_row;

  if not found then
    raise exception 'ooo_followup % cannot move to skipped from %',
      p_id, (select status from public.ooo_followups where id = p_id);
  end if;
  return v_row;
end;
$$;
