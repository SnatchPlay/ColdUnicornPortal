# 11 · Integrations & Ingestion Topology

Where the portal ends and n8n / Smartlead / Bison begin. This file is the implementation pair to [BUSINESS_LOGIC.md §2 System boundaries](../../BUSINESS_LOGIC.md#2-system-boundaries) and [§9 Notifications](../../BUSINESS_LOGIC.md#9-notifications).

## Contents

1. [Topology](#1-topology)
2. [Ingestion-only tables](#2-ingestion-only-tables)
3. [Configuration tables (portal-owned)](#3-configuration-tables-portal-owned)
4. [Notifications dispatch](#4-notifications-dispatch)
5. [OOO routing](#5-ooo-routing)
6. [Reply classification](#6-reply-classification)
7. [Failure modes & invariants](#7-failure-modes--invariants)
8. [CRM integration](#crm-integration)

---

## 1. Topology

```
Smartlead / Bison / Aimfox ──daily pull──▶  n8n  ──UPSERT──▶  Supabase
                                    │                    │
                                    │ webhooks           │
                                    ▼                    ▼
                              Email / SMS         Portal SPA (read + scoped write)
```

Three actors that touch Supabase:

- **n8n** — service-role writes. Owns ingestion + dispatch.
- **Portal** — anon-key writes through RLS. Owns configuration + qualification.
- **Edge functions** (`send-invite`, `manage-invites`) — service-role inside Supabase, invoked by the portal with a JWT, used only for invitation flows.

The portal **never** reaches Smartlead/Bison/Aimfox directly. n8n is the only system that talks to those vendors. Per-client vendor credentials live in `client_sequencers` (ADR-0008), written by the portal, read by n8n.

---

## 2. Ingestion-only tables

The portal must **never** issue INSERT or UPDATE against these. They are populated by n8n (or a future ingestion replacement) using the service role.

Read windows are enforced **server-side** in the `orm-gateway` edge function ([ADR-0008](../../adr/0008-orm-gateway-edge-function.md)); each page requests only the action it needs ([ADR-0009](../../adr/0009-per-page-data-contracts.md)).

| Table | Write source | Read window (gateway) | Read scope |
|-------|--------------|-----------------------|------------|
| `replies` | n8n: insert + classify | never bulk-loaded. List/dashboard actions read **server-side aggregates only** (reply count + last reply per lead, e.g. [orm-gateway/index.ts:1807](../../../supabase/functions/orm-gateway/index.ts#L1807)); the full thread for **one** lead is fetched on demand by `loadLeadDetail` ([index.ts:1949](../../../supabase/functions/orm-gateway/index.ts#L1949), full history, no window) | scoped via RLS |
| `campaign_daily_stats` | n8n: daily UPSERT on (`campaign_id`, `report_date`) | last **90 days** — `CAMPAIGN_DAILY_STATS_WINDOW_DAYS` ([index.ts:19](../../../supabase/functions/orm-gateway/index.ts#L19)) | scoped via set-based RLS |
| `daily_stats` | n8n: daily UPSERT on (`client_id`, `report_date`) | last **180 days** — `DAILY_STATS_WINDOW_DAYS` ([index.ts:20](../../../supabase/functions/orm-gateway/index.ts#L20)) | scoped via RLS |
| `sequencer_daily_stats` (ADR-0012) | n8n ("Get Metrics from Aimfox", 2-hourly): UPSERT on (`client_id`, `sequencer_id`, `profile_id`, `report_date`) — `invites_sent`/`invites_accepted` (daily, from `/analytics/interactions` buckets), `remaining_database_size` (Σ active campaigns `audience_size − sent_connections`), `invite_limit` (weekly cap = Σ accounts `limit.connect`), `invite_limit_remaining` (left today), `schedule_today/tomorrow/day_after` (min(daily_limit, …) formulas). `profile_id` = Aimfox account id, `''` = client rollup (current workflow) | not read by the portal yet (phase-2 UI) | scoped via set-based RLS |

The `domains` and `invoices` tables sit in the middle: rows arrive from ingestion, but the portal **mutates operational fields** (status, reputation, dates for domains; status, amount, issue date for invoices). New row creation is ingestion-only.

`leads` similarly: ingestion creates and enriches; the portal mutates only the ADR-0004 whitelist.

`campaigns`: ingestion creates; portal mutates `name`, `status`, `database_size`, `positive_responses`.

If you find yourself wanting to INSERT into one of the ingestion-only tables from the portal, stop and check whether n8n should do it instead.

---

## 3. Configuration tables (portal-owned)

These exist primarily so the portal can write configuration that downstream systems (n8n) consume.

| Table / column | What | Read by |
|----------------|------|---------|
| `clients.notification_emails` (text[]) | Where n8n sends email alerts for this client | n8n |
| `clients.sms_phone_numbers` (text[]) | Where n8n sends SMS alerts | n8n |
| `clients.auto_ooo_enabled` (bool) | Is OOO auto-routing on? | n8n (gate) |
| `client_ooo_routing` (table) | Mapping of `(client, gender?)` → follow-up `campaign_id` | n8n (rule source) |
| `client_sequencers` (table) | Per-client sequencer credentials: `api_key` + `external_workspace_id` (text) per `sequencers` row (smartlead / emailbison / aimfox — fixed UUIDs `…0001`/`…0002`/`…0003`). Replaced `clients.external_api_key` / `external_workspace_id` / `linkedin_api_key` (ADR-0008) | n8n (join `sequencers` on `key`) |
| `email_exclude_list` | Agency-wide domain blacklist | n8n (pre-send filter) |

Editing these in the portal does not produce immediate side-effects. n8n picks up changes on its next run (timing depends on n8n flow schedule).

### n8n cutover for the 2026-07-04 sequencer migration

Between `20260704_sequencers_catalog.sql` (applied) and `20260704b_drop_client_sequencer_credentials.sql` (deferred), both the old `clients.*` columns and `client_sequencers` are readable. Before the drop is applied, every n8n workflow reading the old columns must switch to:

```sql
select cs.client_id, cs.api_key, cs.external_workspace_id, cs.settings
from client_sequencers cs join sequencers s on s.id = cs.sequencer_id
where s.key = 'emailbison' and cs.enabled;  -- aimfox: s.key = 'aimfox'
```

Notes for n8n: `external_workspace_id` is now **text** (cast if an int is needed); email campaign/lead inserts keep working unchanged (`sequencer_id` defaults to EmailBison) but Aimfox flows **must** set `sequencer_id = '00000000-0000-4000-a000-000000000003'`; new write target `sequencer_daily_stats` (see §2). The Aimfox token moves from the PDCA sheet's `col_105` to the aimfox `client_sequencers.api_key`; the sheet's `col_5` workspace id maps to the emailbison row's `external_workspace_id` for client resolution.

Known workflow quirk to fix at cutover: the sheet's "Invitations limit" cell stores `daily_limit − buckets[1] − buckets[0]` while `sent_today = buckets[1] − buckets[0]` — the remaining-limit formula double-subtracts and can understate the limit; in `sequencer_daily_stats` the two quantities are separate columns (`invite_limit` weekly cap vs `invite_limit_remaining`).

---

## 4. Notifications dispatch

The portal does not send any notification. It maintains the destination lists.

```
Manager opens /manager/clients
    ↓ row click → drawer
    ↓ edits notification_emails (CSV) and sms_phone_numbers (CSV)
    ↓ Save → updateClient(...)
    ↓
Supabase clients row updated
    ↓ ←── n8n re-reads on next trigger evaluation
n8n decides "trigger fires for client X"
    ↓
n8n dispatches email / SMS to addresses in client.notification_emails / sms_phone_numbers
```

Triggers (new MQL, stalled campaign, sentiment shift, etc.) are configured **inside n8n flows**, not in the portal. There is no "notification preferences" data in the portal beyond the destination lists.

Planned (BL-1): expose the destination lists to the client themselves on `/client/settings`. The schema does not need to change; only the UI.

---

## 5. OOO routing

When a reply lands and is classified as `OOO`, n8n optionally enrols the lead into a designated follow-up campaign in Smartlead/Bison. The portal owns the **rules**:

- `clients.auto_ooo_enabled` — global on/off per client. Today this is the only field exposed in the manager drawer.
- `client_ooo_routing` rows — fine-grained mapping `(client_id, gender?, campaign_id, is_active)`. Each row tells n8n "for this client, leads of this gender go to this follow-up campaign". `gender = NULL` means "applies to all".

UI to manage `client_ooo_routing` rows is on the backlog (BL-2). Until it ships, rows are inserted by SQL or by n8n itself when bootstrapping a client.

The follow-up campaigns themselves have `campaigns.type = 'ooo_followup'` and are invisible to clients (ADR-0003). Managers and admins see them in the campaigns list.

---

## 6. Reply classification

Every reply that arrives is classified by n8n using LLM + heuristic rules. The classification value lands in `replies.classification` (one of `OOO | Interested | NRR | Left_Company | Spam_Inbound | other`).

The portal **does not classify** and **does not provide a manual triage UI** ([decision in BUSINESS_LOGIC §10](../../BUSINESS_LOGIC.md#10-out-of-scope-legacy)). If unclassified replies appear in raw data, that indicates ingestion/classification lag in n8n rather than a portal action item.

### 6a. Contact disposition write-path (ADR-0013, CRM split status model)

The CRM view's disposition dimension (OOO / NRR) is stored in its **own** column, `leads.contact_disposition`
(`out_of_office | not_right_role | NULL`), independent of `leads.qualification`. This is a deliberate split
(spec item 10): a disposition change must **not** overwrite the funnel stage.

**Required n8n contract:**

| Reply classification | n8n MUST write | n8n MUST NOT do |
|---|---|---|
| `OOO` | `leads.contact_disposition = 'out_of_office'` | overwrite `leads.qualification` |
| `NRR` | `leads.contact_disposition = 'not_right_role'` | set `final_outcome = 'lost'` (a lost outcome is an explicit human decision) |
| active again | `leads.contact_disposition = NULL` | — |

- **Stage independence:** `crm_stage` derives from `qualification` + offer/meeting facts only. With this contract, `MQL + OOO` stays `MQL` and `SQL + OOO` stays `SQL`.
- **Legacy fallback (display-only):** for OLD rows where `qualification` is already `'OOO'`/`'NRR'`, the read-model maps that legacy value to a display disposition (`deriveContactDisposition`). This is a **fallback for display**, not a data fix — the prior qualification of a legacy OOO/NRR row **cannot be reconstructed** without historical data, so there is **no backfill** into preMQL/MQL/lost.
- **CHECK:** `leads_contact_disposition_check` restricts the column to `out_of_office | not_right_role | NULL`.

Until n8n is updated to write the column, existing OOO/NRR rows still render correctly via the legacy fallback; new OOO/NRR events keep overwriting `qualification` (the pre-existing behaviour) until the cutover lands.

---

## 7. Failure modes & invariants

Important boundary behaviours to preserve:

- **No realtime.** The portal does not subscribe to Supabase channels. After ingestion writes a new row, the portal sees it on the next snapshot reload (manual refresh, or post-mutation if the same record is mutated). Acceptable trade-off; if it ever stops being acceptable, look at adding selective subscriptions for `replies` and `campaign_daily_stats`.
- **Snapshot windows are per-table.** Widening the 90/180-day windows risks the authenticated-role `statement_timeout`. Set-based RLS ([10-nfr §3](./10-nfr.md#3-rls-performance)) is required.
- **Ingestion idempotency** rests on UNIQUE constraints: `campaigns.external_id`, `replies.external_id`, `(campaign_daily_stats.campaign_id, report_date)`, `(daily_stats.client_id, report_date)`. Do not loosen these.
- **Orphan replies** — `replies.client_id` is nullable. Some ingestion paths land a reply before the lead/client mapping resolves. RLS treats `client_id IS NULL` as visible to all internal users. If this proves to be a leak vector, the fix is on the ingestion side (resolve `client_id` before insert), not in the portal.
- **`replies.lead_id`** is also nullable for the same reason. The `private.can_access_reply(client_id, lead_id)` helper handles both.
- **Edge function 401 retry.** The portal refreshes the session and retries once on 401 ([repository.ts:250-256](../../../src/app/data/repository.ts#L250-L256)). If retries fail, do not retry further — surface to the user.

If integration breaks, the portal should keep working in read-only mode using whatever was last ingested. Do not add fallback "portal sends emails directly" code paths.

---

## CRM integration

Lets a client authorize their own CRM (Salesforce / Zoho / API-key providers like HubSpot, Pipedrive, monday) so n8n can sync meetings, replies, and won deals downstream.

**Two-Supabase architecture.** The CRM provider catalog (`crm_providers`, `crm_provider_fields`) and OAuth/credentials edge functions live on a **separate Supabase project** (the legacy CRM project, `ykrwrrwuqbtffovhwqjg`). Our project (`bnetnuzxynmdftiadwef`) only stores **status mirror** in `clients.crm_config`. Tokens and secrets never reach our project.

```
Client portal (this repo)                Legacy CRM Supabase project
─────────────────────                    ───────────────────────────
/client/settings                         crm_providers (catalog)
   ↓ CrmIntegrationCard                  crm_provider_fields
   ↓ select provider, fill form          oauth_sessions (PKCE state)
   ├─ API-key  ──fetch──▶  submit-crm-credentials
   │                            ↓
   │                       client_crm_credentials
   │                            ↓ POST
   │                       Make / n8n webhook
   │                            ↓
   │                       n8n connects to CRM
   ├─ Salesforce OAuth ──▶ salesforce-oauth/init  ──redirect──▶ login.salesforce.com
   │                                                              ↓ user consents
   │                       salesforce-oauth/callback  ◀──redirect──┘
   │                            ↓
   │                       salesforce_integrations + Make webhook
   │                            ↓ redirect back to portal with ?status=connected
   │                       /client/settings  ──updateClient(crm_config)──▶ our DB
   └─ Zoho OAuth ──▶ accounts.zoho.{region}/oauth/v2/auth  ──redirect─┐
                                                                        ↓
                       /client/settings  (code in URL)  ──fetch──▶ zoho-token-exchange
                                                                        ↓
                                                                Make webhook + our DB
```

**`clients.crm_config`** (JSON, mirror only — see [`CrmIntegrationConfig`](../../../src/app/types/core.ts)):

```jsonc
{
  "provider": "salesforce",
  "display_name": "Salesforce",
  "auth_type": "oauth2",
  "status": "connected",        // pending | connected | failed | disconnected
  "connected_at": "2026-05-03T18:22:04Z",
  "updated_at": "2026-05-03T18:22:04Z",
  "last_error": null,
  "metadata": { "env": "production" }
}
```

**Env vars.** `VITE_LEGACY_CRM_SUPABASE_URL` + `VITE_LEGACY_CRM_PUBLISHABLE_KEY`. If either is blank the CRM card hides itself with an inline notice — no other code paths require them.

**Files.**
- [`src/app/lib/crm-integration.ts`](../../../src/app/lib/crm-integration.ts) — separate Supabase client, provider fetcher, edge-function callers.
- [`src/app/components/crm-integration-card.tsx`](../../../src/app/components/crm-integration-card.tsx) — UI + status persistence to `clients.crm_config`.
- [`src/app/pages/settings-page.tsx`](../../../src/app/pages/settings-page.tsx) — renders the card when `identity.role === "client"`.

**Security boundary invariants:**
- The legacy publishable key in our `.env` is the **anon** key for the legacy project. It only grants access to the policies on `crm_providers` (read) + the verify-jwt-disabled edge functions. It does **not** unlock token tables.
- The portal **never** receives access tokens. Token storage is in the legacy project's `salesforce_integrations` / `client_crm_credentials` and from there forwarded to the Make/n8n webhook.
- Disconnect (`updateClient(clientId, { crm_config: null })`) only clears our status mirror. Cleanup on the legacy side is a manual / n8n responsibility — flag this if/when it becomes a real concern.

**Why two projects?** The CRM-integration form shipped first as a standalone tool on its own Supabase project. Re-pointing the edge functions + secrets at our project means migrating Salesforce App callback URLs, `MAKE_WEBHOOK_URL`, and re-doing the security review. Cheaper to call across projects until that work is justified.

**Backlog (Phase 2).** Move `crm_providers` + edge functions into our project so `crm_config` and tokens are co-located, with proper RLS gating reads to the owning client. Tracked in [BUSINESS_LOGIC §11](../../BUSINESS_LOGIC.md#11-open-backlog-planned-not-built).

---

Next: [12 · Hidden rules & constants](./12-hidden-rules.md).
