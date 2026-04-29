# 03 · Data Model

Authoritative source: [`supabase/drizzle/schema.ts`](../../../supabase/drizzle/schema.ts), regenerated with `pnpm db:introspect` against the live project. RLS is applied via `pgPolicy(...)` declarations and supplemented by SQL in [`supabase/migrations/*`](../../../supabase/migrations) and [`docs/reference/supabase-production-rls.sql`](../supabase-production-rls.sql).

## Contents

1. [Enums](#1-enums)
2. [Tables by domain](#2-tables-by-domain)
3. [Views](#3-views)
4. [Private helper functions (RLS predicates)](#4-private-helper-functions-rls-predicates)
5. [Migrations of note](#5-migrations-of-note)
6. [Integrity rules](#6-integrity-rules-observed)

---

## 1. Enums

All `CREATE TYPE ... AS ENUM` definitions, [schema.ts:4-12](../../../supabase/drizzle/schema.ts#L4-L12):

| Enum | Values |
|------|--------|
| `campaign_status` | `draft`, `launching`, `active`, `stopped`, `completed` |
| `campaign_type` | `outreach`, `ooo`, `nurture`, `ooo_followup` |
| `client_status` | `Active`, `Abo`, `On hold`, `Offboarding`, `Inactive`, `Sales` |
| `crm_pipeline_stage` | `new`, `contacted`, `qualified`, `proposal`, `negotiation`, `won`, `lost` |
| `domain_status` | `active`, `warmup`, `blocked`, `retired` |
| `lead_gender` | `male`, `female` |
| `lead_qualification` | `preMQL`, `MQL`, `meeting_scheduled`, `meeting_held`, `offer_sent`, `won`, `rejected`, `OOO`, `NRR` |
| `reply_classification` | `OOO`, `Interested`, `NRR`, `Left_Company`, `Spam_Inbound`, `other` |
| `user_role` | `super_admin`, `admin`, `manager`, `client` |

Notes:

- `lead_qualification.won` and `leads.won` (boolean column) are separate signals; `getLeadStage()` prefers the boolean ([selectors.ts:70-77](../../../src/app/lib/selectors.ts#L70-L77)). In practice, when a lead becomes `won`, the boolean is set and `qualification` may remain at its last value.
- `client_status` has capitalised literals (`"On hold"`, `"Offboarding"`, `"Sales"`) — strings pass through to UI verbatim.
- `crm_pipeline_stage` is used only by `agency_crm_deals` (the agency's own sales funnel), not by lead records.

---

## 2. Tables by domain

### 2.1 Auth & users

#### `users` — [schema.ts:104-116](../../../supabase/drizzle/schema.ts#L104-L116)

Agency-facing user profile. Created on invite acceptance by the `send-invite` edge function.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK, default random | Must equal `auth.users.id` for RLS helpers to work. |
| `created_at` | timestamptz, default `now()` | |
| `email` | text **UNIQUE** not null | |
| `first_name` | text not null | |
| `last_name` | text not null | |
| `updated_at` | timestamptz, default `now()` | |
| `role` | `user_role` not null | |

RLS:

- `users_select_self` — `auth.uid() = id` (everyone reads their own row).
- `users_select_internal` — visible to internal users (admin/manager) for dropdowns and attribution. The policy body is `to ["authenticated"]` without an explicit `using` in the Drizzle declaration; actual predicate lives in the SQL migration at `docs/reference/supabase-production-rls.sql`.
- `users_update_self` — `auth.uid() = id` for both `using` and `with check`; supports profile-name updates through `orm-gateway`.

No INSERT/DELETE policies — row creation remains invite/auth-owned; updates are limited to self-service profile fields.

#### `client_users` — mapping user > client(s) — [schema.ts:313-339](../../../supabase/drizzle/schema.ts#L313-L339)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `created_at` | timestamptz | |
| `client_id` | uuid FK > `clients.id` ON DELETE CASCADE | |
| `user_id` | uuid FK > `users.id` ON DELETE CASCADE | |

Indexes on both FK columns. Unique on (`client_id`, `user_id`) and on `user_id` alone — each user maps to at most one client (enforces the "client role sees exactly one workspace" invariant from ADR-0001).

RLS:

- `client_users_select_scoped` — admin OR `user_id = auth.uid()` OR (manager AND the user is mapped to a client whose `manager_id = auth.uid()`).
- `client_users_insert_admin` / `update_admin` / `delete_admin` — admin only.

### 2.2 Clients & ops config

#### `clients` — [schema.ts:170-205](../../../supabase/drizzle/schema.ts#L170-L205)

The business entity whose outreach we run.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `created_at` | timestamptz | |
| `name` | text not null | Displayed everywhere a client is named. |
| `manager_id` | uuid FK > `users.id` not null | Determines manager scoping (`scopeClients`). |
| `kpi_leads` | smallint | Contract target leads/month (shown in sidebar mini-card & dashboards). |
| `kpi_meetings` | smallint | Contract target meetings/month. |
| `contracted_amount` | numeric | For billing context; not displayed in main UI. |
| `contract_due_date` | date | |
| `external_workspace_id` | integer UNIQUE | Link to the ingestion tool's workspace. |
| `status` | `client_status` not null | Drives filters and dashboard "non-active clients" surface (formerly "at-risk"). |
| `external_api_key` | text | |
| `min_daily_sent` | smallint default 0 | Shown in `ClientsPage` Overview column "Schedule". |
| `inboxes_count` | smallint default 0 | |
| `crm_config` | jsonb default `{}` | Reserved for per-client CRM integration settings. |
| `sms_phone_numbers` | text[] | Notification targets. |
| `notification_emails` | text[] | Notification targets. |
| `auto_ooo_enabled` | boolean default false | Whether OOO auto-routing is on. |
| `linkedin_api_key` | text | |
| `prospects_signed` | integer default 0 | Contracted prospect cap. |
| `prospects_added` | integer default 0 | Actual loaded; fallback source for `getClientKpis.prospects` when `campaigns.database_size` sums to zero. |
| `setup_info` | text | Free-form setup notes. |
| `bi_setup_done` | boolean default false | |
| `lost_reason` | text | |
| `notes` | text | |
| `updated_at` | timestamptz | |

RLS:

- `clients_select_scoped` using `private.can_access_client(id)`.
- `clients_update_scoped` — drizzle declares `for: "update" to: ["authenticated"]`; the actual predicate is in the production RLS SQL and effectively mirrors `can_manage_client(id)`. See `docs/reference/supabase-production-rls.sql`.

#### `condition_rules` — [schema.ts:286-335](../../../supabase/drizzle/schema.ts#L286-L335)

Dynamic condition rules used to evaluate client operational-health states across Clients surfaces.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `key` | text UNIQUE not null | Stable rule identifier (seeded from CS PDCA). |
| `name` | text not null | Human-readable label. |
| `description` | text nullable | |
| `target_entity` | text not null, default `client` | Current implementation focuses on client entities. |
| `surface` | text not null | `clients_overview`, `clients_dod`, `clients_3dod`, `clients_wow`, `clients_mom`, `clients_setup`. |
| `metric_key` | text not null | Primary context key used by the rule. |
| `source_sheet` / `source_range` | text nullable | Traceability back to the legacy sheet. |
| `scope_type` | text not null, default `global` | `global`, `manager`, or `client`. |
| `client_id` | uuid FK nullable | Scoped override for one client. |
| `manager_id` | uuid FK nullable | Scoped override for one manager. |
| `apply_to` | text not null, default `cell` | `row`, `cell`, `badge`, `section`. |
| `column_key` | text nullable | Column/cell target for UI rendering. |
| `branches` | jsonb not null | Ordered branch list (first-match semantics). |
| `base_filter` | jsonb nullable | Optional precondition before branch evaluation. |
| `priority` | integer not null, default 100 | Lower = stronger within same severity. |
| `enabled` | boolean not null, default true | Rule on/off switch. |
| `notes` | text nullable | Migration/runtime caveats and legacy quirks. |
| `created_by` | uuid FK nullable | User who authored/seeded the rule. |
| `created_at` / `updated_at` | timestamptz | |

Indexes:

- `idx_condition_rules_lookup` on `(target_entity, surface, enabled, priority)`
- `idx_condition_rules_client_scope` partial index (`scope_type='client'`)
- `idx_condition_rules_manager_scope` partial index (`scope_type='manager'`)

RLS:

- `condition_rules_select_scoped`:
  - manager can read global rules, manager-scoped rules assigned to them, and client-scoped rules for their assigned clients
  - admin/super_admin can read all
  - client cannot read
- `condition_rules_admin_insert` / `condition_rules_admin_update` / `condition_rules_admin_delete`: admin + super_admin only

See [14 · Condition rules](./14-condition-rules.md) for DSL and runtime evaluation behavior.
#### `client_ooo_routing` — [schema.ts:207-229](../../../supabase/drizzle/schema.ts#L207-L229)

Maps OOO replies to a follow-up campaign, optionally per gender.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK > `clients.id` not null |
| `gender` | `lead_gender` nullable |
| `campaign_id` | uuid FK > `campaigns.id` not null |
| `is_active` | boolean default true |

RLS: all four policies scoped by `private.can_manage_client(client_id)`. Not currently surfaced in the portal UI; exists for ingestion logic.

### 2.3 Campaigns

#### `campaigns` — [schema.ts:118-140](../../../supabase/drizzle/schema.ts#L118-L140)

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `client_id` | uuid FK not null | |
| `external_id` | text UNIQUE not null | ID in the ingestion tool (displayed in drawer). |
| `type` | `campaign_type` not null | `outreach` is client-visible; others are internal (ADR-0003). |
| `name` | text not null | |
| `status` | `campaign_status` not null | |
| `database_size` | integer | Prospect base uploaded for the campaign; summed to compute "Prospects" KPI for clients. |
| `positive_responses` | integer default 0 | Editable in drawer for managers/admins. |
| `start_date` | date | |
| `gender_target` | varchar(10) | |
| `created_at` / `updated_at` | timestamptz | |

RLS:

- `campaigns_select_scoped` — declared `to: ["authenticated"]`; production RLS SQL filters by `can_access_client(client_id)` and, for clients only, `type = 'outreach'`.
- `campaigns_update_scoped` — `using/withCheck: private.can_manage_client(client_id)`. Manager or admin.

#### `campaign_daily_stats` — [schema.ts:231-254](../../../supabase/drizzle/schema.ts#L231-L254)

Per-campaign per-day send/reply counters. **This is the most frequently queried table** — ingestion writes one row per campaign per day.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `campaign_id` | uuid FK not null (indexed) |
| `report_date` | date not null (indexed DESC) |
| `sent_count` | smallint default 0 |
| `reply_count` | smallint default 0 |
| `bounce_count` | smallint default 0 |
| `unique_open_count` | smallint default 0 |
| `inboxes_active` | smallint not null |
| `positive_replies_count` | smallint default 0 not null |
| `created_at` | timestamptz |

UNIQUE (`campaign_id`, `report_date`). Indexes on `campaign_id` and on `report_date DESC`.

RLS — the critical set-based predicate (ADR-0003 enforced here):

```sql
campaign_id IN (
  SELECT c.id
  FROM campaigns c
  WHERE private.can_access_client(c.client_id)
    AND (private.current_app_role() <> 'client' OR c.type = 'outreach')
)
```

The set-based form was the subject of `supabase/migrations/20260421_fix_rls_performance.sql` (see §5).

### 2.4 Leads & replies

#### `leads` — [schema.ts:15-66](../../../supabase/drizzle/schema.ts#L15-L66)

The central row. Holds enrichment (company, title, industry, country), qualification state, and reply denormalisation.

Columns of note:

| Column | Type | Role |
|--------|------|-----|
| `client_id` / `campaign_id` | uuid FKs | Scope. `campaign_id` is nullable. |
| `email` | text (indexed) | Matching key. |
| `first_name`, `last_name`, `job_title`, `company_name`, `linkedin_url` | text | Enrichment. |
| `gender` | `lead_gender` | Used for OOO routing. |
| `qualification` | `lead_qualification` (indexed) | Editable by internal roles. |
| `expected_return_date` | date | Applies when qualification=OOO. |
| `message_title` | varchar(500) | Subject of the step the lead replied to. |
| `message_number` | smallint | Sequence step at which the last reply landed (denormalised from `replies`). |
| `response_time_hours` / `response_time_label` | numeric / varchar | Time-to-reply metric from ingestion. |
| `meeting_booked`, `meeting_held`, `offer_sent`, `won` | booleans default false | **Editable by internal roles; drive `getLeadStage`**. |
| `added_to_ooo_campaign` | boolean | Routing flag. |
| `external_blacklist_id`, `external_domain_blacklist_id` | integer | Back-refs to ingestion tool tables. |
| `source` | varchar(30) default `'cold_email'` | |
| `reply_text` | text | Denormalised latest reply for quick lead-list rendering. |
| `comments` | text | Free-form notes by the manager (editable). |
| `created_at` / `updated_at` | timestamptz | |

RLS:

- `leads_select_scoped` — `private.can_access_client(client_id)`.
- `leads_update_scoped` — policy declared but predicate lives in the SQL migrations; effectively restricted to internal roles with `can_manage_client(client_id)`. **Clients are write-blocked at the RLS layer** (ADR-0004); the drawer also gates editability by `identity.role !== "client"` in the UI.

#### `replies` — [schema.ts:142-168](../../../supabase/drizzle/schema.ts#L142-L168)

Append-only history. Populated by ingestion; the portal never writes.

| Column | Type | Role |
|--------|------|------|
| `lead_id` | uuid FK nullable (indexed) | Links to lead when matched. |
| `external_id` | text UNIQUE not null | Ingestion dedupe key. |
| `sequence_step` | smallint | |
| `message_subject`, `message_text` | text | |
| `received_at` | timestamptz not null (indexed) | |
| `client_id` | uuid (indexed, nullable) | Denormalised from `leads.client_id`; `NULL` when reply is orphan / pending classification. |
| `from_email_address` | varchar(255) | |
| `is_automated_reply` | boolean default false | |
| `classification` | `reply_classification` (indexed) | Auto-filled, shown as badge. `NULL` = unclassified. |
| `short_reason` | text | Human-readable rationale. |
| `language_detected` | varchar(10) | ISO code. |
| `is_forwarded` | boolean default false | |

RLS:

- `replies_select_scoped` — `private.can_access_reply(client_id, lead_id)`. This helper inspects both columns because orphan replies (no `lead_id` yet) must still be visible to the owning client when `client_id` resolves. The helper body lives in `docs/reference/supabase-production-rls.sql`.

No write policies from the portal.

### 2.5 Daily stats (client-level rollup)

#### `daily_stats` — [schema.ts:68-102](../../../supabase/drizzle/schema.ts#L68-L102)

Pre-aggregated per-client per-day snapshot. Populated by ingestion. **Drives DoD / 3-DoD / WoW / MoM metrics** (`client-metrics.ts`).

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK not null (indexed) ON DELETE restrict |
| `report_date` | date not null (indexed) |
| `emails_sent` | integer default 0 not null |
| `prospects_in_base` | integer default 0 not null |
| `mql_count` | integer default 0 not null |
| `me_count` | integer default 0 not null |
| `response_count` | integer default 0 not null |
| `bounce_count` | integer default 0 not null |
| `won_count` | integer default 0 not null |
| `negative_count` | integer default 0 not null |
| `ooo_count` | integer default 0 not null |
| `human_replies_count` | integer default 0 not null |
| `inboxes_count` | integer default 0 not null |
| `prospects_count` | integer default 0 not null |
| `schedule_today`, `schedule_tomorrow`, `schedule_day_after` | integer nullable |
| `week_number`, `month_number`, `year` | smallint nullable |
| `created_at` | timestamptz |

UNIQUE (`client_id`, `report_date`). Index on `report_date`.

RLS `daily_stats_select_scoped`:

```sql
client_id IN (SELECT id FROM clients WHERE private.can_access_client(id))
```

The snapshot loader skips this table for client role: `loadSnapshot({ includeDailyStats: identity?.role !== "client" })` ([`core-data.tsx`](../../../src/app/providers/core-data.tsx)). Clients get their pre-computed equivalents from `campaign_daily_stats` aggregation and from lead-based counts.

### 2.6 Domains, invoices, blacklist

#### `domains` — [schema.ts:341-365](../../../supabase/drizzle/schema.ts#L341-L365)

Outreach sending domains.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK not null |
| `domain_name`, `setup_email` | text not null |
| `purchase_date`, `exchange_date` | date not null |
| `status` | `domain_status` |
| `reputation` | text |
| `exchange_cost` | numeric(8,2) |
| `campaign_verified_at`, `warmup_verified_at` | date |
| `updated_at` | timestamptz |

RLS: all four policies (`select`, `insert`, `update`, `delete`) scoped via `private.can_access_client(client_id)` > admin + assigned manager.

#### `invoices` — [schema.ts:256-274](../../../supabase/drizzle/schema.ts#L256-L274)

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK not null |
| `issue_date` | date not null |
| `amount` | numeric not null |
| `status` | text |

RLS:

- `invoices_select_scoped` — `private.can_access_client(client_id)` (client, manager, admin).
- `invoices_insert_admin` / `update_admin` / `delete_admin` — policies named admin-only; actual predicate in production SQL; managers can also update per `mutation-ownership-matrix.md` in practice.

#### `email_exclude_list` — [schema.ts:276-284](../../../supabase/drizzle/schema.ts#L276-L284)

Agency-wide domain blacklist.

| Column | Type |
|--------|------|
| `domain` | text PK |
| `created_at` | timestamptz |

RLS:

- `email_exclude_list_select_internal` — `private.is_internal_user()` (manager + admin).
- Insert/update/delete — admin only (body in production SQL).

### 2.7 Agency CRM (internal pipeline)

#### `agency_crm_deals` — [schema.ts:286-311](../../../supabase/drizzle/schema.ts#L286-L311)

Not surfaced in the current UI, but present in the schema. Tracks the agency's own sales pipeline for prospective clients.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `company_name`, `contact_name`, `email`, `phone`, `source` | text |
| `salesperson_id` | uuid FK > `users.id` not null |
| `stage` | text (free-form; `crm_pipeline_stage` enum is reserved but not typed here) |
| `stage_updated_at` | timestamptz |
| `estimated_value` | numeric |
| `win_chance` | smallint |
| `lesson_learned` | text |
| `updated_at` | date |

RLS `agency_crm_deals_select_scoped`:

```sql
private.is_admin_user() OR (private.current_app_role() = 'manager' AND salesperson_id = auth.uid())
```

---

## 3. Views

### `admin_dashboard_daily` — [schema.ts:366-373](../../../supabase/drizzle/schema.ts#L366-L373) · migration [`20260421b_admin_dashboard_view.sql`](../../../supabase/migrations/20260421b_admin_dashboard_view.sql)

```sql
CREATE VIEW public.admin_dashboard_daily
WITH (security_invoker = on) AS
SELECT cds.report_date,
       c.client_id,
       SUM(cds.sent_count)::integer              AS sent_count,
       SUM(cds.reply_count)::integer             AS reply_count,
       SUM(cds.bounce_count)::integer            AS bounce_count,
       SUM(cds.unique_open_count)::integer       AS unique_open_count,
       SUM(cds.positive_replies_count)::integer  AS positive_replies_count,
       SUM(cds.inboxes_active)::integer          AS inboxes_active
FROM campaign_daily_stats cds
JOIN campaigns c ON c.id = cds.campaign_id
WHERE cds.report_date >= (CURRENT_DATE - INTERVAL '21 days')
GROUP BY cds.report_date, c.client_id;
```

- `security_invoker = on` — caller's RLS applies, so the view respects the same per-role visibility as `campaign_daily_stats`.
- Hard-coded **21-day** window feeds the Admin Dashboard campaign momentum charts (sent/replies/positive) and manager capacity surface.
- Not directly queried by the portal at the time of writing; the portal aggregates from `campaign_daily_stats` client-side. The view is kept for future server-side rollups and for BI tools.

---

## 4. Private helper functions (RLS predicates)

All policies reference `private.*` helpers defined in `docs/reference/supabase-production-rls.sql`. Inferred behaviour:

| Helper | Signature | Predicate |
|--------|-----------|-----------|
| `private.current_app_role()` | `returns text` | `SELECT role FROM users WHERE id = auth.uid()` (or equivalent). Returns text so callers can compare to literals. |
| `private.is_admin_user()` | `returns boolean` | `current_app_role() IN ('admin', 'super_admin')`. |
| `private.is_internal_user()` | `returns boolean` | `current_app_role() <> 'client'` — admin, super_admin, manager. |
| `private.can_access_client(client_id uuid)` | `returns boolean` | Admin > TRUE; manager > client is assigned (`manager_id = auth.uid()`); client > user is mapped via `client_users`. |
| `private.can_manage_client(client_id uuid)` | `returns boolean` | Admin > TRUE; manager > client is assigned; client > FALSE. |
| `private.can_access_reply(client_id uuid, lead_id uuid)` | `returns boolean` | Checks `can_access_client(client_id)` OR — when `client_id IS NULL` — looks up the owning client via `lead_id` and applies `can_access_client`. Admin short-circuits. |

Pattern: wherever possible the new policies use **set-based subqueries** rather than per-row function calls, because Postgres would otherwise fail to hoist the check past an index. See [§5](#5-migrations-of-note).

---

## 5. Migrations of note

### `supabase/migrations/20260421_fix_rls_performance.sql`

Rewrites `campaign_daily_stats_select_scoped` and `daily_stats_select_scoped` from per-row helper calls to **set-based** predicates:

```sql
-- old (slow)
USING ( private.can_access_campaign(campaign_id) )

-- new (fast; Postgres hoists the IN across a bitmap scan)
USING (
  campaign_id IN (
    SELECT c.id FROM campaigns c
    WHERE private.can_access_client(c.client_id)
      AND (private.current_app_role() <> 'client' OR c.type = 'outreach')
  )
)
```

Measured impact: **~10.48 s > 0.30 s** on a table of ~24k rows during seed testing.

### `supabase/migrations/20260421b_admin_dashboard_view.sql`

Creates the `admin_dashboard_daily` view (§3) with `security_invoker=on`.

### `supabase/migrations/20260428_condition_rules_engine.sql`

Adds `public.condition_rules`, indexes, RLS, and CS PDCA seed data for dynamic client-health conditions.

Notable behavior encoded in seed:

- Rules are normalized JSON DSL (`branches` + optional `base_filter`), no executable formulas.
- Directly mapped rules are enabled; ambiguous or missing-field rules are seeded disabled with `notes`.
- Legacy low-rate green behavior for WoW response/human/OOO is preserved in notes for parity.
Earlier Drizzle migrations live in `supabase/drizzle/migrations/0000_stiff_fixer.sql` — the baseline ddl.

---

## 6. Integrity rules observed

- `client_users.user_id` is **UNIQUE**, enforcing "one client per client-role user" at the database level (matches ADR-0001's single-workspace invariant for clients).
- `campaigns_external_id_key` and `replies_external_id_key` ensure idempotent ingestion upserts.
- `daily_stats` and `campaign_daily_stats` both have unique composite keys over (`*_id`, `report_date`) — no duplicate rows per day.
- `condition_rules.key` is unique, allowing idempotent seed upserts without duplicate rule identities.
- FK cascades: only `client_users.*` cascade on delete. Everywhere else (`campaigns.client_id`, `leads.client_id`, `daily_stats.client_id` RESTRICT, `domains.client_id`, …) deletes are intentionally blocked; cleanup must happen in ingestion.
- `inboxes_active` on `campaign_daily_stats` is **not null** without a default — ingestion MUST supply it.
- Several `varchar(length)` columns (`phone_number 50`, `message_title 500`, `country 100`) are the only places lengths are enforced at the column level; text columns are unbounded.

Next: [04 · Metrics catalog](./04-metrics-catalog.md).





