-- Rewrite SELECT RLS policies on leads, campaigns, and replies to use
-- set-based (subquery / semijoin) predicates instead of per-row function calls.
--
-- Problem (identified 2026-06-01 via EXPLAIN ANALYZE as authenticated/admin):
--   leads_select_scoped:    private.can_access_client(client_id) per row
--   campaigns_select_scoped: private.can_access_campaign(id)     per row
--   replies_select_scoped:  private.can_access_reply(...)        per row
--
--   With 3972 leads, each SELECT on leads calls can_access_client 4020 times
--   (48 clients + 3972 leads in nested loop). Each call costs ~0.1ms, adding
--   ~400ms overhead per query. Superuser: 6ms. With RLS: 446ms.
--
-- Fix: mirror the pattern from 20260421_fix_rls_performance.sql (which took
-- campaign_daily_stats from 10.48s → 0.30s). Push the per-row check into a
-- subquery evaluated ONCE; filter the main table via hash semijoin.
--
--   leads_select_scoped (new):
--     client_id IN (SELECT id FROM clients WHERE can_access_client(id))
--     → can_access_client called 48 times (once per client), not 3972 times.
--
-- Target measured improvement: ~400ms removed from handler time per query.

BEGIN;

-- ── leads ─────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "leads_select_scoped" ON public.leads;

CREATE POLICY "leads_select_scoped"
  ON public.leads
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE private.can_access_client(id)
    )
  );

-- ── campaigns ─────────────────────────────────────────────────────────────────
-- Preserves ADR-0003: client role only sees outreach campaigns.

DROP POLICY IF EXISTS "campaigns_select_scoped" ON public.campaigns;

CREATE POLICY "campaigns_select_scoped"
  ON public.campaigns
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE private.can_access_client(id)
    )
    AND (
      private.current_app_role() <> 'client'
      OR type = 'outreach'::campaign_type
    )
  );

-- ── replies ───────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "replies_select_scoped" ON public.replies;

CREATE POLICY "replies_select_scoped"
  ON public.replies
  FOR SELECT
  TO authenticated
  USING (
    client_id IS NOT NULL
    AND client_id IN (
      SELECT id FROM public.clients
      WHERE private.can_access_client(id)
    )
  );

COMMIT;
