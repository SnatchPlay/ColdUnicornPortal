-- promote_contact_to_lead: sync qualification in both directions, not upgrade-only.
--
-- Why. The CS PDCA client sheet and Supabase disagreed on 102 leads across 15 clients, always the
-- same way: sheet preMQL, Supabase MQL. Neither store was corrupt. The sheet rewrites QUALIFICATION
-- on every TAG_ATTACHED event, in both directions; this function only ever promoted preMQL -> MQL
-- and silently ignored the reverse. A lead tagged Interested and later re-tagged preMQL therefore
-- diverged permanently.
--
-- Verified on 2026-08-05 against a real execution: Bison lead 498990 (Bent Iron PL, Damian Gorniak)
-- carried tags {Custom Mail Server, preMQL} with no Interested tag, the sheet held preMQL and this
-- table held MQL. The tag set is the state, so the sheet was right.
--
-- Ships WITH the caller change, never before it: bison-lead-enrichment and aimfox-leads-processing
-- now derive the label from the lead's whole tag set instead of the single event that woke the run.
-- Applying this migration against the old callers would let one preMQL event demote a lead that
-- still holds the Interested tag.
--
-- ADR-0015 (the RPC owns the lead lifecycle) - ADR-0017 (dual-write, phase A: the sheet is
-- authoritative for outreach state while the agency still runs on it).

