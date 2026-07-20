-- Backfill the Lead CRM child tables from the legacy pipeline booleans (ADR-0013, Phase 5).
--
-- The `leads.meeting_booked` / `meeting_held` / `offer_sent` booleans predate the child tables
-- (`lead_meetings` / `lead_offers`). Phase 5.3 made the DB trigger `private.recompute_lead_*_flags`
-- recompute those booleans FROM the child rows, so a lead that has the boolean set but NO child row is
-- "legacy only": its CRM detail columns are empty and the two write paths (checkbox vs child editor)
-- can drift. This migration seeds one child row per such lead so the child tables become the uniform
-- source of truth. `won` is NOT a child table (handled by the conclusion model); it is left untouched.
--
-- IDEMPOTENT: only inserts where the boolean is set AND the lead has no child row of that type, so it is
-- safe to run after n8n/service-role has already started populating the tables. ADDITIVE — inserts only.
--
-- Timestamps: the booleans carry no scheduled/held/sent date, so those columns are left NULL (honest —
-- the actual date is unknown). The child row's `status` alone drives the recompute + the CRM status/
-- presence columns; the date SLA cells resolve to na/pending for these historical rows.
--
-- After each insert the recompute trigger fires and re-derives the boolean from the new row. Because the
-- status is chosen to reproduce the boolean (held ⇒ held+booked; scheduled ⇒ booked; sent ⇒ offer_sent),
-- the values are unchanged for consistent leads and gently CORRECTED for the few `meeting_held=true AND
-- meeting_booked=false` rows (a held meeting implies a booked one).

-- --- lead_meetings: one intro meeting per lead that has meeting_booked/meeting_held but no meeting row ---
insert into public.lead_meetings (lead_id, meeting_type, status)
select
  l.id,
  'intro'::public.meeting_type,
  (case when l.meeting_held then 'held' else 'scheduled' end)::public.meeting_status
from public.leads l
where (l.meeting_booked or l.meeting_held)
  and not exists (select 1 from public.lead_meetings m where m.lead_id = l.id);

-- --- lead_offers: one sent offer per lead that has offer_sent but no offer row ---
insert into public.lead_offers (lead_id, status)
select
  l.id,
  'sent'::public.offer_status
from public.leads l
where l.offer_sent
  and not exists (select 1 from public.lead_offers o where o.lead_id = l.id);
