-- email_accounts / email_account_warming_daily are scoped through domain → client. Winnr-synced
-- domains not yet linked to a client have client_id = null, which broke the client-set semijoin in
-- the 20260720e policies and hid their mailboxes even from admins — unlike domains RLS, where
-- private.can_access_client(null) is true for admin-tier callers, so admins already see unlinked
-- domains. This adds an admin-only OR branch so unlinked-domain mailboxes surface for admin-tier
-- callers too, matching domain visibility. Managers/clients are unaffected: they never get null-
-- client_id domains (can_access_client(null) is false for them).
--
-- Still set-based (ADR-0006): private.is_admin_user() is a scalar with no row dependency, hoisted
-- once by the planner; the client-membership check stays a semijoin. Verified via EXPLAIN as the
-- authenticated role — the plan is a hashed SubPlan over domains, not a per-row function on the
-- hot email_accounts table.

drop policy if exists email_accounts_select_scoped on public.email_accounts;
create policy email_accounts_select_scoped
  on public.email_accounts
  for select
  to authenticated
  using (
    domain_id in (
      select d.id
      from public.domains d
      where d.client_id in (select id from public.clients where private.can_access_client(id))
         or (d.client_id is null and private.is_admin_user())
    )
  );

drop policy if exists email_account_warming_daily_select_scoped on public.email_account_warming_daily;
create policy email_account_warming_daily_select_scoped
  on public.email_account_warming_daily
  for select
  to authenticated
  using (
    email_account_id in (
      select ea.id
      from public.email_accounts ea
      where ea.domain_id in (
        select d.id
        from public.domains d
        where d.client_id in (select id from public.clients where private.can_access_client(id))
           or (d.client_id is null and private.is_admin_user())
      )
    )
  );
