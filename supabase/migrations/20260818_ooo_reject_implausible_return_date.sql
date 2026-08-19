-- ooo_followups: refuse an extracted return date that cannot be true, and say so out loud.
--
-- Why. The OOO return date decides when a contact is re-enrolled, and it is produced by an LLM
-- reading a free-text auto-responder. `record_ooo_followup` validated the *provenance* of that date
-- (`date_source` must be one of three values; `reply_parsed` must carry a non-null date) but never
-- its *plausibility*. Measured on production 2026-08-18, over 974 episodes with
-- `date_source = 'reply_parsed'`:
--
--     plausible (0-60 days out)   938
--     already in the past          35     2023-08-04 … 2026-08-14
--     more than 6 months out        1     2027-07-24
--
-- The failure is almost always a dropped year: created 2026-08-06, "returns" 2025-08-15. The model
-- reads "August 15" off the email and invents the rest. 23 of the 36 were later expired as `stale`
-- by the Wave 1 worker — contacts who wrote "I am back on ⟨date⟩" and were never followed up at all.
-- 6 more were submitted on a hallucinated schedule.
--
-- Where the threshold comes from. It is measured, not chosen. Deltas between the expected return
-- date and the episode's creation date, for every parsed date in the past:
--
--     -1  -1  -1  -2  -2  -2  -3  -3  -5   |   -13  -18  -21  -38  -51  -54  -66  -75  -87  -99 …
--
-- Legitimate late processing clusters at -1 … -5 (an auto-responder whose window closed before the
-- reply was handled). Then there is an empty band, and the garbage starts at -13. A cut at
-- `current_date - 7` sits inside that gap: it keeps all 9 real ones and rejects all 27 impossible
-- ones. The upper bound of +180 days is not a measured gap — one row, at +366 — but an OOO absence
-- longer than half a year is a resignation, not a holiday.
--
-- What happens to a rejected date. NOT an exception: raising would abort the episode entirely, which
-- is strictly worse than what happens today. The date is discarded, the episode is scheduled on the
-- default cadence exactly as if the reply had carried no date, and `date_source` records
-- `parse_rejected` — a fourth value, so that this stops being invisible. `fallback` would have hidden
-- it among the 1056 replies that genuinely had no date to find; the whole point is to be able to ask
-- "how often is the extractor wrong?" and get an answer.
--
-- Note the interaction with the refresh branch (step 2): after rejection both `p_expected_return_date`
-- and `p_scheduled_for` are null, so the existing "knowledge is only added, never erased" rule
-- applies unchanged — a bad parse on a second OOO reply cannot overwrite a good date an earlier reply
-- established. That is why the demotion sets the arguments to null rather than special-casing later.
--
-- `parse_rejected` is an OUTCOME the function assigns, never an input a caller may send: the
-- argument whitelist still accepts only reply_parsed | fallback | manual.
--
-- Verified on production 2026-08-18 in a rolled-back transaction: a 2025 date on a 2026 reply is
-- demoted and scheduled at current_date + 2; a -3-day date is kept; a caller passing
-- 'parse_rejected' is still rejected; a rejected parse on an existing episode leaves its stored date
-- alone.
--
-- ADR-0015 (episode lifecycle is RPC-owned), ADR-0016 (a workflow that contradicts a data contract
-- is a defect in the workflow — this invariant belongs in the database, not in n8n).

alter table public.ooo_followups
  drop constraint if exists ooo_followups_date_source_check;

alter table public.ooo_followups
  add constraint ooo_followups_date_source_check
  check (date_source = any (array['reply_parsed', 'fallback', 'manual', 'parse_rejected']));

create or replace function public.record_ooo_followup(
  p_sequencer_contact_id uuid,
  p_source_reply_id      uuid default null,
  p_expected_return_date date default null,
  p_scheduled_for        date default null,
  p_date_source          text default 'fallback'
)
returns public.ooo_followups
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row          public.ooo_followups;
  v_client_id    uuid;
  v_routing_key  text;
  v_auto_enabled boolean;
  v_campaign_id  uuid;
  v_scheduled    date;
  v_status       public.ooo_followup_status := 'pending';
  v_skip_reason  text;
