# ADR 0005: master_admin Role

## Status
Accepted 2026-05-22

## Context

We had two internal admin tiers (`super_admin`, `admin`) plus `manager` and `client`. `super_admin` is the engineering tier — it owns impersonation, raw condition-rules JSON editing, and database-level operations. `admin` is the operational tier used by everyone on the customer success side.

Lukasz (the agency owner) needed a tier above the regular admins that could configure two things without involving engineering:

1. **The Clients mega-table layout** — rename built-in columns, hide ones they don't use, and add custom columns of their own (text / checkbox / droplist). He has been doing this in a Google Sheet PDCA for years and wanted parity.
2. **Threshold-based cell colorization (simple triggers)** — set "yellow when X, red when Y" per metric without touching the power-user condition-rules JSON.

`super_admin` already had the power-user UI, but that surface is too sharp for day-to-day owner-level configuration. Promoting all admins to that level would let any CS admin edit global thresholds, which is also wrong.

## Decision

Introduce a fourth internal role: **`master_admin`**.

**Role capability matrix (after this ADR):**

| Capability | client | manager | admin | master_admin | super_admin |
|------------|--------|---------|-------|--------------|-------------|
| Own client portal | ✅ | — | — | — | — |
| Operational surfaces (scoped) | — | ✅ (own clients) | ✅ (all) | ✅ (all) | ✅ (all) |
| User management | — | — | ✅ | ✅ | ✅ |
| Edit Clients mega-table built-in column labels / visibility | — | — | — | ✅ | ✅* |
| Edit Clients mega-table custom columns | — | — | — | ✅ | ✅* |
| Edit custom-field **values** on a client | — | — | — | ✅ | ✅* |
| Configure Simple triggers (yellow / red thresholds) | — | — | — | ✅ | ✅ |
| Configure power-user condition rules (raw branches JSON) | — | — | — | — | ✅ |
| Impersonation | — | — | — | — | ✅ |

`*` super_admin inherits master_admin write capability through `public.is_admin_user()` (which now includes `master_admin`), so the RLS policies are written against `current_app_role() = 'master_admin'` but super_admin sees the surface because they're already an admin in every other sense. In practice super_admin would not configure these directly — they're engineering, not operations — but it isn't gated out.

`master_admin` is **not invitable**. There is no UI to promote a user to or from `master_admin`. The role is seeded by a one-time manual SQL update against `public.users.role`. See [12-hidden-rules.md](../reference/functional/12-hidden-rules.md).

## Consequences

**Where the role check lives:**
- DB: `public.user_role` enum now includes `'master_admin'`. Both `public.is_admin_user()` and `private.is_admin_user()` (used by older migrations) include `master_admin` as an internal admin. RLS on the new tables — `client_table_column_overrides`, `client_custom_fields`, `client_custom_field_values` — gates writes on `current_app_role() = 'master_admin'`.
- TS: `AppRole` includes `"master_admin"`. `isInternalAdmin()` in [src/app/lib/selectors.ts](../../src/app/lib/selectors.ts) returns true for `super_admin | admin | master_admin`. All previous inline `role === "admin" || role === "super_admin"` checks were replaced by the helper.
- Route guard: `/admin` `RequireRole` allows `["admin", "super_admin", "master_admin"]`.

**Write-policy choice for custom-field values:** master_admin only. We considered allowing manager-of-client to edit too, but Lukasz's intended use is owner-only — operational managers shouldn't change checklist data on their clients without his sign-off.

**Condition-rules UI gating tightened.** The existing power-user condition-rules manager (in [src/app/pages/settings-page.tsx](../../src/app/pages/settings-page.tsx)) was previously visible to `admin` + `super_admin`. It is now `super_admin` only. `master_admin` (and `admin`, indirectly via the new "Simple triggers" surface visible to master_admin / super_admin) configure thresholds via the simplified UI instead. Existing rules continue to evaluate unchanged — the change is purely UI gating.

**Simple triggers are not a parallel engine.** The Simple-triggers card writes through the same `condition_rules` table using `key = simple_trigger:<metric>`. Editing or deleting a simple trigger upserts or deletes that row. The evaluator path is untouched.

## Alternatives considered

1. **Reuse `super_admin`.** Rejected: super_admin is engineering-tier and includes impersonation. We do not want the agency owner to have impersonation or raw JSON editing as default capabilities.
2. **Boolean flag on `users` (e.g., `is_owner`).** Rejected: would still require a parallel role-check codepath. Adding an enum variant lets us reuse the existing role machinery (RLS helpers, frontend selectors, route guard) without new plumbing.
3. **Per-table grant tables instead of a role.** Rejected: more flexible but vastly more complex for the immediate need. Can be added later if more granularity becomes necessary.

## References

- DB migrations: `supabase/migrations/20260520_master_admin_role.sql`, `..._master_admin_rls.sql`, `..._client_table_overrides.sql`, `..._client_custom_fields.sql`.
- Frontend: [src/app/types/core.ts](../../src/app/types/core.ts), [src/app/lib/selectors.ts](../../src/app/lib/selectors.ts), [src/app/App.tsx](../../src/app/App.tsx), [src/app/components/app-shell.tsx](../../src/app/components/app-shell.tsx), [src/app/pages/clients-page/mega-table.tsx](../../src/app/pages/clients-page/mega-table.tsx), [src/app/pages/settings-page.tsx](../../src/app/pages/settings-page.tsx).
- Orm gateway: [supabase/functions/orm-gateway/index.ts](../../supabase/functions/orm-gateway/index.ts) — 5 new actions (upsertColumnOverride, createClientCustomField, updateClientCustomField, deleteClientCustomField, upsertClientCustomFieldValue).
- Seed account: `lukasz@coldunicorn.com`.
