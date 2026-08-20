# 11 · Integrations & Ingestion Topology

Where the portal ends and n8n / Bison begin. This file is the implementation pair to [BUSINESS_LOGIC.md §2 System boundaries](../../BUSINESS_LOGIC.md#2-system-boundaries) and [§9 Notifications](../../BUSINESS_LOGIC.md#9-notifications).

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
             Bison / Aimfox ──daily pull──▶  n8n  ──UPSERT──▶  Supabase
                                    │                    │
                                    │ webhooks           │
                                    ▼                    ▼
                              Email / SMS         Portal SPA (read + scoped write)
                                                         │
                                                         └──▶ Marketing site (Webflow)
                                                              anon RPC, aggregate counters only
```

Four actors that touch Supabase:

- **n8n** — service-role writes. Owns ingestion + dispatch.
- **Portal** — anon-key writes through RLS. Owns configuration + qualification.
- **Edge functions** (`send-invite`, `manage-invites`) — service-role inside Supabase, invoked by the portal with a JWT, used only for invitation flows.
- **Marketing site (Webflow)** — **read-only, unauthenticated, aggregates only.** Calls
  `POST /rest/v1/rpc/public_lead_stats` with the project's publishable key and renders the five lead
  counters it returns. It reads no table, no row and no per-client dimension; `anon` has no SELECT
  policy anywhere. This is the single documented exception to "every read goes through the ORM
  gateway" ([ADR-0014](../../adr/0014-public-marketing-stats-rpc.md); function spec in
  [03-data-model §4a](03-data-model.md#4a-public-functions-anon-callable), formula in
  [04-metrics-catalog §16](04-metrics-catalog.md#16-public-marketing-counters)).

The portal **never** reaches Bison/Aimfox directly. n8n is the only system that talks to those vendors. Per-client vendor credentials live in `client_sequencers` (ADR-0008), written by the portal, read by n8n.

---

## 2. Ingestion-only tables

The portal must **never** issue INSERT or UPDATE against these. They are populated by n8n (or a future ingestion replacement) using the service role.

Read windows are enforced **server-side** in the `orm-gateway` edge function ([ADR-0008](../../adr/0008-orm-gateway-edge-function.md)); each page requests only the action it needs ([ADR-0009](../../adr/0009-per-page-data-contracts.md)).

| Table | Write source | Read window (gateway) | Read scope |
|-------|--------------|-----------------------|------------|
| `replies` | n8n: insert + classify | never bulk-loaded. List/dashboard actions read **server-side aggregates only** (reply count + last reply per lead, e.g. [orm-gateway/index.ts:1931](../../../supabase/functions/orm-gateway/index.ts#L1931)); the full thread for **one** lead is fetched on demand by `loadLeadDetail` ([index.ts:2011](../../../supabase/functions/orm-gateway/index.ts#L2011), full history, no window) | scoped via RLS |
| `campaign_daily_stats` | n8n: daily UPSERT on (`campaign_id`, `report_date`) | last **90 days** — `CAMPAIGN_DAILY_STATS_WINDOW_DAYS` ([index.ts:19](../../../supabase/functions/orm-gateway/index.ts#L19)) | scoped via set-based RLS |
| `daily_stats` | n8n: daily UPSERT on (`client_id`, `report_date`) | last **180 days** — `DAILY_STATS_WINDOW_DAYS` ([index.ts:20](../../../supabase/functions/orm-gateway/index.ts#L20)) | scoped via RLS |
| `sequencer_daily_stats` (ADR-0012) | **Historical rows only, from a one-off sheet backfill** — [`sheets-aimfox-metrics-backfill`](../../../automation/n8n/workflows/ops/sheets-aimfox-metrics-backfill/README.md) wrote the table's first 117 rows on 2026-07-22 (5 clients, 2026-06-18…07-22, `profile_id = '__workspace_total__'`, `invites_accepted` NULL — the sheet does not carry acceptances). **No recurring writer exists**; before that date the table had never been written at all (verified 2026-07-21). *Specified* writer: n8n `Get Metrics from Aimfox`, 2-hourly, UPSERT on (`client_id`, `sequencer_id`, `profile_id`, `report_date`) — `invites_sent`/`invites_accepted` (daily, from `/analytics/interactions` buckets), `remaining_database_size` (**deprecated 2026-08-19 — nothing reads it**; was Σ active campaigns `audience_size − sent_connections`, and `audience_size` is a fixed vendor ceiling, so it ran ~20x high. Now Σ `target_count − sent_connections`), `invite_limit` (weekly cap = Σ accounts `limit.connect`), `invite_limit_remaining` (left today), `schedule_today/tomorrow/day_after` (min(daily_limit, …) formulas), `profile_id` = Aimfox account id. The workflow computes every one of these and writes them **to the PDCA spreadsheet**; the schema was designed by reading it ([`20260705`](../../../supabase/migrations/20260705_sequencer_daily_stats_schedule.sql)) and the Supabase write was never built — no Postgres node, no Supabase URL in the graph. Closing this is phase A of [LinkedIn outreach (Aimfox)](../processes/outreach/linkedin-aimfox.md) | not read by the portal yet (phase-2 UI) | scoped via set-based RLS |
| `email_accounts` (`20260720e`) | **n8n from Winnr**: UPSERT on `winnr_email_user_id` from `/v1/email-users` (mailbox identity) + `/v1/warming` (current health score, inbox/spam rate, daily volume, warm-up progress) | read whole by `loadEmailAccountsPage` / `loadDomainsPage` (no window; one row per mailbox) | scoped via set-based RLS (through `domain → client`) |
| `email_account_warming_daily` (`20260720e`) | **n8n from Winnr**: UPSERT on (`email_account_id`, `metric_date`) from `/v1/warming/{id}/metrics` | fetched per-mailbox on demand by `loadEmailAccountWarming` (full history, no window) | scoped via set-based RLS (through `email_account → domain → client`) |

**Winnr** is the mailbox/warming provider. n8n owns the puller (`/v1/domains → /v1/email-users → /v1/warming → /v1/warming/{id}/metrics`); the portal never calls Winnr directly (ADR-0001, [OoS-12](13-out-of-scope.md)). Passwords are intentionally not stored — Winnr does not return them. `domains` carries Winnr sync columns (`winnr_status`, `winnr_domain_id`, `last_synced_at`, `missing_since`, `raw_payload`, …) written only by n8n (`20260720f`); the daily sync **does not create unknown domains** (they need a local `client_id`) — it reports them as unmatched. Each n8n run is logged to **`integration_sync_runs`** (per-provider counters: domains/mailboxes/warming seen·resolved·upserted·unmatched, `status`, `error_message`) — n8n-owned, RLS-enabled with no policy (service_role only).

The `domains` and `invoices` tables sit in the middle: rows arrive from ingestion, but the portal **mutates operational fields** (status, reputation, dates for domains; status, amount, issue date for invoices). New row creation is ingestion-only. (`email_accounts` warming fields are the mailbox equivalent — but those are ingestion-only, never portal-edited.)

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
| `client_sequencers` (table) | Per-client sequencer credentials: `api_key` + `external_workspace_id` (text) per `sequencers` row (emailbison / aimfox — fixed UUIDs `…0002`/`…0003`). Replaced `clients.external_api_key` / `external_workspace_id` / `linkedin_api_key` (ADR-0008) | n8n (join `sequencers` on `key`) |
| `email_exclude_list` | Agency-wide domain blacklist | n8n (pre-send filter) |

Editing these in the portal does not produce immediate side-effects. n8n picks up changes on its next run (timing depends on n8n flow schedule).

### n8n cutover for the 2026-07-04 sequencer migration

Between `20260704_sequencers_catalog.sql` (applied) and `20260704b_drop_client_sequencer_credentials.sql` (deferred), both the old `clients.*` columns and `client_sequencers` are readable. Before the drop is applied, every n8n workflow reading the old columns must switch to:

```sql
select cs.client_id, cs.api_key, cs.external_workspace_id, cs.settings
from client_sequencers cs join sequencers s on s.id = cs.sequencer_id
where s.key = 'emailbison' and cs.enabled;  -- aimfox: s.key = 'aimfox'
```

**`campaigns`, Aimfox columns (2026-08-19).** Four columns carry per-campaign facts that the grid's
LinkedIn capacity band reads: `invites_sent` / `invites_accepted` (cumulative over the campaign's
life, from `GET /campaigns/{id}/metrics`), `message_steps` (Σ `flows[].flow_message_templates`, the
Li/Lf service level) and `metrics_synced_at`. **Two workflows write one row on disjoint column sets:**
[`aimfox-campaign-sync`](../../../automation/n8n/workflows/ingestion/aimfox-campaign-sync/README.md)
owns identity, `status` and `database_size`; `aimfox-daily-metrics` owns those four and issues an
`UPDATE`, never an `INSERT` — a campaign the catalog has not synced yet waits for the next hour
rather than being half-created with no name or client. All four are nullable with no default:
`NULL` means "never measured", `0` means "measured, and it is zero", and the acceptance-rate
denominator needs that difference.

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

> **Superseded for the OOO write-path by [ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md).**
> OOO is no longer a state on `leads`. An out-of-office reply now creates an `ooo_followups` **episode**
> for a `sequencer_contacts` row; a CRM lead is created only by a positive reply. n8n writes through the
> `SECURITY DEFINER` RPCs in `20260722e_ooo_rpcs.sql`, never by mutating `leads`. See §6a below.

The portal owns the **routing rules** that the RPCs consume:

- `clients.auto_ooo_enabled` — global on/off per client. When `false`, `record_ooo_followup` records the
  episode as `skipped / automation_disabled` (visible, not dropped).
- `client_ooo_routing` rows — mapping `(client_id, routing_key, campaign_id, is_active)`. `routing_key` is
  an **explicit** `male | female | general` (ADR-0015 replaced the nullable `gender`; `gender` is dropped by
  the deferred `20260722z`). **`NULL` is never an implicit "general".** Resolution order is specific key →
  `general` → NULL, and NULL surfaces as `skipped / routing_missing`. A partial unique index allows at most
  one **active** row per `(client, routing_key)`; superseded rows are deactivated, never deleted.

The routing UI ships in the client drawer (BL-2, closed by ADR-0015). Saving a rule also runs
`recover_skipped_ooo_followups`, which pulls episodes parked as `routing_missing` / `automation_disabled`
back to `pending`. There is **no** portal list or editor for the episodes themselves
([OoS-16](13-out-of-scope.md)) — n8n owns the lifecycle end to end.

The follow-up campaigns themselves have `campaigns.type = 'ooo_followup'` and are invisible to clients (ADR-0003). Managers and admins see them in the campaigns list.

### Who writes a routing rule

Two writers, split by whether the slot is empty:

- **`bison-workspace-setup`** fills an **empty** rule when it provisions a client, from a campaign it
  has matched to that client by name (`OOO automation | <key>`). It never re-points a rule an
  operator set, never fills from a `completed` or `stopped` campaign, and fills nothing for a key
  whose campaign name is duplicated at the vendor. See
  [workspace provisioning, invariant 10](../processes/ops/workspace-provisioning.md).
- **the portal** (`updateClientOooRouting`) owns every change after that.

### Routing health, and why it is derived rather than stored

A rule pointing at a campaign that is not `active` sends nothing and reads exactly like a working
one. Measured 2026-08-19: **22 of the 25 active rules, across 12 of 16 Active clients**, pointed at a
`completed` or `stopped` campaign, and 80 `pending` episodes were aimed at one.

The rule the portal applies, in both places it surfaces — one definition, in
[`lib/ooo-health.ts`](../../../src/app/lib/ooo-health.ts), with the SQL aggregate as its twin:

```
routed     = count(client_ooo_routing WHERE client_id = c AND is_active)          -- 0..3
live       = of those, the ones whose campaign is `active`   and not archived
awaiting   = of those, the ones whose campaign is `draft`/`launching` and not archived
dead       = routed − live − awaiting
hasGeneral = whether the `general` rule is one of them
healthy   ⇔ hasGeneral AND live = routed
```

Three things this shape is deliberately careful about:

- **Rules are counted, not campaigns.** `bison-campaign-sync` has no removal path, so a workspace can
  hold `ooo_followup` rows for campaigns the vendor no longer has; counting campaigns would score
  those as healthy.
- **A rule whose campaign is archived still counts as `routed`.** The aggregate LEFT-joins and
  filters archival inside the `FILTER`, so such a client cannot vanish from the result and render as
  "never configured" when in fact it has three rules that cannot work. Archiving through the portal
  deactivates the routes pointing at the campaign (migration `20260813`) and `resolve_ooo_routing`
  filters `archived_at is null`, so the episodes park as `routing_missing` rather than being sent
  anywhere — recoverable, but only once somebody is told the rule is dead.
- **Coverage is a separate question from sending, and counts alone cannot answer it.** One live
  rule is complete when it is `general` — `resolve_ooo_routing` falls back to it for every key with
  no rule of its own — and badly incomplete when it is `male`, where female and general contacts
  park as `routing_missing`. Both read `1/1`. Hence `hasGeneral` in the healthy test: without it a
  client with a single `male` rule scored a green 1/1. (Note this is *coverage*, not the count 3 —
  a client routed only through `general` is genuinely healthy.)
- **`awaiting` is separate from `dead`.** Both read `0/3`, and they need different people: a draft
  needs its copy written in Bison (the expected state right after provisioning), a `stopped` campaign
  needs re-creating at the vendor and the rule re-pointing. Folding them together made a successful
  onboarding read as a disaster. That split is the portal's twin of the `ROUTABLE` set in
  `bison-workspace-setup` — provisioning fills a rule from a routable campaign (`active | launching |
  draft`) and never from a dead one.

`auto_ooo_enabled = false` mutes the indicator rather than reddening it — such a client routes
nothing by design.

Surfaces: the **OOO** column on the Clients page (`live/routed`) and the warnings in the drawer's
OOO routing section. Both are computed on read, never cached into `client_sequencers.setup_state` —
a provisioning verdict is a snapshot of the last time somebody pressed Check, and this failure
happens months later, when a workspace's inboxes change and Bison stops the campaign.

**Freshness caveat.** `campaigns.status` is refreshed hourly by `bison-campaign-sync`, whose
`Get Active Clients` only walks clients with `status = 'Active'`. A client in `Onboarding` therefore
shows whatever status was last observed. The grid's tooltip carries `max(campaigns.updated_at)` with
how long ago that was; the drawer says only that statuses are synced hourly for Active clients,
because `ClientOooRoutingPagePayload` carries no timestamp — the drawer is where the rule is
repaired, and the campaign's status is re-read the moment provisioning runs.

---

## 6. Reply classification

Every reply that arrives is classified by n8n using LLM + heuristic rules. The classification value lands in `replies.classification` (one of `OOO | Interested | NRR | Left_Company | Spam_Inbound | other | negative | neutral`). `negative` and `neutral` were added by `20260722b` so outreach analytics can count them separately (§15); the domain-name mapping the spec uses (`positive` = `Interested`, `out_of_office` = `OOO`, `not_right_role` = `NRR`, `other_automated` = `Spam_Inbound`/`Left_Company`/`other`) lives here, at the boundary — the stored labels are the live contract and are on every historical row, so they are **not** renamed.

The portal **does not classify** and **does not provide a manual triage UI** ([decision in BUSINESS_LOGIC §10](../../BUSINESS_LOGIC.md#10-out-of-scope-legacy)). If unclassified replies appear in raw data, that indicates ingestion/classification lag in n8n rather than a portal action item.

### 6a. OOO / NRR write-path (ADR-0015 — the current contract)

An OOO/NRR reply describes an **outreach contact**, not a CRM lead, so nothing about it is written to `leads`
any more. n8n calls, idempotently and in order:

| Step | RPC | Effect |
|---|---|---|
| 1 | `upsert_sequencer_contact(client_sequencer_id, external_contact_id, …)` | find/create the scoped contact identity |
| 2 | `upsert_reply(external_id, sequencer_contact_id, …, classification)` | store the reply (idempotent on `external_id`; `lead_id` NULL — a reply needs no lead) |
| 3 (OOO only) | `record_ooo_followup(sequencer_contact_id, source_reply_id, expected_return_date, scheduled_for, date_source)` | create/refresh the ONE active episode; resolves routing; missing config → visible `skipped` |
| on positive reply | `promote_contact_to_lead(sequencer_contact_id, origin_reply_id, campaign_id, lead)` | create the CRM lead (one per contact), link the reply, cancel the active episode |
| on OOO removed / correction | `cancel_active_ooo_followup(sequencer_contact_id, reason)` | cancel — never delete; the history stays |

Key contract points n8n must respect:

- **`expected_return_date` vs `scheduled_for` are different fields.** `expected_return_date` is the date
  actually parsed from the reply and MUST be `NULL` when none was parseable — never a fallback date.
  `scheduled_for` is when to re-enrol and may use the fallback (today + 2). `date_source` records which.
- **A dateless refresh never erases a known date.** Passing `NULL` for `expected_return_date`/`scheduled_for`
  on a repeat OOO reply leaves the stored values alone (an earlier reply may have determined them).
- **NRR does NOT create a lead** and does NOT set `final_outcome = 'lost'` — a lost outcome is a human
  decision on a lead that already exists.
- **`promote_contact_to_lead` takes a strict whitelist.** `client_id`, `sequencer_id`, `external_id`,
  `qualification`, `won`, timestamps etc. are derived inside the function; a repeat call returns the existing
  lead with `created: false` rather than raising.
- **`reply_text` is derived, not passed.** The function already reads the origin reply row (contact check,
  classification gate, `received_at`), so since `20260815b` it copies that reply's `message_text` onto
  `leads.reply_text` itself. Callers must not send it — the key is not in the whitelist and would raise.
  The value is frozen at creation: it is the reply that made the lead, matching the sheet's `Mail from lead`,
  while `replies` stays the authoritative thread.

**Legacy disposition display — REMOVED 2026-07-22.** The old display-only fallback (rows where
`leads.qualification` was `'OOO'`/`'NRR'` rendered via `deriveContactDisposition`) is gone. The
disposition column + resolver, the CRM "Disposition" column, and the `OOO`/`NRR` `lead_qualification`
values were all removed from the portal and gateway, and
[`supabase/migrations/20260722z_drop_legacy_ooo_columns.sql`](../../../supabase/migrations/20260722z_drop_legacy_ooo_columns.sql)
(no longer deferred) drops the underlying columns + enum values. Its remaining precondition is the
deploy order: **redeploy `orm-gateway` before applying it** — see the file header.

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
