-- The ingestion contract for the OOO model (ADR-0015, spec §12).
--
-- WHY FUNCTIONS AND NOT RAW UPSERTS FROM n8n: every guarantee in spec §17 (one active follow-up per
-- contact, no duplicate contact/reply/lead, cancel-not-delete) is an INVARIANT. If n8n writes raw
-- SQL, those invariants live in a workflow that can be edited without review. Here they live in the
-- database, so a redelivered webhook, a concurrent worker or a hand-run query all hit the same rule.
--
-- SCHEMA PLACEMENT: everything callable is in `public`. The `private` schema has NO USAGE grant for
-- `authenticated` (see the comment at supabase/functions/orm-gateway/index.ts:1890) — RLS policies
-- can reference private.* because policy expressions are evaluated in the table owner's context,
-- but a function the gateway calls directly cannot live there.
--
-- TWO PRIVILEGE TIERS:
--   * the whole episode lifecycle (upsert_*, record_*, claim/submitted/confirmed/failed, skip,
--     cancel, retry, reopen, promote_*) → SECURITY DEFINER, service_role ONLY. n8n drives OOO
--     end-to-end; the portal has NO action that reads or mutates a follow-up, by product decision.
--   * resolve_ooo_routing / recover_skipped_ooo_followups → PLAIN functions (no DEFINER). The
--     gateway calls them as `authenticated` from the client-drawer routing editor, so RLS on
--     client_ooo_routing / ooo_followups is what scopes them — which is why 20260722d keeps a
--     SELECT *and* an UPDATE policy on ooo_followups even though no portal screen lists episodes:
--     recover_skipped_ooo_followups updates them on the caller's behalf. As service_role/owner the
--     same functions bypass RLS and see everything, which ingestion needs.
--
-- Every function uses `set search_path = ''` (not 'public'): an empty search_path plus fully
-- qualified names is the only configuration where a SECURITY DEFINER body cannot be redirected by
-- objects created in a schema the caller controls.
--
-- FALLBACK CONSTANT: when the OOO reply carries no parseable return date, `scheduled_for` defaults
-- to today + OOO_FALLBACK_DAYS (2). `expected_return_date` stays NULL — a fallback is never written
-- as if it were a determined return date (spec §3). Documented in 12-hidden-rules.md.

