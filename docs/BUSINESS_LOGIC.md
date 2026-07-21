# Business Logic Specification вЂ” ColdUnicorn PDCA Portal

**Status:** Authoritative. Updated whenever scope changes.
**Last revision:** 2026-07-14.
**Audience:** Product owner, engineers, managers, support, AI agents.

This document describes **what the product is**, **what it does for each role**, **what it explicitly does not do**, and **how it is bounded against external systems** (Supabase, n8n). It is the canonical business specification вЂ” when reality diverges from this file, this file wins until it is updated.

For implementation detail (file paths, formulas, RLS policies) see [docs/reference/functional/INDEX.md](reference/functional/INDEX.md). This document focuses on **intent**, not code.

---

## Contents

1. [Product summary](#1-product-summary)
2. [System boundaries](#2-system-boundaries)
3. [Roles and responsibilities](#3-roles-and-responsibilities)
4. [Functional scope](#4-functional-scope)
5. [Domain entities and lifecycle](#5-domain-entities-and-lifecycle)
6. [Workflows](#6-workflows)
7. [Data ownership matrix](#7-data-ownership-matrix)
8. [Settings & ecosystem configuration](#8-settings--ecosystem-configuration)
9. [Notifications](#9-notifications)
10. [Out of scope (legacy)](#10-out-of-scope-legacy)
11. [Open backlog (planned, not built)](#11-open-backlog-planned-not-built)
12. [Decisions log](#12-decisions-log)
13. [Update policy](#13-update-policy)

---

## 1. Product summary

ColdUnicorn PDCA Portal is the **agency operations cockpit** for running outbound email outreach on behalf of B2B clients. It serves three audiences in one application:

- **Clients** see their pipeline, results, and contracted KPI progress.
- **Customer-success Managers** ("CS Managers") run day-to-day operations on assigned clients.
- **Admins / Super-admins** manage the entire agency: users, all clients, billing, blacklist, and workspace integrations.

The platform does not generate or send emails. Outbound sending, reply ingestion, and notification dispatch happen **outside the portal** (Smartlead/Bison + n8n). The portal is the *visualisation, qualification, and configuration* surface on top of a shared Supabase database that those systems write into.

The product cycle is PDCA: **Plan** (campaigns, domains, contracted KPIs), **Do** (sends + replies arrive), **Check** (DoD/3-DoD/WoW/MoM dashboards), **Act** (qualify leads, mark milestones, escalate).

---

## 2. System boundaries

The portal is one of three cooperating systems. Each owns a clear slice of behavior. Confusing the boundaries is the most common source of "missing feature" reports.

```
                  в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
                  в”‚     External outreach       в”‚
                  в”‚   (Smartlead / Bison)       в”‚
                  в”‚  в†’ sends emails, captures   в”‚
                  в”‚    replies, exposes API     в”‚
                  в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”¬в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
                                 в”‚
                                 в”‚ daily pull / webhook
                                 в–ј
   в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
   в”‚                         n8n                              в”‚
   в”‚  вЂў Pulls counters в†’ writes campaign_daily_stats /       в”‚
   в”‚     daily_stats                                          в”‚
   в”‚  вЂў Classifies replies в†’ writes replies + classification в”‚
   в”‚  вЂў Reads client_ooo_routing в†’ assigns OOO leads to      в”‚
   в”‚     follow-up campaigns in Smartlead/Bison              в”‚
   в”‚  вЂў Sends notifications by email / SMS based on          в”‚
   в”‚     clients.notification_emails + sms_phone_numbers     в”‚
   в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
                                 в”‚
                                 в”‚ INSERT / UPDATE
                                 в–ј
        в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
        в”‚           Supabase (Postgres)            в”‚
        в”‚   tables, enums, RLS, edge functions     в”‚
        в”‚   в†ђ single source of truth               в”‚
        в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
                                 в–І
                                 в”‚ POST /functions/v1/orm-gateway
                                 в”‚ (publishable key; RLS re-applied in-tx)
                                 в–ј
        в”Њв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”ђ
        в”‚     This Portal (React SPA, Vite)        в”‚
        в”‚  вЂў Reads: dashboards, KPIs, drill-downs  в”‚
        в”‚  вЂў Writes: lead qualification, campaign  в”‚
        в”‚     settings, client config, blacklist,  в”‚
        в”‚     invitations                          в”‚
        в””в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”
```

### Portal responsibilities

- **Display** every metric a stakeholder needs (KPIs, charts, tables, drilldowns).
- **Qualify** leads (lead drawer: qualification, milestones, comments).
- **Configure** clients, campaigns, domains, invoices (manager / admin drawers).
- **Manage** users (admin invitations) and the email blacklist (admin).
- **Persist** notification destinations (`clients.notification_emails`, `sms_phone_numbers`) so n8n knows where to send alerts.
- **Persist** per-client sequencer connections (`client_sequencers`: EmailBison workspace/API key, Aimfox API key) that n8n reads before calling sequencer APIs (ADR-0008).

### n8n responsibilities

- **Ingestion:** populate `campaign_daily_stats`, `daily_stats`, `replies` (with classification), `domains` reputation/verification updates, and `sequencer_daily_stats` (Aimfox LinkedIn invitation counters, remaining database size, invite limits — ADR-0008).
- **Routing:** consume `client_ooo_routing` rows + OOO replies to assign follow-up campaigns in Smartlead/Bison.
- **Notifications:** dispatch email/SMS to addresses found in `clients.notification_emails` / `sms_phone_numbers` when triggers fire (new lead, stalled campaign, etc.).
- **Reply classification:** every reply that lands in `replies` is classified by n8n (using LLM + rules). The portal does not re-classify; "unclassified" is a transient ingestion state, not an action item.

### Supabase responsibilities

- **Source of truth** for every table.
- **RLS enforcement** of role boundaries (`public.is_admin_user`, `is_manager_of_client`, `can_access_client`, `is_internal_user`). RLS is *the* security boundary — the portal has no server of its own to enforce access in.
- **Edge functions:**
  - **`orm-gateway`** — the portal's entire data path. The SPA does not query Postgres directly: it POSTs `{ action, ...payload }` to this function, which runs Drizzle + postgres.js and re-establishes the caller's JWT claims and role *inside each transaction*, so RLS still applies. It also computes the server-side aggregates the dashboards need. It is the **single canonical** gateway function. → [ADR-0008](adr/0008-orm-gateway-edge-function.md)
  - **`send-invite`, `manage-invites`** — privileged invitation flows.

### Hard rule

**The portal never writes to ingestion-managed tables.** See [В§7 Data ownership matrix](#7-data-ownership-matrix) for the canonical list.

---

## 3. Roles and responsibilities

Five roles: `client`, `manager` ("CS Manager"), `admin`, `master_admin` ([ADR-0005](adr/0005-master-admin-role.md)), `super_admin`. Detailed UI/route mapping in [docs/reference/functional/02-roles-routes.md](reference/functional/02-roles-routes.md).

### 3.1 Client

**Goal:** see the work being done on their behalf and judge the contract.

Capabilities:

- View own dashboard: MQLs, meetings, won, sent, prospects (with deltas vs previous period).
- View own pipeline (leads), campaigns, statistics вЂ” read-only.
- See replies for their leads.
- Self-service: change profile name, change password.
- **Self-service notifications** (planned A7): edit own `notification_emails` and `sms_phone_numbers` вЂ” the addresses to which n8n delivers alerts. Currently these fields exist and are editable by manager/admin only; client-side editing is on the backlog.

Restrictions:

- Sees only outreach campaigns (`type='outreach'` вЂ” ADR-0003). Internal types (`ooo`, `nurture`, `ooo_followup`) are invisible.
- Cannot edit lead qualification, milestones, or comments (ADR-0004).
- Cannot see other clients, the blacklist, domains, or invoices.

### 3.2 Manager (CS Manager)

**Goal:** run day-to-day operations for an assigned portfolio of clients.

Capabilities:

- All client-side views, but for every assigned client.
- **Edit lead state:** `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments` (the ADR-0004 whitelist).
- **Edit client config:** name, status, contracted KPIs, min daily sent, inboxes count, notification emails, SMS phone numbers, auto-OOO toggle, setup info, manager (admin only вЂ” manager cannot reassign themselves).
- **Edit campaigns:** name, status, database size, positive responses.
- **Edit domains:** local `status` only (legacy reputation / exchange / verification-date fields dropped in `20260720f`; Winnr warming is read-only).
- **Edit invoices:** issue date, amount, status (within ingested invoice rows; managers do not create invoices in the portal).
- **Read** the email blacklist; cannot modify it.
- **Invite** users for assigned clients (admin role inherits the same).
- **Use dynamic condition highlights** on Clients surfaces (read-only for manager) to diagnose operational health.

Restrictions:

- Cannot see clients or any related data outside `manager_id = auth.uid()`.
- Cannot modify `manager_id` of a client (admin-only).
- Cannot create invoices (those land via ingestion).

### 3.3 Admin

**Goal:** run the agency.

Inherits everything Manager can do, with global scope:

- See all clients, leads, campaigns, domains, invoices, replies.
- **User management:** invite admins, managers, clients via `send-invite` edge function; resend, revoke; map users to clients. List all portal users, **change their role**, and **deactivate/reactivate** accounts (soft, not hard-delete; super_admin-only for super_admin targets; last-admin guard).
- **Blacklist write:** add/remove domains in `email_exclude_list`.
- **Reassign managers:** edit `clients.manager_id`.
- **Manage condition rules:** full CRUD of safe JSON DSL rules in `/admin/settings`.
- See agency-wide dashboard (manager capacity, non-active clients, 21-day campaign momentum).

### 3.4 Super-admin

Inherits Admin. Adds:

- **Impersonation:** preview the portal as any admin, manager, or client. View-only (the Supabase session does not change; mutations would be signed by the super-admin and may diverge from the target's real permissions). Use for support; not a substitute for direct sign-in. Gated by `VITE_ALLOW_INTERNAL_IMPERSONATION`.

`super_admin` cannot be invited via UI; the role must be promoted manually in SQL.

---

## 4. Functional scope

This is the canonical scope. Anything not listed here is **legacy** and out of scope unless promoted to the [open backlog](#11-open-backlog-planned-not-built).

### 4.1 In scope (built and shipping)

| Area | Capability |
|------|-----------|
| Auth | Email/password login. Magic link login (flag-gated). Password reset via email. Profile name + password self-edit. |
| Auth | Invite-based user provisioning (admin в†’ admin/manager/client). `super_admin` is SQL-only. |
| Routing | Per-role URL shells (`/client`, `/manager`, `/admin`). Dispatch by `identity.role` for shared pages. Role gating + clientId guard. |
| Sidebar | Role-specific nav; client KPI mini-card (`kpi_leads`/`kpi_meetings` from `clients`); impersonation panel for super-admin. |
| Client dashboard | 5 KPI cards (MQLs, Meetings, Won, Sent, Prospects) with sparklines + trend deltas. 8 charts (daily sent, weekly/monthly leads, prospects added daily/monthly, 3-month sent, velocity, conversion funnel). |
| Client pipeline | Lead list, search, stage chips, campaign filter, reply scope filter, CSV export. Read-only drawer with reply history. |
| Client campaigns | Outreach-only portfolio cards, daily volume line chart, top-10 sent bar. |
| Client analytics | 4 KPI tiles, pipeline activity line chart, daily sent area chart, campaign reply rates, conversion funnel. |
| Manager dashboard | 4 metric cards (Assigned clients, Active campaigns, Leads in progress, Unclassified replies), campaign watchlist, client portfolio with KPI progress, lead queue. |
| Manager clients page | 5 tabs (Overview, DoD, 3-DoD, WoW, MoM) with metric tables. Editable client drawer + user-mapping management + per-cell condition highlights. Row-level triage is a manual 1вЂ“3 heart satisfaction rating (filter + inline edit), not an automatic health rollup. |
| Internal leads | Editable qualification + milestones + comments drawer. Reply history inline. |
| Internal campaigns | Editable metadata drawer + per-campaign daily performance line chart. |
| Internal statistics | Trend lines, qualification donut, campaign portfolio cards. |
| Domains | Editable local `status`; Winnr status + per-domain mailbox warming shown read-only. |
| Invoices | Editable issue date, amount, status. **Creation is ingestion-only.** |
| Blacklist | Admin: add/remove. Manager: read-only banner. |
| Admin user management | Send/resend/revoke invitations. Tabs: Overview / Pending / Accepted / Expired. |
| Admin dashboard | 3 global metric cards. Campaign momentum split into 3 separate 21-day charts (sent/replies/positive). Manager capacity surface (top 8). |
| Settings | All roles: profile name + password + sign out. Internal roles: identity card + reset link sender. Admin/super-admin: condition-rules builder section. |
| Metrics | DoD, 3-DoD, WoW, MoM rollups computed client-side over the snapshot ([04-metrics-catalog.md](reference/functional/04-metrics-catalog.md)). |
| Dynamic health layer | Safe JSON DSL condition rules evaluated against client metric context and rendered on Clients surfaces. |
| Persistence | Resizable column widths (per page) + sidebar visibility persisted in `localStorage`. |

### 4.2 Domain glossary (terminology)

- **MQL** вЂ” Marketing Qualified Lead. The qualification value used as the "qualified prospect" gate.
- **SQL (in our metrics)** вЂ” same set as MQL. The historical "SQL" label in DoD/WoW/MoM views means *MQL leads counted* (case-insensitive match on `qualification === 'mql'`); it is **not** a separate stage. New copy should prefer "MQL"; "SQL" is retained where it would be disruptive to rename.
- **Meeting Booked vs Meeting Held** вЂ” `meeting_booked` is the manager's signal that the meeting is on the calendar; `meeting_held` confirms it actually happened. Some metrics use one, some the other ([04-metrics В§11.3](reference/functional/04-metrics-catalog.md#113-mom-meetings)). Code is canonical.
- **Reply scope filter** вЂ” filters **leads by their `qualification` value** (`OOO` vs not-OOO), not replies by classification. The label is being renamed to make this clear ([decision](#decision-2026-04-25-rename-reply-scope-filter)).
- **Non-active clients** вЂ” clients with `status в€€ ('On hold', 'Offboarding', <Onboarding?>)`. The old `Sales` value was renamed to `Onboarding` (`20260717_client_satisfaction_and_status_rename.sql`); mechanically those rows are now `Onboarding`, but whether an *onboarding* client should still count as "non-active" is a product question left for a human вЂ” not silently redefined here.
- **OOO routing** вЂ” the act of replying back to an Out-Of-Office reply with a follow-up campaign. The portal stores configuration (`client_ooo_routing` table + `clients.auto_ooo_enabled`); n8n executes the routing.

### 4.3 Configuration vs execution split

Many features look "missing" from the portal's perspective because their **execution** lives in n8n. The portal's job is to *configure* and *display*, not to *do*. Examples:

| Feature | Portal does | n8n does |
|---------|-------------|----------|
| Email/SMS notifications | UI to maintain `notification_emails` / `sms_phone_numbers` arrays per client | Sends the actual email/SMS based on triggers |
| OOO auto-routing | UI to toggle `clients.auto_ooo_enabled`, populate `client_ooo_routing` (planned) | Reads the routing rows and executes Smartlead/Bison API calls |
| Reply classification | Display classification badge | Classify and write `replies.classification` |
| Daily counters | Render `campaign_daily_stats` and `daily_stats` rows | Pull from Smartlead/Bison and INSERT/UPSERT |
| Ingestion metrics (sent/replies/bounces/opens) | Visualise | Write |
| LinkedIn invitations (Aimfox) | Store `client_sequencers` credentials; display `sequencer_daily_stats` | Call the Aimfox API, send invites, UPSERT the daily stats |

---

## 5. Domain entities and lifecycle

Field-level detail in [03-data-model.md](reference/functional/03-data-model.md). This section captures **state machines** and **invariants**.

### 5.1 Lead

Source: ingestion (n8n upserts on `external_id`). The portal never inserts leads.

Fields the portal mutates: `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments` (ADR-0004).

Computed display stage via `getLeadStage(lead)` (precedence top-to-bottom):

```
won  в†’  offer_sent  в†’  meeting_held  в†’  meeting_scheduled (= meeting_booked)  в†’  unqualified (no qualification)  в†’  qualification value
```

Invariants (currently *advisory*, not enforced by DB constraints):

- `meeting_held = true` should imply `meeting_booked = true`.
- `won = true` is intended to be terminal вЂ” once set, no further state changes are expected.
- `offer_sent` typically follows `meeting_held`.

The portal does not enforce these as state-machine transitions; managers can set any field independently. Adding state-machine validation is on the [backlog](#11-open-backlog-planned-not-built).

### 5.2 Campaign

Source: ingestion. Portal mutates `name`, `status`, `database_size`, `positive_responses`. `type` is immutable in UI.

`status` enum: `draft в†’ launching в†’ active в†’ stopped в†’ completed`. Transitions are not enforced; it is a free-form choice from the enum.

Visibility:

- Client: only `type = 'outreach'` (ADR-0003).
- Internal roles: all types.

### 5.3 Client

Source: created via the New-client sheet (manager/admin). Portal mutates everything except `id`; contracted-amount/date only when not billing-locked. Sequencer credentials (formerly `external_workspace_id` / `external_api_key` / `linkedin_api_key` columns) live in `client_sequencers`, one row per client × sequencer (ADR-0008).

`status` enum drives visibility surfaces:

- `Active`, `Subscription` (formerly `Abo`) вЂ” operational; default surface population.
- `Onboarding` (formerly `Sales`), `On hold`, `Offboarding` вЂ” non-default operational states.
- `Inactive` вЂ” fully retired; not surfaced.

`manager_id` is **not nullable** вЂ” every client must have an assigned manager. Reassignment is admin-only ([decision](#decision-2026-04-25-manager-reassignment-only-not-unassign)).

### 5.4 Domain (sending domain)

Source: created/updated by ingestion when domains are provisioned. Portal mutates only the local `status` field (the legacy `reputation`, `exchange_cost`, `exchange_date`, `campaign_verified_at`, `warmup_verified_at` were dropped in `20260720f`). Winnr provider state lives in `winnr_status` + the mailbox tables (`email_accounts`, `email_account_warming_daily`), all ingestion-only.

`status` lifecycle: `warmup в†’ active в†’ blocked в†’ retired`.

### 5.5 Invoice

Source: ingestion creates rows; portal updates `issue_date`, `amount`, `status`.

`status` is a free-text column. The UI displays a curated list (`pending`, `issued`, `sent`, `paid`, `overdue`, `vindication`) but the database accepts any string.

### 5.6 Reply

Append-only, ingestion-managed. The portal **never writes**. `classification` is set by n8n; the portal renders the badge. Unclassified replies are a count-only signal ("triage backlog"), not a workflow ([decision](#decision-2026-04-25-no-reply-triage-ui)).

### 5.7 Daily counters

`campaign_daily_stats` and `daily_stats` are ingestion-only. Portal reads them with windowed queries (90 days for campaign stats, 180 days for client stats).

### 5.8 Email blacklist (`email_exclude_list`)

Domain string is the primary key. Admin-only mutation. Used by ingestion as the master block list before sends.

---

## 6. Workflows

End-to-end sequences. UI surfaces are referenced from per-role files.

### 6.1 Lead qualification

```
ingestion creates lead (qualification = NULL)
    в†“
manager opens leads page в†’ drawer
    в†“
manager sets qualification (preMQL / MQL / rejected / OOO / NRR / вЂ¦)
    в†“ + optional: meeting_booked в†’ meeting_held в†’ offer_sent в†’ won
    в†“
KPI counters re-derive on next render
```

The order of transitions is at manager discretion. There is no DB-level state machine.

### 6.2 Campaign management

```
ingestion creates campaign (status = draft / launching)
    в†“
manager edits via drawer (name, status, database_size, positive_responses)
    в†“
campaign_daily_stats accumulate over time (n8n)
    в†“
campaign appears on dashboards / surfaces; if reply rate < 1% it lands on the Manager Watchlist
```

### 6.3 OOO auto-follow-up

```
client.auto_ooo_enabled = true
    в†“
client_ooo_routing row exists for (client, gender?, follow-up campaign)
    в†“
ingestion classifies a reply as OOO
    в†“
n8n picks up the lead, creates a contact in the follow-up campaign in Smartlead/Bison
    в†“
ingestion eventually creates new replies / counters tied to the follow-up campaign
```

The portal owns the **configuration** rows; n8n owns the **action**. Today the portal exposes only `auto_ooo_enabled` toggle in the client drawer; routing-row management is on the [backlog](#11-open-backlog-planned-not-built).

### 6.4 Notifications

```
clients.notification_emails = [a@x, b@y]
clients.sms_phone_numbers   = [+1...]
    в†“
n8n trigger fires (e.g. new MQL, stalled campaign)
    в†“
n8n sends email / SMS to those addresses / numbers
```

Portal stores the destination lists; n8n decides triggers and dispatches messages. The portal does not currently surface a "preferences" UI for clients themselves вЂ” managers maintain these on the Clients page drawer. Self-service editing is on the [backlog](#11-open-backlog-planned-not-built).

### 6.5 Invitation acceptance

```
admin sends invite (email, role, [clientId for client role])
    в†“
send-invite edge function: auth.users + public.users + (for client) client_users
    в†“
Supabase emails magic-link / signup link
    в†“
user accepts, sets password, becomes a regular session
    в†“
on first login, AuthProvider resolves identity (users + client_users)
    в†“
if client_users mapping is missing в†’ ClientAccessBlocker
```

If a user lands in the orphaned state (`auth.users` exists, `public.users` does not), recovery is admin-managed in SQL. A guided recovery UI is on the [backlog](#11-open-backlog-planned-not-built).

### 6.6 Impersonation

Super-admin only. Read-only role preview. See [02 В§7](reference/functional/02-roles-routes.md#7-impersonation) for the UX caveats; from a business perspective: **for a faithful test of a target user's experience, sign in directly as that user**.

---

## 7. Data ownership matrix

Who **may write** which table from where. RLS is the authoritative gate; ingestion bypasses RLS via the service role inside Supabase.

| Table | Portal write | n8n / ingestion | Notes |
|-------|:-----------:|:---------------:|------|
| `users` | self profile via Supabase Auth | service role for invite acceptance | Admin promotion to super_admin via SQL |
| `client_users` | admin (via UI / edge function) | service role on invite acceptance | One client per client-role user (UNIQUE) |
| `clients` | admin (all fields) / manager (assigned, except `manager_id`) | rarely; only setup automation | `manager_id NOT NULL` |
| `campaigns` | manager / admin (`name`, `status`, `database_size`, `positive_responses`) | yes вЂ” INSERTs new campaigns; UPDATE counters indirectly via stats | `external_id` UNIQUE |
| `campaign_daily_stats` | **never** | yes вЂ” daily UPSERT on (`campaign_id`, `report_date`) | Portal reads only |
| `daily_stats` | **never** | yes вЂ” daily UPSERT on (`client_id`, `report_date`) | Portal reads only; not loaded for client role |
| `leads` | manager / admin (ADR-0004 whitelist) | yes вЂ” INSERT + enrichment UPDATE | Clients never write |
| `replies` | **never** | yes вЂ” INSERT + classification UPDATE | Read-only from portal |
| `domains` | manager / admin (local `status` only) | yes вЂ” provisioning + Winnr sync (winnr_status, mailbox tables) | |
| `invoices` | manager / admin (operational fields) | yes вЂ” invoice rows are ingested | Portal does not currently insert |
| `email_exclude_list` | admin only | rarely | Used by n8n as block list before sends |
| `client_ooo_routing` | (planned) manager / admin | rarely | n8n reads to act |
| `agency_crm_deals` | (planned) admin / sales-manager | n/a today | UI is on [backlog](#11-open-backlog-planned-not-built) |

---

## 8. Settings & ecosystem configuration

Plain-language map of which settings exist, who owns them, and where they live in the UI.

### 8.1 By owner

**Client self-service (planned):**

- Profile name, password вЂ” `Settings` page (currently shipped).
- Notification emails (`clients.notification_emails`) вЂ” **planned**: client should be able to add/remove their own contacts.
- SMS phone numbers (`clients.sms_phone_numbers`) вЂ” **planned**: same as above.
- CRM integration вЂ” **out of scope** for now (admin-only field; the agency team configures).

**Manager / admin (CS scope):**

- Client name, status, contracted KPI targets (`kpi_leads`, `kpi_meetings`).
- Sending volume controls: `min_daily_sent`, `inboxes_count`.
- Notification destinations (until client self-service ships): `notification_emails`, `sms_phone_numbers`.
- Auto-OOO toggle: `auto_ooo_enabled`.
- Setup notes: `setup_info`.
- Sequencer credentials (`client_sequencers`: EmailBison workspace ID + API key, Aimfox API key) — shipped in the client drawer Credentials & IDs section (ADR-0008).
- Workshops / harmonogramy / cold-Ads tracking вЂ” **planned**, fields not in schema yet.

**Admin only:**

- `manager_id` reassignment.
- `email_exclude_list` writes.
- Invite/revoke users.
- (Planned) `client_ooo_routing` rows; `agency_crm_deals` CRM kanban.

### 8.2 Status table

| Setting | Schema field | UI today | Owner |
|---------|--------------|----------|-------|
| Profile name / password | `auth.users` + `public.users` | вњ“ Settings page | Self |
| Notification emails | `clients.notification_emails` (text[]) | вњ“ Manager drawer | Manager (planned: client self-edit) |
| SMS phone numbers | `clients.sms_phone_numbers` (text[]) | вњ“ Manager drawer | Manager (planned: client self-edit) |
| Auto-OOO toggle | `clients.auto_ooo_enabled` (bool) | вњ“ Manager drawer | Manager / admin |
| OOO routing rows | `client_ooo_routing` table | вњ— Planned | Manager / admin |
| Sequencer credentials (EmailBison / Aimfox) | `client_sequencers` (`api_key`, `external_workspace_id`) | ✓ Manager drawer | Manager / admin |
| CRM config | `clients.crm_config` (jsonb) | вњ— Out of scope today | Admin |
| Workshops / harmonogramy | _(not in schema)_ | вњ— Out of scope; schema work needed | Manager / admin |
| Min daily sent | `clients.min_daily_sent` | вњ“ Manager drawer | Manager / admin |
| Inboxes count | `clients.inboxes_count` | вњ“ Manager drawer | Manager / admin |

---

## 9. Notifications

The portal **does not send notifications**. n8n does. The portal's job is to maintain a per-client list of destinations.

- `clients.notification_emails: text[]` вЂ” emails that receive alerts.
- `clients.sms_phone_numbers: text[]` вЂ” phones that receive SMS.

Both are CSV-edited via the Manager / admin drawer on the Clients page. The plan is to also expose them in the client Settings page for self-service (see [open backlog](#11-open-backlog-planned-not-built)).

n8n decides the trigger conditions (new MQL, stalled campaign, sentiment change, etc.). Those rules live in n8n flows and are not part of the portal's data model.

---

## 10. Out of scope (legacy)

Items that appeared in the archived spec or initial scoping but are explicitly **not part of this product**. Listing them here prevents future re-discovery as "missing features."

| Topic | Why out of scope |
|-------|------------------|
| **Health Assessments** (biweekly traffic-light form, `client_health_assessments`) | Not part of current product. The shipped condition-rules layer is an inline metric-evaluation system, not a separate periodic assessment workflow. |
| **CSV / Excel bulk import UI** | Initial data load and ongoing batches are handled by ingestion (n8n / SQL). No file-upload UI. |
| **Cash flow projections / financial planning** | Not part of this portal's scope. Finance lives elsewhere. |
| **Issue tracking per client** (`client_issues` table) | Not part of current product. Use external ticket system. |
| **Auto-generated weekly/monthly reports** (CSV/PDF export) | Reporting is consumed via dashboards. Export is not a goal. |
| **Partnerships / Lost Clients / ABM tables** | Not part of the agency portal in this iteration. |
| **Reply triage UI** | All replies are classified by n8n. "Unclassified" is a transient ingestion state, not a queue users act on. |
| **In-portal email/SMS delivery** | Notifications are dispatched by n8n. The portal is a configuration surface, not a sender. |
| **Magic-link-only auth (no password)** | Both flows are supported; magic link is opt-in via env flag. |

This list grows or shrinks only by an explicit decision. New items go to the [decisions log](#12-decisions-log) before they land here.

---

## 11. Open backlog (planned, not built)

These are real product gaps to be addressed when prioritised. They are *in scope* but *not built*.

| # | Item | Driver | Notes |
|---|------|--------|-------|
| BL-1 | Client self-service notification preferences | A4 decision | UI on `/client/settings` to edit `notification_emails`, `sms_phone_numbers`. Manager retains override on `/manager/clients`. |
| BL-2 | OOO routing rows management UI | A5 + ecosystem | Manager / admin UI to configure `client_ooo_routing` rows. Today only the boolean toggle is exposed. |
| BL-3 | Sequencer management UI (phase 2) | A7 / ADR-0008 | Catalog-driven UI for `sequencers` + `client_sequencers` (enable/disable, settings jsonb, future sequencers) and Aimfox PDCA panels over `sequencer_daily_stats`. The drawer already covers EmailBison/Aimfox credentials. |
| BL-4 | Workshops / harmonogramy / cold-Ads ecosystem fields | A7 | Schema columns + UI in the manager/admin drawer. Specify exact field set before implementing. |
| BL-5 | Agency CRM kanban (`agency_crm_deals`) | C5 decision | Admin/sales-manager UI for the agency's own pipeline. RLS already exists. |
| BL-6 | *(Closed)* Remove non-active clients dashboard surface | 2026-04-29 decision | Surface removed from Admin dashboard. |
| BL-7 | Rename "Reply scope" filter в†’ "Lead OOO scope" | B6 decision | Lead pages (`/manager/leads`, `/admin/leads`, `/client/leads`). |
| BL-8 | State-machine validation for lead transitions | E1 / spec | Optional: enforce `meeting_held в‡’ meeting_booked`, `won` terminality, etc. |
| BL-9 | Orphan auth-user recovery tool | C6 | Admin UI to provision `public.users` row for a stuck `auth.users` entry. |
| BL-10 | Visible impersonation warning in UI | C7 | Banner reminder that mutations during impersonation are signed by the actor, not the impersonated identity. |
| BL-11 | Migrate CRM-integration backend into our Supabase project | 2026-05-03 decision | Move `crm_providers`, edge functions (`submit-crm-credentials`, `salesforce-oauth`, `zoho-token-exchange`), and tokens out of the legacy CRM project (`ykrwrrwuqbtffovhwqjg`) and into `bnetnuzxynmdftiadwef`. Requires re-registering Salesforce App callback URLs and re-doing the security review. Tracked under [11 · CRM integration §Phase 2](./reference/functional/11-integrations.md#crm-integration). |

---

## 12. Decisions log

Append-only. Each entry: date, decision, rationale, references.

### Decision (2026-07-21): System boundary extended with a public aggregate lead counter (ADR-0014)

The agency marketing website (Webflow) shows social-proof counters of leads received - yesterday,
last 7 / 30 / 90 days, all time. Until now no surface served an unauthenticated caller: every read
goes through the ORM gateway with the caller's JWT, and every RLS policy is granted to
`authenticated` only.

- **Decision:** expose exactly one argument-less `SECURITY DEFINER` function,
  `public.public_lead_stats()`, with `EXECUTE` granted to `anon`. It returns five counters and a
  timestamp - no rows, no `client_id`, no per-client or per-campaign breakdown.
- **Rationale:** the smallest possible hole. A new edge function would have cost the
  `verify_jwt = true` invariant or an extra deploy surface for the same exposure; extending the
  gateway would mean inventing an anonymous caller inside the one mechanism the security boundary
  rests on. The `apikey` used by the site is the publishable key, which already ships in the
  portal's JS bundle - no new secret.
- **Counting rule:** all `leads` rows except OOO / NRR / rejected. This is deliberately **not** any
  existing portal KPI (`getClientKpis` counts MQLs only), so the public number is larger than the
  dashboard's. Expected.
- **Boundary:** aggregates only. Any sliced public metric - per client, per campaign, a time series,
  a named logo - requires a new ADR.
- References: [ADR-0014](adr/0014-public-marketing-stats-rpc.md),
  [03-data-model §4a](reference/functional/03-data-model.md#4a-public-functions-anon-callable),
  [04-metrics-catalog §16](reference/functional/04-metrics-catalog.md#16-public-marketing-counters),
  [11-integrations §1](reference/functional/11-integrations.md).

### Decision (2026-07-14): Documentation + agent-contract overhaul; snapshot layer deleted

No product-scope change. This entry records a **documentation and architecture-hygiene** pass that
changed what agents are told to build against.

- **The universal snapshot is gone.** `loadSnapshot`, `CoreSnapshot`, `CoreDataProvider`,
  `useCoreData` and `LegacySnapshotOutlet` were deleted from the codebase — they had already been
  bypassed in production (`CoreDataProvider` was mounted nowhere) but the docs still instructed
  agents to route all data and mutations through them. The cutover-guard allowlist is now empty.
  → [ADR-0009](adr/0009-per-page-data-contracts.md)
- **Four decisions that were shipped but never recorded now have ADRs**: the ORM gateway edge
  function and its trust model ([0008](adr/0008-orm-gateway-edge-function.md)), the per-page data
  contracts ([0009](adr/0009-per-page-data-contracts.md)), the legacy CRM second Supabase client —
  previously an unexplained apparent violation of ADR-0001 — as a **bounded, read-only exception**
  ([0010](adr/0010-legacy-crm-integration.md)), and the conditions rules engine
  ([0011](adr/0011-conditions-rules-engine.md)). Index: [ADR.md](ADR.md).
- **`CLAUDE.md` shrank from ~40 KB to ~7 KB**, becoming a rules + task-routing contract. The detail
  moved to [reuse-catalog.md](reuse-catalog.md),
  [design-system.md](reference/design-system.md),
  [development-standards-and-operations.md](development-standards-and-operations.md), and four new
  procedural skills (`portal-page`, `gateway-action`, `rls-migration`, `visual-verify`).
- **The design system is documented for the first time.** The previous "design conventions" file was
  a 7-line stub, and the palette rules in `CLAUDE.md` were wrong (panels are `#050505`, not
  `#0f0f0f`). The two theme axes — the hardcoded `.dark` class and the separate high-contrast status
  palette that **defaults to on** — are now written down.
- **33 unused shadcn primitives were deleted** (46 → 16). Three of them (`dialog`, `sheet`, `chart`)
  were the ones the old docs told agents to use, while having zero importers.

**Why:** the docs had drifted far enough that an agent following them faithfully would write code
against dead scaffolding. Docs that describe a system that no longer runs are worse than no docs.

**Bug found and fixed in the same pass — invoice editing is admin-only.** `invoices_update_admin` is
`private.is_admin_user()`-only (`super_admin | admin | master_admin`), so a **manager editing an
invoice got a `42501`** even though the drawer offered the control — and the test suite had this
codified as expected behaviour (the "saves invoice draft changes" test ran as a *manager*). We
**gated the UI** rather than widening RLS: invoices are billing records, and admin-only writes are
the intended boundary. Managers keep read access (`invoices_select_scoped`). The drawer now renders
read-only for them, with a regression test. → [09-mutations-rls.md](reference/functional/09-mutations-rls.md) §4

### Decision (2026-07-04): Multi-sequencer model — catalog + per-client credentials (ADR-0012)

Sequencers (Smartlead, EmailBison, Aimfox — the look4lead concept is replaced by Aimfox) became first-class data: a global `sequencers` catalog (fixed load-bearing UUIDs), per-client credentials in `client_sequencers` (replacing the dropped `clients.external_api_key` / `external_workspace_id` / `linkedin_api_key` columns), `sequencer_id NOT NULL DEFAULT EmailBison` on `campaigns` and `leads` (all historical rows attributed to EmailBison), and the ingestion-only `sequencer_daily_stats` table for Aimfox LinkedIn PDCA metrics (invites sent/accepted per profile, remaining database size, invite limit ≈195/week). The client drawer's credential fields now read/write `client_sequencers` via the `upsertClientSequencer` gateway action. AI reply classification and SMS/email notifications for LinkedIn leads stay in n8n (OoS-12). The destructive column-drop migration (`20260704b`) applies only after the n8n cutover.

**Rationale:** Aimfox integration + upcoming per-sequencer PDCA statistics require attributing campaigns/leads/stats to a specific tool and holding more than one credential set per client. **References:** [ADR-0012](adr/0012-multi-sequencer-model.md), migrations `20260704_sequencers_catalog.sql` / `20260704b_drop_client_sequencer_credentials.sql`, [03-data-model.md](reference/functional/03-data-model.md), [09-mutations-rls.md](reference/functional/09-mutations-rls.md), [11-integrations.md](reference/functional/11-integrations.md).

### Decision (2026-06-19): User profile photos (avatars) with initials fallback (Batch 10D)

Users (admin/manager/client) can now have a **profile photo** shown in place of the initials avatar wherever their identity appears — the lower-left sidebar identity block (expanded **and** collapsed), the Settings profile section, and the admin User Management list. If no photo exists or the image fails to load, the UI falls back to the existing initials. A new shared [`UserAvatar`](../src/app/components/ui/user-avatar.tsx) component is the single source of truth for the photo/initials decision.

- **Self-service:** any user uploads/replaces/removes their own photo in **Settings** (gateway action `updateProfileAvatar`, under `users_update_self`).
- **Admin management:** admin/master_admin/super_admin can set/clear photos for any user from **User Management** (`admin_set_user_avatar` SECURITY DEFINER RPC). Managers and clients can only edit their own.
- **Collapsed sidebar:** the bottom item is now the user's avatar (click → role Settings), replacing the theme toggle; the theme toggle remains in the expanded sidebar.

**Storage model — public bucket, path-only:** images live in a **public** `user-avatars` Storage bucket (5 MB, jpeg/png/webp) at `avatars/{user_id}/{uuid}.{ext}`; the DB stores only `users.avatar_path` (never a URL — the public URL is derived at render). We deliberately chose a public bucket over the private+signed-URL pattern: avatars are low-sensitivity face photos with unguessable UUID names, and public read removes per-render signing latency and list-batching complexity. `storage.objects` RLS still restricts writes to the caller's own folder (or admins). Type/size are validated client-side **and** enforced by the bucket.

**Rationale:** Client feedback — *"add our photos/faces instead of letters (e.g. 'ŁK') in the lower-left corner; if no photo, initials are fine."* **References:** migration `20260619_user_avatars.sql`, [03-data-model.md §2.1](reference/functional/03-data-model.md), [09-mutations-rls.md §3.6/§3.7](reference/functional/09-mutations-rls.md), [07-admin-portal.md](reference/functional/07-admin-portal.md).

### Decision (2026-06-18): Leads report replaces the Google-Sheets client report (Batch 4)

The Leads tab became a dense, spreadsheet-style **report table** designed to replace the client's external Google-Sheets lead report. Shipped this batch:

- **Compact table (4A):** small font, narrow resizable columns, sticky header, horizontal scroll, truncation + tooltips, on both the internal Leads page and the client portal report — driven by one shared column registry (`src/app/lib/lead-report-columns.tsx`) and `LeadReportTable`.
- **Report columns (4C):** the Google-Sheets fields that already exist in the schema (name, job title, email, phone/source, company, industry, headcount, lead received, campaign, message title/#, website, qualification, response time, status, mail-from-lead preview, LinkedIn) plus the new notes.
- **Notes (4D):** `comments` renamed to **`client_note`** (client-facing) + new **`coldunicorn_note`** (internal; hidden from the client role at the gateway).
- **Row highlight (4E):** manual `green`/`yellow`/`red` semi-transparent row colour (`leads.highlight`), set by admin/manager.
- **Per-client custom columns (4F):** new `lead_custom_fields` / `lead_custom_field_values` ([ADR-0007](adr/0007-per-client-lead-custom-fields.md)); defined by admin/master_admin only, scoped per client, never leaking across clients.
- **Export (4G):** CSV + XLSX (lazy-loaded SheetJS) of **all** rows matching the current filters/sort (paged server-side, role-scoped); the client export omits the internal note.

**Deliberately deferred:** the **status-model change** (abandoning the micro-CRM booleans for a `qualification`-only single status) is **out of this batch**. KPIs, stage counts, filters, the checkbox edit UI, and the n8n ingestion contract are unchanged; the report "Status" column is read-only, derived from the existing `getLeadStage()`. The `qualification` enum already contains the five target statuses, so no enum change was needed. Confirm the full status model with the client before migrating — it touches KPIs, historical rows, and ingestion.

**Rationale:** Client feedback Batch 4 (narrower columns, replace the Sheets report, client/internal notes, row highlights, custom columns, export). **References:** migrations `20260618b`, `20260618c`; [ADR-0004](adr/0004-lead-state-boundaries.md), [ADR-0007](adr/0007-per-client-lead-custom-fields.md); [03-data-model.md §2.4](reference/functional/03-data-model.md), [09-mutations-rls.md §2.3/§2.13b](reference/functional/09-mutations-rls.md).

### Decision (2026-06-18): User Management lists existing users; role change + soft-deactivate

The admin **User Management** page now lists all portal users (not just invitations) and lets an admin/master_admin **change a user's role** and **deactivate/reactivate** an account. Hard delete is intentionally **not** offered — users are referenced by `clients.manager_id`, `agency_crm_deals.salesperson_id`, `*_updated_by`, etc., so deletion would break FKs and audit history. Deactivation is a soft flag (`users.is_active` + `deactivated_at`/`deactivated_by`).

All permission rules are enforced **server-side** in SECURITY DEFINER Postgres functions (`admin_update_user_role`, `admin_set_user_active`, `admin_list_users`), called via `supabase.rpc()` — not the `orm-gateway` edge function — so the feature ships via migration alone. Guards: cannot change/deactivate your own account, only `super_admin` may touch `super_admin`, and a last-admin guard. A deactivated user is locked out because `private.current_app_role()` returns NULL for them (no role-gated RLS access) and the auth provider signs them out via `current_account_active()`.

**Rationale:** Client feedback "I don't see anybody from my team" — the page only managed invites. **References:** migration `20260618`, [09-mutations-rls.md §3.6](reference/functional/09-mutations-rls.md), [03-data-model.md §2.1](reference/functional/03-data-model.md).

### Decision (2026-06-18): Custom field types `number` and `currency`; editable field type

Master-admin custom columns gain **number** and **currency** types, and the type of an existing column can now be **changed** in Settings (existing values are preserved, never deleted). Sorting for every custom field type is centralized in [`getCustomFieldSortValue`](../src/app/lib/custom-field-sort.ts): number/currency sort by parsed amount (currency tolerates `zł`/`PLN`/`€`/`$`/`£` and space/comma grouping), droplist by configured option order, checkbox by boolean, text/link by normalized string; empty values sort last.

This fixes two bugs: (1) sorting a custom column did nothing because the page comparator only knew the static built-in columns; (2) an "MRR" column entered as free text (`8000 zł`) sorted lexicographically. The fix is **not** MRR-specific — switch any text column to **currency** to get numeric sort. **References:** migration `20260618` (relaxed `field_type` CHECK), [master-admin-guide.md §2](master-admin-guide.md).

### Decision (2026-04-25): Documentation snapshot established

Created this `BUSINESS_LOGIC.md` plus topic files under `docs/reference/functional/` (11 files). Established that **this file is the canonical product spec** and the functional reference contains implementation detail. ADRs remain for architecture-level commitments.

**Rationale:** Prior to this, scope drift was inferred from archived specs. The new structure separates "what we are building" (this file) from "how it currently works" (functional reference) from "why we chose the architecture" (ADRs).

### Decision (2026-04-25): Out-of-scope items remain legacy

Confirmed that Health Assessments, CSV bulk import, cash flow, issue tracking, partnerships, lost-clients, auto reports, in-portal notification delivery, and reply triage UI are **not part of the product**. See [В§10 Out of scope](#10-out-of-scope-legacy).

**Rationale:** The product owner reviewed gaps from archived spec and confirmed these are legacy; the new architecture delegates execution to n8n.

### Decision (2026-04-25): Notifications and OOO routing are split between portal and n8n

The portal owns *configuration* (destination lists, toggles, routing rows). n8n owns *execution* (sending alerts, performing OOO follow-up).

**Rationale:** This is the existing operational reality. Documenting the split prevents engineers from re-implementing dispatch logic in the portal.

### Decision (2026-04-25): Rename "at-risk" в†’ "non-active"

The Admin dashboard surface for clients in `On hold / Offboarding / Sales` was labelled "At-risk clients". Renamed to "Non-active clients". Optionally extend the status set to include `Inactive`.

**References:** Gap analysis В§B3. Implementation tracked as [BL-6](#11-open-backlog-planned-not-built).

### Decision (2026-04-25): Rename reply-scope filter

Filter previously labelled "All / Active only / OOO only" on the leads pages filters by **lead.qualification**, not reply classification. Will be renamed to "Lead OOO scope" or equivalent for clarity.

**References:** Gap analysis В§B6. Tracked as [BL-7](#11-open-backlog-planned-not-built).

### Decision (2026-04-25): No reply triage UI

Every reply is classified by n8n. The portal does not need a triage workflow.

### Decision (2026-05-03): Client CRM integration ships against the legacy Supabase project

Added a "CRM integration" card on `/client/settings` that lets a client authorize their own CRM (Salesforce / Zoho / API-key providers). The provider catalog and OAuth/credential exchange edge functions are reused from the standalone legacy CRM project (`ykrwrrwuqbtffovhwqjg`); our project (`bnetnuzxynmdftiadwef`) only stores a status mirror in `clients.crm_config`.

**Rationale:** The legacy CRM-integration tool is already wired into the Make/n8n pipeline that performs the actual CRM sync. Re-pointing the edge functions + Salesforce App + `MAKE_WEBHOOK_URL` at our project is a security-review-gated migration; not worth blocking the client-facing UI on it. Cross-project calls cost us two extra env vars and a separate Supabase client; the alternative was dropping the feature or porting the backend before any UI exists.

**Trade-offs accepted:**
- Two Supabase clients on the frontend (main + legacy CRM project, anon keys only).
- Tokens live in the legacy project, not ours. The portal sees only "connected / pending / failed" status.
- Disconnect clears our status mirror but does not revoke tokens on the legacy side — n8n / manual cleanup required for full revoke.

**Phase 2** (tracked as [BL-11](#11-open-backlog-planned-not-built)): migrate the backend into our project.

**References:** [11 · CRM integration](./reference/functional/11-integrations.md#crm-integration), [05 · Client portal §5.5](./reference/functional/05-client-portal.md#55-crm-integration-card).

### Decision (2026-04-29): Admin dashboard simplification

Removed two Admin dashboard surfaces to reduce noise:

- `Unclassified replies` KPI card
- `Non-active clients` panel

Also split the previous combined campaign momentum chart into three independent 21-day charts (sent / replies / positive).

**References:** Gap analysis В§A11.

### Decision (2026-04-25): Manager reassignment only, not unassign

`clients.manager_id` remains `NOT NULL`. Replacing a manager requires picking another manager, not leaving the field empty.

**References:** Gap analysis В§C4. If unassignment is later required, schema migration + UI work needed.

### Decision (2026-04-25): Drizzle ORM is the canonical access layer

Keep using Drizzle for type generation and migrations. New queries should prefer Drizzle's query builder where it improves clarity. The `repository.ts` boundary remains the only place that talks to Supabase.

**References:** Gap analysis В§C1. Runtime cutover shipped on 2026-04-28 (see decision below).

### Decision (2026-04-25): Implement agency CRM UI

`agency_crm_deals` is in scope, just not yet built. Move to backlog as [BL-5](#11-open-backlog-planned-not-built).

**References:** Gap analysis В§C5.

### Decision (2026-04-25): Code-derived metric semantics win over archived spec

Where archived spec and current code diverge on metric formulas (MoM MQL, Meetings Rate, "SQL" в†” MQL terminology, `daily_snapshots` в†” `daily_stats`), the current code is the source of truth. Spec is updated, not the other way around.

**References:** Gap analysis В§D.

---

### Decision (2026-04-28): Dynamic condition rules engine shipped

Implemented a data-driven condition system over client operational metrics:

- `condition_rules` table + RLS + seeded CS PDCA rules.
- Safe JSON DSL evaluator (no executable formula mode).
- Clients surfaces render explainable per-cell highlights + tooltips. (The row-level health rollup and health filter these rules once fed were replaced by the manual satisfaction rating, 2026-07-17.)
- Admin/super-admin can manage rules from `/admin/settings`.

This capability is intentionally distinct from the legacy biweekly Health Assessment form.

References: `docs/reference/functional/14-condition-rules.md`, `supabase/migrations/20260428_condition_rules_engine.sql`.

### Decision (2026-04-28): BL-11 runtime ORM cutover shipped

Completed BL-11 with a single runtime cutover:

- Frontend runtime reads/writes now go through `orm-gateway` edge function.
- `orm-gateway` executes DB access through Drizzle ORM + Postgres.js.
- RLS passthrough is preserved by setting transaction-local JWT claims and role context before each action.
- Invitation lifecycle (`send-invite`, `manage-invites`) remains on dedicated edge functions in this wave.

References: `src/app/data/repository.ts`, `supabase/functions/orm-gateway/index.ts`, `docs/reference/functional/09-mutations-rls.md`.

## 13. Update policy

This file is **mandatory reading** before starting any change that touches:

- A role's capabilities.
- A new feature or removal of an existing one.
- A configuration field.
- A workflow involving n8n / ingestion.
- A scope boundary (in scope / planned / out of scope).

If the change alters any of the above:

1. **Update this file in the same change** вЂ” at minimum, the Decisions log.
2. Update the relevant section (В§3 if roles change, В§4 for scope, В§5 for entity lifecycle, В§7 for ownership, В§8 for settings, В§10/11 for scope movement).
3. Cross-link to the implementation detail in [docs/reference/functional/](reference/functional/).
4. If the change is architectural, also write an ADR.

When this file disagrees with code, the code may be wrong, the file may be wrong, or both. **Reconcile before merging.**

---

## Quick navigation

- [Implementation reference](reference/functional/INDEX.md)
- [Architecture decisions (ADRs)](adr/)
- [Production RLS SQL](reference/supabase-production-rls.sql)
- [Agent working agreement](../CLAUDE.md)





