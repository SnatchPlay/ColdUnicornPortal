-- Backfill of the OOO model from the legacy `leads` columns (ADR-0015).
--
-- DELETES NOTHING. The legacy columns keep their values; the destructive companion is
-- 20260722z_drop_legacy_ooo_columns.sql, applied only after the n8n cutover.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- TWO ITEMS NEED A HUMAN DECISION BEFORE THIS RUNS AGAINST PRODUCTION
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- (A) PLACEHOLDER client_sequencers. `sequencer_contacts` is keyed on client_sequencer_id, so every
--     (client_id, sequencer_id) pair that appears in `leads` needs a parent row. Where none exists
--     this migration creates one with no api_key, no external_workspace_id, `enabled = false` and
--     settings.backfill_placeholder = true. Such a row is a TECHNICAL PARENT — it does NOT
--     represent a confirmed external workspace, and n8n must not treat it as configured (hence
--     enabled = false; n8n filters on `cs.enabled`).
--     Run this BEFORE the migration and resolve each category (0 / 1 / many):
--
--       select l.client_id, l.sequencer_id, count(*) as leads_count,
--              count(distinct cs.id) as matching_client_sequencers
--       from public.leads l
--       left join public.client_sequencers cs
--         on cs.client_id = l.client_id and cs.sequencer_id = l.sequencer_id
--       where l.external_id is not null
--       group by l.client_id, l.sequencer_id
--       having count(distinct cs.id) <> 1;
--
-- (B) DUPLICATE (client_sequencer, external_id) LEADS. One external contact may map to several
--     legacy leads. `uq_leads_source_sequencer_contact` forbids that, so this migration links the
--     OLDEST lead per contact and leaves the rest with source_sequencer_contact_id = NULL, then
--     creates the index. The leftovers are reported by the NOTICE at the end and by:
--
--       select cs.id as client_sequencer_id, l.external_id, count(*)
--       from public.leads l
--       join public.client_sequencers cs
--         on cs.client_id = l.client_id and cs.sequencer_id = l.sequencer_id
--       where l.external_id is not null
--       group by 1, 2 having count(*) > 1;
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- BACKFILL RULES FOR ooo_followups (derived facts only — nothing is invented)
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--   added_to_ooo_campaign = true            → submitted, submitted_at = leads.updated_at
--   expected_return_date >= today, routed   → pending
--   expected_return_date >= today, no route → skipped + routing_missing / automation_disabled
--   otherwise (past date, or never known)   → cancelled + superseded
--
--   expected_return_date is carried over VERBATIM — NULL stays NULL (spec §3/AC-8).
--   scheduled_for = coalesce(expected_return_date, updated_at::date) + 2, date_source = 'fallback'.
--   source_reply_id stays NULL: legacy rows carry no reliable link to the reply that caused the OOO.
--   target_campaign_id is set only for rows that are still actionable (pending). A historical
--   episode's real campaign is unknowable, and guessing it would corrupt the routing snapshot.

begin;

-- --- 1. Parent rows for the scoped identity (see decision A above) -----------------------------
insert into public.client_sequencers (client_id, sequencer_id, enabled, settings)
select distinct l.client_id, l.sequencer_id, false, '{"backfill_placeholder": true}'::jsonb
from public.leads l
where l.external_id is not null
  and l.external_id <> ''
  and not exists (
    select 1 from public.client_sequencers cs
     where cs.client_id = l.client_id and cs.sequencer_id = l.sequencer_id
  )
on conflict (client_id, sequencer_id) do nothing;

-- --- 2. sequencer_contacts from leads ----------------------------------------------------------
insert into public.sequencer_contacts (
  client_sequencer_id, external_contact_id, email, first_name, last_name,
  routing_key, first_seen_at, last_seen_at
)
select distinct on (cs.id, l.external_id)
  cs.id,
  l.external_id,
  l.email,
  l.first_name,
  l.last_name,
  coalesce(l.gender::text, 'general'),   -- NULL gender becomes an EXPLICIT 'general' (spec §11)
  l.created_at,
  l.updated_at
from public.leads l
join public.client_sequencers cs
  on cs.client_id = l.client_id and cs.sequencer_id = l.sequencer_id
where l.external_id is not null and l.external_id <> ''
order by cs.id, l.external_id, l.created_at
on conflict (client_sequencer_id, external_contact_id) do nothing;

