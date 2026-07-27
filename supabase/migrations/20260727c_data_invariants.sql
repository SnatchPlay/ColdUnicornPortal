-- public.data_invariants() — the assertions that must hold, in the database that owns them.
--
-- WHY THIS EXISTS. On 2026-07-23 promote_contact_to_lead began raising on every insert. All five
-- branch-S Postgres nodes run `onError: continueRegularOutput`, which ADR-0017 requires so a
-- Supabase failure cannot stop the sheet or the CRM. n8n therefore reported success, and 50 CRM
-- leads were lost over four days. The instance-wide error handler
-- (automation/n8n/workflows/ops/automation-failure-recorder) could not help and never will:
-- an Error Trigger fires when an execution FAILS, and continueRegularOutput is precisely the
-- setting that stops it failing. A swallowed error is invisible to it by construction.
--
-- The answer is to assert the OUTCOME instead of the absence of an exception. "Every positive reply
-- has a lead" is true regardless of which of the sixty-six nodes broke, or whether the cause was a
-- bad cast, an expired credential, an unresolved campaign or an RLS change. It would have caught
-- this defect in two hours instead of four days, and it will catch the next one, which will have a
-- different cause.
--
-- WHY IN THE DATABASE. CLAUDE.md §5a.4: "Never move a database invariant into n8n." Here an
-- invariant is added by a reviewable migration that `pnpm db:migrate:local` exercises, not by
-- editing a workflow. The probe that reads this function stays trivial and cannot drift from it.
--
-- SCHEMA PLACEMENT: `public`, following 20260722e — `private` has no USAGE grant for
-- `authenticated`, so nothing a caller invokes directly may live there. SECURITY DEFINER +
-- service_role only: n8n reads it, and by the same product decision that keeps follow-ups out of
-- the portal, no portal surface calls it.
--
-- CONTRACT. One row per invariant, ALWAYS — a satisfied invariant returns violations = 0 rather
-- than no row. A caller must be able to tell "checked, clean" from "never ran", which is the same
-- distinction this whole function exists to restore.
--
--   name        stable identifier, safe to alert on
--   severity    'critical' — data is being lost right now
--               'warning'  — a pipeline is stalled or degraded
--   violations  how many rows break it
--   detail      a bounded sample for triage. IDs, names and timestamps only — never message
--               bodies, e-mail addresses or contact identity.

begin;

create or replace function public.data_invariants()
returns table (name text, severity text, violations bigint, detail jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  -- 1. A positive reply must become a CRM lead (ADR-0015 §5). The two-hour grace lets normal
  --    in-flight enrichment finish — branch S calls five vendors before it reaches the RPC.
  --    THE 2026-07-23 DEFECT. Was 50 for four days; anything above 0 for long is data loss.
  with orphaned as (
    select r.id, r.received_at, c.name as client
      from public.replies r
      join public.sequencer_contacts sc on sc.id = r.sequencer_contact_id
      join public.client_sequencers cs on cs.id = sc.client_sequencer_id
      join public.clients c on c.id = cs.client_id
     where r.classification = 'Interested'
       and r.lead_id is null
       and r.received_at < now() - interval '2 hours'
     order by r.received_at
     limit 20
  )
  select 'positive_reply_without_lead', 'critical',
         (select count(*) from public.replies r2
           where r2.classification = 'Interested' and r2.lead_id is null
             and r2.received_at < now() - interval '2 hours'),
         coalesce((select jsonb_agg(jsonb_build_object(
                    'reply_id', id, 'client', client, 'received_at', received_at))
                     from orphaned), '[]'::jsonb)

  union all

  -- 2. An active client with a live EmailBison sequencer must have yesterday's counters
  --    (process invariant 2, bison-ingestion). THE 2026-07-20 STALL: three ingestion workflows
  --    failed every run for days and daily_stats simply stopped, with no signal. Yesterday, not
  --    today, because the population run is scheduled and today's row legitimately lands late.
  select 'daily_stats_stale', 'warning',
         count(*),
         coalesce(jsonb_agg(jsonb_build_object('client', name) order by name), '[]'::jsonb)
    from (
      select c.name
        from public.clients c
        join public.client_sequencers cs on cs.client_id = c.id and cs.enabled
        join public.sequencers s on s.id = cs.sequencer_id and s.key = 'emailbison'
       where c.status = 'Active'
         and not exists (select 1 from public.daily_stats d
                          where d.client_id = c.id and d.report_date = current_date - 1)
       group by c.name
    ) stale

  union all

  -- 3. Branch S writes the contact before the reply; a reply with no contact means the chain broke
  --    one step earlier than the defect above, and `positive_reply_without_lead` cannot see it —
  --    its joins would drop the row. Without this, a failure at upsert_sequencer_contact looks
  --    exactly like silence.
  select 'reply_without_sequencer_contact', 'warning',
         count(*),
         coalesce(jsonb_agg(jsonb_build_object('reply_id', id, 'received_at', received_at)
                            order by received_at) filter (where rn <= 20), '[]'::jsonb)
    from (
      select r.id, r.received_at, row_number() over (order by r.received_at) as rn
        from public.replies r
       where r.sequencer_contact_id is null
         and r.received_at < now() - interval '2 hours'
    ) noc

  -- DELIBERATELY ABSENT: "an OOO episode past its scheduled_for is a stalled dispatcher".
  -- It was drafted, then measured against production before shipping: 105 violations, oldest three
  -- days overdue — on a healthy system. `ooo-enrol-followups` runs in shadow mode, "records intent,
  -- sends nothing" (reference/n8n/ooo-phase-a.md), so no episode has ever left `pending`; 146 of 243
  -- are past due by design. An invariant that fires on a correctly-working system is worse than no
  -- invariant: it teaches people to ignore the channel, which is the failure this whole function
  -- exists to prevent. Add it when phase A2 starts sending, and set the threshold from the send
  -- cadence then rather than guessing now.
$$;

comment on function public.data_invariants() is
  'Assertions that must hold across the ingestion and CRM pipelines. One row per invariant, always; '
  'violations = 0 means checked-and-clean. Read by the ops probe — see '
  'automation/n8n/workflows/ops/data-invariant-probe.';

revoke all on function public.data_invariants() from public, anon, authenticated;
grant execute on function public.data_invariants() to service_role;

commit;
