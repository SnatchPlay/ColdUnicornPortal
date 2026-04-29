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

---

## 2. Implicit business rules

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

### Daily-stats inclusion gate

[core-data.tsx:103](../../../src/app/providers/core-data.tsx#L103) вЂ” `includeDailyStats = identity?.role !== "client"`. During super-admin impersonation of a client, the snapshot reload omits `daily_stats`, so client-shell pages that rely on it render empty states. Document for support; this is intentional ([10-nfr В§1.1](./10-nfr.md#11-bulk-snapshot)).

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

### Condition-rules read gate for client role

`CoreDataProvider.refresh()` skips `repository.loadConditionRules()` when `identity.role === "client"` to avoid expected RLS denials for the client role.
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
| `table:clients:overview:columns` | clients-page (Overview tab; other tabs may have their own keys) | Same |
| `table:client-leads:columns` | client-leads-page | Same |
| `table:domains:columns` | domains-page | Same |
| `table:invoices:columns` | invoices-page | Same |

`useResizableColumns(defaults, mins, storageKey)` ([use-resizable-columns.ts](../../../src/app/lib/use-resizable-columns.ts)) loads on mount, clamps to mins, writes back on resize.

---

## 7. Bucket orderings

DoD / 3-DoD / WoW / MoM tables use **custom** orderings, not alphabetical. Defined as constants in [clients-page.tsx:27-54](../../../src/app/pages/clients-page.tsx#L27-L54):

| View | Order (left в†’ right) |
|------|----------------------|
| **DoD** | `+2 в†’ +1 в†’ 0 в†’ -1 в†’ -2 в†’ -3 в†’ -4` |
| **3-DoD** | `0 в†’ -1 в†’ -2 в†’ -3 в†’ -4` |
| **WoW** | `0 в†’ -1 в†’ -2 в†’ -3` |
| **MoM** | `0 в†’ -1 в†’ -2 в†’ -3` |

DoD has the asymmetry of three forward-looking schedule buckets (`+2`, `+1`, `0`) and four backward-looking sent buckets (`0` through `-4`). The "0" row uniquely shows both schedule and actual sent.

3-DoD `ClientMetricsOverview.threeDodTotal/Sql` aggregates buckets **0, -1, -2 only** (last 3 days), not the full 5-bucket history ([client-metrics.ts:312-313](../../../src/app/lib/client-metrics.ts#L312-L313)).

---

End of constants reference. Next: [13 В· Out of scope](./13-out-of-scope.md).

