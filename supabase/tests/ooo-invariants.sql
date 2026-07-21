-- OOO model invariant + state-machine + RLS tests (ADR-0015).
-- Runs entirely inside one transaction and ROLLS BACK — the local dump is left untouched.
-- Every check is a plpgsql ASSERT, so the first violated invariant aborts with its own message.

\set ON_ERROR_STOP on
begin;

-- ── Fixture ────────────────────────────────────────────────────────────────────────────────────
-- Fixed UUIDs so failures are greppable. 'ff…' prefix keeps them clear of real data.
insert into public.users (id, email, first_name, last_name, role) values
  ('ffffffff-0000-4000-a000-00000000000a', 'mgr-a@test.local', 'Mgr', 'A', 'manager'),
  ('ffffffff-0000-4000-a000-00000000000b', 'mgr-b@test.local', 'Mgr', 'B', 'manager'),
  ('ffffffff-0000-4000-a000-00000000000c', 'cli-a@test.local', 'Cli', 'A', 'client');

insert into public.clients (id, name, status, manager_id, auto_ooo_enabled) values
  ('ffffffff-0000-4000-a000-0000000000a1', 'ZZ Test Client A', 'Active', 'ffffffff-0000-4000-a000-00000000000a', true),
  ('ffffffff-0000-4000-a000-0000000000b1', 'ZZ Test Client B', 'Active', 'ffffffff-0000-4000-a000-00000000000b', true),
  ('ffffffff-0000-4000-a000-0000000000c1', 'ZZ Test Client C', 'Active', 'ffffffff-0000-4000-a000-00000000000a', false);

insert into public.client_users (client_id, user_id)
  values ('ffffffff-0000-4000-a000-0000000000a1', 'ffffffff-0000-4000-a000-00000000000c');

insert into public.client_sequencers (id, client_id, sequencer_id) values
  ('ffffffff-0000-4000-a000-0000000000a2', 'ffffffff-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-000000000002'),
  ('ffffffff-0000-4000-a000-0000000000b2', 'ffffffff-0000-4000-a000-0000000000b1', '00000000-0000-4000-a000-000000000002'),
  ('ffffffff-0000-4000-a000-0000000000c2', 'ffffffff-0000-4000-a000-0000000000c1', '00000000-0000-4000-a000-000000000002');

insert into public.campaigns (id, client_id, external_id, type, name, status) values
  ('ffffffff-0000-4000-a000-0000000000a3', 'ffffffff-0000-4000-a000-0000000000a1', 'zz-ext-a3', 'ooo_followup', 'ZZ OOO male',    'active'),
  ('ffffffff-0000-4000-a000-0000000000a4', 'ffffffff-0000-4000-a000-0000000000a1', 'zz-ext-a4', 'ooo_followup', 'ZZ OOO general', 'active'),
  ('ffffffff-0000-4000-a000-0000000000b3', 'ffffffff-0000-4000-a000-0000000000b1', 'zz-ext-b3', 'outreach',     'ZZ B outreach',  'active');

-- Client A routes male; client B has NO routing; client C has routing but automation off.
insert into public.client_ooo_routing (client_id, routing_key, campaign_id, is_active) values
  ('ffffffff-0000-4000-a000-0000000000a1', 'male',    'ffffffff-0000-4000-a000-0000000000a3', true),
  ('ffffffff-0000-4000-a000-0000000000c1', 'general', 'ffffffff-0000-4000-a000-0000000000a4', true);

-- ── 1. Ingestion idempotency + routing resolution ──────────────────────────────────────────────
do $$
declare
  v_c1 uuid; v_c1b uuid; v_cB uuid; v_cC uuid;
  v_r1 uuid; v_r1b uuid;
  v_f  public.ooo_followups;
  v_f2 public.ooo_followups;
  v_n  integer;
