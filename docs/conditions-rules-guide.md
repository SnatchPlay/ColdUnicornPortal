# Conditions Rules — Power-User Guide

This guide explains the **Conditions Engine** in Settings — the surface for authoring cell colorization, badges, and alerts on the Clients page.

It is available to **`master_admin` and `super_admin`**. Master admin sees the visual builder only; super admin additionally has a **Raw JSON** tab for advanced shapes the visual builder can't represent.

If you just need to set yellow/red thresholds on a built-in metric, the older [`Simple triggers`](master-admin-guide.md#3-setting-up-warnings-simple-triggers) card still works and covers ~80% of cases. Both Simple triggers and the visual builder write to the same underlying `condition_rules` table.

**Storage:** `public.condition_rules` table. One row = one rule.
**Evaluation:** [src/app/lib/conditions/evaluator.ts](../src/app/lib/conditions/evaluator.ts) — runs client-side over the loaded snapshot every time the Clients page renders.
**Catalog:** [src/app/lib/conditions/metric-catalog.ts](../src/app/lib/conditions/metric-catalog.ts) — the code-level registry of every selectable metric (built-in + auto-generated from `client_custom_fields`).

---

## 1. Mental model

A **rule** answers one question: *"for this metric on this surface, what severity should each row/cell get?"*

The engine evaluates rules in priority order. For each rule, it walks the `branches` array top-down. The first branch whose `when` condition matches wins, and its `severity` + `label` + `message` are attached to the target row/cell.

If no branch matches, the rule produces no result (the cell stays neutral). Multiple rules can target the same surface — the engine merges results and the **highest severity** wins per cell.

The **visual builder** is a constrained editor over the same JSON the engine consumes. It only produces shapes that:

- target one metric from the **catalog** (built-in or custom-field),
- use flat AND/OR groupings (one level, no nesting),
- apply at `cell` / `row` / `badge` level (not `clients_dod`),
- optionally include the "Only active clients" base filter.

Anything outside that shape opens in **Raw JSON** mode for super_admin (or read-only for master_admin).

---

## 2. The visual builder

Open Settings → Conditions Engine → New rule (or pick an existing one). The form has four sections.

### 2.1 What to watch

One dropdown, grouped by surface and with a "Custom columns" group at the bottom. Picking a metric sets `surface`, `metric_key`, `column_key`, `apply_to = cell`, and `target_entity = client` in one move. There is no separate "Surface" or "Metric key" field — the catalog enforces consistency.

Custom columns added by master_admin via Settings → Clients table customization appear automatically in this dropdown.

### 2.2 Scope

- **Apply to** — `All clients`, `One specific client`, or `One specific manager`.
- Client/manager pickers list real records, sorted A–Z.
- **Only apply to active clients** checkbox — writes the standard `client.status = 'Active'` base filter under the hood.

### 2.3 Severity bands (= `branches`)

One row per band. Each band has:

- **Severity chip** — `Good`, `Info`, `Warning`, `Danger`, or `Critical`. The chip preview uses the same colour the cell will end up.
- **Condition row** — `When` + operator (filtered by metric value type) + a "compare to" toggle (for numeric metrics) + value input that adapts to the type:
  - `number` / `percent` → numeric input. `between` → two inputs. For numeric metrics, a second mode is available: **compare against another metric** with an optional multiplier (`MQLs < KPI Leads × 0.8`). Toggle the dropdown between "a fixed value" and "another metric".
  - `boolean` → "Yes / checked" / "No / unchecked" toggle.
  - `enum` (e.g. droplist custom column) → value `Select`. `in`/`not_in` → multi-select chips.
  - `text` → text input (the one place free text is intentional — it's literal content).
- **+ Add condition** turns the band into a flat `ALL of` / `ANY of` group. The toggle on top of the band switches between AND and OR. One level only; no deeper nesting.
- **Short label** + **Tooltip message** — content shown on hover.
- **↑ / ↓** to reorder bands. Bands are checked top-to-bottom; first match wins.

### 2.4 Rule details

- **Rule name** — human label.
- **Rule key** — stable identifier. Auto-generated for new rules (e.g. `wow-bounce-rate`); super_admin can edit, master_admin cannot.
- **Enabled** checkbox.

`priority` defaults to 100 and is exposed only in Raw mode.

---

## 3. Raw JSON mode (super_admin)

The `Raw JSON` tab shows the rule as `condition_rules` JSON. Edit and tab out — on blur, the JSON is parsed and validated. Use it for:

- Deep `all` / `any` nesting (e.g. `(A AND B) OR C`).
- Surfaces the visual builder doesn't support (all DoD cells use a dynamic `dod:{bucket}:{kind}` column key, where `kind` is `schedule` / `sent` / `aimfox_schedule` / `aimfox_sent` — author DoD rules here).
- Metric paths not in the catalog (rare; usually means the catalog needs an entry).
- Reading the underlying shape for debugging.

When an existing rule's shape can't be represented in the visual builder, opening it automatically lands on the Raw tab with a banner. Master admin sees such rules read-only.

The JSON schema:

```ts
interface ConditionRule {
  id: string;
  key: string;
  name: string;
  description: string | null;

  targetEntity: "client" | "campaign" | "lead";
  surface: string;
  metricKey: string;

  sourceSheet: string | null;
  sourceRange: string | null;

  scopeType: "global" | "client" | "manager";
  clientId: string | null;
  managerId: string | null;

  applyTo: "cell" | "row" | "badge" | "section";
  columnKey: string | null;

  branches: Array<{
    severity: "good" | "info" | "warning" | "danger" | "critical_over";
    when: ConditionNode;
    label: string;
    message: string;
  }>;
  baseFilter: ConditionNode | null;

  priority: number;
  enabled: boolean;
  notes: string | null;
}
```

`ConditionNode` is either a comparison (`{ left, op, right? }`) or a group (`{ all: [...] }` / `{ any: [...] }`).

---

## 4. Operators

| Op | Meaning | Right side |
|----|---------|------------|
| `eq` / `neq` | equals / not equals | scalar |
| `gt` / `gte` / `lt` / `lte` | numeric compare | numeric scalar |
| `between` | `low <= x <= high` | `{ value: [low, high] }` |
| `is_blank` / `not_blank` | null/empty checks | (no right) |
| `starts_with` / `not_starts_with` | string prefix | string scalar |
| `in` / `not_in` | membership | `{ value: [...] }` |

**Value refs** (`left` / `right`) can take:

- `{ "value": <literal> }` — fixed value.
- `{ "metric": "<path>" }` — read from the row context.
- `{ "metric": "...", "multiplier": 0.8 }` — read and scale ("80% of contracted").
- `{ "metric": "...", "transform": "lower" | "upper" | "trim" | "abs" | "round" }`.

---

## 5. The catalog & surfaces

The visual builder only offers metrics in [`metric-catalog.ts`](../src/app/lib/conditions/metric-catalog.ts). Each entry binds together:

- the `path` resolved at runtime by `getMetricValue` in evaluator.ts,
- the `columnKey` that mega-table matches when colouring a cell,
- the operator presets the builder offers,
- for enums, the allowed option list.

Surfaces and their built-in metrics:

| `surface` | What it colours | Catalog group |
|-----------|-----------------|---------------|
| `clients_overview` | Overview columns: Client, Manager, Status, Inboxes, Signed, Added, Min sent, KPI Leads, KPI Meetings, Won, LinkedIn acceptance rate, LinkedIn remaining database. **Custom columns also live here.** | Basic, KPI, Client, Custom columns |
| `clients_3dod` | The "3-Day rolling" columns. | 3-Day rolling |
| `clients_wow` | "Week over Week" columns. | Week over Week |
| `clients_mom` | "Month over Month" columns. | Month over Month |
| `clients_setup` | Setup-status badges. | Setup |
| `clients_dod` | The email DoD cells (Schedule + Daily sent). **Raw mode only** — dynamic column keys. | (not exposed in builder) |
| `clients_dod_aimfox_schedule` | The Schedule (LinkedIn) cells. **Raw mode only.** | (not exposed in builder) |
| `clients_dod_aimfox_sent` | The Daily sent (LinkedIn) cells. **Raw mode only.** | (not exposed in builder) |

The two LinkedIn DoD surfaces are separate on purpose: their targets are absolute floors that have
nothing to do with each other, or with the email bands' `min_sent`. Both seeded rules gate on
`linkedin_connected` — see
[14-condition-rules §7.4](reference/functional/14-condition-rules.md#74-linkedin-dod-floors-20260819_aimfox_dod_colour_rulessql).

To add a new built-in metric: edit `metric-catalog.ts`, add an entry, run the type-check.

---

## 6. Custom columns (master-admin)

When master_admin adds a custom column (text / checkbox / droplist) in Settings → Clients table customization, it shows up automatically in the rule builder's metric dropdown under "Custom columns". You can colour the cell, write tooltip messages, and use the same operators that fit the field's type:

| Custom-field type | Value type | Operators offered | Right-side input |
|-------------------|-----------|-------------------|------------------|
| `text` | `text` | `is_blank, not_blank, starts_with, eq, neq` | text input |
| `checkbox` | `boolean` | `eq, neq` | Yes / No toggle |
| `droplist` | `enum` | `eq, neq, in, not_in, is_blank, not_blank` | option dropdown / multi-select |

Custom-field values are loaded into the context as `custom.<fieldId>` and colour the column whose id is `cf:<fieldId>` (handled automatically; you don't see these strings in the builder).

---

## 7. Worked examples

### 7.1 Below contracted daily sent volume

Pick metric **"Min daily sent"** → Scope: All clients, Only active clients ✓. Two bands:
1. Severity = `Danger`, **When** `is less than` `200`. Message: "Sent volume is below 200/day."
2. Severity = `Warning`, **When** `is less than` `500`. Message: "Sent volume is below 500/day."

### 7.2 Bounce or complaint too high (flat OR)

Pick metric **"WoW Bounce rate"**. Add a second condition (toggle ALL → ANY). First condition: `is at least` `0.02`. Second condition (via "+ Add condition", different metric not yet supported in flat form — for multi-metric use raw mode).

### 7.3 Trial ends soon (custom column)

Master admin added a text column "Trial ends" with values like `"2026-06-01"`. Pick metric **"Trial ends"** (under Custom columns) → operator `starts with` → value `2026-06`. Cell turns yellow for any client whose trial-ends date is in June 2026.

### 7.4 Setup stage check (droplist)

Master admin added a droplist "Setup stage" with options `Active / Paused / At risk / Lost`. Pick metric **"Setup stage"** → operator `is one of` → tick `At risk` and `Lost` → severity `Danger`. Both troubled stages turn the cell red.

**Colouring "nothing chosen yet".** Pick the droplist metric → operator **`is empty`** → severity
`Danger`. Put that branch **last**, because branches evaluate top to bottom and the first match wins.
This is how the live `Setup` rule paints an unfilled cell red. Resist the tempting alternative
(`is none of` with every option ticked): it silently turns red the day someone adds a new option to
the droplist. See [14-condition-rules §Setup](reference/functional/14-condition-rules.md).

---

## 8. Common gotchas

- **Rule does nothing.** Check `enabled`. Check scope. The most common cause used to be a typo in `metric_key` — the visual builder makes this impossible, but check that the catalog entry exists if the rule was authored in raw mode.
- **Wrong cell coloured.** The catalog binds metric→columnKey 1:1. If you want a different column, pick a different metric.
- **Severity not showing up.** Another rule on the same cell may be returning a higher severity. Highest severity wins; priority is only a tiebreaker.
- **`null` vs `undefined`.** `is_blank` treats both the same. Numeric comparisons against a missing value return null and the branch does not match — it does not implicitly equal zero.
- **Don't reuse the `simple_trigger:` key prefix.** That namespace is owned by the Simple-triggers UI; the builder warns if you try.

---

## 9. Operational notes

- Rules are read once per snapshot load. Not realtime.
- Evaluation is client-side. The engine only colours UI; underlying data is unchanged.
- RLS on `public.condition_rules`: select for any internal admin; write for `super_admin` and `master_admin` via `is_admin_user()`.
- No DB migration needed when the catalog gains a new built-in entry — it's a code-level change.
- New custom columns added at runtime appear in the catalog immediately (next snapshot refresh).

References:
- Types — [src/app/lib/conditions/types.ts](../src/app/lib/conditions/types.ts)
- Catalog — [src/app/lib/conditions/metric-catalog.ts](../src/app/lib/conditions/metric-catalog.ts)
- Validator — [src/app/lib/conditions/validation.ts](../src/app/lib/conditions/validation.ts)
- Evaluator — [src/app/lib/conditions/evaluator.ts](../src/app/lib/conditions/evaluator.ts)
- Builder UI — [src/app/pages/settings/condition-rule-builder.tsx](../src/app/pages/settings/condition-rule-builder.tsx)
- Schema migration — [supabase/migrations/20260428_condition_rules_engine.sql](../supabase/migrations/20260428_condition_rules_engine.sql)