begin
  if p_date_source is null or p_date_source not in ('reply_parsed', 'fallback', 'manual') then
    raise exception 'Unknown date_source %; expected reply_parsed|fallback|manual', p_date_source;
  end if;
  -- Spec §3: a fallback date must never be recorded as a parsed return date.
  if p_date_source = 'reply_parsed' and p_expected_return_date is null then
    raise exception 'date_source=reply_parsed requires a non-null expected_return_date';
  end if;

  -- A parsed date has to be usable for SCHEDULING or it is not information at all. See the header
  -- for where -7 and +180 come from. Discard it and fall through to the default cadence, but record
  -- that it happened: `parse_rejected` is the difference between "the reply had no date" and "the
  -- extractor produced one we could not believe".
  if p_date_source = 'reply_parsed'
     and (p_expected_return_date < current_date - 7
          or p_expected_return_date > current_date + 180) then
    p_expected_return_date := null;
    p_scheduled_for        := null;
    p_date_source          := 'parse_rejected';
  end if;

  select cs.client_id, sc.routing_key, c.auto_ooo_enabled
    into v_client_id, v_routing_key, v_auto_enabled
    from public.sequencer_contacts sc
    join public.client_sequencers cs on cs.id = sc.client_sequencer_id
    join public.clients c            on c.id  = cs.client_id
   where sc.id = p_sequencer_contact_id;
  if v_client_id is null then
    raise exception 'Unknown sequencer_contact_id %', p_sequencer_contact_id;
  end if;

  -- 1. Same reply already recorded → idempotent no-op.
  if p_source_reply_id is not null then
    select * into v_row from public.ooo_followups where source_reply_id = p_source_reply_id;
    if found then
      return v_row;
    end if;
  end if;

  -- OOO_FALLBACK_DAYS = 2. expected_return_date is never invented — see step 3.
  v_scheduled := coalesce(p_scheduled_for, coalesce(p_expected_return_date, current_date) + 2);

  -- 2. Refresh the existing active episode (spec §4).
  --    KNOWLEDGE IS ONLY ADDED, NEVER ERASED: a later OOO reply often carries no parseable date (a
  --    bare auto-responder), and overwriting with NULL would throw away a date an earlier reply DID
  --    determine — then reschedule to today+2 and re-enrol the contact while they are still away.
  --    So a NULL argument leaves the stored value alone, and the same rule governs `scheduled_for`
  --    and `date_source`: they only move when the caller actually supplies new information. A
  --    rejected parse arrives here as all-NULL, so it is covered by that rule without a special case.
  update public.ooo_followups f
     set expected_return_date = coalesce(p_expected_return_date, f.expected_return_date),
         scheduled_for        = case
                                  when p_scheduled_for is not null then p_scheduled_for
                                  when p_expected_return_date is not null then p_expected_return_date + 2
                                  else f.scheduled_for
                                end,
         date_source          = case
                                  when p_scheduled_for is not null
                                    or p_expected_return_date is not null then p_date_source
                                  else f.date_source
                                end,
         source_reply_id      = coalesce(p_source_reply_id, f.source_reply_id)
   where f.sequencer_contact_id = p_sequencer_contact_id
     and f.status in ('pending', 'processing', 'failed')
  returning * into v_row;
  if found then
    return v_row;
  end if;

  -- 3. New episode. Missing configuration is recorded as an explicit, visible skip (spec §17) —
  --    never a silent drop.
  if not coalesce(v_auto_enabled, false) then
    v_status := 'skipped';
    v_skip_reason := 'automation_disabled';
  else
    v_campaign_id := public.resolve_ooo_routing(v_client_id, v_routing_key);
    if v_campaign_id is null then
      v_status := 'skipped';
      v_skip_reason := 'routing_missing';
    end if;
  end if;

  begin
    insert into public.ooo_followups (
      sequencer_contact_id, source_reply_id, expected_return_date, scheduled_for, date_source,
      status, routing_key, target_campaign_id, routing_source, skip_reason
    ) values (
      p_sequencer_contact_id, p_source_reply_id, p_expected_return_date, v_scheduled, p_date_source,
      v_status, v_routing_key, v_campaign_id, 'automatic', v_skip_reason
    )
    returning * into v_row;
  exception when unique_violation then
    -- A concurrent worker won the race on uq_ooo_followups_active / uq_ooo_followups_source_reply.
    -- Return whatever it created: the outcome the caller wanted is already true.
    select * into v_row
      from public.ooo_followups
     where (p_source_reply_id is not null and source_reply_id = p_source_reply_id)
        or (sequencer_contact_id = p_sequencer_contact_id
            and status in ('pending', 'processing', 'failed'))
     limit 1;
  end;

  return v_row;
end;
$function$;
