-- Legacy-boolean sync (ADR-0013 §5, product decision 2026-07-19 = RECOMPUTE, not latch).
-- n8n writes lead_meetings/lead_offers DIRECTLY (bypassing the gateway), so the sync must be a DB
-- trigger, not gateway-transaction code. Booleans are RECOMPUTED from child rows: cancelling a
-- meeting un-counts it. The trigger only ever fires for leads touched by child DML, so leads with no
-- child rows keep their ingestion-set booleans (spec §11). `won` is NOT trigger-managed — it belongs
-- to the conclusion/status action. The trigger only derives booleans; ADR-0004's mapLeadPatch stays
-- the single whitelist for direct lead edits.

-- meeting_booked = an active (scheduled/held) meeting exists; meeting_held = a held meeting exists.
-- Booleans are computed once, and leads is updated ONLY when a value actually changes, so an unrelated
-- child write (e.g. a 'planned' meeting or a call_script edit) does not churn the row or bump updated_at.
create or replace function private.recompute_lead_meeting_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.lead_id, old.lead_id);
  v_booked boolean;
  v_held boolean;
begin
  select
    exists (select 1 from public.lead_meetings m where m.lead_id = target and m.status::text in ('scheduled', 'held')),
    exists (select 1 from public.lead_meetings m where m.lead_id = target and m.status::text = 'held')
  into v_booked, v_held;

  update public.leads l
    set meeting_booked = v_booked, meeting_held = v_held
    where l.id = target
      and (l.meeting_booked is distinct from v_booked or l.meeting_held is distinct from v_held);
  return null;
end;
$$;

-- offer_sent = a sent/accepted offer exists.
create or replace function private.recompute_lead_offer_flags()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid := coalesce(new.lead_id, old.lead_id);
  v_sent boolean;
begin
  select exists (select 1 from public.lead_offers o where o.lead_id = target and o.status::text in ('sent', 'accepted'))
  into v_sent;

  update public.leads l
    set offer_sent = v_sent
    where l.id = target and l.offer_sent is distinct from v_sent;
  return null;
end;
$$;

drop trigger if exists trg_recompute_meeting_flags on public.lead_meetings;
create trigger trg_recompute_meeting_flags
  after insert or update or delete on public.lead_meetings
  for each row execute function private.recompute_lead_meeting_flags();

drop trigger if exists trg_recompute_offer_flags on public.lead_offers;
create trigger trg_recompute_offer_flags
  after insert or update or delete on public.lead_offers
  for each row execute function private.recompute_lead_offer_flags();