CREATE OR REPLACE FUNCTION public.promote_contact_to_lead(p_sequencer_contact_id uuid, p_origin_reply_id uuid, p_campaign_id uuid DEFAULT NULL::uuid, p_lead jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Editable identity/enrichment fields only. Anything absent from this list is rejected.
  v_allowed        text[] := array[
    'email', 'first_name', 'last_name', 'job_title', 'company_name', 'linkedin_url', 'gender',
    'phone_number', 'phone_source', 'industry', 'headcount_range', 'website', 'country',
    'qualification'
  ];
  v_unknown        text[];
  v_client_id      uuid;
  v_sequencer_id   uuid;
  v_external_id    text;
  v_contact_email  text;
  v_reply_contact  uuid;
  v_classification text;
  v_gender         text;
  v_qualification  text;
  v_received_at    timestamptz;
  v_lead_id        uuid;
begin
  -- (6) no unknown keys
  select array_agg(k) into v_unknown
    from jsonb_object_keys(coalesce(p_lead, '{}'::jsonb)) k
   where k <> all (v_allowed);
  if v_unknown is not null then
    raise exception 'promote_contact_to_lead rejects unknown lead fields: %', v_unknown;
  end if;

  select cs.client_id, cs.sequencer_id, sc.external_contact_id, sc.email
    into v_client_id, v_sequencer_id, v_external_id, v_contact_email
    from public.sequencer_contacts sc
    join public.client_sequencers cs on cs.id = sc.client_sequencer_id
   where sc.id = p_sequencer_contact_id;
  if v_client_id is null then
    raise exception 'Unknown sequencer_contact_id %', p_sequencer_contact_id;
  end if;

  -- (1) the reply must belong to this contact, and (2) be a positive one.
  select r.sequencer_contact_id, r.classification::text, r.received_at
    into v_reply_contact, v_classification, v_received_at
    from public.replies r
   where r.id = p_origin_reply_id;
  if v_reply_contact is null then
    raise exception 'Reply % is not linked to any sequencer contact', p_origin_reply_id;
  end if;
  if v_reply_contact <> p_sequencer_contact_id then
    raise exception 'Reply % belongs to contact %, not %',
      p_origin_reply_id, v_reply_contact, p_sequencer_contact_id;
  end if;
  if v_classification is distinct from 'Interested' then
    raise exception 'Reply % has classification % — only a positive reply creates a CRM lead',
      p_origin_reply_id, coalesce(v_classification, 'null');
  end if;

  -- (4) a supplied campaign must belong to the same client.
  if p_campaign_id is not null
     and not exists (select 1 from public.campaigns c
                      where c.id = p_campaign_id and c.client_id = v_client_id) then
    raise exception 'Campaign % does not belong to client %', p_campaign_id, v_client_id;
  end if;

  -- (5) gender must be a valid enum label.
  v_gender := p_lead ->> 'gender';
  if v_gender is not null and v_gender not in ('male', 'female') then
    raise exception 'Unknown gender %; expected male|female', v_gender;
  end if;

  -- (5a) qualification, when supplied, must be a known stage. Empty string == not supplied.
  v_qualification := nullif(p_lead ->> 'qualification', '');
  if v_qualification is not null and v_qualification not in ('MQL', 'preMQL') then
    raise exception 'Unknown qualification %; expected MQL|preMQL', v_qualification;
  end if;

  -- (7) the payload email must not silently contradict the contact identity.
  if v_contact_email is not null and (p_lead ->> 'email') is not null
     and lower(v_contact_email) <> lower(p_lead ->> 'email') then
    raise exception 'Payload email % contradicts contact identity % — update the contact first',
      p_lead ->> 'email', v_contact_email;
  end if;

  -- Idempotency A: this exact reply was already promoted.
  select id into v_lead_id from public.leads where origin_reply_id = p_origin_reply_id;
  if v_lead_id is not null then
    -- Two-way qualification sync (Idempotency A — same originating reply). Upgrade-only was the rule until 2026-08-05 and it
    -- produced a standing disagreement: the client sheet rewrites QUALIFICATION on every tag event
    -- in both directions, so a lead whose Interested tag was removed and preMQL attached read
    -- preMQL in the sheet and MQL here, on 102 leads across 15 clients. The callers now derive the
    -- label from the lead's whole tag set rather than from the event that fired, so the value
    -- arriving here is the current state and may legitimately be lower than what is stored.
    --
    -- The stage guard is what makes that safe: only MQL <-> preMQL ever move. A lead that has
    -- advanced to meeting_scheduled, meeting_held, offer_sent, won or rejected is never touched by
    -- an inbound tag, which is the protection the old preMQL-only predicate gave for free.
    if v_qualification is not null then
      update public.leads
         set qualification = v_qualification::public.lead_qualification
       where id = v_lead_id
         and qualification::text in ('MQL', 'preMQL')
         and qualification::text is distinct from v_qualification;
    end if;
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end if;

  -- Idempotency B / (3): this contact already has a CRM lead. A later positive reply attaches to
  -- the existing lead — one contact never yields two leads.
  select id into v_lead_id
    from public.leads where source_sequencer_contact_id = p_sequencer_contact_id;
  if v_lead_id is not null then
    update public.replies set lead_id = v_lead_id where id = p_origin_reply_id and lead_id is null;
    -- Two-way qualification sync (Idempotency B — same contact). Upgrade-only was the rule until 2026-08-05 and it
    -- produced a standing disagreement: the client sheet rewrites QUALIFICATION on every tag event
    -- in both directions, so a lead whose Interested tag was removed and preMQL attached read
    -- preMQL in the sheet and MQL here, on 102 leads across 15 clients. The callers now derive the
    -- label from the lead's whole tag set rather than from the event that fired, so the value
    -- arriving here is the current state and may legitimately be lower than what is stored.
    --
    -- The stage guard is what makes that safe: only MQL <-> preMQL ever move. A lead that has
    -- advanced to meeting_scheduled, meeting_held, offer_sent, won or rejected is never touched by
    -- an inbound tag, which is the protection the old preMQL-only predicate gave for free.
    if v_qualification is not null then
      update public.leads
         set qualification = v_qualification::public.lead_qualification
       where id = v_lead_id
         and qualification::text in ('MQL', 'preMQL')
         and qualification::text is distinct from v_qualification;
    end if;
    perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end if;

  begin
    insert into public.leads (
      client_id, campaign_id, sequencer_id, external_id,
      source_sequencer_contact_id, origin_reply_id,
      qualification, source, created_at,
      email, first_name, last_name, job_title, company_name, linkedin_url, gender,
      phone_number, phone_source, industry, headcount_range, website, country
    ) values (
      v_client_id, p_campaign_id, v_sequencer_id, v_external_id,
      p_sequencer_contact_id, p_origin_reply_id,
      coalesce(v_qualification, 'preMQL')::public.lead_qualification, 'cold_email',
      coalesce(v_received_at, now()),
      coalesce(p_lead ->> 'email', v_contact_email),
      p_lead ->> 'first_name', p_lead ->> 'last_name', p_lead ->> 'job_title',
      p_lead ->> 'company_name', p_lead ->> 'linkedin_url', v_gender::public.lead_gender,
      p_lead ->> 'phone_number', p_lead ->> 'phone_source', p_lead ->> 'industry',
      p_lead ->> 'headcount_range', p_lead ->> 'website', p_lead ->> 'country'
    )
    returning id into v_lead_id;
  exception when unique_violation then
    -- Concurrent promotion of the same contact/reply won the race.
    select id into v_lead_id
      from public.leads
     where origin_reply_id = p_origin_reply_id
        or source_sequencer_contact_id = p_sequencer_contact_id
     limit 1;
    update public.replies set lead_id = v_lead_id where id = p_origin_reply_id and lead_id is null;
    if v_qualification = 'MQL' then
      update public.leads set qualification = 'MQL'
       where id = v_lead_id and qualification::text = 'preMQL';
    end if;
    perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end;

  update public.replies set lead_id = v_lead_id where id = p_origin_reply_id;
  -- Spec §7: the OOO episode ends when the person answers positively — but its history stays.
  perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');

  return jsonb_build_object('lead_id', v_lead_id, 'created', true);
end;
$function$
;
