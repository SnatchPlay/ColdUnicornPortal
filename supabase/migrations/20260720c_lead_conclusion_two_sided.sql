-- Two-sided terminal-conclusion invariant (ADR-0013, spec item 3 correction). The `20260720b` check
-- only forbade an outcome WITHOUT a conclusion; it still allowed the mirror-image inconsistent states
-- (a conclusion or a concluded_at with a NULL outcome). The canonical requirement is bidirectional:
-- the three terminal columns are either ALL empty (non-terminal lead) or ALL set (concluded lead), with
-- a non-empty conclusion. Enforced at the DB so a direct/service-role/n8n write cannot bypass it.
--
-- `conclusion` is a canonical terminal field, not a draft store: if the product later wants a draft
-- conclusion before the lead is concluded, that needs a SEPARATE field/model, not this column.

-- Reconcile any partial rows to the invariant before enforcing it. Only the NULL-outcome side can have
-- stragglers (an old un-conclude that left a conclusion/concluded_at behind); clear them. The set side
-- was already guarded by 20260720b, so no outcome row can carry a blank conclusion.
update public.leads
  set conclusion = null, concluded_at = null
  where final_outcome is null and (conclusion is not null or concluded_at is not null);

do $$ begin
  if exists (select 1 from pg_constraint where conname = 'leads_final_outcome_invariant_check') then
    alter table public.leads drop constraint leads_final_outcome_invariant_check;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leads_conclusion_consistency_check') then
    alter table public.leads
      add constraint leads_conclusion_consistency_check
      check (
        (final_outcome is null and conclusion is null and concluded_at is null)
        or (
          final_outcome is not null
          and concluded_at is not null
          and nullif(btrim(conclusion), '') is not null
        )
      );
  end if;
end $$;
