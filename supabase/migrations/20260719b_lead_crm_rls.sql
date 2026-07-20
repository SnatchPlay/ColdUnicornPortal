-- RLS for the lead CRM child tables (ADR-0013 §7). Read: anyone who can access the owning client
-- (incl. client role — CRM data is read-only for clients). Write: manager/admin via can_manage_client
-- (client role write-blocked in Postgres, mirroring leads_update_scoped). All predicates are
-- SET-BASED per ADR-0006: the write policy is `for all`, so its USING is also evaluated on SELECT —
-- a per-row private.* call there would reintroduce the O(n) defect, so it too is a subquery.

do $$
declare
  tbl text;
begin
  foreach tbl in array array['lead_meetings', 'lead_offers', 'lead_tasks', 'lead_value_deliveries']
  loop
    execute format('alter table public.%I enable row level security', tbl);

    -- SELECT: scoped through the parent lead to the caller's accessible clients (set-based).
    execute format('drop policy if exists %I on public.%I', tbl || '_select_scoped', tbl);
    execute format($f$
      create policy %I on public.%I for select to authenticated
      using (
        lead_id in (
          select l.id from public.leads l
          where l.client_id in (select id from public.clients where private.can_access_client(id))
        )
      )$f$, tbl || '_select_scoped', tbl);

    -- WRITE (insert/update/delete): manager/admin only, via can_manage_client (set-based).
    execute format('drop policy if exists %I on public.%I', tbl || '_write_scoped', tbl);
    execute format($f$
      create policy %I on public.%I for all to authenticated
      using (
        lead_id in (
          select l.id from public.leads l
          where l.client_id in (select id from public.clients where private.can_manage_client(id))
        )
      )
      with check (
        lead_id in (
          select l.id from public.leads l
          where l.client_id in (select id from public.clients where private.can_manage_client(id))
        )
      )$f$, tbl || '_write_scoped', tbl);
  end loop;
end $$;