begin
  -- AC-5/AC-10: repeated contact upsert on the scoped identity returns the same row.
  v_c1  := public.upsert_sequencer_contact('ffffffff-0000-4000-a000-0000000000a2', 'ext-1', 'p1@test.local', 'P', 'One', 'male', '{}'::jsonb);
  v_c1b := public.upsert_sequencer_contact('ffffffff-0000-4000-a000-0000000000a2', 'ext-1', null, null, null, null, null);
  assert v_c1 = v_c1b, 'T1.1 duplicate sequencer contact created';
  -- NULLs must not erase known values.
  assert (select email from public.sequencer_contacts where id = v_c1) = 'p1@test.local', 'T1.2 null argument erased email';

  -- AC-4: a reply exists without any CRM lead, and is idempotent on external_id.
  v_r1  := public.upsert_reply('rep-1', now(), v_c1, null, 'OOO', 'Away', 'I am out until Friday', true);
  v_r1b := public.upsert_reply('rep-1', now(), v_c1, null, 'OOO', 'Away', 'I am out until Friday', true);
  assert v_r1 = v_r1b, 'T1.3 duplicate reply created';
  assert (select lead_id from public.replies where id = v_r1) is null, 'T1.4 reply must not require a lead';
  -- client_id is derived, never supplied.
  assert (select client_id from public.replies where id = v_r1) = 'ffffffff-0000-4000-a000-0000000000a1', 'T1.5 reply client_id not derived from contact';

  -- Routing: specific key wins; unknown key falls back to general; no config → NULL (never 'general').
  assert public.resolve_ooo_routing('ffffffff-0000-4000-a000-0000000000a1', 'male')    = 'ffffffff-0000-4000-a000-0000000000a3', 'T1.6 specific routing not resolved';
  assert public.resolve_ooo_routing('ffffffff-0000-4000-a000-0000000000a1', 'female')  is null, 'T1.7 missing routing must be NULL, not an implicit general';
  assert public.resolve_ooo_routing('ffffffff-0000-4000-a000-0000000000b1', 'male')    is null, 'T1.8 client without routing must resolve NULL';

  -- ── 2. record_ooo_followup ───────────────────────────────────────────────────────────────────
  -- AC-7/AC-8: the two dates are independent; an undetermined return date stays NULL.
  v_f := public.record_ooo_followup(v_c1, v_r1, null, null, 'fallback');
  assert v_f.expected_return_date is null, 'T2.1 fallback wrote a fake expected_return_date';
  assert v_f.scheduled_for = current_date + 2, 'T2.2 fallback scheduled_for wrong';
  assert v_f.status = 'pending', 'T2.3 routed follow-up should be pending';
  assert v_f.target_campaign_id = 'ffffffff-0000-4000-a000-0000000000a3', 'T2.4 routing snapshot missing';

  -- AC-10: the SAME reply redelivered does not open a second episode.
  v_f2 := public.record_ooo_followup(v_c1, v_r1, '2026-08-01', null, 'reply_parsed');
  assert v_f2.id = v_f.id, 'T2.5 redelivered reply created a second follow-up';
  select count(*) into v_n from public.ooo_followups where sequencer_contact_id = v_c1;
  assert v_n = 1, format('T2.6 expected 1 follow-up, found %s', v_n);

  -- §4: a NEW reply while one is active updates the dates in place — still exactly one active.
  v_r1b := public.upsert_reply('rep-2', now(), v_c1, null, 'OOO', 'Away again', 'Back on the 25th', true);
  v_f2  := public.record_ooo_followup(v_c1, v_r1b, '2026-07-25', '2026-07-27', 'reply_parsed');
  assert v_f2.id = v_f.id, 'T2.7 second OOO reply opened a parallel active follow-up';
  assert v_f2.expected_return_date = '2026-07-25', 'T2.8 expected_return_date not refreshed';
  assert v_f2.scheduled_for = '2026-07-27', 'T2.9 scheduled_for not refreshed';
  assert v_f2.source_reply_id = v_r1b, 'T2.10 source_reply_id not re-pointed';

  -- A later dateless reply must NOT erase what an earlier reply determined, nor pull the schedule
  -- forward to the fallback — that would re-enrol the contact while they are still away.
  v_r1b := public.upsert_reply('rep-2b', now(), v_c1, null, 'OOO', 'Auto', 'Out of office', true);
  v_f2  := public.record_ooo_followup(v_c1, v_r1b, null, null, 'fallback');
  assert v_f2.expected_return_date = '2026-07-25', 'T2.10b a dateless reply erased a known return date';
  assert v_f2.scheduled_for = '2026-07-27', 'T2.10c a dateless reply reset the schedule to the fallback';
  assert v_f2.date_source = 'reply_parsed', 'T2.10d a dateless reply downgraded date_source';

  -- Spec §3 guard: a parsed date source cannot be claimed without a date.
  begin
    perform public.record_ooo_followup(v_c1, null, null, null, 'reply_parsed');
    assert false, 'T2.11 reply_parsed without a date must be rejected';
  exception when others then null;
  end;

  -- AC-9: the active unique index is real, not just enforced in application code.
  begin
    insert into public.ooo_followups (sequencer_contact_id, scheduled_for, date_source, routing_key)
    values (v_c1, current_date, 'fallback', 'male');
    assert false, 'T2.12 a second ACTIVE follow-up was allowed';
  exception when unique_violation then null;
  end;

  -- AC-18: missing configuration is visible, not silent.
  v_cB := public.upsert_sequencer_contact('ffffffff-0000-4000-a000-0000000000b2', 'ext-b1', 'pb@test.local', 'P', 'B', 'male', null);
  v_f2 := public.record_ooo_followup(v_cB, null, null, null, 'fallback');
  assert v_f2.status = 'skipped' and v_f2.skip_reason = 'routing_missing', 'T2.13 missing routing must skip with routing_missing';

  v_cC := public.upsert_sequencer_contact('ffffffff-0000-4000-a000-0000000000c2', 'ext-c1', 'pc@test.local', 'P', 'C', 'general', null);
  v_f2 := public.record_ooo_followup(v_cC, null, null, null, 'fallback');
  assert v_f2.status = 'skipped' and v_f2.skip_reason = 'automation_disabled', 'T2.14 auto_ooo_enabled=false must skip with automation_disabled';

  -- §10 REGRESSION: adding the GENERAL fallback must revive episodes parked under a SPECIFIC key.
  -- Client B has no routing at all, so its male contact sits at skipped/routing_missing. Adding a
  -- `general` rule is the most natural single fix, and recovery must not be filtered to
  -- routing_key = 'general' — that would leave exactly the male/female episodes stuck while
  -- reporting 0 recovered.
  insert into public.client_ooo_routing (client_id, routing_key, campaign_id, is_active)
  values ('ffffffff-0000-4000-a000-0000000000b1', 'general',
          'ffffffff-0000-4000-a000-0000000000b3', true);
  assert (select routing_key from public.ooo_followups where sequencer_contact_id = v_cB) = 'male',
         'T2.14a fixture lost the male routing key';
  v_n := public.recover_skipped_ooo_followups('ffffffff-0000-4000-a000-0000000000b1');
  assert v_n = 1, format('T2.14b general fallback recovered %s male episodes, expected 1', v_n);
  select * into v_f2 from public.ooo_followups where sequencer_contact_id = v_cB;
  assert v_f2.status = 'pending' and v_f2.skip_reason is null,
         'T2.14c male episode not revived by the general fallback';
  assert v_f2.target_campaign_id = 'ffffffff-0000-4000-a000-0000000000b3',
         'T2.14d revived episode did not resolve through the general rule';

  -- §10: fixing the configuration brings the skipped episode back automatically.
  update public.clients set auto_ooo_enabled = true where id = 'ffffffff-0000-4000-a000-0000000000c1';
  v_n := public.recover_skipped_ooo_followups('ffffffff-0000-4000-a000-0000000000c1');
  assert v_n = 1, format('T2.15 expected 1 recovered follow-up, got %s', v_n);
  select * into v_f2 from public.ooo_followups where sequencer_contact_id = v_cC;
  assert v_f2.status = 'pending' and v_f2.skip_reason is null, 'T2.16 recovered row not pending';
  assert v_f2.target_campaign_id = 'ffffffff-0000-4000-a000-0000000000a4', 'T2.17 recovery did not resolve the campaign';
