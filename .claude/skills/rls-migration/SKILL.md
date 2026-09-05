---
name: rls-migration
description: "Use for any Supabase schema or security change: a new table/column/enum, a new or modified RLS policy, a private.* helper function, an index, or a migration in supabase/migrations/. Enforces the set-based predicate rule and the EXPLAIN-ANALYZE-as-authenticated-role gate. Not for reading data or for frontend-only changes."
user-invocable: true
---

# Schema & RLS Migration Workflow

RLS is the security boundary of this product. The ORM gateway connects as a privileged Postgres
user and re-establishes the caller's identity per transaction
([ADR-0008](../../../docs/adr/0008-orm-gateway-edge-function.md)) — which means **a bad policy is
the whole security failure**, not one of several layers. Treat policy changes accordingly.

## Hard rule: set-based predicates ([ADR-0006](../../../docs/adr/0006-set-based-rls-predicates.md))

On any table above ~1k rows, a policy that calls a helper **per row** is a performance defect:

```sql
-- FORBIDDEN on hot tables: one function call per row, O(n)
USING (private.can_access_client(client_id))

-- CORRECT: subquery evaluated once → hash semijoin
USING (client_id IN (SELECT id FROM clients WHERE private.can_access_client(id)))
```

Measured 2026-06-01 on `leads`: 446 ms → 22 ms (3972 per-row calls → 48, one per client).

Already converted: `leads`, `campaigns`, `replies` (`20260601b`), `campaign_daily_stats`,
`daily_stats` (`20260421`). Still unaudited: `domains`, `invoices`, `condition_rules`,
`client_custom_field_values` — if you touch one, audit it.

## Hard rule: `revoke ... from public, anon, authenticated`

Supabase ships `alter default privileges in schema public grant execute on functions to anon,
authenticated, service_role`. **Every `create function` in `public` therefore hands `anon` a direct
EXECUTE grant**, and `revoke all ... from public` does *not* take it back — `PUBLIC` and `anon` are
different grantees. A `SECURITY DEFINER` function bypasses RLS, so the grant is the only thing
standing between the internet and the function body.

```sql
-- WRONG: anon keeps the default grant and can call this without signing in
revoke all on function public.f(uuid) from public;
grant execute on function public.f(uuid) to service_role;

-- CORRECT: name every grantee you are taking it away from
revoke all on function public.f(uuid) from public, anon, authenticated;
grant execute on function public.f(uuid) to service_role;
```

This was not hypothetical: `mark_linkedin_invited` (`20260810`) wrote the first form, and until
`20260905` any holder of the publishable key could stamp `leads.linkedin_invitation_sent_at` —
proven against a local copy of production. The `admin_*` RPCs had the same grant and were saved
only by their own `private.current_app_role()` check.

**Verify, don't assume** — the ACL is the truth, not the migration text:

```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef;
```

`mcp__supabase__get_advisors(type: "security")` flags the same thing as
`anon_security_definer_function_executable` — run it after any migration that adds a function.

The one deliberate exception is `public.public_lead_stats()`
([ADR-0014](../../../docs/adr/0014-public-marketing-stats-rpc.md)), which the marketing site calls
anonymously. A second anon-callable function needs an ADR, not a grant.

## The gate: EXPLAIN as the authenticated role — never as superuser

**Superuser bypasses RLS and gives a false baseline.** Use
[`scripts/db-diagnose-rls-explain.mjs`](../../../scripts/db-diagnose-rls-explain.mjs): it opens a
transaction, `set_config`s a real JWT `sub`, sets `role` to `authenticated`, then EXPLAINs.

```bash
node scripts/db-diagnose-rls-explain.mjs
```

1. Run `EXPLAIN (ANALYZE, BUFFERS)` **before** the change.
2. Read the plan for `Filter: private.*` inside a Seq/Index Scan → that is the per-row defect.
3. Rewrite to the set-based form.
4. Re-run EXPLAIN → confirm a `SubPlan`/`InitPlan`, not a per-row `Filter`.
5. **Record before/after timings in the migration comment.** A policy change with no numbers has
   not been done.

## Writing the migration

- Files live in `supabase/migrations/` named `YYYYMMDD[suffix]_description.sql`
  (e.g. `20260601b_leads_campaigns_replies_rls_set_based.sql`).
- **Apply and test on the local Supabase stack first** — `pnpm db:migrate:local` against
  `supabase start` (hydrated from a prod dump, so row counts are realistic; see
  [reference/local-supabase.md](../../../docs/reference/local-supabase.md)). Never test a migration
  by applying it straight to production. The cloud apply then happens via `pnpm db:migrate` (CI
  `db-migrate` job on push to `main`).
- Verify with `node scripts/db-verify.mjs` (set `SUPABASE_DB_URL` — local or cloud).
- **Shipped migrations are immutable** — fix forward with a new file. Never edit a migration that
  has been applied.
- Ask before anything destructive (drop/rename a column, drop a policy). Additive is the default.
- Keep the Drizzle schema in sync: `supabase/drizzle/schema.ts` is what the gateway queries
  against (`pnpm db:introspect`).

## Roles

`super_admin`, `admin`, `master_admin`, `manager`, `client`. Helper predicates live in the
`private.*` schema. `master_admin` ([ADR-0005](../../../docs/adr/0005-master-admin-role.md)) sits
above `admin` for cross-tenant configuration — check `private.is_internal_user` /
`private.can_manage_client` semantics before adding a new helper rather than writing a fifth
variant.

## Never

- Widen a policy to "fix a bug". Find the real cause — a too-narrow policy is usually a symptom of
  a wrong scoping assumption in the gateway action.
- Put row scoping in the gateway's `WHERE` clause instead of in RLS. The gateway's SQL is about
  *what the page needs*; RLS is about *what the caller may see*.
- Put a service-role key or `DATABASE_URL` anywhere the browser can reach.
- Write `revoke all ... from public` and think the function is closed. Name `anon` and
  `authenticated` explicitly, then read `proacl` back.

## Checklist

- [ ] New/changed function: `revoke all ... from public, anon, authenticated` + an explicit grant,
      and `proacl` read back to confirm `anon` is gone
- [ ] `get_advisors(type: "security")` clean of new
      `anon_security_definer_function_executable` entries
- [ ] EXPLAIN (ANALYZE, BUFFERS) as `authenticated`, **before**
- [ ] Set-based predicate (no per-row `private.*` on hot tables)
- [ ] EXPLAIN **after** → SubPlan/InitPlan confirmed
- [ ] Before/after timings in the migration comment
- [ ] Applied + tested on the **local Supabase stack** (`pnpm db:migrate:local`) before cloud
- [ ] Migration applied + `db-verify` clean
- [ ] Row counts sanity-checked **per role** (client / manager / admin)
- [ ] Drizzle schema regenerated if columns changed
- [ ] Docs: [03-data-model.md](../../../docs/reference/functional/03-data-model.md) +
      [09-mutations-rls.md](../../../docs/reference/functional/09-mutations-rls.md)
- [ ] `security-review` skill run (this change touches the trust boundary by definition)
