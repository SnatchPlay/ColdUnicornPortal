# 09 · Mutations & RLS

Every write path in the portal, the RLS policy that guards it, who is allowed to invoke it, and the optimistic-update behaviour. Matches (and supersedes) the short matrix in [`docs/reference/mutation-ownership-matrix.md`](../mutation-ownership-matrix.md).

## Contents

1. [Architecture](#1-architecture)
2. [ORM Gateway Mutations](#2-orm-gateway-mutations)
3. [Edge functions](#3-edge-functions)
4. [Mutation ownership matrix](#4-mutation-ownership-matrix)
5. [RLS performance rules (ADR-0006)](#5-rls-performance-rules-adr-0006)
6. [Optimistic updates & rollback](#6-optimistic-updates--rollback)
7. [Error taxonomy](#7-error-taxonomy)
8. [Read strategy after the snapshot cutover](#8-read-strategy-after-the-snapshot-cutover)

---

## 1. Architecture

All reads and writes funnel through the `Repository` interface exported from [`src/app/data/repository.ts`](../../../src/app/data/repository.ts) ([interface: repository.ts:539-650](../../../src/app/data/repository.ts#L539-L650)). Pages call `repository.updateX(…)` **directly** — the old global data provider and its hook wrapper were removed in ADR-0009; no provider sits between a page and the repository. Each repository method dispatches one typed action to the `orm-gateway` edge function, which runs the corresponding Drizzle statement inside a transaction that carries the caller's JWT claims and role, so RLS stays authoritative (ADR-0008).

> **Ingestion-only tables.** The portal **must never** issue INSERT or UPDATE against `replies`, `campaign_daily_stats`, or `daily_stats`. Those rows are owned by **n8n** ([11-integrations.md §2](./11-integrations.md#2-ingestion-only-tables)). `domains`, `invoices`, `leads`, `campaigns` are partially shared: ingestion creates rows, the portal mutates a whitelisted subset of fields.

The write path is therefore:

1. Page (or a small co-located handler) calls `repository.updateX(id, patch)`.
2. `invokeOrmGatewayAction` ([repository.ts:383-510](../../../src/app/data/repository.ts#L383-L510)) attaches the access token + a `_requestId`, POSTs to `${supabaseUrl}/functions/v1/${runtimeConfig.ormGatewayFunction}`, and retries **once** on HTTP 401 after `refreshSession()`.
3. The gateway maps the patch through a **server-side field whitelist** (`mapClientPatch`, `mapCampaignPatch`, `mapLeadPatch`, `mapDomainPatch`, `mapInvoicePatch` — [index.ts:354-472](../../../supabase/functions/orm-gateway/index.ts#L354-L472)), executes the UPDATE, and returns the row.
4. The page updates its **own local state** (optimistically or from the returned row) or calls the page hook's `refresh()`. There is no snapshot to patch.

Pages that use the draft pattern (campaigns, leads, clients, domains, invoices) surface errors as `toast.error(…)` via `sonner` and keep the user in the drawer so they can retry.

RLS is the authoritative access boundary. Client-side role checks in UI (e.g. disabling inputs for `identity.role === "client"`) are redundant safety, not security.

Exceptions that do **not** go through the gateway: Supabase Auth (`providers/auth.tsx`), five SECURITY DEFINER RPCs (§3.6), Storage avatar objects (§3.7), and the read-only legacy-CRM client ([`lib/crm-integration.ts`](../../../src/app/lib/crm-integration.ts), ADR-0010).

---

## 2. ORM Gateway Mutations

Mutations are dispatched with `invokeOrmGatewayAction` (no retry — see §7.2); selects use `invokeOrmGatewaySelectWithRetry` ([repository.ts:512-537](../../../src/app/data/repository.ts#L512-L537)). The action → `{table, operation}` map that drives error attribution lives at [repository.ts:59-108](../../../src/app/data/repository.ts#L59-L108).

### 2.1 `updateClient(clientId, patch)` — [repository.ts:808-810](../../../src/app/data/repository.ts#L808-L810) · gateway [index.ts:2309](../../../supabase/functions/orm-gateway/index.ts#L2309)

- **Table:** `clients`.
- **Statement:** `UPDATE clients SET <patch> WHERE id = :clientId RETURNING *`.
- **RLS:** `clients_update_scoped` — production predicate allows admin and the client's assigned manager.
- **Allowed roles:** admin, super_admin, manager (assigned).
- **Called from:** Clients page drawer save ([clients-page.tsx:267](../../../src/app/pages/clients-page.tsx#L267)) and the CRM integration card ([crm-integration-card.tsx:178](../../../src/app/components/crm-integration-card.tsx#L178), writes `crm_config`).
- **Fields (whitelist `mapClientPatch`, [index.ts:354-381](../../../supabase/functions/orm-gateway/index.ts#L354-L381)):** `name`, `status`, `manager_id`, `min_daily_sent`, `inboxes_count`, `notification_emails`, `sms_phone_numbers`, `auto_ooo_enabled`, `setup_info`, `kpi_leads`, `kpi_meetings`, `crm_config`, contract fields.
- **ADR-0012:** the credential fields (`external_workspace_id`, `external_api_key`, `linkedin_api_key`) were removed from `mapClientPatch` — sequencer credentials now go through `upsertClientSequencer` (§2.15).

### 2.2 `updateCampaign(campaignId, patch)` — [repository.ts:812-814](../../../src/app/data/repository.ts#L812-L814) · gateway [index.ts:2316](../../../supabase/functions/orm-gateway/index.ts#L2316)

- **Table:** `campaigns`.
- **RLS:** `campaigns_update_scoped` with `using/withCheck: private.can_manage_client(client_id)`.
- **Allowed roles:** admin, super_admin, manager (assigned).
- **Called from:** Campaigns page drawer save.
- **Fields:** `name`, `status`, `database_size`, `positive_responses`.

### 2.3 `updateLead(leadId, patch)` — [repository.ts:816-818](../../../src/app/data/repository.ts#L816-L818) · gateway [index.ts:2323](../../../supabase/functions/orm-gateway/index.ts#L2323)

- **Table:** `leads`.
- **RLS (verified against the live DB):** `leads_update_scoped` — `using`/`with check` = `private.can_manage_client(client_id)`. The client role is therefore **write-blocked in Postgres** (ADR-0004), not merely in the UI. The drawer's `disabled={identity?.role === "client"}` and the `mapLeadPatch` whitelist are the two redundant layers above it. (The older `leads_update_visible` / `can_access_client` policy in [`supabase-production-rls.sql`](../supabase-production-rls.sql) is superseded — that file lags the live schema.)
- **Allowed roles:** admin, super_admin, master_admin, manager (assigned).
- **Called from:** Leads page drawer save ([leads-page.tsx:510](../../../src/app/pages/leads-page.tsx#L510)), the report highlight picker ([leads-page.tsx:697](../../../src/app/pages/leads-page.tsx#L697), optimistic with table-level rollback), and the manager dashboard lead drawer ([manager-dashboard-page.tsx:139](../../../src/app/pages/manager-dashboard-page.tsx#L139)).
- **Fields (ADR-0004 whitelist, enforced server-side in `mapLeadPatch` — [index.ts:392-427](../../../supabase/functions/orm-gateway/index.ts#L392-L427)):**
  - Pipeline: `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`
  - Report (Batch 4): `client_note` (renamed from `comments`), `coldunicorn_note` (internal — gateway nulls it for the client role in `loadLeadsList`), `highlight` (`green|yellow|red|null`)
  - Identity: `email`, `first_name`, `last_name`, `job_title`, `company_name`, `linkedin_url`, `phone_number`, `phone_source`, `gender`
  - Firmographics: `country`, `industry`, `headcount_range`, `website`
  - OOO: `expected_return_date`, `added_to_ooo_campaign`
- **Never accepted by gateway (read-only):** `id`, `client_id`, `campaign_id`, `external_id`, `external_blacklist_id`, `external_domain_blacklist_id`, `source`, `reply_text`, `response_time_hours`, `response_time_label`, `message_title`, `message_number`, `created_at`. Keys outside the whitelist are silently dropped — they will not error, just no-op.
- **Not editable via `mapLeadPatch`:** the terminal-status columns `final_outcome`, `conclusion`, `concluded_at`. They are written only by `concludeLead` (§2.3a), which sets all three atomically and syncs `won`.

### 2.3a `concludeLead(leadId, finalOutcome, conclusion)` — atomic terminal write (ADR-0013, Phase 5)

- **Table:** `leads`. Same RLS as `updateLead` (`leads_update_scoped`; **client write-blocked in Postgres**) — no new policy; this action reuses the leads UPDATE path.
- **Purpose:** set `final_outcome` (`won|lost|lost_premql|null`), `conclusion`, and `concluded_at` together so the DB CHECK `final_outcome ⇒ concluded_at` always holds, and **sync the legacy `won` boolean** — the meeting/offer recompute triggers deliberately never touch `won`, so the conclusion action owns it. `won = (finalOutcome === 'won')`; `finalOutcome: null` un-concludes (clears all four, `won=false`).
- **Why separate from `updateLead`:** it must set `won` + the three terminal columns in one statement; routing it through the draft/`mapLeadPatch` flow would let two write paths race over `won`. Bypasses the whitelist by design (a dedicated action, not a free-form patch).
- **Called from:** the Leads page CRM-view drawer conclusion editor ([lead-conclusion-editor.tsx](../../../src/app/components/lead-conclusion-editor.tsx)); `repository.concludeLead`.
- **KPI:** `won` stays the source of truth for the win KPIs (funnel/dashboards/MoM); this action keeps it consistent with `final_outcome`. Verified end-to-end on the local stack (conclude→`won=true`+CHECK holds; un-conclude→all four cleared).

### 2.4 `updateDomain(domainId, patch)` — [repository.ts:820-822](../../../src/app/data/repository.ts#L820-L822) · gateway [index.ts:2330](../../../supabase/functions/orm-gateway/index.ts#L2330)

- **Table:** `domains`.
- **RLS (verified live):** `domains_update_scoped` — `using`/`with check` = `private.can_manage_client(client_id)` (manager of the client + admin tier).
- **Called from:** Domains page drawer save ([domains-page.tsx:396](../../../src/app/pages/domains-page.tsx#L396)).
- **Fields:** `status`, `reputation`, `exchange_cost`, `campaign_verified_at`, `warmup_verified_at`.

### 2.5 `updateInvoice(invoiceId, patch)` — [repository.ts:824-826](../../../src/app/data/repository.ts#L824-L826) · gateway [index.ts:2337](../../../supabase/functions/orm-gateway/index.ts#L2337)

- **Table:** `invoices`.
- **RLS (verified live):** `invoices_update_admin` — `using`/`with check` = `private.is_admin_user()`. **Admin-tier only.** Managers can *read* invoices (`invoices_select_scoped` = `can_access_client`) but a manager save is rejected with `42501`. INSERT/DELETE are admin-only too (and the portal exposes neither).
- **Called from:** Invoices page drawer save ([invoices-page.tsx:163](../../../src/app/pages/invoices-page.tsx#L163)).
- **Fields:** `issue_date`, `amount`, `status`.

### 2.6 `upsertClientUserMapping(userId, clientId)` — [repository.ts:894-896](../../../src/app/data/repository.ts#L894-L896) · gateway [index.ts:2406](../../../supabase/functions/orm-gateway/index.ts#L2406)

- **Table:** `client_users`.
- **Statement:** `UPSERT ... ON CONFLICT (user_id) DO UPDATE SET client_id = :clientId`.
- **RLS:** `client_users_insert_admin` / `update_admin` — admin only.
- **Called from:** Clients page — client-user access management ([clients-page.tsx:297](../../../src/app/pages/clients-page.tsx#L297)).

### 2.7 `deleteClientUserMapping(mappingId)` — [repository.ts:898-900](../../../src/app/data/repository.ts#L898-L900) · gateway [index.ts:2421](../../../supabase/functions/orm-gateway/index.ts#L2421)

- **Table:** `client_users`.
- **RLS:** admin only.
- **Called from:** Clients page ([clients-page.tsx:319](../../../src/app/pages/clients-page.tsx#L319)).

### 2.8 `upsertEmailExcludeDomain(domain)` — [repository.ts:902-904](../../../src/app/data/repository.ts#L902-L904) · gateway [index.ts:2426](../../../supabase/functions/orm-gateway/index.ts#L2426)

- **Table:** `email_exclude_list`.
- **Statement:** `UPSERT ... ON CONFLICT (domain) DO NOTHING` logically (domain is the PK).
- **RLS:** `email_exclude_list_insert_admin` / `update_admin`.
- **Allowed roles:** admin, super_admin.
- **Called from:** Blacklist page, admin mode ([blacklist-page.tsx:46](../../../src/app/pages/blacklist-page.tsx#L46)).

### 2.9 `deleteEmailExcludeDomain(domain)` — [repository.ts:906-908](../../../src/app/data/repository.ts#L906-L908) · gateway [index.ts:2442](../../../supabase/functions/orm-gateway/index.ts#L2442)

- **Table:** `email_exclude_list`.
- **RLS:** `email_exclude_list_delete_admin`.
- **Allowed roles:** admin, super_admin.
- **Called from:** Blacklist page, Remove button ([blacklist-page.tsx:57](../../../src/app/pages/blacklist-page.tsx#L57)).

### 2.10 `createClient(input)` — [repository.ts:792-794](../../../src/app/data/repository.ts#L792-L794) · gateway [index.ts:2344](../../../supabase/functions/orm-gateway/index.ts#L2344)

- **Table:** `clients`.
- **Statement:** `INSERT INTO clients VALUES (<input>) RETURNING *`.
- **RLS policy:** `clients_insert_internal` — `role IN ('super_admin','admin','manager')` (set-based predicate). Migration: `supabase/migrations/20260517_entity_insert_policies.sql`.
- **Allowed roles:** admin, super_admin, manager.
- **Called from:** Clients page "New client" Sheet ([clients-page.tsx:245](../../../src/app/pages/clients-page.tsx#L245)).
- **Fields:** `name` (required), `manager_id` (**optional** — `null` = Unassigned; pre-filled with `identity.userId` for the manager role, but an admin may leave it empty; the picker also offers admins, not just `manager`-role users), `status` (required), `kpi_leads`, `kpi_meetings`, `contracted_amount`, `contract_due_date`. `clients.manager_id` is nullable since `20260715_clients_manager_id_nullable.sql`.
- **ADR-0012:** optional `sequencerCredentials` array (`{sequencer_key, api_key?, external_workspace_id?}`) — the gateway upserts `client_sequencers` rows in the same transaction after the client insert (New-client sheet sends EmailBison workspace/key + Aimfox key this way).
- **Update pattern:** no optimistic update; the returned row is prepended to the page's local `clients` array.

### 2.11 `createCampaign(input)` — [repository.ts:796-798](../../../src/app/data/repository.ts#L796-L798) · gateway [index.ts:2354](../../../supabase/functions/orm-gateway/index.ts#L2354)

- **Table:** `campaigns`.
- **Statement:** `INSERT INTO campaigns VALUES (<input>) RETURNING *`.
- **RLS policy:** `campaigns_insert_internal` — admin/super_admin any client; manager scoped to own `clients.manager_id`. Migration: `20260517_entity_insert_policies.sql`.
- **Allowed roles:** admin, super_admin, manager (scoped).
- **Called from:** Campaigns page "New campaign" Sheet ([campaigns-page.tsx:480](../../../src/app/pages/campaigns-page.tsx#L480)).
- **Fields:** `client_id`, `external_id` (required, unique in Smartlead/Bison), `name`, `type`, `status`, `database_size`, `start_date`, optional `sequencer_id` (omitted → DB default EmailBison; ADR-0012). `sequencer_id` is NOT in `mapCampaignPatch` — immutable via portal after creation.
- **Update pattern:** no optimistic update; the page calls its hook's `refresh()` after the insert resolves.

### 2.12 `createLead(input)` — [repository.ts:800-802](../../../src/app/data/repository.ts#L800-L802) · gateway [index.ts:2364](../../../supabase/functions/orm-gateway/index.ts#L2364)

- **Table:** `leads`.
- **Statement:** `INSERT INTO leads VALUES (<input>) RETURNING *`.
- **RLS policy:** `leads_insert_internal` — same scoping as `createCampaign`. Migration: `20260517_entity_insert_policies.sql`.
- **Allowed roles:** admin, super_admin, manager (scoped).
- **Called from:** Leads page "New lead" Sheet ([leads-page.tsx:416](../../../src/app/pages/leads-page.tsx#L416)).
- **Fields:** `client_id` (required), `campaign_id` (optional), `first_name`, `last_name`, `email`, `company_name`, `job_title`. `source` is auto-set to `'manual'`.
- **Update pattern:** no optimistic update; the page calls `refresh()` (the list is server-paginated, so the new row must come back from the server).

### 2.13 `createDomain(input)` — [repository.ts:804-806](../../../src/app/data/repository.ts#L804-L806) · gateway [index.ts:2374](../../../supabase/functions/orm-gateway/index.ts#L2374)

- **Table:** `domains`.
- **Statement:** `INSERT INTO domains VALUES (<input>) RETURNING *`.
- **RLS policy:** `domains_insert_internal` — same scoping as campaigns. Migration: `20260517_entity_insert_policies.sql`.
- **Allowed roles:** admin, super_admin, manager (scoped).
- **Called from:** Domains page "New domain" Sheet ([domains-page.tsx:375](../../../src/app/pages/domains-page.tsx#L375)).
- **Fields:** `client_id`, `domain_name`, `setup_email`, `purchase_date`, `exchange_date` (all required), `exchange_cost`, `status` (optional).
- **Update pattern:** no optimistic update; the page calls `refresh()`.

### 2.13b Lead custom fields (Batch 4, Task 4F) — [ADR-0007](../../adr/0007-per-client-lead-custom-fields.md)

Per-client custom columns on the Leads report. Repository methods → orm-gateway actions:

- `loadLeadCustomFields(clientId?)` — select; RLS `lcf_select_scoped` (accessible clients, client role included).
- `createLeadCustomField(input)` / `updateLeadCustomField(fieldId, patch)` / `deleteLeadCustomField(fieldId)` — table `lead_custom_fields`; RLS `lcf_write_admin` (**super_admin/admin/master_admin only** — managers cannot define).
- `upsertLeadCustomFieldValue(leadId, fieldId, value)` — table `lead_custom_field_values`; RLS `lcfv_write_scoped` requires accessible client **and** role ∈ field `editable_by` (default `{admin,master_admin}`).
- **Read path:** `loadLeadsList` returns `customFields` (definitions for the page's clients) + `customValues` (values for the returned rows only) — no global fetch.
- **UI:** internal Leads page "Manage columns" sheet (admin-only) for definitions; inline cell editing in the report for values (optimistic via `useLeadCustomColumns`).

### 2.14 `loadConditionRules()` — [repository.ts:788-790](../../../src/app/data/repository.ts#L788-L790) · gateway [index.ts:2301](../../../supabase/functions/orm-gateway/index.ts#L2301)

- **Table:** `condition_rules`.
- **Statement:** `SELECT * FROM condition_rules ORDER BY priority ASC, created_at ASC`.
- **RLS:** `condition_rules_select_scoped`.
- **Allowed roles:** manager (scoped/global read), admin, super_admin.
- **Blocked role:** client.
- **Note:** `loadClientsOverview` and `loadAdminSettings` already embed the rules in their payloads; the standalone action exists for callers that need only the rules. Runtime evaluation: [`lib/conditions/*`](../../../src/app/lib/conditions) (ADR-0011, [14-condition-rules.md](./14-condition-rules.md)).

### 2.15 `createConditionRule(input)` / `updateConditionRule(ruleId, patch)` / `deleteConditionRule(ruleId)`

- **Repository:** [repository.ts:828-842](../../../src/app/data/repository.ts#L828-L842) · gateway [index.ts:2384-2405](../../../supabase/functions/orm-gateway/index.ts#L2384-L2405).
- **Table:** `condition_rules`.
- **RLS:** `condition_rules_admin_insert` / `_admin_update` / `_admin_delete`.
- **Allowed roles:** admin, super_admin only.
- **Called from:** admin settings condition-rules builder ([settings-page.tsx:404-446](../../../src/app/pages/settings-page.tsx#L404-L446)).
- **Note:** `updateConditionRule` stamps `updated_at` client-side before dispatch ([repository.ts:832-838](../../../src/app/data/repository.ts#L832-L838)).

### 2.16 Clients-table customization (column overrides + client custom fields)

Admin-configurable Clients table, surfaced in the Settings page ([settings-page.tsx:824-840](../../../src/app/pages/settings-page.tsx#L824-L840)).

| Repository method | Table | Gateway |
|---|---|---|
| `upsertColumnOverride(columnKey, patch)` | `client_table_column_overrides` | [index.ts:2447](../../../supabase/functions/orm-gateway/index.ts#L2447) |
| `setColumnOrder(orderedKeys)` | `client_table_column_overrides` | [index.ts:2479](../../../supabase/functions/orm-gateway/index.ts#L2479) |
| `createClientCustomField` / `updateClientCustomField` / `deleteClientCustomField` | `client_custom_fields` | [index.ts:2507-2554](../../../supabase/functions/orm-gateway/index.ts#L2507-L2554) |
| `upsertClientCustomFieldValue(clientId, fieldId, value)` | `client_custom_field_values` | [index.ts:2555](../../../supabase/functions/orm-gateway/index.ts#L2555) |

Definitions are admin-tier only; values are gated by the field's `editable_by` array. Migrations: `20260520_client_custom_fields.sql`, `20260520_client_table_overrides.sql`, `20260524_column_override_position.sql`, `20260527_custom_field_editable_by.sql`, `20260616_custom_field_link_type.sql`.

### 2.17 `upsertClientSequencer(clientId, sequencerKey, patch)` — [ADR-0012](../../adr/0012-multi-sequencer-model.md)

- **Table:** `client_sequencers`.
- **Statement:** raw-SQL `INSERT … SELECT` resolving `sequencer_key` → `sequencers.id`, `ON CONFLICT (client_id, sequencer_id) DO UPDATE` — only fields present in `patch` overwrite (`api_key`, `external_workspace_id`, `settings`, `enabled`); `updated_at = now()`.
- **RLS:** `client_sequencers_{select,insert,update,delete}_scoped` — all gated `private.can_manage_client(client_id)`. Client role has zero visibility (API keys).
- **Allowed roles:** admin, super_admin, master_admin, manager (assigned).
- **Called from:** Clients page drawer save (`buildSequencerPatches` diffs the EmailBison workspace/key + Aimfox key fields against the loaded rows) and `createClient` (`sequencerCredentials` array, §2.4).

### Per-user table preferences

| Repository method | Table | Gateway |
|---|---|---|
| `loadTablePreferences(tableKey)` | `user_table_preferences` | `loadTablePreferences` action |
| `saveTablePreferences(tableKey, preferences)` | `user_table_preferences` | `saveTablePreferences` action |

Personal layout — column widths, filters and sort — **not** the global `column_overrides` layout
(see [03-data-model §4](./03-data-model.md)). The row is keyed on the JWT subject inside the
gateway; no user id crosses the wire, and RLS allows a caller to touch only `user_id = auth.uid()`.
`preferences` is opaque jsonb: the UI owns the shape and must ignore stale keys rather than trust
them. The payload is capped at 32 KB in `parseOrmGatewayRequest`, backed by a 64 KB CHECK on the
column.

Consumed by [`useTablePreferences`](../../../src/app/lib/use-table-preferences.ts), which treats
localStorage as a first-paint cache and Postgres as the source of truth, debounces writes (a drag
must not be a gateway call per mousemove), and **degrades instead of failing**: if the action is
rejected — an older gateway build, say — the table keeps working off the cache. Migration:
`20260714b_user_table_preferences.sql`.

### 2.18 Lead CRM child tables (ADR-0013)

`lead_meetings` / `lead_offers` / `lead_tasks` / `lead_value_deliveries` (migrations `20260719*`). Schema + RLS in [03-data-model §2.4b](03-data-model.md#24b-lead-crm-child-tables-adr-0013).

- **RLS (verified live via EXPLAIN as `authenticated`):** `<table>_select_scoped` = set-based `can_access_client` through the parent lead (clients get read-only CRM data); `<table>_write_scoped` (`for all`) = set-based `can_manage_client`, so the **client role is write-blocked in Postgres**, mirroring `leads_update_scoped`.
- **Portal gateway write actions** — the atomic conclusion action (`concludeLead`, §2.3a) landed in **Phase 5.1**. The child-table CRUD (create/update/delete meetings/offers/tasks/deliveries) and the direct-editable CRM lead columns (`contact_made_at`, `contact_method`, `negotiation_started_at`, `linkedin_invitation_sent_at`) are **Phase 5.2/5.3** (pending); until then those tables/columns are populated by n8n/service-role and read by the CRM read-model.
- **Legacy-boolean recompute trigger:** `AFTER INSERT/UPDATE/DELETE` on `lead_meetings`/`lead_offers` recomputes `leads.meeting_booked`/`meeting_held`/`offer_sent` from child rows (RECOMPUTE, not latch — cancelling un-counts; product decision 2026-07-19). It is a DB trigger, not gateway code, because n8n writes the child tables directly. `won` stays manual (whitelist). The trigger only *derives* booleans; `mapLeadPatch` remains the single whitelist for direct lead edits (ADR-0004).

---

## 3. Edge functions

Four functions are deployed. **The `verify_jwt` column is load-bearing — read it before assuming a
function is protected** (verified 2026-07-14 via `supabase functions list`):

| Function | `verify_jwt` | Who enforces auth |
|---|---|---|
| `orm-gateway` | **`true`** | The platform, before the handler runs. This is what makes it safe for `parseJwtClaims` to decode the JWT **without** re-verifying the signature ([ADR-0008](../../adr/0008-orm-gateway-edge-function.md)). If this ever flips to `false`, the gateway must verify the signature itself. |
| `orm-gateway-next` | **`true`** | same |
| `send-invite` | **`false`** | **The handler itself**, deliberately: 401 on a missing bearer token → `auth.getUser()` (verifies the signature server-side via the Auth API) → re-reads the actor's role from `public.users` and gates on it (403). |
| `manage-invites` | **`false`** | same pattern — 401 → `auth.getUser()` → `isAdminActor(role)` → 403. |

| Function | Purpose | Privileges |
|---|---|---|
| `orm-gateway` | All runtime reads/writes (~46 actions). Drizzle + `postgres.js`, RLS passthrough. | Holds a **`DATABASE_URL` transaction-pooler credential** ([index.ts:23-32](../../../supabase/functions/orm-gateway/index.ts#L23-L32)) but never bypasses RLS: `executeAsCaller` sets `role` to the caller's JWT role inside the transaction ([index.ts:694-728](../../../supabase/functions/orm-gateway/index.ts#L694-L728), [`rls-context.ts`](../../../supabase/functions/orm-gateway/rls-context.ts)). Unknown JWT roles fall back to `authenticated`. |
| `orm-gateway-next` | Deploy-only twin: `import "../orm-gateway/index.ts"` — identical code, separate deployment slot so WIP gateway changes can be tested without touching production. Targeted via `VITE_ORM_GATEWAY_FUNCTION`. | same |
| `send-invite` | Creates the auth user + `public.users` (+ `client_users` for clients) and emails the invite. | service role |
| `manage-invites` | `list` / `resend` / `revoke`. | service role |

### 3.1 Auth handshake

1. `getSessionAccessToken()` ([repository.ts:282-321](../../../src/app/data/repository.ts#L282-L321)) retrieves the current access token, force-refreshing when it expires within 60 s.
2. The first call uses that token.
3. On **HTTP 401**, the client refreshes the session and retries **once** ([repository.ts:415-420](../../../src/app/data/repository.ts#L415-L420) for the gateway; [349-354](../../../src/app/data/repository.ts#L349-L354) for the invite functions).
4. Failures are mapped to `RepositoryError` via `classifyErrorKind` on the backend-provided message/code.

### 3.2 `sendInvite(payload: InviteRequest)` — [repository.ts:844-855](../../../src/app/data/repository.ts#L844-L855)

- **Function:** `send-invite`.
- **Body:** `{ email, role, clientId? }` (shape defined by `InviteRequest` in `types/core.ts`).
- **Server action:** creates a row in Supabase `auth.users` (via `auth.admin.inviteUserByEmail`), inserts `public.users`, and — for client role — the `public.client_users` mapping. Sends the invitation email.
- **Authorized role (on the server):** admin / super_admin only. Enforced inside the function by reading `auth.users.app_metadata.role`.
- **Success shape:** `{ ok: true, inviteId: string }`.

### 3.3 `listInvites()` — [repository.ts:857-868](../../../src/app/data/repository.ts#L857-L868)

- **Function:** `manage-invites`, body `{ action: "list" }`.
- **Returns:** `{ ok: true, invites: InviteRecord[] }`.
- **Authorized role:** admin / super_admin.

### 3.4 `resendInvite(inviteId)` — [repository.ts:870-881](../../../src/app/data/repository.ts#L870-L881)

- **Function:** `manage-invites`, body `{ action: "resend", inviteId }`.
- **Server action:** regenerate magic link, extend expiry, re-email.
- **Returns:** `{ ok: true, invite: InviteRecord }`.

### 3.5 `revokeInvite(inviteId)` — [repository.ts:883-892](../../../src/app/data/repository.ts#L883-L892)

- **Function:** `manage-invites`, body `{ action: "revoke", inviteId }`.
- **Server action:** invalidates pending invite.
- **Returns:** `{ ok: true }`.

### 3.6 Admin user management — Postgres RPCs (not the gateway)

User-management writes (2B/2C) call **SECURITY DEFINER functions** directly via `supabase.rpc(...)` from `repository.ts` — deliberately **not** the `orm-gateway` edge function. This keeps the entire feature deployable through a migration alone (no edge redeploy) while enforcing every permission rule in SQL. Shared error wrapper: `invokeUserRpc` ([repository.ts:240-248](../../../src/app/data/repository.ts#L240-L248)); methods at [repository.ts:924-953](../../../src/app/data/repository.ts#L924-L953). Migration: [`20260618_user_management_and_custom_field_types.sql`](../../../supabase/migrations/20260618_user_management_and_custom_field_types.sql).

These five RPCs plus Supabase Auth, Storage and the legacy-CRM client are the **only** places `supabase-js` is used at runtime ([`lib/supabase.ts`](../../../src/app/lib/supabase.ts) is imported by exactly two files: `providers/auth.tsx` and `data/repository.ts`; `lib/avatar-storage.ts` re-uses the same client).

| Repository method | RPC | Enforced server-side |
|-------------------|-----|----------------------|
| `listManagedUsers()` | `public.admin_list_users()` | Caller must be `super_admin`/`admin`/`master_admin`; returns all users incl. `is_active`/`deactivated_at`. |
| `updateUserRole(userId, role)` | `public.admin_update_user_role(target, new_role)` | Internal-admin only · cannot change own role · only `super_admin` may assign/modify `super_admin` · last-admin guard (can't demote the last active admin-tier user). |
| `setUserActive(userId, active)` | `public.admin_set_user_active(target, active)` | Internal-admin only · cannot deactivate self · only `super_admin` may toggle a `super_admin` · last-admin guard. Sets `deactivated_at`/`deactivated_by`. |
| `setUserAvatar(userId, avatarPath)` | `public.admin_set_user_avatar(target, new_avatar_path)` | Internal-admin only. Sets/clears another user's `avatar_path` (+ `avatar_updated_at`). Migration [`20260619_user_avatars.sql`](../../../supabase/migrations/20260619_user_avatars.sql). Self avatar edits do **not** use this — they go through the gateway `updateProfileAvatar` action under `users_update_self`. |
| `isCurrentAccountActive()` | `public.current_account_active()` | Auth gate — `loadIdentity` runs it in parallel with `repository.loadIdentity` and blocks a deactivated user with `errorCode: "account_deactivated"` ([auth.tsx:96-106](../../../src/app/providers/auth.tsx#L96-L106)). **Fails open** on RPC error ([repository.ts:948-953](../../../src/app/data/repository.ts#L948-L953)). |

All admin user-management RPCs are `revoke all from public; grant execute to authenticated`. Violations `raise exception ... using errcode = '42501'` → surfaced as `RepositoryError` (kind `permission`). The deactivation lockout is reinforced at the data layer: `private.current_app_role()` returns NULL for a deactivated user, so all role-gated RLS denies them even with a still-valid JWT.

### 3.7 Avatars — gateway action + storage writes (Batch 10D)

Self-service avatar updates use the `orm-gateway` action **`updateProfileAvatar(sessionUserId, avatarPath|null)`** (`repository.updateProfileAvatar`), which writes `users.avatar_path` + `avatar_updated_at` under `users_update_self` RLS — the same path as `updateProfileName`. Admins editing another user use the `admin_set_user_avatar` RPC above.

The image bytes are written to the **public** `user-avatars` Storage bucket from the browser via the publishable client ([avatar-storage.ts](../../../src/app/lib/avatar-storage.ts)) — never the DB. The upload flow is transactional-enough: upload object → write DB → best-effort delete the previous object; if the DB write fails, the just-uploaded object is removed. `storage.objects` RLS restricts writes to the caller's own `avatars/{uid}/…` folder (or `private.is_admin_user()`).

**Why public bucket (not private + signed URLs):** avatars are low-sensitivity face photos with unguessable UUID object names; public read removes per-render signing latency and list-batching complexity, and the DB stores only the object path. Decision logged in [BUSINESS_LOGIC.md](../../BUSINESS_LOGIC.md). Migration [`20260619_user_avatars.sql`](../../../supabase/migrations/20260619_user_avatars.sql).

---

## 4. Mutation ownership matrix

Canonical authorization per entity, **verified against `pg_policies` on the live project**. "Own" = the subject's own row. "Admin tier" = `super_admin`, `admin`, `master_admin` (ADR-0005).

| Entity | Client | Manager | Admin tier | Live write predicate |
|--------|:------:|:-------:|:----------:|---|
| `users` (name, avatar; password via Auth) | Own | Own | Own + others via RPC | `users_update_self` (`auth.uid() = id`); admin edits go through SECURITY DEFINER RPCs (§3.6) |
| `clients` | ✖ | ✓ assigned | ✓ all | `clients_update_scoped` = `can_manage_client(id)`; insert = `clients_insert_internal` |
| `client_users` | ✖ | ✖ | ✓ | admin-only |
| `campaigns` | ✖ | ✓ assigned | ✓ all | `campaigns_update_scoped` = `can_manage_client(client_id)` |
| `leads` | ✖ | ✓ assigned | ✓ all | `leads_update_scoped` = `can_manage_client(client_id)` |
| `lead_meetings` / `lead_offers` / `lead_tasks` / `lead_value_deliveries` | ✖ | ✓ assigned | ✓ all | `<table>_write_scoped` = set-based `can_manage_client` via parent lead (ADR-0013). Gateway write actions: Phase 5. |
| `replies` | ✖ | ✖ | ✖ | ingestion only — no portal write policy |
| `campaign_daily_stats` | ✖ | ✖ | ✖ | ingestion only |
| `daily_stats` | ✖ | ✖ | ✖ | ingestion only |
| `domains` | ✖ | ✓ assigned | ✓ all | `domains_update_scoped` / `_delete_scoped` = `can_manage_client(client_id)` |
| `invoices` | ✖ | **✖ (read-only)** | ✓ all | `invoices_update_admin` = `is_admin_user()` — **managers cannot write invoices**, despite seeing the page |
| `email_exclude_list` | ✖ | ✖ (read) | ✓ | `*_admin` = `is_admin_user()`; managers get `select_internal` only |
| `condition_rules` | ✖ (no read) | ✖ (read, scoped) | ✓ | `condition_rules_admin_*` = `is_admin_user()` |
| `client_table_column_overrides`, `client_custom_fields`(+values) | ✖ | ✖ (values only if in `editable_by`) | `master_admin` writes definitions | see [03 §2.8](./03-data-model.md#28-customization-tables--not-in-schemats) |
| `sequencers` (catalog, ADR-0012) | read-only | read-only | read-only | `sequencers_select_authenticated` (`using true`); writes `sequencers_write_master` = master_admin |
| `client_sequencers` (ADR-0012) | ✖ (invisible) | ✓ assigned | ✓ all | `client_sequencers_*_scoped` = `can_manage_client(client_id)` |
| `sequencer_daily_stats` (ADR-0012) | ✖ | ✖ | ✖ | ingestion only — set-based select RLS |
| `client_ooo_routing` | ✖ | ✓ assigned (not in UI) | ✓ | `can_manage_client(client_id)` |
| `agency_crm_deals` | ✖ | ✓ own `salesperson_id` (not in UI) | ✓ | — |
| Invite edge functions | ✖ | ✖ | ✓ | enforced inside the function |

"Assigned" = the record's `client_id` is among clients where `clients.manager_id = auth.uid()`.

> **Resolved 2026-07-14:** invoice writes are admin-only in RLS (`invoices_insert/update/delete_admin` = `private.is_admin_user()` = `super_admin | admin | master_admin`), so the Invoices drawer now hides its edit controls for managers and renders read-only ([invoices-page.tsx](../../../src/app/pages/invoices-page.tsx), `canEditInvoices`). Managers keep SELECT via `invoices_select_scoped` = `can_access_client(client_id)`. We gated the UI rather than widening RLS — invoices are billing records and admin-only writes are the intended boundary. Regression test: `hides invoice edit controls from managers` in [modules-ops.test.tsx](../../../src/app/pages/__tests__/modules-ops.test.tsx).

Clients do not write domain entities through the portal. Their account actions still go through Supabase Auth (`updatePassword`, `requestPasswordReset`, `signOut`), while profile-name persistence now routes through `orm-gateway` to `public.users` under `users_update_self` (`id = auth.uid()`).

---

## 5. RLS performance rules (ADR-0006)

### 5.1 Set-based SELECT policies — mandatory for high-volume tables

SELECT policies on tables with >1 k rows **must** use the subquery (set-based) form, not a per-row helper function call.

**Required pattern:**
```sql
CREATE POLICY "table_select_scoped" ON public.table FOR SELECT TO authenticated
USING (
  client_id IN (
    SELECT id FROM public.clients WHERE private.can_access_client(id)
  )
);
```

**Forbidden on high-volume tables:**
```sql
USING (private.can_access_client(client_id))  -- called once per row → O(n) overhead
```

**Why:** `private.can_access_client(client_id)` takes a row-level argument. PostgreSQL cannot hoist it out of a scan even when the function is `STABLE`. At ~0.1ms per call × 4020 rows = 400ms of pure RLS overhead per query. The subquery form materialises a hash set once (48 clients) and the main scan becomes a semijoin.

**Measured (2026-06-01, admin role, leads table 3972 rows):**
- Per-row form: 446ms execution time
- Set-based form: 22ms execution time (20×)

Full analysis: [ADR-0006](../../../docs/adr/0006-set-based-rls-predicates.md).

### 5.2 EXPLAIN ANALYZE checklist for new gateway actions

Before any new SELECT action on a table with >1 k rows goes to production:

1. Run `EXPLAIN (ANALYZE, BUFFERS)` **as the authenticated role** — not superuser. Use `scripts/db-diagnose-rls-explain.mjs` pattern: open a transaction, set JWT claims via `set_config`, `SET LOCAL ROLE authenticated`, then EXPLAIN.
2. Scan the plan for `Filter: private.*` inside any Seq or Index scan. Those are per-row calls.
3. If found, rewrite the policy to the set-based form **before shipping**.
4. Record before/after execution times in the migration comment.

### 5.3 Current policy status by table

| Table | Policy form | Since |
|---|---|---|
| `leads` | Set-based: `client_id IN (SELECT ...)` | `20260601b` |
| `campaigns` | Set-based: `client_id IN (SELECT ...) AND role/type` | `20260601b` |
| `replies` | Set-based: `client_id IS NOT NULL AND client_id IN (SELECT ...)` | `20260601b` |
| `campaign_daily_stats` | Set-based: `campaign_id IN (SELECT ...)` | `20260421` |
| `daily_stats` | Set-based: `client_id IN (SELECT ...)` | `20260421` |
| `clients` | Per-row: `can_access_client(id)` | — (48 rows — acceptable) |
| `sequencer_daily_stats` | Set-based: `client_id IN (SELECT ...)` | `20260704` |
| `sequencers`, `client_sequencers` | Per-row helper (tiny tables) | `20260704` |
| `domains`, `invoices`, `condition_rules` | Per-row helper | Phase 7 audit pending |

### 5.4 `_serverMs` response field

Every `orm-gateway` response includes `_serverMs: { total, setup, handler, …perQuery }` (milliseconds, rounded) plus the `_requestId` echoed from the request ([index.ts:2810-2820](../../../supabase/functions/orm-gateway/index.ts#L2810-L2820)). Use it to distinguish network overhead from DB overhead:

- `setup`: the single `set_config` round-trip that installs the JWT claims + role.
- `handler`: the action's SQL.
- extra keys: per-query timings when the handler populates `PerfContext.queryMs`.
- `total - setup - handler`: transaction/connection overhead (edge function → DB).
- `fetchMs - total`: network + edge scheduling. When it exceeds 1500 ms the frontend logs `[GATEWAY_OVERHEAD]` ([repository.ts:444-449](../../../src/app/data/repository.ts#L444-L449)) — a cold-start / pooler stall, not an app defect.

---

## 6. Optimistic updates & rollback

There is no central mutation wrapper. Each page owns its own strategy:

| Page | Pattern |
|---|---|
| Clients | True optimistic: patch local `clients` array → call `repository.updateClient` → replace with the server row; **on error re-fetch** the page payload and toast ([clients-page.tsx:260-281](../../../src/app/pages/clients-page.tsx#L260-L281)). |
| Leads report highlight | Optimistic in the table component; the handler rethrows so the table rolls its colour back ([leads-page.tsx:695-701](../../../src/app/pages/leads-page.tsx#L695-L701)). |
| Lead custom-field cells | Optimistic via `useLeadCustomColumns` ([`lib/use-lead-custom-columns.ts`](../../../src/app/lib/use-lead-custom-columns.ts)). |
| Leads / Campaigns / Domains / Invoices drawers | Not optimistic: `await repository.updateX(...)` then the page hook's `refresh()` (server-paginated lists must come back from the server). Errors surface as `toast.error` and the draft stays in the drawer. |

Common invariants:

- `isDraftDirty` is derived from the diff between `draft` and the selected record; Save/Cancel appear only when dirty.
- Dependent projections (e.g. `getLeadStage`) re-derive on the next render because they are pure functions of the row.
- No realtime reconciliation — two managers editing the same lead simultaneously silently overwrite each other. Last save wins.

---

## 7. Error taxonomy

`RepositoryError` ([repository.ts:110-144](../../../src/app/data/repository.ts#L110-L144)) carries:

- `table` — e.g. `"leads"`, `"invites"`, `"auth"`, `"dashboard"`, `"shell"` (from `ORM_ACTION_META`, [repository.ts:59-108](../../../src/app/data/repository.ts#L59-L108)).
- `operation` — `"select"` | `"insert"` | `"update"` | `"upsert"` | `"delete"`.
- `kind` — `"permission"` | `"network"` | `"timeout"` | `"unknown"`.
- `code`, `details`, `hint` — Postgres/PostgREST fields propagated through the gateway's error envelope for diagnostic toasts.

### 7.1 Kind classification

`classifyErrorKind(message, code)` at [repository.ts:168-200](../../../src/app/data/repository.ts#L168-L200):

- `code === "57014"` → `timeout` (Postgres `statement_timeout`).
- `code === "42501"` → `permission` (insufficient privilege / RLS denial).
- Message contains `statement timeout`, `canceling statement`, `57014` → `timeout`.
- Message contains `permission`, `denied`, `forbidden`, `policy`, `rls`, `42501` → `permission`.
- Message contains `network`, `fetch`, `503`, `502`, `504`, `timeout` → `network`.
- Otherwise → `unknown`.

The gateway classifies independently on its side (`classifyAuthErrorCode`, [index.ts:730-754](../../../supabase/functions/orm-gateway/index.ts#L730-L754)) when composing the failure envelope.

### 7.2 Retry behaviour

`isRetryable(error)` at [repository.ts:266-268](../../../src/app/data/repository.ts#L266-L268), delays `SNAPSHOT_RETRY_DELAYS_MS = [250, 600]` at [repository.ts:57](../../../src/app/data/repository.ts#L57):

- **Only** `select` actions with `kind ∈ {network, timeout}` are retried — two retries, three attempts total ([repository.ts:512-537](../../../src/app/data/repository.ts#L512-L537)).
- Independently of that, **any** gateway call retries once on HTTP 401 after a session refresh.

Mutations are never auto-retried — to avoid duplicate inserts / non-idempotent updates. The user re-triggers them from the drawer.

### 7.3 Auth handshake errors

`getSessionAccessToken()` ([repository.ts:282-321](../../../src/app/data/repository.ts#L282-L321)) converts session-fetch / refresh failures into `RepositoryError({ kind: "permission" })` with a message guiding the user to sign in again. If a session has less than 60 s of life left, it is proactively refreshed.

---

## 8. Read strategy after the snapshot cutover

The universal bulk-snapshot loader and its global data provider are **deleted** (ADR-0009). A regression guard test fails the build if any app-runtime file reintroduces the snapshot action: [`data/__tests__/snapshot-cutover-guard.test.ts`](../../../src/app/data/__tests__/snapshot-cutover-guard.test.ts).

### 8.1 Boot

`ShellDataProvider` ([`providers/shell-data.tsx`](../../../src/app/providers/shell-data.tsx)) calls `repository.loadShellData()` once per identity. The payload is three projected lists only — `usersLite`, `clientsLite`, `clientUsers` ([index.ts:894-941](../../../supabase/functions/orm-gateway/index.ts#L894-L941)) — enough for nav, ownership labels and dropdowns.

### 8.2 Per page

| Route | Hook | Gateway action(s) |
|---|---|---|
| Dashboard (admin) | inline in [admin-dashboard-page.tsx:29](../../../src/app/pages/admin-dashboard-page.tsx#L29) | `loadAdminDashboardOverview` |
| Dashboard (manager) | inline in [manager-dashboard-page.tsx:45-76](../../../src/app/pages/manager-dashboard-page.tsx#L45-L76) | `loadManagerDashboardOverview` |
| Dashboard (client) | [client-dashboard-page.tsx:203](../../../src/app/pages/client-dashboard-page.tsx#L203) | `loadClientDashboard` |
| Leads (internal + client) | [`use-leads.ts`](../../../src/app/lib/use-leads.ts) | `loadLeadsList`, `loadLeadsFilterOptions`, `loadLeadDetail` |
| Campaigns | [`use-campaigns.ts`](../../../src/app/lib/use-campaigns.ts) | `loadCampaignsList`, `loadCampaignStats` |
| Clients | `useClientsOverview` ([clients-page.tsx:158](../../../src/app/pages/clients-page.tsx#L158)) | `loadClientsOverview` → then `loadClientsMetricsSummary` (deferred) |
| Statistics | [`use-analytics.ts`](../../../src/app/lib/use-analytics.ts) | `loadAnalyticsOverview`, `loadCampaignStats` |
| Domains / Invoices / Blacklist | [`use-domains.ts`](../../../src/app/lib/use-domains.ts) / [`use-invoices.ts`](../../../src/app/lib/use-invoices.ts) / [`use-blacklist.ts`](../../../src/app/lib/use-blacklist.ts) | `loadDomainsPage` / `loadInvoicesPage` / `loadBlacklistPage` |
| Settings | [`use-settings.ts`](../../../src/app/lib/use-settings.ts) | `loadAdminSettings` |
| Admin users | inline in [admin-user-management-page.tsx:96-114](../../../src/app/pages/admin-user-management-page.tsx#L96-L114) | invite fns + `admin_list_users` RPC |

**Stale-response guard (mandatory).** Hooks that re-fetch on parameter change hold a `loadIdRef` counter and discard responses whose id no longer matches — this is what prevents a slow in-flight request from overwriting a newer fast one ([use-campaigns.ts:27-70](../../../src/app/lib/use-campaigns.ts#L27-L70), [use-analytics.ts:24-88](../../../src/app/lib/use-analytics.ts#L24-L88), [manager-dashboard-page.tsx:45-76](../../../src/app/pages/manager-dashboard-page.tsx#L45-L76)). `use-leads.ts` uses the sibling form: a serialized `paramsKey` effect plus a cancel flag for the drawer fetch ([use-leads.ts:23-83](../../../src/app/lib/use-leads.ts#L23-L83)).

### 8.3 Refresh

Every page hook exposes `refresh()`. It is called by: error-state Retry buttons, drawer saves and creates, and the invite/user-management actions. There is no global refresh.

Next: [10 · Non-functional requirements](./10-nfr.md).

