-- Strengthen the terminal-conclusion invariant (ADR-0013, spec item 4). A recorded `final_outcome`
-- must carry BOTH its conclusion timestamp AND a non-empty conclusion text — all three set atomically
-- by the concludeLead gateway action. This replaces 20260719d's timestamp-only check so the DB is the
-- backstop even for a direct/service-role write that bypasses the gateway validator.
--
-- Additive/safe: `final_outcome` is a new column (20260719d) not yet live in production, so no existing
-- row can violate the tightened predicate; the constraint is added clean, no data correction needed.

do $$ begin
  -- Drop the weaker timestamp-only check (fix-forward; 20260719d is immutable and stays on record).
  if exists (select 1 from pg_constraint where conname = 'leads_final_outcome_concluded_check') then
    alter table public.leads drop constraint leads_final_outcome_concluded_check;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'leads_final_outcome_invariant_check') then
    alter table public.leads
      add constraint leads_final_outcome_invariant_check
      check (
        final_outcome is null
        or (concluded_at is not null and nullif(btrim(conclusion), '') is not null)
      );
  end if;
end $$;
