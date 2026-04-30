# 09 · Mutations & RLS

Every write path in the portal, the RLS policy that guards it, who is allowed to invoke it, and the optimistic-update behaviour. Matches (and supersedes) the short matrix in [`docs/reference/mutation-ownership-matrix.md`](../mutation-ownership-matrix.md).

## Contents

1. [Architecture](#1-architecture)
2. [ORM Gateway Mutations](#2-orm-gateway-mutations)
3. [Edge functions](#3-edge-functions)
4. [Mutation ownership matrix](#4-mutation-ownership-matrix)
5. [Optimistic updates & rollback](#5-optimistic-updates--rollback)
6. [Error taxonomy](#6-error-taxonomy)
7. [Snapshot reload strategy](#7-snapshot-reload-strategy)

---

## 1. Architecture

All writes funnel through the `Repository` interface exported from [`src/app/data/repository.ts`](../../../src/app/data/repository.ts). Pages never call Supabase directly for writes; they go through `useCoreData()` in [`providers/core-data.tsx`](../../../src/app/providers/core-data.tsx), which wraps the repository to:

> **Ingestion-only tables.** The portal **must never** issue INSERT or UPDATE against `replies`, `campaign_daily_stats`, or `daily_stats`. Those rows are owned by **n8n** ([11-integrations.md §2](./11-integrations.md#2-ingestion-only-tables)). `domains`, `invoices`, `leads`, `campaigns` are partially shared: ingestion creates rows, the portal mutates a whitelisted subset of fields.

> **ORM runtime status.** BL-11 is shipped: runtime reads/writes now go through `orm-gateway`, which executes Drizzle ORM queries with transaction-local JWT claim + role passthrough so existing RLS policies remain authoritative. The `Repository` interface is still the only frontend data boundary.

1. Invoke the repository method.
2. On success, patch the local `snapshot` with the returned row.
3. On error, leave the snapshot untouched and propagate the `RepositoryError`.

Pages that use the draft pattern (campaigns, leads, clients, domains, invoices) surface errors as `toast.error(…)` via `sonner` and keep the user in the drawer so they can retry.

RLS is the authoritative access boundary. Client-side role checks in UI (e.g. disabling inputs for `identity.role === "client"`) are redundant safety, not security.

---

## 2. ORM Gateway Mutations

All runtime data reads/writes in `repository.ts` now call `/functions/v1/orm-gateway` with an action payload. The gateway runs Drizzle queries server-side and returns typed envelopes (`{ ok, data }` / `{ ok, error }`).

### 2.1 `updateClient(clientId, patch)` — [repository.ts:395-400](../../../src/app/data/repository.ts#L395-L400)

- **Table:** `clients`.
- **Statement:** `UPDATE clients SET <patch> WHERE id = :clientId RETURNING *`.
- **RLS:** `clients_update_scoped` — production predicate allows admin and the client's assigned manager.
- **Allowed roles:** admin, super_admin, manager (assigned).
- **Called from:** Clients page drawer save.
- **Fields usually written:** `name`, `status`, `manager_id`, `min_daily_sent`, `inboxes_count`, `notification_emails`, `sms_phone_numbers`, `auto_ooo_enabled`, `setup_info`, `kpi_leads`, `kpi_meetings`.

### 2.2 `updateCampaign(campaignId, patch)` — [repository.ts:401-411](../../../src/app/data/repository.ts#L401-L411)

- **Table:** `campaigns`.
- **RLS:** `campaigns_update_scoped` with `using/withCheck: private.can_manage_client(client_id)`.
- **Allowed roles:** admin, super_admin, manager (assigned).
- **Called from:** Campaigns page drawer save.
- **Fields:** `name`, `status`, `database_size`, `positive_responses`.

### 2.3 `updateLead(leadId, patch)` — [repository.ts:412-417](../../../src/app/data/repository.ts#L412-L417)

- **Table:** `leads`.
- **RLS:** `leads_update_scoped`. Policy predicate lives in `docs/reference/supabase-production-rls.sql`; effectively restricts writes to internal roles that can manage the owning client.
- **Allowed roles:** admin, super_admin, manager (assigned); **never client** (ADR-0004 + RLS).
- **Called from:** Leads page drawer save.
- **Fields (ADR-0004 whitelist):** `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments`.

### 2.4 `updateDomain(domainId, patch)` — [repository.ts:418-423](../../../src/app/data/repository.ts#L418-L423)

- **Table:** `domains`.
- **RLS:** `domains_update_scoped` via `private.can_access_client(client_id)` (manager + admin).
- **Called from:** Domains page drawer save.
- **Fields:** `status`, `reputation`, `exchange_cost`, `campaign_verified_at`, `warmup_verified_at`.

### 2.5 `updateInvoice(invoiceId, patch)` — [repository.ts:424-429](../../../src/app/data/repository.ts#L424-L429)

- **Table:** `invoices`.
- **RLS:** `invoices_update_admin` policy name; production predicate extends to managers of the owning client.
- **Called from:** Invoices page drawer save.
- **Fields:** `issue_date`, `amount`, `status`.

### 2.6 `upsertClientUserMapping(userId, clientId)` — [repository.ts:476-485](../../../src/app/data/repository.ts#L476-L485)

- **Table:** `client_users`.
- **Statement:** `UPSERT ... ON CONFLICT (user_id) DO UPDATE SET client_id = :clientId`.
- **RLS:** `client_users_insert_admin` / `update_admin` — admin only.
- **Called from:** _programmatic only_; not bound to a UI action in the current build. Intended for re-mapping a client user without going through an invite.

### 2.7 `deleteClientUserMapping(mappingId)` — [repository.ts:486-490](../../../src/app/data/repository.ts#L486-L490)

- **Table:** `client_users`.
- **RLS:** admin only.
- **Called from:** _programmatic only_.

### 2.8 `upsertEmailExcludeDomain(domain)` — [repository.ts:491-500](../../../src/app/data/repository.ts#L491-L500)

- **Table:** `email_exclude_list`.
- **Statement:** `UPSERT ... ON CONFLICT (domain) DO NOTHING` logically (domain is the PK).
- **RLS:** `email_exclude_list_insert_admin` / `update_admin`.
- **Allowed roles:** admin, super_admin.
- **Called from:** Blacklist page (admin mode).

### 2.9 `deleteEmailExcludeDomain(domain)` — [repository.ts:501-505](../../../src/app/data/repository.ts#L501-L505)

- **Table:** `email_exclude_list`.
- **RLS:** `email_exclude_list_delete_admin`.
- **Allowed roles:** admin, super_admin.
- **Called from:** Blacklist page (Remove button).

### 2.10 `loadConditionRules()`

- **Table:** `condition_rules`.
- **Statement:** `SELECT * FROM condition_rules ORDER BY priority ASC, created_at ASC`.
- **RLS:** `condition_rules_select_scoped`.
- **Allowed roles:** manager (scoped/global read), admin, super_admin.
- **Blocked role:** client.

### 2.11 `createConditionRule(input)` / `updateConditionRule(ruleId, patch)`

- **Table:** `condition_rules`.
- **RLS:** `condition_rules_admin_insert` / `condition_rules_admin_update`.
- **Allowed roles:** admin, super_admin only.
- **Called from:** admin settings condition-rules builder.

### 2.12 `deleteConditionRule(ruleId)`

- **Table:** `condition_rules`.
- **RLS:** `condition_rules_admin_delete`.
- **Allowed roles:** admin, super_admin only.
- **Called from:** admin settings condition-rules builder.

---

## 3. Edge functions

Runtime data actions call `/functions/v1/orm-gateway`. Invitation lifecycle remains on `/functions/v1/send-invite` and `/functions/v1/manage-invites`.

### 3.1 Auth handshake

1. `getSessionAccessToken()` retrieves the current Supabase access token (forces a refresh if it expires within 60 s).
2. First call to the function uses that token.
3. If the response is **HTTP 401**, the client refreshes the session and retries once.
4. Failures are mapped to `RepositoryError` via `classifyErrorKind` on the backend-provided message.

### 3.2 `sendInvite(payload: InviteRequest)` — [repository.ts:430-441](../../../src/app/data/repository.ts#L430-L441)

- **Function:** `send-invite`.
- **Body:** `{ email, role, clientId? }` (shape defined by `InviteRequest` in `types/core.ts`).
- **Server action:** creates a row in Supabase `auth.users` (via `auth.admin.inviteUserByEmail`), inserts `public.users`, and — for client role — the `public.client_users` mapping. Sends the invitation email.
- **Authorized role (on the server):** admin / super_admin only. Enforced inside the function by reading `auth.users.app_metadata.role`.
- **Success shape:** `{ ok: true, inviteId: string }`.

### 3.3 `listInvites()` — [repository.ts:442-453](../../../src/app/data/repository.ts#L442-L453)

- **Function:** `manage-invites`, body `{ action: "list" }`.
- **Returns:** `{ ok: true, invites: InviteRecord[] }`.
- **Authorized role:** admin / super_admin.

### 3.4 `resendInvite(inviteId)` — [repository.ts:454-465](../../../src/app/data/repository.ts#L454-L465)

- **Function:** `manage-invites`, body `{ action: "resend", inviteId }`.
- **Server action:** regenerate magic link, extend expiry, re-email.
- **Returns:** `{ ok: true, invite: InviteRecord }`.

### 3.5 `revokeInvite(inviteId)` — [repository.ts:466-475](../../../src/app/data/repository.ts#L466-L475)

- **Function:** `manage-invites`, body `{ action: "revoke", inviteId }`.
- **Server action:** invalidates pending invite.
- **Returns:** `{ ok: true }`.

---

## 4. Mutation ownership matrix

Canonical authorization per entity. "Own" = the subject's own row (e.g. a user updating their profile) — not currently used for data mutations beyond auth.

| Entity | Client | Manager | Admin / Super-admin |
|--------|:------:|:-------:|:-------------------:|
| `users` (profile name, password via Auth) | Own | Own | Own (+ admin promotion via SQL) |
| `clients` | ✖ | ✓ assigned | ✓ all |
| `client_users` | ✖ | ✖ | ✓ |
| `campaigns` | ✖ | ✓ assigned | ✓ all |
| `leads` | ✖ | ✓ assigned | ✓ all |
| `replies` | ✖ | ✖ | ✖ (ingestion only) |
| `campaign_daily_stats` | ✖ | ✖ | ✖ (ingestion only) |
| `daily_stats` | ✖ | ✖ | ✖ (ingestion only) |
| `domains` | ✖ | ✓ assigned | ✓ all |
| `invoices` | ✖ | ✓ assigned | ✓ all |
| `email_exclude_list` | ✖ | ✖ | ✓ |
| `client_ooo_routing` | ✖ | ✓ assigned (not in UI) | ✓ |
| `agency_crm_deals` | ✖ | ✓ own `salesperson_id` (not in UI) | ✓ |
| Invite edge functions | ✖ | ✖ | ✓ |

"Assigned" = the record's `client_id` is among clients where `clients.manager_id = auth.uid()`.

Clients do not write domain entities through the portal. Their account actions still go through Supabase Auth (`updatePassword`, `requestPasswordReset`, `signOut`), while profile-name persistence now routes through `orm-gateway` to `public.users` under `users_update_self` (`id = auth.uid()`).

---

## 5. Optimistic updates & rollback

`CoreDataProvider` wraps each mutation roughly as:

```ts
async function updateLead(leadId, patch) {
  const previous = snapshot.leads;
  setSnapshot(s => ({ ...s, leads: replaceById(s.leads, leadId, optimisticMerge(previous, leadId, patch)) }));
  try {
    const next = await repository.updateLead(leadId, patch);
    setSnapshot(s => ({ ...s, leads: replaceById(s.leads, leadId, next) }));
    return next;
  } catch (err) {
    setSnapshot(s => ({ ...s, leads: previous }));
    throw err;
  }
}
```

Observations:

- The UI reflects changes immediately; on failure the toast surfaces the error and the drawer inputs retain the user's draft so they can retry.
- `Escape` in a drawer reverts to `selectedRecord` (discards draft) even after a successful save — `selectedRecord` is updated by the provider's state change.
- Dependent projections (e.g. `getLeadStage`) re-derive on the next render because they are pure functions of the new row.

No realtime reconciliation — two managers editing the same lead simultaneously will silently overwrite each other. The most recent save wins.

---

## 6. Error taxonomy

`RepositoryError` ([repository.ts:39-73](../../../src/app/data/repository.ts#L39-L73)) carries:

- `table` — e.g. `"leads"`, `"invites"`, `"auth"`.
- `operation` — `"select"` | `"update"` | `"upsert"` | `"delete"`.
- `kind` — `"permission"` | `"network"` | `"timeout"` | `"unknown"`.
- `code`, `details`, `hint` — optional PostgREST fields propagated for diagnostic toasts.

### 6.1 Kind classification

`classifyErrorKind(message, code)` at [repository.ts:97-129](../../../src/app/data/repository.ts#L97-L129):

- `code === "57014"` → `timeout` (Postgres `statement_timeout`).
- `code === "42501"` → `permission` (insufficient privilege / RLS denial).
- Message contains `statement timeout`, `canceling statement`, `57014` → `timeout`.
- Message contains `permission`, `denied`, `forbidden`, `policy`, `rls`, `42501` → `permission`.
- Message contains `network`, `fetch`, `503`, `502`, `504`, `timeout` → `network`.
- Otherwise → `unknown`.

### 6.2 Retry behaviour

`isRetryable(error)` at [repository.ts:167-169](../../../src/app/data/repository.ts#L167-L169):

- **Only** `select` operations with `kind ∈ {network, timeout}` are retried.
- Retry delays: `[250, 600] ms` (two retries, three attempts total).

Mutations are never auto-retried — to avoid duplicate inserts / non-idempotent updates. The user re-triggers them manually from the drawer.

### 6.3 Auth handshake errors

`getSessionAccessToken()` ([repository.ts:183-222](../../../src/app/data/repository.ts#L183-L222)) converts session-fetch / refresh failures into `RepositoryError({ kind: "permission" })` with a message guiding the user to sign in again. If a session has less than 60 s of life left, it is proactively refreshed.

---

## 7. Snapshot reload strategy

### 7.1 Bulk snapshot on mount

`CoreDataProvider` calls `repository.loadSnapshot()` once when the provider mounts and whenever the session changes. Eleven snapshot tables are fetched in parallel, then `condition_rules` are fetched as a separate read-path call:

| Table | Order by | Window |
|-------|----------|--------|
| `users` | `created_at DESC` | — |
| `clients` | `created_at DESC` | — |
| `client_users` | `created_at DESC` | — |
| `campaigns` | `created_at DESC` | — |
| `leads` | `updated_at DESC` | optional `leadsLimit` |
| `replies` | `received_at DESC` | — |
| `campaign_daily_stats` | `report_date DESC` | 90 days (`gte`) |
| `daily_stats` | `report_date DESC` | 180 days (`gte`); **skipped for client role** |
| `domains` | `updated_at DESC` | — |
| `invoices` | `issue_date DESC` | — |
| `email_exclude_list` | `created_at DESC` | — |
| `condition_rules` | `priority ASC, created_at ASC` | loaded separately; skipped for `client` role |

The 90/180-day windows exist to keep the authenticated-role `statement_timeout` comfortable (the dashboard only shows the last 21 days; 90 is headroom for drill-downs). Constants in [repository.ts:29-30](../../../src/app/data/repository.ts#L29-L30).

### 7.2 Manual refresh

`useCoreData().refresh()` re-runs `loadSnapshot()`. Triggered by:

- Error `Retry` buttons on `<Banner>` and portal error states.
- After `sendInvite`/`resendInvite`/`revokeInvite` (to update the invite list).

### 7.3 After a mutation

Pages typically rely on the optimistic snapshot patching; they do **not** call `refresh()` after every save. This avoids a full snapshot re-fetch after a trivial field edit.

Next: [10 · Non-functional requirements](./10-nfr.md).

