-- Repair promote_contact_to_lead: enum cast on insert, and lead date from the reply.
--
-- Defect 1 — every insert has raised since 2026-07-23 (F1).
-- 20260723_promote_contact_qualification_sync replaced the literal `'preMQL'` in the INSERT with
-- `coalesce(v_qualification, 'preMQL')`. The literal was an untyped constant Postgres coerced to
-- public.lead_qualification; the coalesce resolves to `text`, and under `set search_path = ''`
-- there is no implicit assignment cast, so the statement raises:
--
--     column "qualification" is of type public.lead_qualification but expression is of type text
--
-- Only the INSERT path was affected — the two idempotency branches assign the *literal* 'MQL' and
-- kept working, which is why re-promotions succeeded while new leads did not. The five branch-S
-- Postgres nodes run `onError: continueRegularOutput` (ADR-0017: a Supabase failure must not stop
-- the sheet), so n8n reported success and the loss was silent: 51 `Interested` replies across 11
-- clients were left with `lead_id is null` between 2026-07-23 and 2026-07-27.
--
-- Defect 2 — lead date was the ingestion moment, not the reply (F7).
-- The INSERT never set created_at, so it defaulted to now(): a lead landed on the day n8n happened
-- to run, not the day the prospect answered. Every WoW/MoM bucket is cut on `leads.created_at`
-- (04-metrics-catalog §10-11), so a delayed or replayed run silently moved leads between weeks —
-- and a backfill of the 51 lost leads would have piled all of them onto one day. CS PDCA counts by
-- the client sheet's LEAD RECEIVED date; `replies.received_at` is that same fact.
-- Decided 2026-07-27: created_at comes from the originating reply.
--
-- Body-only replacement. Signature, SECURITY DEFINER and grants are unchanged from 20260722e.

begin;

create or replace function public.promote_contact_to_lead(
  p_sequencer_contact_id uuid,
  p_origin_reply_id      uuid,
  p_campaign_id          uuid default null,
  p_lead                 jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    -- Upgrade-only qualification sync: a later run carrying an MQL label promotes preMQL -> MQL.
    if v_qualification = 'MQL' then
      update public.leads set qualification = 'MQL'
       where id = v_lead_id and qualification::text = 'preMQL';
    end if;
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end if;

  -- Idempotency B / (3): this contact already has a CRM lead. A later positive reply attaches to
  -- the existing lead — one contact never yields two leads.
  select id into v_lead_id
    from public.leads where source_sequencer_contact_id = p_sequencer_contact_id;
  if v_lead_id is not null then
    update public.replies set lead_id = v_lead_id where id = p_origin_reply_id and lead_id is null;
    -- Upgrade-only qualification sync (see Idempotency A). This is the branch that fires when the
    -- MQL tag is attached to an already-known contact — the promotion that was lost before.
    if v_qualification = 'MQL' then
      update public.leads set qualification = 'MQL'
       where id = v_lead_id and qualification::text = 'preMQL';
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
$$;

-- SECURITY DEFINER function ownership + grants are unchanged from 20260722e (service_role only).

commit;