end $$;

-- ── 3. State machine ───────────────────────────────────────────────────────────────────────────
do $$
declare
  v_c uuid; v_f public.ooo_followups; v_id uuid; v_before integer; v_after integer;
begin
  select id into v_c from public.sequencer_contacts where external_contact_id = 'ext-1';
  select id into v_id from public.ooo_followups where sequencer_contact_id = v_c;

  -- Illegal jumps must not silently rewrite the status.
  begin perform public.mark_ooo_confirmed(v_id); assert false, 'T3.1 pending → confirmed was allowed';
  exception when others then null; end;
  begin perform public.mark_ooo_submitted(v_id); assert false, 'T3.2 pending → submitted was allowed';
  exception when others then null; end;

  -- claim increments the attempt counter exactly once.
  v_f := public.claim_ooo_followup(v_id);
  assert v_f.status = 'processing' and v_f.attempt_count = 1, 'T3.3 claim did not move to processing/attempt 1';
  -- A second claim finds nothing: contention returns NULL rather than raising.
  assert public.claim_ooo_followup(v_id) is null, 'T3.4 a claimed row was claimable again';

  -- failure keeps the attempt count (it was already counted by claim), then retry re-queues it.
  v_f := public.mark_ooo_failed(v_id, 'HTTP 500', now() + interval '1 hour');
  assert v_f.status = 'failed' and v_f.attempt_count = 1, 'T3.5 failure re-counted the attempt';
  v_f := public.retry_ooo_followup(v_id);
  assert v_f.status = 'pending' and v_f.attempt_count = 1 and v_f.last_error is null, 'T3.6 retry reset the historical attempt count';

  -- Happy path through to confirmed.
  v_f := public.claim_ooo_followup(v_id);
  assert v_f.attempt_count = 2, 'T3.7 second claim did not increment';
  v_f := public.mark_ooo_submitted(v_id);
  assert v_f.status = 'submitted' and v_f.submitted_at is not null, 'T3.8 submit failed';
  begin perform public.claim_ooo_followup(v_id);
    assert public.claim_ooo_followup(v_id) is null, 'T3.9 submitted row was claimable';
  end;
  v_f := public.mark_ooo_confirmed(v_id);
  assert v_f.status = 'confirmed' and v_f.confirmed_at is not null, 'T3.10 confirm failed';
  begin perform public.mark_ooo_submitted(v_id); assert false, 'T3.11 confirmed → submitted was allowed';
  exception when others then null; end;

  -- §7/§17: a SUBMITTED episode is closed, so a new OOO reply may open the next one.
  perform public.upsert_reply('rep-3', now(), v_c, null, 'OOO', 'Away #2', 'Out again', true);
  v_f := public.record_ooo_followup(v_c, (select id from public.replies where external_id = 'rep-3'),
                                    '2026-09-01', null, 'reply_parsed');
  assert v_f.id <> v_id, 'T3.12 a new OOO reply after submitted did not open a new episode';
  assert v_f.status = 'pending', 'T3.13 new episode should be pending';

  -- AC-11: cancel keeps the row.
  select count(*) into v_before from public.ooo_followups;
  v_f := public.cancel_ooo_followup(v_f.id, 'manual_cancel');
  select count(*) into v_after from public.ooo_followups;
  assert v_f.status = 'cancelled' and v_f.cancelled_at is not null, 'T3.14 cancel did not stamp the row';
  assert v_before = v_after, 'T3.15 cancel deleted history';
  -- Repeated cancel is idempotent (webhooks retry).
  assert (public.cancel_ooo_followup(v_f.id, 'manual_cancel')).status = 'cancelled', 'T3.16 repeat cancel raised';

  -- reopen restores it and re-resolves routing.
  v_f := public.reopen_ooo_followup(v_f.id);
  assert v_f.status = 'pending' and v_f.target_campaign_id = 'ffffffff-0000-4000-a000-0000000000a3', 'T3.17 reopen did not re-resolve routing';
  -- ...but never alongside another active episode.
  begin
    perform public.reopen_ooo_followup(v_id);  -- v_id is confirmed; contact already has an active one
    assert false, 'T3.18 reopen created a second active follow-up';
  exception when others then null; end;
