-- Persisted contact disposition (ADR-0013, spec item 10 correction). Previously the disposition was
-- DERIVED from the n8n-owned `qualification` (OOO/NRR), which meant an OOO/NRR event OVERWROTE the prior
-- qualification (e.g. MQL) and destroyed the funnel stage. The canonical model stores the disposition in
-- its OWN column so `qualification` is never overwritten by a disposition change:
--
--   OOO  → contact_disposition = 'out_of_office'   (qualification untouched)
--   NRR  → contact_disposition = 'not_right_role'  (qualification untouched)
--   active → contact_disposition = NULL
--
-- Rules the split model enforces (unchanged, now that the dimensions are truly independent):
--   * disposition does NOT change crm_stage (stage derives from qualification + offer/meeting facts);
--   * NRR does NOT auto-set final_outcome (a lost outcome stays an explicit decision).
--
-- Legacy compatibility: for OLD rows where `qualification` is already 'OOO'/'NRR', the read-model falls
-- back to mapping that legacy value to a display disposition. That fallback is display-only — the prior
-- qualification of a legacy OOO/NRR row CANNOT be reconstructed without historical data, so there is NO
-- backfill into preMQL/MQL/lost here (that would fabricate data).
--
-- n8n write-path: n8n must be updated to write `contact_disposition` and STOP writing OOO/NRR into
-- `qualification` (see docs/reference/functional/11-integrations.md). Additive/safe: nullable column,
-- no existing row set.

alter table public.leads
  add column if not exists contact_disposition text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_contact_disposition_check') then
    alter table public.leads
      add constraint leads_contact_disposition_check
      check (contact_disposition is null or contact_disposition in ('out_of_office', 'not_right_role'));
  end if;
end $$;
