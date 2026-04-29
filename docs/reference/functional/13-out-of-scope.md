# 13 В· Out of Scope (Legacy)

Items that appeared in the **archived** specs (`docs/archive/MASTER_FUNCTIONAL_SPECIFICATION.md`, `PROJECT_SPEC.md`) or in early scoping but are **explicitly not part of this product**. The canonical scope statement is in [BUSINESS_LOGIC.md В§10](../../BUSINESS_LOGIC.md#10-out-of-scope-legacy); this file is the implementation-side companion.

The **purpose** of this file is to prevent re-discovery: when an engineer or stakeholder finds an "obviously missing" feature, this list says "we know, and the answer is no". Anything not on this list and not in the [open backlog](#open-backlog-cross-reference) defaults to *in scope*.

## Contents

1. [Out of scope items](#1-out-of-scope-items)
2. [Why each is out of scope](#2-why-each-is-out-of-scope)
3. [How to promote something back into scope](#3-how-to-promote-something-back-into-scope)
4. [Open backlog cross-reference](#4-open-backlog-cross-reference)

---

## 1. Out of scope items

| # | Item | Spec source | Decision date |
|---|------|-------------|---------------|
| OoS-1 | **Health Assessments** (biweekly traffic-light form, `client_health_assessments` table, US-M3) | PROJECT_SPEC.md В§6.2 | 2026-04-25 |
| OoS-2 | **CSV / Excel bulk import UI** (file picker, column mapper, validation preview, US-A10) | PROJECT_SPEC.md В§6.3, В§7.4 | 2026-04-25 |
| OoS-3 | **Cash flow projections** (`cash_flow_projections` table, US-A4) | PROJECT_SPEC.md В§3.12, В§6.3 | 2026-04-25 |
| OoS-4 | **Issue tracking per client** (`client_issues` table, US-M6) | PROJECT_SPEC.md В§6.2 | 2026-04-25 |
| OoS-5 | **Auto-generated PDCA reports** (weekly/monthly CSV/PDF export, US-A7) | PROJECT_SPEC.md В§6.3 | 2026-04-25 |
| OoS-6 | **Partnerships dashboard** (`partnerships` table) | PROJECT_SPEC.md В§3.12 | 2026-04-25 |
| OoS-7 | **Lost-clients ABM tracking** (`abm_lost_clients` table, US-A8) | PROJECT_SPEC.md В§3.13 | 2026-04-25 |
| OoS-8 | **Reply triage UI** (manual classification of replies) | inferred from `replies.classification` field | 2026-04-25 |
| OoS-9 | **In-portal email/SMS dispatch** (sending notifications from the portal directly) | PROJECT_SPEC.md В§6.1 US-C8 | 2026-04-25 |
| OoS-10 | **RR/BR per-team-member reports** (US-A9) | PROJECT_SPEC.md В§6.3 | 2026-04-25 |
| OoS-11 | **CRM platform plug-ins** (`client_crm_integrations` table for Pipedrive / HubSpot / Zoho / Salesforce / Livespace) | PROJECT_SPEC.md В§3.3 | 2026-04-25 |
| OoS-12 | **Smartlead / Bison API sync from portal** (Phase 2 / future, В§8.1-8.2) | PROJECT_SPEC.md В§8 | 2026-04-25 |
| OoS-13 | **Account-Based Selling (ABS) scoring** (`account_based_selling` table) | PROJECT_SPEC.md В§3.12 | 2026-04-25 |
| OoS-14 | **`crm_prospects` / `lg_pipeline` separate from `agency_crm_deals`** | PROJECT_SPEC.md В§3.10-3.11 | 2026-04-25 |
| OoS-15 | **Server-side metric rollup tables / pre-computed `daily_snapshots` with diff columns** | PROJECT_SPEC.md В§3.7 | 2026-04-25 |

---

## 2. Why each is out of scope

### OoS-1 вЂ” Health Assessments

The original spec proposed a periodic traffic-light form to grade each client on six axes (IP / domains / warmup / copy / funnel / server). **Decision:** the portal does not implement a separate biweekly form/table workflow. The shipped dynamic condition layer evaluates operational metrics in-place on Clients surfaces (see [14 · Condition rules](./14-condition-rules.md)) and is intentionally different from a standalone assessment process. If a formal periodic assessment workflow is needed later, it should be explicitly re-scoped instead of repurposing condition rules.

### OoS-2 вЂ” CSV / Excel bulk import UI

Initial data load and ongoing batch updates are handled by **n8n / SQL**. The portal is a *thin* read+config surface. Adding a generalised import orchestration UI would require column mapping, validation pipelines, dry-runs, error tracebacks вЂ” none of which the team has bandwidth for, and none of which the agency operationally needs (the data already arrives via ingestion).

### OoS-3 вЂ” Cash flow projections

Financial planning lives outside this portal. The agency uses dedicated finance tools.

### OoS-4 вЂ” Issue tracking

Tickets / incidents are tracked elsewhere (external ticket system / spreadsheet). The portal does not need to become a ticketing tool.

### OoS-5 вЂ” Auto reports & exports

Stakeholders consume metrics via **dashboards**, not reports. Adding CSV/PDF export pipelines is feature creep without identified consumers. The single CSV export that does exist (Client Pipeline в†’ Export) is a focused tool for the client to take their lead list to sales tooling.

### OoS-6 вЂ” Partnerships

Partnership tracking is not a portal concern. Out of scope.

### OoS-7 вЂ” Lost-clients ABM

The agency tracks lost clients elsewhere; the portal's role is current-active operations. The `clients.status = 'Inactive'` value can be used for very basic lost-tracking inside the existing surface.

### OoS-8 вЂ” Reply triage UI

Every reply is classified by **n8n**. The portal does not classify replies. If unclassified replies are present in raw data, that is an ingestion/classification issue in n8n, not a portal workflow. See [11-integrations В§6](./11-integrations.md#6-reply-classification).

### OoS-9 вЂ” In-portal email/SMS dispatch

The portal stores destination lists (`clients.notification_emails`, `clients.sms_phone_numbers`); **n8n dispatches**. Triggers (new MQL, stalled campaign, sentiment change) live inside n8n flows, not in the portal. Building a duplicate dispatcher in the portal would split the source of truth and create deliverability problems.

### OoS-10 вЂ” RR/BR per-team-member reports

Team-member-level performance is not a portal-level metric. Manager capacity surface on the Admin dashboard provides enough visibility.

### OoS-11 вЂ” CRM platform plug-ins

The `crm_config` JSONB column on `clients` exists for future integration with the agency's own CRM stack. Multi-CRM with first-class config tables is **deferred**. If pushed live later, prefer extending the JSONB column over creating a new normalised table.

### OoS-12 вЂ” Smartlead / Bison API sync from portal

The portal does **not** call Smartlead/Bison APIs directly. n8n owns those integrations. Pushing data from the portal directly would duplicate logic and split error handling.

### OoS-13 вЂ” ABS scoring

Account-Based Selling scoring (CLV, market size, target dates) is not part of this portal's value proposition. If sales analytics is needed later, build it on the agency's BI stack.

### OoS-14 вЂ” `crm_prospects` / `lg_pipeline` separate tables

The original spec introduced multiple CRM-related tables. Reality consolidated into the single `agency_crm_deals` table. UI for that table is on the [open backlog](#4-open-backlog-cross-reference) as **BL-5**, not duplicated into separate tables.

### OoS-15 вЂ” Server-side rollup tables

The original spec proposed `daily_snapshots` with `mql_diff`, `me_diff`, `won_diff` pre-computed columns. The actual implementation uses **client-side aggregation** over raw daily counters (`daily_stats`, `campaign_daily_stats`). This trade-off (more bytes shipped, more flexibility) is a deliberate choice to keep ingestion simple. The `admin_dashboard_daily` view is the only server-side rollup and it covers the 21-day admin chart only.

---

## 3. How to promote something back into scope

If a feature here turns out to be necessary:

1. Add a **decision entry** to [BUSINESS_LOGIC.md В§12](../../BUSINESS_LOGIC.md#12-decisions-log) explaining why scope changed.
2. Move the item from this file to the [Open backlog](../../BUSINESS_LOGIC.md#11-open-backlog-planned-not-built) and assign a `BL-N` identifier.
3. Update the relevant role file (05/06/07) and metric / charts catalog.
4. If the change affects architecture (new tables, new RLS, new write path), write an **ADR** under `docs/adr/`.

The same path applies in reverse: if a backlog item is decided **never**, move it here.

---

## 4. Open backlog cross-reference

What is in scope but **not yet built**. Single source: [BUSINESS_LOGIC.md В§11](../../BUSINESS_LOGIC.md#11-open-backlog-planned-not-built). Reproduced here as a quick checklist.

- **BL-1** Client self-service notification preferences on `/client/settings`.
- **BL-2** OOO routing rows management UI (`client_ooo_routing`).
- **BL-3** LinkedIn API key field in manager/admin client drawer.
- **BL-4** Workshops / harmonogramy / cold-Ads ecosystem fields (schema + UI).
- **BL-5** Agency CRM kanban for `agency_crm_deals`.
- **BL-6 (closed):** Removed the non-active clients dashboard surface in the 2026-04-29 simplification pass.
- **BL-7** Rename "Reply scope" filter в†’ "Lead OOO scope".
- **BL-8** State-machine validation for lead transitions.
- **BL-9** Orphan auth-user recovery tool.
- **BL-10** Visible impersonation warning in UI.

When a backlog item ships, remove it from this list and from BUSINESS_LOGIC.md В§11.

---

End of out-of-scope reference. Back to [INDEX](./INDEX.md).