end $$;

-- ── 4. promote_contact_to_lead ─────────────────────────────────────────────────────────────────
do $$
declare
  v_c uuid; v_cB uuid; v_pos uuid; v_pos2 uuid; v_ooo uuid; v_res jsonb; v_lead uuid; v_n integer;
begin
  select id into v_c  from public.sequencer_contacts where external_contact_id = 'ext-1';
  select id into v_cB from public.sequencer_contacts where external_contact_id = 'ext-b1';
  select id into v_ooo from public.replies where external_id = 'rep-1';

  v_pos := public.upsert_reply('rep-pos-1', now(), v_c, null, 'Interested', 'Yes', 'Sounds good', false);

  -- Whitelist: an unknown field is a hard error, not a silently dropped key.
  begin
    perform public.promote_contact_to_lead(v_c, v_pos, null, '{"email":"p1@test.local","won":true}'::jsonb);
    assert false, 'T4.1 unknown lead field accepted';
  exception when others then null; end;
  begin
    perform public.promote_contact_to_lead(v_c, v_pos, null, '{"client_id":"ffffffff-0000-4000-a000-0000000000b1"}'::jsonb);
    assert false, 'T4.2 caller-supplied client_id accepted';
  exception when others then null; end;

  -- A non-positive reply never creates a CRM lead (spec §1, AC-1/AC-2/AC-3).
  begin
    perform public.promote_contact_to_lead(v_c, v_ooo, null, '{}'::jsonb);
    assert false, 'T4.3 an OOO reply created a CRM lead';
  exception when others then null; end;

  -- A reply belonging to another contact is rejected.
  begin
    perform public.promote_contact_to_lead(v_cB, v_pos, null, '{}'::jsonb);
    assert false, 'T4.4 a foreign reply was accepted';
  exception when others then null; end;

  -- A campaign from another client is rejected.
  begin
    perform public.promote_contact_to_lead(v_c, v_pos, 'ffffffff-0000-4000-a000-0000000000b3', '{}'::jsonb);
    assert false, 'T4.5 a cross-client campaign was accepted';
  exception when others then null; end;

  -- Happy path.
  v_res := public.promote_contact_to_lead(v_c, v_pos, 'ffffffff-0000-4000-a000-0000000000a3',
             '{"first_name":"P","last_name":"One","job_title":"Head of Ops","gender":"male"}'::jsonb);
  assert (v_res ->> 'created')::boolean, 'T4.6 first promotion should report created=true';
  v_lead := (v_res ->> 'lead_id')::uuid;
  assert (select qualification::text from public.leads where id = v_lead) = 'preMQL', 'T4.7 lead did not start at preMQL';
  assert (select client_id from public.leads where id = v_lead) = 'ffffffff-0000-4000-a000-0000000000a1', 'T4.8 lead client not derived';
  assert (select lead_id from public.replies where id = v_pos) = v_lead, 'T4.9 positive reply not linked to the lead';
  -- AC-12: promotion closes the OOO episode but keeps its history.
  assert not exists (select 1 from public.ooo_followups
                      where sequencer_contact_id = v_c and status in ('pending','processing','failed')),
         'T4.10 an active follow-up survived promotion';
  assert exists (select 1 from public.ooo_followups
                  where sequencer_contact_id = v_c and cancellation_reason = 'positive_reply_received'),
         'T4.11 cancellation reason not recorded';

  -- AC-10: the same webhook redelivered returns the existing lead instead of raising.
  v_res := public.promote_contact_to_lead(v_c, v_pos, null, '{}'::jsonb);
  assert not (v_res ->> 'created')::boolean and (v_res ->> 'lead_id')::uuid = v_lead, 'T4.12 redelivery created a second lead';

  -- One contact → one lead: a LATER positive reply attaches to the existing lead.
  v_pos2 := public.upsert_reply('rep-pos-2', now() + interval '1 day', v_c, null, 'Interested', 'Still yes', 'Following up', false);
  v_res  := public.promote_contact_to_lead(v_c, v_pos2, null, '{}'::jsonb);
  assert not (v_res ->> 'created')::boolean and (v_res ->> 'lead_id')::uuid = v_lead, 'T4.13 a second positive reply created a second lead';
  assert (select lead_id from public.replies where id = v_pos2) = v_lead, 'T4.14 later reply not attached to the existing lead';

  select count(*) into v_n from public.leads where source_sequencer_contact_id = v_c;
  assert v_n = 1, format('T4.15 expected exactly 1 lead for the contact, found %s', v_n);
