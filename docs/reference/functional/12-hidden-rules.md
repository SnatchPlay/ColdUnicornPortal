# 12 В· Hidden Rules & Constants

Non-obvious branches, magic numbers, and implicit business rules that live inside the code. Without this file you would have to re-derive them by reading the source. They are listed here so they can be discovered, audited, and changed deliberately.

## Contents

1. [Magic numbers](#1-magic-numbers)
2. [Implicit business rules](#2-implicit-business-rules)
3. [Naming traps](#3-naming-traps)
4. [Mutation semantics](#4-mutation-semantics)
5. [Auth error codes](#5-auth-error-codes)
6. [Browser persistence keys](#6-browser-persistence-keys)
7. [Bucket orderings](#7-bucket-orderings)

---

## 1. Magic numbers

| Constant | Value | Where | Effect |
|----------|-------|-------|--------|
| `CAMPAIGN_DAILY_STATS_WINDOW_DAYS` | **90** | [repository.ts:29](../../../src/app/data/repository.ts#L29) | Snapshot loader caps `campaign_daily_stats` to last 90 days. |
| `DAILY_STATS_WINDOW_DAYS` | **180** | [repository.ts:30](../../../src/app/data/repository.ts#L30) | Snapshot loader caps `daily_stats` to last 180 days; skipped entirely for client role. |
| `SNAPSHOT_RETRY_DELAYS_MS` | `[250, 600]` | [repository.ts:23](../../../src/app/data/repository.ts#L23) | Up to two retries of failing SELECTs (`network` / `timeout` only). |
| Session refresh threshold | **60 s** before `expires_at` | [repository.ts:198](../../../src/app/data/repository.ts#L198) | Forces `auth.refreshSession()` if the access token is within 60 s of expiry. |
| `PAGE_SIZE` (lazy load) | **50** | leads-page, client-leads-page, clients-page, campaigns-page | "Load more" increments by 50 rows. Resets on filter / search change. |
| Admin dashboard "campaign momentum" window | **21 days** | `admin-dashboard-page.tsx` and `admin_dashboard_daily` view | Hard-coded 21 days for each momentum chart (sent/replies/positive) and the view. |
| Manager dashboard "campaign watchlist" reply-rate threshold | **< 1 %** | [manager-dashboard-page.tsx:108-127](../../../src/app/pages/manager-dashboard-page.tsx#L108-L127) | Active campaigns below 1% reply rate land on the watchlist alongside `stopped` / `launching` campaigns. |
| Watchlist slice | **8 campaigns** | manager-dashboard-page | Sorted by reply rate ascending, top 8 alerts shown. |
| Manager-capacity surface slice | **8 managers** | [admin-dashboard-page.tsx:127](../../../src/app/pages/admin-dashboard-page.tsx#L127) | Top 8 by client count; rest hidden. |
| Lead queue slice | **10 leads** | manager-dashboard-page | Most recently updated leads. |
| Campaign-performance "top" slices | **6 / 8 / 10** | client-dashboard-page (top 6 with color threshold), client-statistics-page (top 8), client-campaigns-page (top 10 sent) | Sorted by reply rate / sent and sliced. |
| Reply-rate color threshold (client dashboard list) | **в‰Ґ 5 %** green, otherwise yellow | client-dashboard-page | Visual cue for "healthy" campaign on the conversion-funnel companion list. |
| KPI sparkline windows | **6 weeks** for MQLs / Meetings / Won; **7 days** for Sent; **7 months** for Prospects | client-dashboard-page (`Sparkline` component) | Different windows because the underlying source has different granularity. |
| Default timeframe | **30 days** (`createDefaultTimeframe()`) | [timeframe.ts](../../../src/app/lib/timeframe.ts) | Loaded into pages on first render. |
| `today` normalisation | **noon** local | [client-metrics.ts:249-250](../../../src/app/lib/client-metrics.ts#L249-L250) | Avoids DST boundary issues when bucketing days. |
| Condition severity rank | `critical_over > danger > warning > info > good` | `src/app/lib/conditions/types.ts`, `evaluator.ts` | Highest rank wins visual precedence; lower `priority` breaks ties. |
| Sequencer catalog UUIDs (ADR-0012) | smartlead `00000000-0000-4000-a000-000000000001`, emailbison `…-0002`, aimfox `…-0003` | `20260704_sequencers_catalog.sql`, `supabase/drizzle/schema.ts` (campaigns default) | **Load-bearing** — they are the column DEFAULTs on `campaigns.sequencer_id` / `leads.sequencer_id` and the constants n8n hardcodes. Never change. |
| `sequencer_id` default | **EmailBison** (`…-0002`) | `campaigns` / `leads` DDL | Inserts that omit `sequencer_id` attribute to EmailBison — all pre-2026-07-04 rows were backfilled this way. Aimfox flows must set it explicitly. |
| `sequencer_daily_stats.profile_id` sentinel | `''` (empty string, NOT NULL) | `20260704_sequencers_catalog.sql` | Means "account-level rollup"; kept non-null so the UNIQUE(client, sequencer, profile, date) key stays honest. |
| `invite_limit` vs `invite_limit_remaining` | weekly cap vs left-today | `sequencer_daily_stats` | `invite_limit` = Σ Aimfox accounts' `limit.connect` (≈195/account, weekly); `invite_limit_remaining` = what n8n says is left today. The legacy sheet's "Invitations limit" column held the REMAINING value — do not conflate. |
| Aimfox `daily_limit` divisor | **5** working days | n8n "Get Metrics from Aimfox" + `schedule_*` column comments | `daily_limit = invite_limit / 5`; feeds the `schedule_today/tomorrow/day_after` min() formulas. |
| `public_lead_stats()` window anchor | **UTC midnight** | [`20260721_public_lead_stats_rpc.sql`](../../../supabase/migrations/20260721_public_lead_stats_rpc.sql) | Not the browser's timezone and not Europe/London — matches `isoDaysAgo()` in the gateway. `yesterday` is the previous whole UTC day, half-open. |
| `public_lead_stats()` rolling windows | **7 / 30 / 90** days | same migration | Marketing-site counters. Each is `created_at >= midnight - Nd`, so it covers N whole days **plus today so far** — the public number rises during the day and is not comparable to a "last N complete days" figure. |

---

## 2. Implicit business rules

### `master_admin` role is seeded manually (no UI)

There is no invitation flow for `master_admin`. The role is granted by a one-time SQL update against `public.users.role`:

```sql
update public.users set role = 'master_admin' where email = 'lukasz@coldunicorn.com';
```

Run this once after the `20260520_master_admin_role.sql` migration applies. Any future promotion (or demotion away from `master_admin`) follows the same manual path — the `Role` select in the invitations UI deliberately does not list `master_admin` or `super_admin`. See [ADR-0005](../../adr/0005-master-admin-role.md).

### Custom-column condition metrics use `custom.<fieldId>` path and `cf:<fieldId>` column key

Master-admin custom columns (`client_custom_fields`) are colourable by condition rules. The evaluation context exposes their per-client values as `context.custom[<fieldId>]` (raw text — checkbox stored as `"true"`/`"false"`). The mega-table column for a custom field carries `conditionKey: "cf:<fieldId>"` so a rule with `surface: 'clients_overview'`, `apply_to: 'cell'`, `column_key: 'cf:<fieldId>'` paints the cell. The metric catalog at [src/app/lib/conditions/metric-catalog.ts](../../../src/app/lib/conditions/metric-catalog.ts) generates these entries at runtime from `clientCustomFields` so they appear automatically in the visual rule builder.

### Custom-column sorting is resolved in the page comparator, not the column's `sortValue`

Custom columns (`cf:<fieldId>`) are built dynamically and are **not** in the static `MEGA_COLUMNS` array. `compareMega` in [clients-page.tsx](../../../src/app/pages/clients-page.tsx) special-cases `sort.key.startsWith("cf:")` and resolves the sort value from the field definition + stored values via [`getCustomFieldSortValue`](../../../src/app/lib/custom-field-sort.ts). Before this (migration `20260618`/3G), sorting a custom column was a silent no-op because the comparator only searched `MEGA_COLUMNS`. Per-type rules: **number/currency** → parsed amount (currency strips `zł`/`zl`/`PLN`/`€`/`EUR`/`$`/`USD`/`£`/`GBP` and space/comma grouping; dot-only thousands like `12.000` is read as a decimal — the safe default for client inputs that use spaces/commas); **droplist** → option index (configured order, not alphabetical); **checkbox** → 1/0; **text/link** → normalized lowercase with `localeCompare(numeric:true, sensitivity:"base")`. Empty/unparseable → `null`, which the comparator always sorts **last** (both directions). Parsing is applied **only** to number/currency fields — a text column is never coerced.

### `client_table_column_overrides.column_key` carries three synthetic namespaces

`column_key` is free text (PK). It is used for three kinds of override on the Clients mega-table, all stored in the same row shape (`label_override` / `hidden` / `position`):

- **Built-in column** → the column `id` (e.g. `name`, `dod-sched-+2`, `mom-won-0`).
- **Custom field column** → `cf:<fieldId>`.
- **Section band name** → `section:<original sub name>` (e.g. `section:Daily sent`). Only `label_override` is meaningful here; `hidden`/`position` are ignored. In [mega-table.tsx](../../../src/app/pages/clients-page/mega-table.tsx) every built-in/custom column whose `sub` matches the original name is rewritten to the override, so the band stays contiguous in the boundary/segment logic.
- **Per-column section reassignment** → `colsection:<column id>` (e.g. `colsection:inboxes`, `colsection:cf:<fieldId>`). `label_override` holds the target section's *original* name; `applySectionAssignment` rewrites that column's `sub` and `group` (via `SECTION_TO_GROUP`) so it renders under the chosen band. This is label-only: the column keeps its position, so the master admin must also reorder it adjacent to that section or the band splits. Applied *before* the `section:*` rename pass, so a reassigned column also picks up that section's display rename.
- **Master-admin-created sections** → a single row keyed `sections:custom`, with `label_override` holding a **JSON array** of the invented section names. This is purely a settings-side registry so created sections appear in the Section dropdown and rename list; mega-table never reads it. A created section only materialises as a band once a column carries a matching `colsection:<id>`. `SECTION_TO_GROUP` has no entry for a custom section, so reassigned columns keep their own `group` (the thick group separators may not align — acceptable for a manual band). Deleting a custom section (in settings) clears the columns' `colsection` rows, drops its `section:<name>` rename, then rewrites the `sections:custom` array.

`setColumnOrder` only touches reordered keys, so the caller must re-merge untouched overrides (notably `section:*`) into its local state after the optimistic update and after the server response — otherwise they vanish on a reorder. This re-merge now lives in the settings page/`useAdminSettings` state rather than in a global provider.

### `private.is_internal_user()` and `public.is_internal_user()` must stay in lockstep

Two SECURITY DEFINER helpers exist with the same name in different schemas. RLS policies on `public.users` (`users_select_internal`) and `public.email_exclude_list` (`email_exclude_list_select_internal`) call **`private.is_internal_user()`**, while several view-models and skill calls use `public.is_internal_user()`. When the `master_admin` role was introduced, migration `20260520_master_admin_rls.sql` patched `public.is_internal_user`, `private.is_admin_user`, `public.is_admin_user`, and `private.can_access_client` — but missed `private.is_internal_user`. The result: `master_admin` could not read other users via the snapshot (Statistics "By manager" showed "Unknown manager" rows) and could not read the email exclude list. Fixed in `20260526_master_admin_private_is_internal_user.sql`. **Rule:** any time the internal-roles set changes, update **both** helpers in the same migration.

### Conditions Engine is open to master_admin (Raw mode stays super_admin-only)

`canManageConditionRules` in [src/app/pages/settings-page.tsx](../../../src/app/pages/settings-page.tsx) now returns true for both `super_admin` and `master_admin`. The visual builder is identical for both; only super_admin sees the **Raw JSON** tab. Rules whose JSON shape cannot be represented in the visual builder open in the Raw tab automatically (for super_admin) or show read-only (for master_admin).

### Blacklist is hidden from nav but routable

`/admin/blacklist` and `/manager/blacklist` are still mounted in [App.tsx](../../../src/app/App.tsx), but the Blacklist entry is removed from `ADMIN_NAV` and the manager nav in [app-shell.tsx](../../../src/app/components/app-shell.tsx). Direct URLs still work for emergency edits; the surface is just not advertised.

### "Lead in progress"

[manager-dashboard-page.tsx:50](../../../src/app/pages/manager-dashboard-page.tsx#L50) вЂ” Counts as "in progress" when both `won === false` AND `offer_sent === false`. Note: leads with `qualification = 'rejected'` or `'OOO'` still pass this test as long as those two booleans are false. This is intentional вЂ” they remain "in the funnel" until explicitly moved to a terminal state.

### KPI progress fallback

[clients-page.tsx:269](../../../src/app/pages/clients-page.tsx#L269) вЂ” When `client.kpi_leads === 0` (no contracted target), per-client KPI progress shows "n/a" rather than dividing by zero.

### `getLeadStage` precedence

[selectors.ts:70-77](../../../src/app/lib/selectors.ts#L70-L77) вЂ” Top-down precedence: `won в†’ offer_sent в†’ meeting_held в†’ meeting_scheduled в†’ unqualified в†’ qualification`. A lead with `won = true` AND `qualification = 'preMQL'` displays as "won". This is the **display** stage and does not validate that the underlying booleans agree (see invariants in [BUSINESS_LOGIC В§5.1](../../BUSINESS_LOGIC.md#51-lead)).

### `qualification` case sensitivity in DoD/3-DoD/WoW/MoM

[client-metrics.ts:191](../../../src/app/lib/client-metrics.ts#L191) вЂ” `lead.qualification?.toLowerCase()` is compared to lowercase literals (`"mql"`, `"premql"`). The stored enum values are `MQL` / `preMQL`; the comparison is therefore case-insensitive. Don't introduce mixed-case enum values without updating this branch.

### 3-DoD threeDodTotal includes both preMQL and MQL

[client-metrics.ts:195-202](../../../src/app/lib/client-metrics.ts#L195-L202) вЂ” `threeDodTotal` increments for `qualification в€€ {preMQL, MQL}`; `sql` (= MQL leads) increments only for `MQL`. A lead at preMQL counts toward the "total" bucket but not toward the "SQL" bucket вЂ” by design.

### Reply scope filter on lead pages

[leads-page.tsx:152-153](../../../src/app/pages/leads-page.tsx#L152-L153), [client-leads-page.tsx](../../../src/app/pages/client-leads-page.tsx) вЂ” Filters **leads by `qualification`**:

- `replyScope === "ooo"` в†’ `qualification === "OOO"`.
- `replyScope === "active"` в†’ `qualification !== "OOO"`.
- `replyScope === "all"` в†’ no filter.

It does **not** filter replies by `replies.classification`. The label is misleading; rename tracked as BL-7.

### CSV export filename

[client-leads-page.tsx:152-188](../../../src/app/pages/client-leads-page.tsx#L152-L188) вЂ” `client-leads-{timeframe-label}.csv` with the timeframe label lowercased and spaces replaced by dashes (e.g. `client-leads-last-30-days.csv`). Quotes inside cells are escaped with `""`.

### Profile name split

[auth.tsx:324-362](../../../src/app/providers/auth.tsx#L324-L362) вЂ” Splits on the **first** space: `"Jan Maria Kowalski"` в†’ `first_name = "Jan"`, `last_name = "Maria Kowalski"`. Preserves multi-word last names but discards the option of a multi-word first name.

### Domain validation regex (blacklist)

[blacklist-page.tsx:11-13](../../../src/app/pages/blacklist-page.tsx#L11-L13):

```
/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
```

Requires a TLD of at least two letters. Domain is normalised with `trim().toLowerCase()` before submission. Internationalised TLDs (e.g. `.co.uk`, punycode) work because the regex accepts repeated subdomains, but you should sanity-check before adding edge-case TLDs.

### Statistics page: campaign filter auto-reset

[statistics-page.tsx:61-66](../../../src/app/pages/statistics-page.tsx#L61-L66) вЂ” When the user changes the client filter and the previously-selected campaign no longer belongs to a visible client, `campaignFilterId` is reset to `ALL_FILTER_VALUE`. Avoids "selected but invisible" states.

### Condition evaluator `value` fallback

`evaluateConditionRules()` injects `context.value = context[rule.metricKey]` when `value` is not already present. This keeps rules written against `left.metric = "value"` reusable across surfaces without hardcoding column-specific branches.

### DoD dynamic condition cell keys

DoD condition evaluation uses generated keys `dod:{bucket}:{schedule|sent}` and injects runtime `value` per cell. One rule (`dod_sent_or_schedule_vs_min_sent`) can therefore evaluate all DoD schedule/sent cells.

### Legacy low-rate green branches (WoW)

Three seeded WoW rules intentionally keep a legacy green branch for very low rates:

- total response `< 0.10%`
- human response `< 0.10%`
- OOO `< 0.10%`

These branches are preserved for parity and documented in rule `notes` pending minimum-volume guard design.

### Condition rules are never fetched for the client role

There is no longer an explicit role check: condition rules only travel inside the two gateway payloads that clients never request — `loadClientsOverview` (Clients page, [orm-gateway/index.ts:1372](../../../supabase/functions/orm-gateway/index.ts#L1372)) and `loadAdminSettings` (Settings, [index.ts:2217](../../../supabase/functions/orm-gateway/index.ts#L2217)). Both routes are internal-only, so the client role never triggers the RLS denial the old provider-level skip existed to avoid. The standalone `repository.loadConditionRules()` action still exists ([repository.ts:788](../../../src/app/data/repository.ts#L788)) but no page calls it — if a client-visible page ever does, the denial returns.
### Auth state-change debounce

[auth.tsx:238](../../../src/app/providers/auth.tsx#L238) вЂ” `window.setTimeout(..., 0)` defers the auth-state listener so multiple Supabase events (TOKEN_REFRESHED + USER_UPDATED) within the same tick batch into one identity reload.

---

## 3. Naming traps

| Term | Misleading because | Reality |
|------|--------------------|---------|
| **"SQL Leads"** (DoD/WoW/MoM) | Sounds like a separate "Sales Qualified" stage | Same as MQL count. Historical naming. |
| **"Reply scope filter"** (leads pages) | Sounds like it filters replies | Filters leads by `qualification = 'OOO'`. Rename pending (BL-7). |
| **`positive_responses`** (campaign drawer) vs `positive_replies_count` (daily stats) | Look like the same metric | The drawer field is a manually curated lifetime counter; the daily-stats column is ingestion-derived per day. They can diverge intentionally. |
| **`meeting_booked`** vs **`meeting_held`** | Often used interchangeably in conversation | Two separate booleans. Some metrics use one, some the other. |
| **`getClientKpis().mqls`** | Looks like a stage count | `count(qualification === 'MQL')` вЂ” uses the raw qualification, not `getLeadStage`. Differs from "MQL stage count" once a lead progresses past MQL. |
| **`leads.source`** vs **`leads.sequencer_id`** | Both sound like "which tool sent this" | `source` is free-text channel provenance (`'cold_email'`, gateway fallback `"smartlead"`); `sequencer_id` is the FK attribution (ADR-0012). Do not unify them. |

---

## 4. Mutation semantics

[09-mutations-rls.md В§5](./09-mutations-rls.md#5-optimistic-updates--rollback) describes the pattern; this table summarises which mutations are optimistic vs fire-and-forget.

| Operation | Style | Notes |
|-----------|-------|-------|
| `updateClient` | Optimistic + rollback | Drawer Save in clients-page |
| `updateCampaign` | Optimistic + rollback | Drawer Save in campaigns-page |
| `updateLead` | Optimistic + rollback | Drawer Save in leads-page (internal) |
| `updateDomain` | Optimistic + rollback | Drawer Save in domains-page |
| `updateInvoice` | Optimistic + rollback | Drawer Save in invoices-page |
| `upsertEmailExcludeDomain` | Optimistic + rollback | Add domain in blacklist-page |
| `deleteEmailExcludeDomain` | Optimistic + rollback | Remove domain in blacklist-page |
| `upsertClientUserMapping` | Optimistic + rollback | Used programmatically |
| `deleteClientUserMapping` | Optimistic + rollback | Same |
| `sendInvite` | Fire-and-forget + toast | No snapshot mutation; clears global error on success |
| `listInvites` | Fire-and-forget | Returns promise; consumed by AdminUserManagementPage on mount |
| `resendInvite` | Fire-and-forget + toast | |
| `revokeInvite` | Fire-and-forget + toast | |
| `createConditionRule` | Fire-and-forget + toast on failure | Appends and re-sorts `snapshot.conditionRules` on success |
| `updateConditionRule` | Optimistic + rollback | Replaces row, re-sorts by priority after server ack |
| `deleteConditionRule` | Optimistic + rollback | Removes row immediately; restores on failure |
| `createClient` | Server-confirmed, prepend | No optimistic update; server returns row → prepend to `snapshot.clients` |
| `createCampaign` | Server-confirmed, prepend | Same pattern; prepend to `snapshot.campaigns` |
| `createLead` | Server-confirmed, prepend | Same pattern; prepend to `snapshot.leads`. `source` always `'manual'` |
| `createDomain` | Server-confirmed, prepend | Same pattern; prepend to `snapshot.domains` |

Optimistic updates use the pattern: snapshot replace в†’ repository call в†’ on success replace with server response в†’ on failure restore previous + toast. Mutations are **not auto-retried** even on transient failures.

### Race conditions

Two managers editing the same lead simultaneously: last write wins. There is no version column or `If-Match` semantics. If multi-editor scenarios become common, add `updated_at` optimistic concurrency.

---

## 5. Auth error codes

`AuthErrorCode` enum at [auth.tsx:15-22](../../../src/app/providers/auth.tsx#L15-L22). Triggers and user-facing messages:

| Code | Trigger | Default message | UI surface |
|------|---------|-----------------|-----------|
| `runtime_config` | `runtimeConfig.isConfigured === false` (missing env vars) | `runtimeConfig.error` | `RuntimeConfigScreen` (full-page) |
| `session_invalid` | `getSession()` returned no session, or session refresh failed | "Your session is no longer valid. Sign in again to continue." | `SessionAccessBlocker` |
| `profile_missing` | Authenticated but `public.users` row missing | "Your account is authenticated, but the workspace profile is still being provisioned." | `SessionAccessBlocker` |
| `client_mapping_missing` | Client role but `client_users` row missing | "Your client account is authenticated, but client access mapping is not assigned yet." | `SessionAccessBlocker` (for non-client routes) / `ClientAccessBlocker` (when role is client) |
| `permission` | RLS denial during identity load | "Your authenticated session does not have permission to load this workspace." | `SessionAccessBlocker` (danger tone) |
| `network` | Connection failure during identity load | "The workspace could not be loaded because the network connection is unstable." | `SessionAccessBlocker` (warning tone, not danger) |
| `unknown` | Anything else | "The workspace could not be resolved for this authenticated session." | `SessionAccessBlocker` |

Recovery actions on every blocker: "Retry account check" в†’ `refreshIdentity()`; "Sign out" в†’ `signOut()`.

`classifyAuthErrorCode(message, code)` ([auth.tsx:79-101](../../../src/app/providers/auth.tsx#L79-L101)) maps DB / network errors into the codes above using keyword matching (`permission`, `forbidden`, `denied`, `policy`, `42501` в†’ permission; `network`, `fetch`, `timeout`, `502/503/504` в†’ network; otherwise `unknown`).

---

## 6. Browser persistence keys

UI preferences kept in `localStorage`. Values are non-secret; clearing them resets layout but not data.

| Key | Used by | Purpose |
|-----|---------|---------|
| `app_shell_sidebar_hidden` | [app-shell.tsx:78](../../../src/app/components/app-shell.tsx#L78) | `"1"` to hide the desktop sidebar; `"0"` or absent to show. |
| `table:campaigns:columns` | campaigns-page | Resizable column widths |
| `table:leads:columns` | leads-page | Same |
| `table:clients:mega-columns` | clients-page mega-table (all ~61 columns; single shared storage key) | Same |
| `table:client-leads:columns` | client-leads-page | Same |
| `table:domains:columns` | domains-page | Same |
| `table:invoices:columns` | invoices-page | Same |

`useResizableColumns(defaults, mins, storageKey)` ([use-resizable-columns.ts](../../../src/app/lib/use-resizable-columns.ts)) loads on mount, clamps to mins, writes back on resize.

---

## 7. Bucket orderings

DoD / 3-DoD / WoW / MoM column groups in the Clients mega-table use **custom** orderings, not alphabetical. Bucket arrays are defined as constants in [`src/app/pages/clients-page/mega-table.tsx`](../../../src/app/pages/clients-page/mega-table.tsx) (`DOD_SCHED_BUCKETS`, `DOD_SENT_BUCKETS`, `TD3_*_BUCKETS`, `WOW_BUCKETS`, `MOM_BUCKETS`):

| View | Order (left в†’ right) |
|------|----------------------|
| **DoD** | `+2 в†’ +1 в†’ 0 в†’ -1 в†’ -2 в†’ -3 в†’ -4` |
| **3-DoD** | `0 в†’ -1 в†’ -2 в†’ -3 в†’ -4` |
| **WoW** | `0 в†’ -1 в†’ -2 в†’ -3` |
| **MoM** | `0 в†’ -1 в†’ -2 в†’ -3` |

DoD has the asymmetry of three forward-looking schedule buckets (`+2`, `+1`, `0`) and four backward-looking sent buckets (`0` through `-4`). The "0" row uniquely shows both schedule and actual sent.

3-DoD `ClientMetricsOverview.threeDodTotal/Sql` aggregates buckets **0, -1, -2 only** (last 3 days), not the full 5-bucket history ([client-metrics.ts:312-313](../../../src/app/lib/client-metrics.ts#L312-L313)).

---

## 8. Clients mega-table layout conventions

The Clients page uses a single dense flex-row table with two-level header bands. Implementation details that aren't obvious from the rendered output:

- **Sticky columns** are the first 3 (`Client`, `Health`, `Manager`). Sticky offsets are computed cumulatively from the live resized widths in `computeStickyOffsets()` — if column widths change, sticky `left:` offsets recalculate via the memoized parse of `useResizableColumns.template`.
- **Header bands** (top tier "group", middle tier "sub") are derived by walking the column list and collapsing consecutive equal `group` / `subKey` values. Renaming a `group` mid-list will visually split the band.
- **Cell tinting precedence**: for a column with a `dodBucket`, `dodCellKey(bucket, kind)` is consulted first (per-bucket DoD rules); otherwise `column.conditionKey` is checked against `allResults` then `overviewResults`. Sticky columns never receive condition tinting (they carry their own status pill / health badge instead).
- **Sort default per column** is encoded as `defaultDirection` on each column entry. The page-level default sort is `health asc` (worst first), matching the `getHealthScore` convention where lower = worse.

---

End of constants reference. Next: [13 В· Out of scope](./13-out-of-scope.md).

---

## 9. OOO model constants and non-obvious rules (ADR-0015)

| Rule | Value / behaviour | Where |
|---|---|---|
| **OOO fallback schedule** | When a reply carries no parseable return date, `scheduled_for = today + 2 days` and `expected_return_date` stays **NULL**. A fallback is never written as if it were a determined date (spec §3). | `record_ooo_followup` |
| **Knowledge is only added** | A repeat OOO reply with NULL dates does **not** erase dates an earlier reply determined, and does not pull the schedule forward. Only supplied values move anything. | `record_ooo_followup` step 2 |
| **"Active" excludes `submitted`** | Active = `pending \| processing \| failed`. `submitted` closes the episode, so a later OOO reply may open the next one; the redelivery guard is the separate `source_reply_id` unique index. | `uq_ooo_followups_active` |
| **`submitted` ≠ enrolled** | It means the sequencer API accepted the request; a batch call can silently ignore a contact already in the campaign. Read it as "sent to sequencer", not "added to campaign". `confirmed` (verified membership) is optional and may never be used. | ADR-0015 §4 |
| **Attempt fields are last-attempt-only** | `attempt_count` / `last_attempt_at` / `last_error` do **not** form an audit trail. `attempt_count` is incremented by `claim`, not by `mark_ooo_failed`, and `retry` does not reset it. | `20260722e` |
| **Reopen keeps cancellation history** | `reopen_ooo_followup` leaves `cancelled_at` / `cancellation_reason` in place. Anything reading those columns must gate on `status = 'cancelled'`, or a reopened episode reads as both pending and cancelled. | `20260722e` |
| **Routing snapshot freezes** | `routing_key` / `target_campaign_id` / `routing_source` are per-episode, so changing a client's routing rule does NOT rewrite finished episodes. `recover_skipped_ooo_followups` only re-resolves episodes still parked as `skipped`. | `20260722e` |
| **Auto-recovery is limited** | `recover_skipped_ooo_followups` revives only `routing_missing` and `automation_disabled` (both mean "not configured", which the operator just fixed), only the newest skipped episode per contact, and only when no other episode is active. `contact_ineligible` needs a manual reopen. | `20260722e` |
| **No portal view of episodes** | There is no follow-up list or editor by product decision ([OoS-16](13-out-of-scope.md)); n8n drives the lifecycle. `ooo_followups` still has SELECT+UPDATE policies because `recover_skipped_ooo_followups` runs as the caller from the routing editor. | `20260722d`, OoS-16 |
| **Backfill status mapping** | `added_to_ooo_campaign` → `submitted`; future `expected_return_date` → `pending` (or `skipped` if unrouted); past or unknown date → `cancelled / superseded`. Historical episodes get **no** `target_campaign_id` — the real campaign is unknowable and guessing it would corrupt the snapshot. | `20260722f` |
| **`formatDate` shifts bare dates** | Latent, unrelated to OOO but worth knowing before any `date` column is rendered: `formatDate` runs `new Date("2026-07-27")`, which parses as UTC midnight, so viewers west of UTC see the previous day. Affects existing `date` columns (e.g. `domains.purchase_date`). | `lib/format.ts` |