begin;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Routing resolution — specific key → general → none (spec §11)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- NOT security definer: under `authenticated` the client_ooo_routing SELECT policy scopes it; under
-- service_role / the table owner it sees everything. NULL means "no routing" and the caller must
-- surface that as skipped/routing_missing — never silently treat it as 'general'.
create or replace function public.resolve_ooo_routing(p_client_id uuid, p_routing_key text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select r.campaign_id
  from public.client_ooo_routing r
  where r.client_id = p_client_id
    and r.is_active
    and r.routing_key in (p_routing_key, 'general')
  -- Specific key wins over the general fallback.
  order by (r.routing_key = p_routing_key) desc, r.created_at desc
  limit 1;
$$;

revoke all on function public.resolve_ooo_routing(uuid, text) from public, anon;
grant execute on function public.resolve_ooo_routing(uuid, text) to authenticated, service_role;

comment on function public.resolve_ooo_routing(uuid, text) is
  'ADR-0015. Resolves the OOO follow-up campaign for (client, routing_key): specific key → general → NULL. NULL means routing_missing; it is never an implicit general.';

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Ingestion: sequencer contacts and replies
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- Idempotent on the scoped identity (client_sequencer_id, external_contact_id). NULL arguments do
-- not erase known values — an event carrying fewer fields must not degrade the record.
create or replace function public.upsert_sequencer_contact(
  p_client_sequencer_id uuid,
  p_external_contact_id text,
  p_email               text default null,
  p_first_name          text default null,
  p_last_name           text default null,
  p_routing_key         text default null,
  p_raw_payload         jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_client_sequencer_id is null or coalesce(p_external_contact_id, '') = '' then
    raise exception 'upsert_sequencer_contact requires client_sequencer_id and external_contact_id';
  end if;
  if p_routing_key is not null and p_routing_key not in ('male', 'female', 'general') then
    raise exception 'Unknown routing_key %; expected male|female|general', p_routing_key;
  end if;

  insert into public.sequencer_contacts as sc (
    client_sequencer_id, external_contact_id, email, first_name, last_name,
    routing_key, raw_payload
  )
  values (
    p_client_sequencer_id, p_external_contact_id, p_email, p_first_name, p_last_name,
    coalesce(p_routing_key, 'general'), coalesce(p_raw_payload, '{}'::jsonb)
  )
  on conflict (client_sequencer_id, external_contact_id) do update set
    email        = coalesce(excluded.email,       sc.email),
    first_name   = coalesce(excluded.first_name,  sc.first_name),
    last_name    = coalesce(excluded.last_name,   sc.last_name),
    routing_key  = coalesce(p_routing_key,        sc.routing_key),
    raw_payload  = coalesce(p_raw_payload,        sc.raw_payload),
    last_seen_at = now()
  returning sc.id into v_id;

  return v_id;
end;
$$;

-- Idempotent on replies.external_id (the pre-existing ingestion key, unchanged). `client_id` is
-- DERIVED from the contact, never taken from the caller, so a reply cannot be filed under a client
-- the contact does not belong to. `lead_id` stays NULL when no CRM lead exists yet (spec AC-4).
create or replace function public.upsert_reply(
  p_external_id          text,
  p_received_at          timestamptz,
  p_sequencer_contact_id uuid default null,
  p_lead_id              uuid default null,
  p_classification       text default null,
  p_message_subject      text default null,
  p_message_text         text default null,
  p_is_automated_reply   boolean default false,
  p_from_email_address   text default null,
  p_sequence_step        smallint default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id        uuid;
  v_client_id uuid;
begin
  if coalesce(p_external_id, '') = '' or p_received_at is null then
    raise exception 'upsert_reply requires external_id and received_at';
  end if;

  if p_sequencer_contact_id is not null then
    select cs.client_id
      into v_client_id
      from public.sequencer_contacts sc
      join public.client_sequencers cs on cs.id = sc.client_sequencer_id
     where sc.id = p_sequencer_contact_id;
    if v_client_id is null then
      raise exception 'Unknown sequencer_contact_id %', p_sequencer_contact_id;
    end if;
  elsif p_lead_id is not null then
    select l.client_id into v_client_id from public.leads l where l.id = p_lead_id;
  end if;

  insert into public.replies as r (
    external_id, received_at, sequencer_contact_id, lead_id, client_id,
    classification, message_subject, message_text, is_automated_reply,
    from_email_address, sequence_step
  )
  values (
    p_external_id, p_received_at, p_sequencer_contact_id, p_lead_id, v_client_id,
    p_classification::public.reply_classification, p_message_subject, p_message_text,
    coalesce(p_is_automated_reply, false), p_from_email_address, p_sequence_step
  )
  on conflict (external_id) do update set
    sequencer_contact_id = coalesce(excluded.sequencer_contact_id, r.sequencer_contact_id),
    lead_id              = coalesce(excluded.lead_id,              r.lead_id),
    client_id            = coalesce(excluded.client_id,            r.client_id),
    classification       = coalesce(excluded.classification,       r.classification),
    message_subject      = coalesce(excluded.message_subject,      r.message_subject),
    message_text         = coalesce(excluded.message_text,         r.message_text),
    is_automated_reply   = excluded.is_automated_reply
  returning r.id into v_id;

  return v_id;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- record_ooo_followup — create or update THE single active episode (spec §4)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Check order is load-bearing:
--   1. a follow-up already exists for this source_reply_id (ANY status) → return it. This is the
--      redelivery guard, and it must come first: once an episode is `submitted` it is no longer
--      "active", so step 2 would happily open a duplicate for the very same reply.
--   2. an ACTIVE follow-up exists → update its dates and re-point it at the newer reply. Never a
--      second parallel active row.
--   3. otherwise create a new episode, resolving routing.
create or replace function public.record_ooo_followup(
  p_sequencer_contact_id uuid,
  p_source_reply_id      uuid default null,
  p_expected_return_date date default null,
  p_scheduled_for        date default null,
  p_date_source          text default 'fallback'
) returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
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
  --    and `date_source`: they only move when the caller actually supplies new information.
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
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- State machine — one function per transition, each an atomic conditional UPDATE
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Allowed transitions:
--   pending   → processing | cancelled | skipped
--   processing→ submitted  | failed    | cancelled
--   failed    → processing | pending (retry) | cancelled | skipped
--   submitted → confirmed  | cancelled
--   confirmed → (terminal)
--   cancelled → pending  (explicit reopen only)
--   skipped   → pending  (explicit reopen only)
-- A generic mark(id, status) is deliberately NOT offered: it makes pending→confirmed and
-- cancelled→submitted one typo away.

-- Claim for processing. Contention is NORMAL, so a lost race returns NULL rather than raising:
-- `where status in (...)` is the lock — if another worker already claimed it, no row comes back.
create or replace function public.claim_ooo_followup(p_id uuid)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ooo_followups;
begin
  update public.ooo_followups
     set status          = 'processing',
         attempt_count   = attempt_count + 1,
         last_attempt_at = now(),
         last_error      = null,
         next_attempt_at = null
   where id = p_id
     and status in ('pending', 'failed')
  returning * into v_row;

  return v_row;  -- NULL ⇒ already claimed by another worker, or not in a claimable state.
end;
$$;

-- The sequencer API accepted the request. NOT proof of campaign membership — a batch call can
-- silently ignore a contact that is already enrolled. The portal labels this "Sent to sequencer".
create or replace function public.mark_ooo_submitted(p_id uuid)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ooo_followups;
begin
  update public.ooo_followups
     set status = 'submitted', submitted_at = now(), last_error = null
   where id = p_id and status = 'processing'
  returning * into v_row;

  if not found then
    raise exception 'ooo_followup % cannot move to submitted from %',
      p_id, (select status from public.ooo_followups where id = p_id);
  end if;
  return v_row;
end;
$$;

-- Membership verified by a separate reconciliation call. Optional by design: if the sequencer API
-- offers no such check, this transition is simply never used and `submitted` is terminal success.
create or replace function public.mark_ooo_confirmed(p_id uuid)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ooo_followups;
begin
  update public.ooo_followups
     set status = 'confirmed', confirmed_at = now()
   where id = p_id and status = 'submitted'
  returning * into v_row;

  if not found then
    raise exception 'ooo_followup % cannot move to confirmed from %',
      p_id, (select status from public.ooo_followups where id = p_id);
  end if;
  return v_row;
end;
$$;

-- attempt_count is NOT incremented here — claim_ooo_followup already counted this attempt.
create or replace function public.mark_ooo_failed(
  p_id              uuid,
  p_error           text,
  p_next_attempt_at timestamptz default null
) returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ooo_followups;
begin
  update public.ooo_followups
     set status = 'failed', last_error = p_error, next_attempt_at = p_next_attempt_at
   where id = p_id and status = 'processing'
  returning * into v_row;

  if not found then
    raise exception 'ooo_followup % cannot move to failed from %',
      p_id, (select status from public.ooo_followups where id = p_id);
  end if;
  return v_row;
end;
$$;

-- Business/configuration reason, not a technical error. Stays visible in the portal so the missing
-- configuration is actionable (spec §17).
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
     ('routing_missing', 'campaign_missing', 'automation_disabled', 'contact_ineligible') then
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

-- Cancel by id. The row is never deleted (spec §6): the detection, the dates, the attempts and the
-- reason are the audit trail.
create or replace function public.cancel_ooo_followup(p_id uuid, p_reason text)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ooo_followups;
begin
  if p_reason is null or p_reason not in
     ('ooo_removed', 'positive_reply_received', 'manual_cancel',
      'classification_corrected', 'superseded') then
    raise exception 'Unknown cancellation_reason %', p_reason;
  end if;
  update public.ooo_followups
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason
   where id = p_id and status <> 'cancelled'
  returning * into v_row;

  if not found then
    -- Already cancelled ⇒ idempotent success, not an error (webhooks retry).
    select * into v_row from public.ooo_followups where id = p_id;
    if not found then
      raise exception 'Unknown ooo_followup %', p_id;
    end if;
  end if;
  return v_row;
end;
$$;

-- Cancel whatever is currently active for a contact. This is the "OOO tag removed" / "positive
-- reply arrived" path, where the caller knows the person but not the episode.
create or replace function public.cancel_active_ooo_followup(p_sequencer_contact_id uuid, p_reason text)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id
    from public.ooo_followups
   where sequencer_contact_id = p_sequencer_contact_id
     and status in ('pending', 'processing', 'failed');

  if v_id is null then
    return null;  -- Nothing active ⇒ nothing to cancel. Idempotent.
  end if;
  return public.cancel_ooo_followup(v_id, p_reason);
end;
$$;

-- failed → pending. attempt_count is intentionally NOT reset: it is the historical number of
-- attempts, and zeroing it would hide a record that has been failing all week.
create or replace function public.retry_ooo_followup(p_id uuid)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ooo_followups;
begin
  update public.ooo_followups
     set status = 'pending', next_attempt_at = null, last_error = null
   where id = p_id and status = 'failed'
  returning * into v_row;

  if not found then
    raise exception 'ooo_followup % cannot be retried from %',
      p_id, (select status from public.ooo_followups where id = p_id);
  end if;
  return v_row;
end;
$$;

-- cancelled|skipped → pending. Re-resolves routing for automatic episodes, because the usual reason
-- to reopen is that the missing configuration has just been supplied. A manual_override keeps its
-- pinned campaign.
create or replace function public.reopen_ooo_followup(p_id uuid)
returns public.ooo_followups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.ooo_followups;
  v_contact uuid;
begin
  select sequencer_contact_id into v_contact from public.ooo_followups where id = p_id;
  if v_contact is null then
    raise exception 'Unknown ooo_followup %', p_id;
  end if;


  if exists (
    select 1 from public.ooo_followups
     where sequencer_contact_id = v_contact
       and status in ('pending', 'processing', 'failed')
  ) then
    raise exception 'Contact % already has an active OOO follow-up; cancel it before reopening %',
      v_contact, p_id;
  end if;

  update public.ooo_followups f
     set status      = 'pending',
         skip_reason = null,
         last_error  = null,
         target_campaign_id = case
           when f.routing_source = 'manual_override' then f.target_campaign_id
           else public.resolve_ooo_routing(
                  (select cs.client_id
                     from public.sequencer_contacts sc
                     join public.client_sequencers cs on cs.id = sc.client_sequencer_id
                    where sc.id = f.sequencer_contact_id),
                  f.routing_key)
         end
   where f.id = p_id and f.status in ('cancelled', 'skipped')
  returning * into v_row;

  if not found then
    raise exception 'ooo_followup % cannot be reopened from %',
      p_id, (select status from public.ooo_followups where id = p_id);
  end if;
  return v_row;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- recover_skipped_ooo_followups — configuration was fixed, bring the skipped episodes back (§10)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- NOT security definer: called by the gateway as `authenticated` right after a routing or
-- auto_ooo_enabled change, so the ooo_followups UPDATE policy is what limits it to the caller's
-- clients. Called as service_role it covers everything.
--
-- Only `routing_missing` and `automation_disabled` are auto-recovered — both mean "the system was
-- not configured", which the caller has just fixed. `contact_ineligible` is a judgement about the
-- person and requires an explicit reopen. `campaign_missing` is left to a manual reopen too, since
-- assigning a campaign is a separate decision.
create or replace function public.recover_skipped_ooo_followups(
  p_client_id   uuid,
  p_routing_key text default null
) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with candidates as (
    select f.id,
           public.resolve_ooo_routing(cs.client_id, f.routing_key) as resolved_campaign_id
      from public.ooo_followups f
      join public.sequencer_contacts sc on sc.id = f.sequencer_contact_id
      join public.client_sequencers  cs on cs.id = sc.client_sequencer_id
      join public.clients            c  on c.id  = cs.client_id
     where cs.client_id = p_client_id
       and f.status = 'skipped'
       and f.skip_reason in ('routing_missing', 'automation_disabled')
       and (p_routing_key is null or f.routing_key = p_routing_key)
       and c.auto_ooo_enabled
       -- Never resurrect a record whose contact already has a live episode.
       and not exists (
         select 1 from public.ooo_followups active
          where active.sequencer_contact_id = f.sequencer_contact_id
            and active.status in ('pending', 'processing', 'failed')
       )
       -- Only the newest skipped episode per contact; older ones stay history.
       and f.created_at = (
         select max(latest.created_at) from public.ooo_followups latest
          where latest.sequencer_contact_id = f.sequencer_contact_id
            and latest.status = 'skipped'
       )
  )
  update public.ooo_followups f
     set status             = 'pending',
         skip_reason        = null,
         target_campaign_id = candidates.resolved_campaign_id
    from candidates
   where f.id = candidates.id
     and candidates.resolved_campaign_id is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.recover_skipped_ooo_followups(uuid, text) from public, anon;
grant execute on function public.recover_skipped_ooo_followups(uuid, text) to authenticated, service_role;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- promote_contact_to_lead — the ONLY way an outreach contact becomes a CRM lead (spec §7)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- The payload is a strict whitelist. Everything that determines identity, scope or CRM state is
-- derived here, never accepted from the caller, so ingestion cannot invent a lead in another
-- client, pre-set `won`, or backdate `created_at`.
--
-- Returns {"lead_id": uuid, "created": bool}. A repeated webhook is NORMAL and must not raise:
-- it returns the existing lead with created=false, and attaches the new reply to it.
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
    'phone_number', 'phone_source', 'industry', 'headcount_range', 'website', 'country'
  ];
  v_unknown        text[];
  v_client_id      uuid;
  v_sequencer_id   uuid;
  v_external_id    text;
  v_contact_email  text;
  v_reply_contact  uuid;
  v_classification text;
  v_gender         text;
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
  select r.sequencer_contact_id, r.classification::text
    into v_reply_contact, v_classification
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

  -- (7) the payload email must not silently contradict the contact identity.
  if v_contact_email is not null and (p_lead ->> 'email') is not null
     and lower(v_contact_email) <> lower(p_lead ->> 'email') then
    raise exception 'Payload email % contradicts contact identity % — update the contact first',
      p_lead ->> 'email', v_contact_email;
  end if;

  -- Idempotency A: this exact reply was already promoted.
  select id into v_lead_id from public.leads where origin_reply_id = p_origin_reply_id;
  if v_lead_id is not null then
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end if;

  -- Idempotency B / (3): this contact already has a CRM lead. A later positive reply attaches to
  -- the existing lead — one contact never yields two leads.
  select id into v_lead_id
    from public.leads where source_sequencer_contact_id = p_sequencer_contact_id;
  if v_lead_id is not null then
    update public.replies set lead_id = v_lead_id where id = p_origin_reply_id and lead_id is null;
    perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end if;

  begin
    insert into public.leads (
      client_id, campaign_id, sequencer_id, external_id,
      source_sequencer_contact_id, origin_reply_id,
      qualification, source,
      email, first_name, last_name, job_title, company_name, linkedin_url, gender,
      phone_number, phone_source, industry, headcount_range, website, country
    ) values (
      v_client_id, p_campaign_id, v_sequencer_id, v_external_id,
      p_sequencer_contact_id, p_origin_reply_id,
      'preMQL', 'cold_email',
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
    perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end;

  update public.replies set lead_id = v_lead_id where id = p_origin_reply_id;
  -- Spec §7: the OOO episode ends when the person answers positively — but its history stays.
  perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');

  return jsonb_build_object('lead_id', v_lead_id, 'created', true);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Privileges: ingestion + state machine are service_role ONLY
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- These bypass RLS by construction (SECURITY DEFINER, owned by postgres). Granting them to
-- `authenticated` would hand every logged-in user a write path around every policy in this
-- database. The portal reaches follow-ups through the gateway under RLS instead.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.upsert_sequencer_contact(uuid, text, text, text, text, text, jsonb)',
    'public.upsert_reply(text, timestamptz, uuid, uuid, text, text, text, boolean, text, smallint)',
    'public.record_ooo_followup(uuid, uuid, date, date, text)',
    'public.claim_ooo_followup(uuid)',
    'public.mark_ooo_submitted(uuid)',
    'public.mark_ooo_confirmed(uuid)',
    'public.mark_ooo_failed(uuid, text, timestamptz)',
    'public.skip_ooo_followup(uuid, text)',
    'public.cancel_ooo_followup(uuid, text)',
    'public.cancel_active_ooo_followup(uuid, text)',
    'public.retry_ooo_followup(uuid)',
    'public.reopen_ooo_followup(uuid)',
    'public.promote_contact_to_lead(uuid, uuid, uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- promote_contact_to_lead — the ONLY way an outreach contact becomes a CRM lead (spec §7)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- The payload is a strict whitelist. Everything that determines identity, scope or CRM state is
-- derived here, never accepted from the caller, so ingestion cannot invent a lead in another
-- client, pre-set `won`, or backdate `created_at`.
--
-- Returns {"lead_id": uuid, "created": bool}. A repeated webhook is NORMAL and must not raise:
-- it returns the existing lead with created=false, and attaches the new reply to it.
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
    'phone_number', 'phone_source', 'industry', 'headcount_range', 'website', 'country'
  ];
  v_unknown        text[];
  v_client_id      uuid;
  v_sequencer_id   uuid;
  v_external_id    text;
  v_contact_email  text;
  v_reply_contact  uuid;
  v_classification text;
  v_gender         text;
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
  select r.sequencer_contact_id, r.classification::text
    into v_reply_contact, v_classification
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

  -- (7) the payload email must not silently contradict the contact identity.
  if v_contact_email is not null and (p_lead ->> 'email') is not null
     and lower(v_contact_email) <> lower(p_lead ->> 'email') then
    raise exception 'Payload email % contradicts contact identity % — update the contact first',
      p_lead ->> 'email', v_contact_email;
  end if;

  -- Idempotency A: this exact reply was already promoted.
  select id into v_lead_id from public.leads where origin_reply_id = p_origin_reply_id;
  if v_lead_id is not null then
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end if;

  -- Idempotency B / (3): this contact already has a CRM lead. A later positive reply attaches to
  -- the existing lead — one contact never yields two leads.
  select id into v_lead_id
    from public.leads where source_sequencer_contact_id = p_sequencer_contact_id;
  if v_lead_id is not null then
    update public.replies set lead_id = v_lead_id where id = p_origin_reply_id and lead_id is null;
    perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end if;

  begin
    insert into public.leads (
      client_id, campaign_id, sequencer_id, external_id,
      source_sequencer_contact_id, origin_reply_id,
      qualification, source,
      email, first_name, last_name, job_title, company_name, linkedin_url, gender,
      phone_number, phone_source, industry, headcount_range, website, country
    ) values (
      v_client_id, p_campaign_id, v_sequencer_id, v_external_id,
      p_sequencer_contact_id, p_origin_reply_id,
      'preMQL', 'cold_email',
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
    perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');
    return jsonb_build_object('lead_id', v_lead_id, 'created', false);
  end;

  update public.replies set lead_id = v_lead_id where id = p_origin_reply_id;
  -- Spec §7: the OOO episode ends when the person answers positively — but its history stays.
  perform public.cancel_active_ooo_followup(p_sequencer_contact_id, 'positive_reply_received');

  return jsonb_build_object('lead_id', v_lead_id, 'created', true);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- Privileges: ingestion + state machine are service_role ONLY
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- These bypass RLS by construction (SECURITY DEFINER, owned by postgres). Granting them to
-- `authenticated` would hand every logged-in user a write path around every policy in this
-- database. The portal reaches follow-ups through the gateway under RLS instead.
do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.upsert_sequencer_contact(uuid, text, text, text, text, text, jsonb)',
    'public.upsert_reply(text, timestamptz, uuid, uuid, text, text, text, boolean, text, smallint)',
    'public.record_ooo_followup(uuid, uuid, date, date, text)',
    'public.claim_ooo_followup(uuid)',
    'public.mark_ooo_submitted(uuid)',
    'public.mark_ooo_confirmed(uuid)',
    'public.mark_ooo_failed(uuid, text, timestamptz)',
    'public.skip_ooo_followup(uuid, text)',
    'public.cancel_ooo_followup(uuid, text)',
    'public.cancel_active_ooo_followup(uuid, text)',
    'public.retry_ooo_followup(uuid)',
    'public.reopen_ooo_followup(uuid)',
    'public.promote_contact_to_lead(uuid, uuid, uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end $$;

commit;
