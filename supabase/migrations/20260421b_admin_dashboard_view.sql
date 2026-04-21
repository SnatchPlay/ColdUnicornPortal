-- Aggregated view for the Admin Dashboard 21-day trend. Pre-aggregates
-- per (report_date, client_id) to avoid shipping 24k+ rows to the browser
-- on every mount. Uses security_invoker so the caller's RLS policies on
-- the underlying campaign_daily_stats / campaigns tables apply.

create or replace view public.admin_dashboard_daily
with (security_invoker = on) as
select
  cds.report_date,
  c.client_id,
  sum(cds.sent_count)::int              as sent_count,
  sum(cds.reply_count)::int             as reply_count,
  sum(cds.bounce_count)::int            as bounce_count,
  sum(cds.unique_open_count)::int       as unique_open_count,
  sum(cds.positive_replies_count)::int  as positive_replies_count,
  sum(cds.inboxes_active)::int          as inboxes_active
from public.campaign_daily_stats cds
join public.campaigns c on c.id = cds.campaign_id
where cds.report_date >= current_date - interval '21 days'
group by cds.report_date, c.client_id;

comment on view public.admin_dashboard_daily is
  'Daily per-client rollup of campaign_daily_stats for the last 21 days. '
  'security_invoker so RLS from campaign_daily_stats / campaigns applies.';

grant select on public.admin_dashboard_daily to authenticated;
