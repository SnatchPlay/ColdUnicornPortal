-- Backfill the CRM leads lost while promote_contact_to_lead was raising (2026-07-23 .. 2026-07-27).
--
-- Depends on 20260727_promote_contact_lead_cast_and_date, which repairs the enum cast that made
-- every insert raise and makes `leads.created_at` come from `replies.received_at`. Run in order:
-- backfilling before that migration would raise on every row; backfilling after it, but before the
-- date change, would have stamped all ~51 leads with the migration's own timestamp and put a
-- fabricated spike into one WoW bucket.
--
-- Scope: every `Interested` reply that is linked to a sequencer contact and still has no lead.
-- Deliberately NOT restricted to a date window — the invariant "a positive reply has a lead" holds
-- for all time, and a row that predates the incident is just as wrong.
--
-- IDEMPOTENT: promote_contact_to_lead is idempotent (returns created=false for an already-promoted
-- reply or an already-promoted contact), and the WHERE clause re-checks `lead_id is null`, so a
-- second run is a no-op. On an empty database this is a no-op too.
--
-- PER-ROW ISOLATION: each promotion runs inside its own exception block. The RPC raises on cases
-- this backfill must not paper over — a contact whose client_sequencer vanished, a reply whose
-- classification was corrected after the fact — and one such row must not abort the other fifty.
-- Every skip is RAISEd as a WARNING so the run is auditable rather than silently partial; that is
-- the same failure mode (silent partial success) that let the original defect live for four days.
--
-- Qualification is left to the RPC default (preMQL). The MQL labels live on Bison tags, which this
-- migration cannot read; branch S re-runs promote_contact_to_lead with the label on the next
-- TAG_ATTACHED event and the upgrade-only sync lifts preMQL -> MQL then.

begin;

do $$
declare
  r            record;
  v_result     jsonb;
  v_created    int := 0;
  v_existing   int := 0;
  v_skipped    int := 0;
begin
  for r in
    select rep.id as reply_id, rep.sequencer_contact_id, rep.received_at
      from public.replies rep
     where rep.classification = 'Interested'
       and rep.lead_id is null
       and rep.sequencer_contact_id is not null
     order by rep.received_at
  loop
    begin
      v_result := public.promote_contact_to_lead(r.sequencer_contact_id, r.reply_id, null, '{}'::jsonb);
      if (v_result ->> 'created')::boolean then
        v_created := v_created + 1;
      else
        v_existing := v_existing + 1;
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
      raise warning 'backfill skipped reply % (contact %, received %): %',
        r.reply_id, r.sequencer_contact_id, r.received_at, sqlerrm;
    end;
  end loop;

  raise notice 'orphaned-reply backfill: % created, % already had a lead, % skipped',
    v_created, v_existing, v_skipped;
end $$;

commit;
