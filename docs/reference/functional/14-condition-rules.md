# 14 · Condition Rules

Dynamic operational health layer for client surfaces. This system replaces spreadsheet-only conditional formatting with data-driven, safe rules persisted in Supabase and evaluated in the portal runtime.

## Contents

1. [Purpose and boundaries](#1-purpose-and-boundaries)
2. [End-to-end flow](#2-end-to-end-flow)
3. [Data model and RLS](#3-data-model-and-rls)
4. [Rule DSL](#4-rule-dsl)
5. [Engine behavior](#5-engine-behavior)
6. [Client condition context mapping](#6-client-condition-context-mapping)
7. [Seeded CS PDCA rules](#7-seeded-cs-pdca-rules)
8. [UI integration](#8-ui-integration)
9. [Admin no-code builder](#9-admin-no-code-builder)
10. [Known legacy quirks](#10-known-legacy-quirks)
11. [Testing coverage](#11-testing-coverage)

---

## 1. Purpose and boundaries

The condition system is for **read/evaluate/display only**:

- It evaluates client operational metrics into explainable condition results.
- It drives row/cell highlighting, row-level health rollups, and health filtering in `ClientsPage`.
- It does not mutate ingestion counters or trigger external side effects.

Hard boundaries:

- No `eval` / Function constructor / executable formulas.
- No writes to ingestion-only tables (`replies`, `campaign_daily_stats`, `daily_stats`).
- No Smartlead/Bison direct calls from the portal.
- No notification dispatch from the portal.

This capability is **not** the legacy biweekly Health Assessment form. It is a runtime health layer over existing metrics.

---

## 2. End-to-end flow

```txt
raw Supabase snapshot
> createClientMetrics() + client condition context
> evaluate safe JSON DSL rules
> condition results
> row/cell styles + health rollups + filters + tooltip explanations
```

Runtime entry points:

- Context builder: `src/app/lib/conditions/client-condition-context.ts`
- Evaluator: `src/app/lib/conditions/evaluator.ts`
- Surface evaluator: `src/app/lib/conditions/client-condition-results.ts`
- UI consumer: `src/app/pages/clients-page.tsx`

---

## 3. Data model and RLS

### 3.1 Table

`public.condition_rules` (migration: `supabase/migrations/20260428_condition_rules_engine.sql`)

Key fields:

- Identity: `id`, `key`, `name`, `description`
- Targeting: `target_entity`, `surface`, `metric_key`, `apply_to`, `column_key`
- Scope: `scope_type`, `client_id`, `manager_id`
- Logic: `branches jsonb`, `base_filter jsonb`
- Governance: `priority`, `enabled`, `notes`, `source_sheet`, `source_range`, `created_by`, timestamps

Indexes:

- `idx_condition_rules_lookup` on `(target_entity, surface, enabled, priority)`
- `idx_condition_rules_client_scope` partial index on `client_id` where `scope_type='client'`
- `idx_condition_rules_manager_scope` partial index on `manager_id` where `scope_type='manager'`

### 3.2 RLS matrix

Policies in migration and production RLS script:

- Manager read: global + own manager-scoped + client-scoped for assigned clients
- Admin/super_admin read + write: full access
- Client: no access

Policy names:

- `condition_rules_select_scoped`
- `condition_rules_admin_insert`
- `condition_rules_admin_update`
- `condition_rules_admin_delete`

---

## 4. Rule DSL

Type definitions live in `src/app/lib/conditions/types.ts`.

### 4.1 Supported operators

- `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
- `between`
- `is_blank`, `not_blank`
- `starts_with`, `not_starts_with`
- `in`, `not_in`

### 4.2 Condition tree

- Comparison node: `{ left, op, right? }`
- Group nodes: `{ all: ConditionNode[] }`, `{ any: ConditionNode[] }`
- Arbitrary nested groups supported

### 4.3 Value references

- Static: `{ value: ... }`
- Metric path: `{ metric: "client.min_daily_sent" }`
- Optional `multiplier`
- Optional transform: `lower`, `upper`, `trim`, `abs`, `round`

### 4.4 Branch semantics

A rule contains ordered branches. First matching branch returns one result for that rule.

---

## 5. Engine behavior

### 5.1 Helpers

- `evaluateConditionRules(context, rules, { targetId })`
- `evaluateSingleRule(context, rule, options)`
- `getHighestSeverity(results)`
- `getCellCondition(results, columnKey)`
- `getRowCondition(results)`
- `getSeverityClassName(severity)`

### 5.2 Severity ranking

Order:

`critical_over > danger > warning > info > good`

Resolution behavior:

- Results are sorted by severity rank (desc), then `priority` (asc).
- Higher severity always dominates lower severity visually.
- For same severity, lower numeric `priority` wins.

### 5.3 Health score rollup

`getHealthScore(results)` computes row-level score in `[0..100]`:

- base `100`
- `critical_over`: `-60`
- `danger`: `-25`
- `warning`: `-8`
- `info` / `good`: excluded

Rows are sorted worst-first by default (`healthScore ASC`) in the clients overview.

### 5.4 DoD dynamic bucket mode

DoD rules are reusable via runtime `value` injection:

- Rule column key in DB: `dynamic_dod_bucket`
- Runtime cell keys: `dod:{bucket}:{schedule|sent}`
- Each DoD schedule/sent cell evaluates the same rule with the injected `value`

---

## 6. Client condition context mapping

Context builder: `buildClientConditionContext(...)` in `client-condition-context.ts`.

Primary mappings:

- `prospects_added` < `clients.prospects_added`
- `prospects_signed` < `clients.prospects_signed`
- `inboxes` < `clients.inboxes_count`
- `min_sent` < `clients.min_daily_sent`
- `sent_today` / `sent_yesterday` / `sent_two_days_ago` < `createClientMetrics().overview`
- `schedule_today` / `schedule_tomorrow` / `schedule_day_after` < `createClientMetrics().overview`
- `three_dod_total`, `three_dod_sql` and bucket variants < `createClientMetrics()`
- `wow_*` rates and `wow_sql` < current WoW bucket `0`
- `mom_sql`, `mom_meetings`, `mom_won` < current MoM bucket `0`
- `monthly_sql_kpi` < `clients.kpi_leads`
- `monthly_meeting_kpi` < `clients.kpi_meetings`
- `monthly_won_kpi` < `null` (rule is seeded disabled)
- `auto_li_api_key` < `clients.linkedin_api_key`
- `bi_setup` < `clients.bi_setup_done`

Direct-mapping-only policy for ambiguous setup fields:

- `report_or_folder_link`, `folder_link`, `issues` are `null` in current mapping.
- Dependent rules are seeded disabled with notes.

---

## 7. Seeded CS PDCA rules

Seed migration inserts 23 normalized rules (`source_sheet='CS PDCA'` + `source_range`).

### 7.1 Enabled

- `prospects_added_vs_signed`
- `dod_sent_or_schedule_vs_min_sent`
- `inboxes_vs_min_sent`
- `three_dod_sql_vs_monthly_lead_kpi_daily_target`
- `three_dod_total_too_high_vs_sql`
- `wow_bounce_rate`
- `wow_total_response_rate`
- `wow_human_response_rate`
- `wow_ooo_rate`
- `wow_negative_response_rate`
- `wow_sql_vs_monthly_lead_kpi_weekly_target`
- `mom_sql_vs_monthly_lead_kpi`
- `mom_meetings_vs_meeting_kpi`
- `min_sent_required`
- `spreadsheet_or_workspace_ids_present`
- `bi_setup_required`
- `auto_li_api_key_present`

### 7.2 Disabled (with notes)

- `mom_won_vs_won_kpi` (missing `monthly_won_kpi` source)
- `report_or_folder_link_present`
- `folder_link_present`
- `issues_ok`
- `checkbox_true_green`
- `bp_text_warning` (non-operational legacy formatting)

---

## 8. UI integration

`ClientsPage` (`src/app/pages/clients-page.tsx`) consumes evaluated results.

### 8.1 Visual behavior

- Row tint based on highest non-good severity
- One severity badge per row (highest severity only)
- Row health score (`0..100`)
- Cell highlight by mapped `column_key`, with reduced cell-fill noise (problem-cell emphasis only)
- Distinct `critical_over` (fuchsia) style
- DoD/3DoD/WoW/MoM table cells wired to rule results
- Setup panel highlights for mapped setup fields (`min_sent`, workspace id, BI setup, Auto-LI key)

### 8.2 Explainability

- Tooltip/popover per highlighted cell includes rule name, value, message, source sheet/range
- Drawer groups matched results into:
  - `Operational issues`
  - `Setup gaps`

### 8.3 Filters

Health filter (highest severity across any surface for the client):

- `all`
- `warning`
- `danger`
- `critical`
- `healthy`

`healthy` includes rows with no non-positive severity (`none`/`good`/`info`).

---

## 9. Admin no-code builder

Location: `SettingsPage` (`/admin/settings`, admin/super_admin only).

Capabilities in current build:

- Rule list with search + surface filter + enabled-state filter
- Quick enable/disable
- Quick priority edit
- Full editor with:
  - metadata fields (`key`, `name`, `surface`, `metricKey`, `applyTo`, `scope`, source metadata)
  - branch CRUD
  - recursive `all`/`any` tree builder
  - comparison node builder (left/right refs, op, transform, multiplier)
  - base filter editor
  - JSON preview
- Validation before save (`conditions/validation.ts`)
- CRUD operations via `useCoreData()` and repository

Manager/client roles:

- No builder controls
- Manager only consumes rule-driven highlights on Clients surfaces

---

## 10. Known legacy quirks

Preserved for parity and documented in rule notes:

- WoW total response rate: `<0.10%` treated as green
- WoW human response rate: `<0.10%` treated as green
- WoW OOO rate: `<0.10%` treated as green

Rationale:

- Legacy sheet likely used these branches to avoid flagging very-low-volume or blank rows.
- Future improvement path: add minimum-volume guards before applying danger/warning thresholds.

---

## 11. Testing coverage

Tests added under:

- `src/app/lib/conditions/__tests__/evaluator.test.ts`
- `src/app/lib/conditions/__tests__/business-rules.test.ts`
- `src/app/lib/conditions/__tests__/client-condition-context.test.ts`
- `src/app/pages/__tests__/clients-conditions.test.tsx`
- `src/app/pages/__tests__/settings-conditions-builder.test.tsx`

Coverage includes:

- DSL operators, nested groups, multipliers, transforms, null handling
- Severity and priority resolution
- Core seeded business-rule scenarios
- Client context mapping fidelity
- ClientsPage visual behavior (danger/healthy/DoD cases)
- Admin settings builder visibility + CRUD/validation flow

