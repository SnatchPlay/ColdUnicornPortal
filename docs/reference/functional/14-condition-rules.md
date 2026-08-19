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
- It drives **per-cell** highlighting + tooltips in `ClientsPage`. As of
  `20260717_client_satisfaction_and_status_rename.sql` it no longer produces a row-level health
  rollup, a `healthScore`, or a health filter — those were replaced by the manual satisfaction
  rating (`clients.satisfaction`; see [06-manager-portal §2.7](./06-manager-portal.md)).
- It does not mutate ingestion counters or trigger external side effects.

Hard boundaries:

- No `eval` / Function constructor / executable formulas.
- No writes to ingestion-only tables (`replies`, `campaign_daily_stats`, `daily_stats`).
- No Bison direct calls from the portal.
- No notification dispatch from the portal.

This capability is **not** the legacy biweekly Health Assessment form. It is a runtime health layer over existing metrics.

---

## 2. End-to-end flow

```txt
raw Supabase snapshot
> createClientMetrics() + client condition context
> evaluate safe JSON DSL rules
> condition results
> per-cell styles + tooltip explanations (no row rollup / no health filter — see §1)
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
- `auto_li_api_key` < aimfox `client_sequencers.api_key` (was `clients.linkedin_api_key`; ADR-0012)
- `client.external_workspace_id` / `client.external_api_key` / `client.linkedin_api_key` metric paths < emailbison/aimfox `client_sequencers` rows (ADR-0012) — the path names are kept for live-rule compatibility (`spreadsheet_or_workspace_ids_present` reads `client.external_workspace_id`)
- `aimfox_accept_rate` < `ClientMetricsOverview.aimfoxAcceptRate` — accepted / sent over ACTIVE
  Aimfox campaigns, as a 0..1 fraction. `null` when there is no active campaign or nothing sent.
- `aimfox_remaining_db` < `ClientMetricsOverview.aimfoxActiveRemainingDb` — loaded audience minus
  invites sent, over the same campaigns. `null` under the same conditions.
- `bi_setup` < `clients.bi_setup_done` (context key retained; the **Bi column was removed** from the
  grid and the drawer, so `bi_setup_required` is now seeded disabled and the metric is no longer
  offered in the guided builder)

Per-cell sibling keys (only present while a cell is being coloured, see
[client-condition-results.ts](../../../src/app/lib/conditions/client-condition-results.ts)):

- `cell.bucket`, `cell.total_leads`, `cell.sql_leads` < the 3-DoD row of the bucket under
  evaluation. Use these — **not** `three_dod_total` / `three_dod_sql`, which are the row-level
  3-day rolling sums and are identical for all five buckets.

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
- `auto_li_api_key_present`
- `setup_type_colour` (added by `20260714_pdca_cell_colour_rules.sql`)
- `aimfox_accept_rate` (added by `20260819c_aimfox_capacity_colour_rules.sql`)
- `aimfox_remaining_db` (added by `20260819c_aimfox_capacity_colour_rules.sql`)

### 7.2 Disabled (with notes)

- `mom_won_vs_won_kpi` (missing `monthly_won_kpi` source)
- `report_or_folder_link_present`
- `folder_link_present`
- `issues_ok`
- `checkbox_true_green`
- `bp_text_warning` (non-operational legacy formatting)
- `bi_setup_required` (disabled by `20260714_pdca_cell_colour_rules.sql` — the Bi column no longer
  exists, so the rule had no cell to paint)

### 7.3 SQL-vs-KPI cell colouring (`20260714_pdca_cell_colour_rules.sql`)

The 3-DoD / WoW / MoM SQL bands are graded against `monthly_sql_kpi` (= `clients.kpi_leads`,
"KPI LEADS / MONTH" in the client drawer):

| Band | Target per cell | good | warning | danger |
|---|---|---|---|---|
| 3-DoD SQL | KPI / 20 days | ≥ target | 80–99.99% | < 80% |
| WoW SQL | KPI / 4 weeks | ≥ target | 80–99.99% | < 80% |
| MoM SQL | KPI | ≥ target | 80–99.99% | < 80% |

A client with `kpi_leads is null` matches no branch and stays uncoloured.

**Why the comparisons scale the left side.** The branches read `value * 20 >= monthly_sql_kpi`
rather than `value >= monthly_sql_kpi * 0.05`. Multiplying the KPI by `0.04` drifts in IEEE-754
(`100 * 0.04 = 4.000000000000001`), which flips a client sitting exactly on the 80% boundary from
yellow to red. Scaling the integer cell value keeps the boundary exact. Same reason the 2.51x ratio
is written `value * 100 >= cell.sql_leads * 251`.

`three_dod_total_too_high_vs_sql` colours a 3-DoD TOTAL cell **warning** when that day's total leads
are ≥ 2.51x that *same day's* SQL leads (`cell.sql_leads`), and leaves it uncoloured otherwise. Its
`base_filter` (`value > 0`) keeps empty days uncoloured — without it `0 >= 2.51 * 0` would hold.

`setup_type_colour` colours the **Setup** custom droplist. Since migration
`20260814_setup_colour_rules.sql`: `BiS1` / `BiS2` → good (green), `One` → warning (yellow),
**nothing set → danger (red)**. The v1 rule (20260714) left an unset Setup uncoloured, which is
exactly the client somebody needs to see. A value that is neither blank nor one of the three known
options — a fourth setup type someone adds later — is deliberately left **uncoloured**, not red; see
the blockquote below. The field id is environment-specific, so the migration resolves it by name.

> **Why the "nothing set" branch is `is_blank` and not `not_in ["One","BiS1","BiS2"]`.** `not_in`
> works — it is true for `null` / `undefined` / `""` because the candidate list does not contain them
> — but it copies the droplist's option list into the rule body. The day a master_admin adds a fourth
> setup type, every client on it is coloured red for "not chosen". `is_blank` has no such coupling.
>
> The reason `not_in` was tempting is that `ENUM_OPS` ([`metric-catalog.ts`](../../../src/app/lib/conditions/metric-catalog.ts))
> did not offer `is_blank` for droplist metrics, which would have locked the rule into the
> `super_admin`-only Raw JSON tab. That was a gap in a preset list, not a real constraint — the
> builder's `requiresRight` and the validator's `OPERATORS_WITHOUT_RIGHT` already handled
> right-operand-less operators — so the same change widened `ENUM_OPS` with `is_blank` / `not_blank`.
> **Any droplist rule can now say "is empty" from the guided builder.**
>
> Branch order matters: branches evaluate in array order, first match wins, so the two positive
> branches come first and the catch-all is last.


### 7.4 LinkedIn capacity (`20260819c_aimfox_capacity_colour_rules.sql`)

| Cell | metric / column key | good | warning | danger |
|---|---|---|---|---|
| Accept | `aimfox_accept_rate` | ≥ 0.40 | 0.30–0.399 | < 0.30 |
| Rem DB | `aimfox_remaining_db` | ≥ 200 | 100–199 | < 100 |

**Rates are 0..1 fractions.** `0.4`, never `40` — the context carries every rate that way
(`wow_bounce_rate` compares against `0.01`), so a rule written in percent points never fires. This is
the single easiest way to ship these two rules broken.

> **Neither rule has a `base_filter`, and that is the "IF LinkedIn connected" gate.** Both metrics
> are `null` for a client with no active Aimfox campaign, and `compareWithOperator`
> ([evaluator.ts](../../../src/app/lib/conditions/evaluator.ts)) returns `false` for every numeric
> operator when the left operand does not coerce to a number — so those clients match no branch and
> stay uncoloured, with no filter to keep in sync.
>
> Contrast with the DoD LinkedIn rules, which **do** need an explicit filter: their counters come
> through the gateway's `toInt` and arrive as a real `0`, indistinguishable from "connected and idle".
> The difference is where the null survives, not a difference of intent.

A real `0` still colours: a client that has invited its whole audience genuinely has nothing left,
and 0% acceptance on real sends is the worst case there is — both belong in red.

Both metrics are in the guided builder ([metric-catalog.ts](../../../src/app/lib/conditions/metric-catalog.ts),
group **Basic**), so a master_admin can retune the thresholds without the Raw JSON tab.

`mom_meetings_vs_meeting_kpi` is graded the same way against `monthly_meeting_kpi`.

> **Writing a rule for a bucketed surface (`clients_3dod` / `clients_wow` / `clients_mom`): the left
> operand must be `value`.** The per-cell evaluator injects the bucket's own number as `value`;
> the row-level keys (`three_dod_sql`, `wow_sql`, `mom_sql`, `mom_meetings`, `mom_won`) hold rolling
> aggregates and are identical for all five buckets, so a rule reading them paints the whole band
> from the current day/week/month. `mom_won_vs_won_kpi` still has this shape — harmless only because
> `monthly_won_kpi` has no source and stays `null`, so no branch ever matches. Whoever wires up a
> won-KPI source must switch its left operand to `value` first.

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

- Tooltip/popover per highlighted cell includes rule name, value, message, source sheet/range — this
  is now the **only** explainability surface. The drawer's `Operational issues` and `Setup gaps`
  groupings were removed with the row rollup (`20260717_client_satisfaction_and_status_rename.sql`).

### 8.3 Filters

The condition engine no longer drives a client-list filter. The Clients grid filters on the manual
`clients.satisfaction` rating instead (`All` / `♥` / `♥♥` / `♥♥♥` / `Not rated`); see
[06-manager-portal §2.5](./06-manager-portal.md).

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
- CRUD via `repository.createConditionRule` / `updateConditionRule` / `deleteConditionRule`, called directly from the Settings page ([settings-page.tsx:427](../../../src/app/pages/settings-page.tsx#L427), [:431](../../../src/app/pages/settings-page.tsx#L431), [:446](../../../src/app/pages/settings-page.tsx#L446)); rules are read as part of the `loadAdminSettings` payload via `useAdminSettings()` ([`lib/use-settings.ts`](../../../src/app/lib/use-settings.ts)), and `refresh()` re-loads them after each mutation ([ADR-0009](../../adr/0009-per-page-data-contracts.md))

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
- `src/app/lib/conditions/__tests__/aimfox-capacity-rules.test.ts`

Coverage includes:

- DSL operators, nested groups, multipliers, transforms, null handling
- Severity and priority resolution
- Core seeded business-rule scenarios
- Client context mapping fidelity
- ClientsPage visual behavior (danger/healthy/DoD cases)
- Admin settings builder visibility + CRUD/validation flow
- LinkedIn capacity boundaries (0.40 / 0.399, 0.30 / 0.299, 200 / 199, 100 / 99) and the
  null-means-uncoloured contract that stands in for a base filter