end $$;

\echo '--- RPC + invariant suite passed ---'

-- ── 5. RLS: the gateway runs as `authenticated`, so policies are the real boundary ─────────────
-- Emulates executeAsCaller: JWT claims + SET LOCAL ROLE inside the transaction.

select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-4000-a000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_a integer; v_b integer;
begin
  select count(*) into v_a from public.ooo_followups f
    join public.sequencer_contacts sc on sc.id = f.sequencer_contact_id
   where sc.client_sequencer_id = 'ffffffff-0000-4000-a000-0000000000a2';
  select count(*) into v_b from public.ooo_followups f
    join public.sequencer_contacts sc on sc.id = f.sequencer_contact_id
   where sc.client_sequencer_id = 'ffffffff-0000-4000-a000-0000000000b2';
  assert v_a > 0, 'T5.1 manager A cannot see their own client follow-ups';
  assert v_b = 0, format('T5.2 manager A saw %s follow-ups of client B', v_b);

  -- A mutation aimed at a guessed UUID from another client must affect zero rows.
  update public.ooo_followups set scheduled_for = current_date
   where sequencer_contact_id in (select id from public.sequencer_contacts
                                   where client_sequencer_id = 'ffffffff-0000-4000-a000-0000000000b2');
  get diagnostics v_b = row_count;
  assert v_b = 0, 'T5.3 manager A updated another client''s follow-up';

  -- Ingestion RPCs must be unreachable from a portal session.
  begin
    perform public.record_ooo_followup(
      (select id from public.sequencer_contacts where external_contact_id = 'ext-1'), null, null, null, 'fallback');
    assert false, 'T5.4 authenticated could call an ingestion RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.promote_contact_to_lead(
      (select id from public.sequencer_contacts where external_contact_id = 'ext-1'), null, null, '{}'::jsonb);
    assert false, 'T5.5 authenticated could promote a contact to a lead';
  exception when insufficient_privilege then null;
  end;

  -- The whole episode lifecycle stays closed to the portal: OOO is driven end-to-end by n8n, and
  -- no portal action reads or mutates a follow-up (product decision — there is no operational UI).
  begin
    perform public.cancel_ooo_followup((select id from public.ooo_followups limit 1), 'manual_cancel');
    assert false, 'T5.6 authenticated could call a state-machine function';
  exception when insufficient_privilege then null;
  end;

  -- But the routing editor's recovery path DOES run as authenticated, so the UPDATE policy on
  -- ooo_followups has to keep working for rows the caller can manage.
  declare v_recovered integer;
  begin
    select public.recover_skipped_ooo_followups('ffffffff-0000-4000-a000-0000000000a1'::uuid)
      into v_recovered;
    assert v_recovered >= 0, 'T5.7 recover_skipped_ooo_followups is unreachable as authenticated';
  end;
