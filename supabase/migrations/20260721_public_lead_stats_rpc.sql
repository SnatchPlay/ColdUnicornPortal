-- Public aggregate lead counters for the marketing website (ADR-0014).
--
-- Why: the marketing site (Webflow) shows "leads delivered" counters — yesterday / 7d / 30d / 90d /
-- all time. It has no authenticated user, so it cannot go through the orm-gateway (ADR-0008 requires
-- a caller JWT whose claims are re-established inside the transaction). Every RLS policy in this
-- database is granted to `authenticated` only, so the `anon` role sees zero rows — and that must
-- stay true. This migration therefore exposes ONE narrow, argument-less function that returns FIVE
-- integers and nothing else, and grants EXECUTE on it to `anon`.
--
-- SECURITY DEFINER is required (anon has no SELECT policy on leads and must never get one) and is
-- safe here because the function takes no arguments, has a pinned search_path, and can only ever
-- emit aggregate counts — there is no row, no client_id and no lead identity in the result.
--
-- Boundary (ADR-0014): this surface may only ever return aggregates with NO per-client or
-- per-campaign breakdown. A sliced public metric needs a new ADR.
--
-- "Lead" here = a leads row that is NOT OOO / NRR / rejected. The predicate mirrors
-- deriveContactDisposition() in src/app/lib/crm/lead-status.ts:73 — the canonical
-- `contact_disposition` column (20260720d) with the legacy fallback for rows where n8n still writes
-- OOO/NRR into `qualification` (see docs/reference/functional/11-integrations.md §6). Do NOT delete
-- the legacy CASE branch once n8n cuts over: historical rows keep those qualification values.
--
-- Performance: one pass over `leads` with FILTER aggregates. `all_time` counts every row, so a seq
-- scan is unavoidable and an index on created_at would buy nothing — deliberately not added.
--   EXPLAIN (ANALYZE, BUFFERS), local prod-dump copy, 4723 leads, 2026-07-21:
--   Aggregate → Nested Loop Left Join → Seq Scan on leads. Buffers: shared hit=318.
--   Planning 0.493 ms, Execution 9.456 ms. One scan, no per-row function call.

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
      and coalesce(
            l.contact_disposition,
            case l.qualification
              when 'OOO' then 'out_of_office'
              when 'NRR' then 'not_right_role'
            end
          ) is null
  )
  select json_build_object(
    -- Previous whole UTC day, half-open interval.
    'yesterday', count(q.created_at) filter (
        where q.created_at >= b.utc_midnight - interval '1 day'
          and q.created_at <  b.utc_midnight),
    -- Rolling windows anchored to UTC midnight: N whole days PLUS today so far, so the number on
    -- the site keeps ticking up during the day.
    'last_7_days',  count(q.created_at) filter (where q.created_at >= b.utc_midnight - interval '7 days'),
    'last_30_days', count(q.created_at) filter (where q.created_at >= b.utc_midnight - interval '30 days'),
    'last_90_days', count(q.created_at) filter (where q.created_at >= b.utc_midnight - interval '90 days'),
    'all_time',     count(q.created_at),
    'generated_at', now()
  )
  from bounds b
  left join qualified q on true;
$$;

-- `public` (i.e. every role, including future ones) must not inherit EXECUTE by default; grant it
-- explicitly to the two roles that need it.
revoke all on function public.public_lead_stats() from public;
grant execute on function public.public_lead_stats() to anon, authenticated;

comment on function public.public_lead_stats() is
  'ADR-0014. Public aggregate lead counters for the marketing site. Called by anon via PostgREST RPC. Returns counters only — never rows, never a per-client breakdown.';
