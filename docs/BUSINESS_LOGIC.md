# Business Logic Specification вЂ” ColdUnicorn PDCA Portal

**Status:** Authoritative. Updated whenever scope changes.
**Last revision:** 2026-04-28.
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
                                 в”‚ SELECT / scoped UPDATE
                                 в”‚ (publishable key + RLS)
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

### n8n responsibilities

- **Ingestion:** populate `campaign_daily_stats`, `daily_stats`, `replies` (with classification), `domains` reputation/verification updates.
- **Routing:** consume `client_ooo_routing` rows + OOO replies to assign follow-up campaigns in Smartlead/Bison.
- **Notifications:** dispatch email/SMS to addresses found in `clients.notification_emails` / `sms_phone_numbers` when triggers fire (new lead, stalled campaign, etc.).
- **Reply classification:** every reply that lands in `replies` is classified by n8n (using LLM + rules). The portal does not re-classify; "unclassified" is a transient ingestion state, not an action item.

### Supabase responsibilities

- **Source of truth** for every table.
- **RLS enforcement** of role boundaries (`public.is_admin_user`, `is_manager_of_client`, `can_access_client`, `is_internal_user`).
- **Edge functions** `send-invite` and `manage-invites` (the only server-side code path the portal invokes for writes that need elevated privileges).

### Hard rule

**The portal never writes to ingestion-managed tables.** See [В§7 Data ownership matrix](#7-data-ownership-matrix) for the canonical list.

---

## 3. Roles and responsibilities

Four roles. Detailed UI/route mapping in [docs/reference/functional/02-roles-routes.md](reference/functional/02-roles-routes.md).

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
- **Edit domains:** status, reputation, exchange cost, verification dates.
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
- **User management:** invite admins, managers, clients via `send-invite` edge function; resend, revoke; map users to clients.
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
| Manager clients page | 5 tabs (Overview, DoD, 3-DoD, WoW, MoM) with metric tables. Editable client drawer + user-mapping management + dynamic condition highlights/badges/health filters. |
| Internal leads | Editable qualification + milestones + comments drawer. Reply history inline. |
| Internal campaigns | Editable metadata drawer + per-campaign daily performance line chart. |
| Internal statistics | Trend lines, qualification donut, campaign portfolio cards. |
| Domains | Editable status, reputation, exchange cost, verification dates. |
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
- **Non-active clients** вЂ” clients with `status в€€ ('On hold', 'Offboarding', 'Sales')`.
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

Source: created by admin (likely via SQL today; UI creation is on the [backlog](#11-open-backlog-planned-not-built)). Portal mutates everything except `id`, `external_workspace_id`, contracted-amount/date when those are billing-locked.

`status` enum drives visibility surfaces:

- `Active`, `Abo` вЂ” operational; default surface population.
- `On hold`, `Offboarding`, `Sales` вЂ” non-active operational states.
- `Inactive` вЂ” fully retired; not surfaced.

`manager_id` is **not nullable** вЂ” every client must have an assigned manager. Reassignment is admin-only ([decision](#decision-2026-04-25-manager-reassignment-only-not-unassign)).

### 5.4 Domain (sending domain)

Source: created/updated by ingestion when domains are provisioned. Portal mutates operational fields: `status`, `reputation`, `exchange_cost`, `campaign_verified_at`, `warmup_verified_at`.

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
| `domains` | manager / admin (operational fields) | yes вЂ” provisioning + reputation updates | |
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
- LinkedIn API key (`linkedin_api_key`) вЂ” **planned UI**, currently only schema field.
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
| LinkedIn API key | `clients.linkedin_api_key` | вњ— Planned | Manager / admin |
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
| BL-3 | LinkedIn API key UI | A7 | Add `linkedin_api_key` field to manager/admin client drawer. |
| BL-4 | Workshops / harmonogramy / cold-Ads ecosystem fields | A7 | Schema columns + UI in the manager/admin drawer. Specify exact field set before implementing. |
| BL-5 | Agency CRM kanban (`agency_crm_deals`) | C5 decision | Admin/sales-manager UI for the agency's own pipeline. RLS already exists. |
| BL-6 | *(Closed)* Remove non-active clients dashboard surface | 2026-04-29 decision | Surface removed from Admin dashboard. |
| BL-7 | Rename "Reply scope" filter в†’ "Lead OOO scope" | B6 decision | Lead pages (`/manager/leads`, `/admin/leads`, `/client/leads`). |
| BL-8 | State-machine validation for lead transitions | E1 / spec | Optional: enforce `meeting_held в‡’ meeting_booked`, `won` terminality, etc. |
| BL-9 | Orphan auth-user recovery tool | C6 | Admin UI to provision `public.users` row for a stuck `auth.users` entry. |
| BL-10 | Visible impersonation warning in UI | C7 | Banner reminder that mutations during impersonation are signed by the actor, not the impersonated identity. |

---

## 12. Decisions log

Append-only. Each entry: date, decision, rationale, references.

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
- Clients surfaces now render explainable highlights/badges/health filters.
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