end $$;
reset role;

select set_config('request.jwt.claims', '{"sub":"ffffffff-0000-4000-a000-00000000000c","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_n integer;
begin
  -- The client role has no business seeing contacts that are not CRM leads (spec §17).
  select count(*) into v_n from public.sequencer_contacts;
  assert v_n = 0, format('T5.8 the client role saw %s sequencer contacts', v_n);
  select count(*) into v_n from public.ooo_followups;
  assert v_n = 0, format('T5.9 the client role saw %s follow-ups', v_n);
end $$;
reset role;

\echo '--- RLS suite passed ---'

-- ── 6. Backfill rules against synthetic legacy leads ──────────────────────────────────────────
-- The production dump carries no legacy OOO signal at all (0 rows), so the backfill classification
-- is exercised here instead of being taken on trust.
do $$
declare
  v_cs uuid := 'ffffffff-0000-4000-a000-0000000000a2';
  v_contact uuid;
  v_f public.ooo_followups;
begin
  -- Past return date → cancelled/superseded.
  insert into public.leads (client_id, sequencer_id, external_id, email, expected_return_date, gender)
  values ('ffffffff-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-000000000002', 'legacy-past',
          'past@test.local', current_date - 10, 'male');
  -- Future return date + routing → pending.
  insert into public.leads (client_id, sequencer_id, external_id, email, expected_return_date, gender)
  values ('ffffffff-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-000000000002', 'legacy-future',
          'future@test.local', current_date + 10, 'male');
  -- Already enrolled → submitted.
  insert into public.leads (client_id, sequencer_id, external_id, email, added_to_ooo_campaign, gender)
  values ('ffffffff-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-000000000002', 'legacy-sent',
          'sent@test.local', true, 'male');

  -- Replay the backfill steps for these three rows only.
  insert into public.sequencer_contacts (client_sequencer_id, external_contact_id, email, routing_key, first_seen_at, last_seen_at)
  select v_cs, l.external_id, l.email, coalesce(l.gender::text, 'general'), l.created_at, l.updated_at
    from public.leads l where l.external_id like 'legacy-%'
  on conflict do nothing;

  update public.leads l set source_sequencer_contact_id = sc.id
    from public.sequencer_contacts sc
   where sc.client_sequencer_id = v_cs and sc.external_contact_id = l.external_id
     and l.external_id like 'legacy-%';

  insert into public.ooo_followups (
    sequencer_contact_id, expected_return_date, scheduled_for, date_source, status,
    routing_key, target_campaign_id, routing_source, submitted_at, cancelled_at, cancellation_reason, skip_reason)
  select c.contact_id, c.expected_return_date,
         coalesce(c.expected_return_date, c.updated_at::date) + 2, 'fallback',
         c.status::public.ooo_followup_status, c.routing_key,
         case when c.status = 'pending' then c.resolved else null end, 'automatic',
         case when c.status = 'submitted' then c.updated_at end,
         case when c.status = 'cancelled' then c.updated_at end,
         case when c.status = 'cancelled' then 'superseded' end,
         case when c.status <> 'skipped' then null
              when not c.auto_ooo_enabled then 'automation_disabled' else 'routing_missing' end
  from (
    select l.source_sequencer_contact_id as contact_id, l.expected_return_date, l.updated_at,
           sc.routing_key, cl.auto_ooo_enabled,
           public.resolve_ooo_routing(cl.id, sc.routing_key) as resolved,
           case when l.added_to_ooo_campaign then 'submitted'
                when l.expected_return_date < current_date or l.expected_return_date is null then 'cancelled'
                when not cl.auto_ooo_enabled then 'skipped'
                when public.resolve_ooo_routing(cl.id, sc.routing_key) is null then 'skipped'
                else 'pending' end as status
      from public.leads l
      join public.sequencer_contacts sc on sc.id = l.source_sequencer_contact_id
      join public.client_sequencers cs  on cs.id = sc.client_sequencer_id
      join public.clients cl            on cl.id = cs.client_id
     where l.external_id like 'legacy-%'
  ) c;

  select f.* into v_f from public.ooo_followups f join public.sequencer_contacts sc on sc.id = f.sequencer_contact_id
   where sc.external_contact_id = 'legacy-past';
  assert v_f.status = 'cancelled' and v_f.cancellation_reason = 'superseded', 'T6.1 expired legacy OOO should be cancelled/superseded';
  assert v_f.target_campaign_id is null, 'T6.2 a historical episode must not be given a guessed campaign';

  select f.* into v_f from public.ooo_followups f join public.sequencer_contacts sc on sc.id = f.sequencer_contact_id
   where sc.external_contact_id = 'legacy-future';
  assert v_f.status = 'pending' and v_f.expected_return_date = current_date + 10, 'T6.3 actionable legacy OOO should stay pending with its date';
  assert v_f.target_campaign_id = 'ffffffff-0000-4000-a000-0000000000a3', 'T6.4 pending backfill did not resolve routing';

  select f.* into v_f from public.ooo_followups f join public.sequencer_contacts sc on sc.id = f.sequencer_contact_id
   where sc.external_contact_id = 'legacy-sent';
  assert v_f.status = 'submitted' and v_f.submitted_at is not null, 'T6.5 added_to_ooo_campaign should map to submitted';
  assert v_f.expected_return_date is null, 'T6.6 backfill invented a return date';
end $$;

\echo '--- backfill suite passed ---'

rollback;
