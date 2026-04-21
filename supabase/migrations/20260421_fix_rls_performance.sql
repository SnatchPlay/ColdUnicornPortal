-- Rewrite RLS policies that call per-row security functions into set-based
-- form. Prior policies on campaign_daily_stats and daily_stats invoked
-- private.can_access_campaign / private.can_access_client once per row; on
-- 24k stats rows this exceeded the 8s statement_timeout for the
-- `authenticated` role, producing the "Could not select campaign_daily_stats"
-- error on the admin dashboard.
--
-- Measured (super_admin over session pooler, public.campaign_daily_stats
-- with 24k rows):
--   before: Seq Scan + per-row Filter -> 10.48s
--   after : hashed SubPlan semijoin   ->  0.30s

begin;

-- campaign_daily_stats ------------------------------------------------------

drop policy if exists "campaign_daily_stats_select_scoped" on public.campaign_daily_stats;

create policy "campaign_daily_stats_select_scoped"
on public.campaign_daily_stats
for select
to authenticated
using (
  campaign_id in (
    select c.id
    from public.campaigns c
    where private.can_access_client(c.client_id)
      and (
        private.current_app_role() <> 'client'
        or c.type = 'outreach'::campaign_type
      )
  )
);

-- daily_stats ---------------------------------------------------------------
-- Existing policy (kept in sync): apply the same pattern for consistency.

do $$
declare
  _def text;
begin
  select pg_get_expr(polqual, polrelid)
    into _def
    from pg_policy
    where polrelid = 'public.daily_stats'::regclass
    limit 1;

  if _def is not null and _def like '%can_access_client(client_id)%'
     and _def not like '%client_id in%'
  then
    execute 'drop policy if exists "daily_stats_select_scoped" on public.daily_stats';
    execute $p$
      create policy "daily_stats_select_scoped"
      on public.daily_stats
      for select
      to authenticated
      using (
        client_id in (
          select id from public.clients
          where private.can_access_client(id)
        )
      )
    $p$;
  end if;
end $$;

-- index to support ORDER BY report_date DESC on campaign_daily_stats --------

create index if not exists campaign_daily_stats_report_date_idx
  on public.campaign_daily_stats (report_date desc);

commit;
