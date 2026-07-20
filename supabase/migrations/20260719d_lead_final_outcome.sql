-- Phase 1b — explicit terminal outcome for the split lead CRM status model (ADR-0013, refined).
-- The status model is SPLIT: crm_stage (preMQL/MQL/SQL) and contact_disposition (OOO/NRR) are DERIVED
-- on read (no columns); only the explicit terminal decision is stored here. `conclusion` +
-- `concluded_at` already exist (20260719_lead_crm_tables.sql); the conclusion action (Phase 5) sets all
-- three atomically. KPI dashboards are untouched — they keep their booleans/qualification semantics.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'final_outcome') then
    create type public.final_outcome as enum ('won', 'lost', 'lost_premql');
  end if;
end $$;

alter table public.leads
  add column if not exists final_outcome public.final_outcome;

-- A recorded terminal outcome must carry its conclusion timestamp (set atomically with the outcome).
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_final_outcome_concluded_check') then
    alter table public.leads
      add constraint leads_final_outcome_concluded_check
      check (final_outcome is null or concluded_at is not null);
  end if;
end $$;