-- --- 3. leads → contact provenance (oldest lead wins; see decision B above) --------------------
with ranked as (
  select l.id,
         sc.id as contact_id,
         row_number() over (partition by sc.id order by l.created_at, l.id) as rn
  from public.leads l
  join public.client_sequencers cs
    on cs.client_id = l.client_id and cs.sequencer_id = l.sequencer_id
  join public.sequencer_contacts sc
    on sc.client_sequencer_id = cs.id and sc.external_contact_id = l.external_id
  where l.external_id is not null and l.external_id <> ''
)
update public.leads l
   set source_sequencer_contact_id = ranked.contact_id
  from ranked
 where l.id = ranked.id and ranked.rn = 1;

-- Created only now: on a database with duplicate (client_sequencer, external_id) leads, creating it
-- in 20260722_ooo_model_tables.sql would have made step 3 impossible to run.
create unique index if not exists uq_leads_source_sequencer_contact
  on public.leads (source_sequencer_contact_id)
  where source_sequencer_contact_id is not null;

-- --- 4. replies → contact (through the lead that was linked in step 3) -------------------------
update public.replies r
   set sequencer_contact_id = l.source_sequencer_contact_id
  from public.leads l
 where r.lead_id = l.id
   and r.sequencer_contact_id is null
   and l.source_sequencer_contact_id is not null;

-- --- 5. ooo_followups from the legacy OOO signal -----------------------------------------------
with source as (
  select
    l.source_sequencer_contact_id                       as contact_id,
    l.expected_return_date,
    l.added_to_ooo_campaign,
    l.updated_at,
    sc.routing_key,
    c.auto_ooo_enabled,
    public.resolve_ooo_routing(c.id, sc.routing_key)    as resolved_campaign_id
  from public.leads l
  join public.sequencer_contacts sc on sc.id = l.source_sequencer_contact_id
  join public.client_sequencers cs  on cs.id = sc.client_sequencer_id
  join public.clients c             on c.id  = cs.client_id
  where l.source_sequencer_contact_id is not null
    and (
      l.qualification::text     = 'OOO'
      or l.contact_disposition  = 'out_of_office'
      or l.added_to_ooo_campaign
      or l.expected_return_date is not null
    )
),
classified as (
  select
    s.*,
    case
      when s.added_to_ooo_campaign                                    then 'submitted'
      when s.expected_return_date < current_date
        or s.expected_return_date is null                             then 'cancelled'
      when not s.auto_ooo_enabled                                     then 'skipped'
      when s.resolved_campaign_id is null                             then 'skipped'
      else 'pending'
    end as status
  from source s
)
insert into public.ooo_followups (
  sequencer_contact_id, expected_return_date, scheduled_for, date_source, status,
  routing_key, target_campaign_id, routing_source,
  submitted_at, cancelled_at, cancellation_reason, skip_reason
)
select
  c.contact_id,
  c.expected_return_date,
  coalesce(c.expected_return_date, c.updated_at::date) + 2,
  'fallback',
  c.status::public.ooo_followup_status,
  c.routing_key,
  case when c.status = 'pending' then c.resolved_campaign_id else null end,
  'automatic',
  case when c.status = 'submitted' then c.updated_at end,
  case when c.status = 'cancelled' then c.updated_at end,
  case when c.status = 'cancelled' then 'superseded' end,
  case
    when c.status <> 'skipped'      then null
    when not c.auto_ooo_enabled     then 'automation_disabled'
    else 'routing_missing'
  end
from classified c
on conflict do nothing;

-- --- 6. Report what needs a human ---------------------------------------------------------------
do $$
declare
  v_placeholders integer;
  v_unlinked     integer;
  v_contacts     integer;
  v_followups    integer;
begin
  select count(*) into v_placeholders
    from public.client_sequencers
   where settings ->> 'backfill_placeholder' = 'true';

  select count(*) into v_unlinked
    from public.leads l
   where l.external_id is not null and l.external_id <> ''
     and l.source_sequencer_contact_id is null;

  select count(*) into v_contacts  from public.sequencer_contacts;
  select count(*) into v_followups from public.ooo_followups;

  raise notice 'OOO backfill: % sequencer_contacts, % ooo_followups.', v_contacts, v_followups;
  raise notice 'OOO backfill: % placeholder client_sequencers created (decision A — enabled=false, need a real workspace mapping).', v_placeholders;
  raise notice 'OOO backfill: % leads left unlinked because another lead already owns their contact (decision B).', v_unlinked;
end $$;

commit;
