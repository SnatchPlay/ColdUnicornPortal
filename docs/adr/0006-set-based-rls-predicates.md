# ADR 0006: Set-Based RLS Predicates for High-Volume Tables

## Status
Accepted 2026-06-01

## Context

During Phase 4B latency investigation, EXPLAIN ANALYZE run under a real admin JWT revealed that the SELECT policies on `leads`, `campaigns`, and `replies` were calling `private.can_access_client(client_id)` **per row**:

```
Nested Loop  (actual rows=3972)
  Seq Scan on clients  Filter: private.can_access_client(id)          ← 48 calls
  Index Scan on leads  Filter: private.can_access_client(client_id)   ← 3972 calls
Execution Time: 446ms
```

`private.can_access_client` is declared `STABLE`, but because it receives a per-row column argument the planner cannot hoist it out of the scan. Each call chains through `private.current_app_role()` → `SELECT role FROM users WHERE id = auth.uid()`. At ~0.1ms per call × 4020 rows = **~400ms overhead per query**.

The earlier `20260421_fix_rls_performance.sql` migration had already solved the identical problem for `campaign_daily_stats` (10.48 s → 0.30 s), but its set-based pattern was not extended to the remaining tables.

After rewriting `leads`, `campaigns`, and `replies` SELECT policies to use the subquery form, handler time dropped from 1340ms to 200ms (6.7×) and total browser fetch from ~2600ms to ~1140ms.

## Decision

All SELECT RLS policies on tables scanned in high-volume paths (`leads`, `campaigns`, `replies`, `campaign_daily_stats`, `daily_stats`, and any future table with >1k expected rows) **must** use the set-based subquery pattern, not per-row helper function calls.

**Correct (set-based):**
```sql
CREATE POLICY "leads_select_scoped"
  ON public.leads FOR SELECT TO authenticated
  USING (
    client_id IN (
      SELECT id FROM public.clients
      WHERE private.can_access_client(id)
    )
  );
```

**Forbidden (per-row function call on high-volume table):**
```sql
CREATE POLICY "leads_select_scoped"
  ON public.leads FOR SELECT TO authenticated
  USING (private.can_access_client(client_id));   -- called once per row
```

**Why the subquery form is faster:** PostgreSQL evaluates the subquery once and materialises the result as a hash set. The main table scan becomes a semijoin against that set — O(1) lookup per row instead of a function call.

## Consequences

### Mandatory checklist for new gateway actions

Before any new edge function action on a table with >1k rows is shipped:

1. Run `EXPLAIN (ANALYZE, BUFFERS)` **as the authenticated role** (with real JWT sub set via `set_config`), not as superuser. Superuser bypasses RLS and gives a false baseline.
2. Inspect the plan for `Filter: private.*` lines inside Seq/Index scans. Any such line on a table with >500 rows is a red flag.
3. If found, rewrite the affected SELECT policy to the subquery form before the action goes to production.
4. Re-run EXPLAIN after the policy change and confirm the filter moves to a SubPlan / InitPlan / Hash Semijoin above the main scan.
5. Record the before/after execution times in the migration comment.

### Diagnostic tooling

- `_serverMs: { total, setup, handler }` is included in every gateway response envelope permanently. Use it to distinguish network overhead from DB overhead when diagnosing slow actions.
- `scripts/db-diagnose-rls-explain.mjs` is the canonical script for running EXPLAIN under a real JWT context.

### Row limit guidance

| Table rows | Acceptable policy form |
|---|---|
| < 100 | per-row helper call acceptable |
| 100–1k | prefer set-based; benchmark first |
| > 1k | **must** use set-based subquery |

### Scope of the 2026-06-01 fix

`20260601b_leads_campaigns_replies_rls_set_based.sql` rewrote:
- `leads_select_scoped`
- `campaigns_select_scoped` (also preserves ADR-0003 outreach-only filter for client role)
- `replies_select_scoped` (requires `client_id IS NOT NULL`; n8n always sets this)

Tables not yet reviewed for this pattern: `domains`, `invoices`, `condition_rules`, `client_custom_field_values`. These are lower volume and not on hot query paths yet; audit them in Phase 7.
