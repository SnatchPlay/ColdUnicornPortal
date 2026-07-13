-- Align sequencer_daily_stats with the real "Get Metrics from Aimfox" n8n workflow
-- (analyzed 2026-07-05; ADR-0008 follow-up).
--
-- The workflow writes three per-day Aimfox schedule volumes to the PDCA sheet
-- ("Schedule volume for Today/Tomorrow/Day after tomorrow (Aimfox)") that had no
-- home in the table, and its "Invitations limit" cell is actually the REMAINING
-- limit for today, not the weekly cap. Split the two quantities:
--   invite_limit           = weekly connect cap snapshot (sum of accounts'
--                            limit.connect; the "~195 per account" number)
--   invite_limit_remaining = what is left today
--                            (workflow: sum_limit_connect/5 - sent buckets)
-- Schedule formulas (computed by n8n, stored here as facts):
--   schedule_today     = min(daily_limit, remaining_audience + sent_today)
--   schedule_tomorrow  = min(daily_limit, max(remaining_audience - daily_limit, 0))
--   schedule_day_after = min(daily_limit, max(remaining_audience - 2*daily_limit, 0))
--   where daily_limit = invite_limit / 5 (working days).

begin;

alter table public.sequencer_daily_stats
  add column if not exists schedule_today integer not null default 0,
  add column if not exists schedule_tomorrow integer not null default 0,
  add column if not exists schedule_day_after integer not null default 0,
  add column if not exists invite_limit_remaining integer;

comment on column public.sequencer_daily_stats.invite_limit is
  'Weekly connect-limit cap snapshot: sum of the client''s Aimfox accounts'' limit.connect (~195 per LinkedIn account). NOT the remaining amount — see invite_limit_remaining.';
comment on column public.sequencer_daily_stats.invite_limit_remaining is
  'Invites still available today as computed by n8n (daily_limit minus today''s sent buckets). Snapshot, overwritten by each 2-hourly run.';
comment on column public.sequencer_daily_stats.schedule_today is
  'Aimfox planned invite volume for today: min(daily_limit, remaining_audience + sent_today).';
comment on column public.sequencer_daily_stats.schedule_tomorrow is
  'Aimfox planned invite volume for tomorrow: min(daily_limit, max(remaining_audience - daily_limit, 0)).';
comment on column public.sequencer_daily_stats.schedule_day_after is
  'Aimfox planned invite volume for the day after tomorrow: min(daily_limit, max(remaining_audience - 2*daily_limit, 0)).';

commit;
