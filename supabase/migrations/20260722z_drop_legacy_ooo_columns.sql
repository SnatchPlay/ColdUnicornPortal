-- ⚠️ DESTRUCTIVE — DO NOT APPLY UNTIL THE n8n CUTOVER IS DONE ⚠️
--
-- Companion to 20260722_ooo_model_tables.sql / 20260722e_ooo_rpcs.sql / 20260722f_ooo_backfill.sql.
-- Same deferred pattern as 20260704b_drop_client_sequencer_credentials.sql: written together with
-- the additive work so the end state is reviewable, applied separately once nothing writes the old
-- shape any more.
--
-- PRECONDITIONS (verify each, in order, before running):
--   1. 20260722f_ooo_backfill.sql applied, and both of its manual decisions resolved.
--   2. n8n writes OOO/NRR through the RPCs in 20260722e and NO LONGER:
--        · sets leads.qualification = 'OOO' / 'NRR'
--        · writes leads.expected_return_date / leads.added_to_ooo_campaign
--        · writes leads.contact_disposition
--      Verify with:
--        select count(*) from public.leads
--         where qualification::text in ('OOO','NRR')
--            or contact_disposition is not null
--            or added_to_ooo_campaign
--            or expected_return_date is not null;
--      A non-zero count on rows CREATED AFTER the cutover means n8n is still on the old contract.
--   3. The portal + gateway READ-side removal is DEPLOYED. This was done together with moving this
--      file out of migrations/deferred/ (2026-07-22): `deriveContactDisposition`,
--      `mapLegacyQualificationToDisposition`, the `ContactDisposition` type, the CRM "Disposition"
--      column + `DISPOSITION_LABELS`, the three `LeadRecord` fields, every `toLeadRecord` /
--      `mapLeadInsert` / raw-SELECT reference in orm-gateway, the `replyScope` OOO/active filter
--      (contract + both leads pages), and `OOO`/`NRR` from the `lead_qualification` union + the
--      drizzle enum are all gone. Dropping the columns while the OLD gateway is still deployed leaves
--      the read model selecting columns that no longer exist, so the gateway MUST be redeployed
--      before this runs.
--
-- Deploy order overall: additive migrations → gateway + portal → n8n cutover → THIS FILE.
-- CRITICAL: redeploy the orm-gateway edge function (and ship the portal build) BEFORE applying this;
-- the live gateway still SELECTs the dropped columns until it is redeployed.
--
-- IRREVERSIBLE: the legacy values are dropped. Everything worth keeping was copied into
-- sequencer_contacts / ooo_followups by the backfill; leads that were OOO/NRR keep their row but
-- lose the disposition marker (which, per ADR-0013, was never reconstructible into a funnel stage
-- anyway).

begin;

-- --- 1. leads: the OOO state that no longer belongs on a CRM lead (spec §18) -------------------
alter table public.leads
  drop column if exists expected_return_date,
  drop column if exists added_to_ooo_campaign,
  drop column if exists contact_disposition;

-- --- 2. client_ooo_routing: gender is superseded by the explicit routing_key -------------------
alter table public.client_ooo_routing
  drop column if exists gender;

-- --- 3. lead_qualification without OOO / NRR --------------------------------------------------
-- Postgres cannot remove a value from an enum, so the type is rebuilt. Any row still holding
-- 'OOO'/'NRR' would fail the cast — precondition 2 exists exactly to prevent that. The index is
-- dropped and recreated because it depends on the column's type.
drop index if exists public.idx_leads_qualification;

alter type public.lead_qualification rename to lead_qualification_legacy;

create type public.lead_qualification as enum (
  'preMQL', 'MQL', 'meeting_scheduled', 'meeting_held', 'offer_sent', 'won', 'rejected'
);

alter table public.leads
  alter column qualification type public.lead_qualification
  using qualification::text::public.lead_qualification;

drop type public.lead_qualification_legacy;

create index idx_leads_qualification on public.leads using btree (qualification);

-- --- 4. public_lead_stats(): the legacy OOO/NRR fallback is now dead code ----------------------
-- ADR-0014 boundary is unchanged: no arguments, aggregates only, anon-executable. The predicate
-- simplifies because OOO/NRR contacts are no longer leads at all.
create or replace function public.public_lead_stats()
returns json
language sql
stable
security definer
set search_path to 'public'
as $$
  with bounds as (
    select (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') as utc_midnight
  ),
  qualified as (
    select l.created_at
    from public.leads l
    where l.qualification is distinct from 'rejected'
  )
  select json_build_object(
    'yesterday', count(q.created_at) filter (
        where q.created_at >= b.utc_midnight - interval '1 day'
          and q.created_at <  b.utc_midnight),
    'last_7_days',  count(q.created_at) filter (where q.created_at >= b.utc_midnight - interval '7 days'),
    'last_30_days', count(q.created_at) filter (where q.created_at >= b.utc_midnight - interval '30 days'),
    'last_90_days', count(q.created_at) filter (where q.created_at >= b.utc_midnight - interval '90 days'),
    'all_time',     count(q.created_at),
    'generated_at', now()
  )
  from bounds b
  left join qualified q on true;
$$;

revoke all on function public.public_lead_stats() from public;
grant execute on function public.public_lead_stats() to anon, authenticated;

commit;
