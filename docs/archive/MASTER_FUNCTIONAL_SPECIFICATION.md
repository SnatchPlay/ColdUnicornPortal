> Legacy archive: this document is historical context only.
> It is not the source of truth for the current frontend runtime.
> It may reference mock-only modules, old table names, and deprecated architecture.

# ColdUnicorn PDCA Platform - Master Functional Specification

**Version:** 1.0
**Date:** 2026-04-04
**Status:** Draft for product/design/frontend review

---

# 1. Executive Summary

## What the Product Is

The ColdUnicorn PDCA Platform is a custom B2B SaaS portal replacing a sprawling Google Sheets-based operating system for a cold email lead generation agency (~35 active clients). It consists of two interlinked portals:

- **Client Portal** -- External-facing. Clients view their leads, campaigns, email statistics, pipeline progress, and dashboards.
- **Admin Portal** -- Internal-facing. ColdUnicorn admins, CS managers, and the founder manage the entire agency operation: client health, PDCA metrics, CRM pipeline, finances, domains, automations, and reporting.

## What the Migration Is Really Doing

This is not a simple "move data from sheets to a database" project. It is a **business process digitization** that:

1. Replaces a 127-column operational spreadsheet (CS PDCA) with normalized time-series data and computed views.
2. Replaces per-client Google Sheet reports with a proper multi-tenant lead management system.
3. Makes four Make.com automations (reply classification, lead logging, OOO routing, LinkedIn import) first-class citizens of the platform rather than invisible background processes.
4. Introduces proper role-based access control where currently clients access raw Google Sheets.
5. Creates a CS Manager daily operating workspace that doesn't exist as a distinct concept today.

## Main Findings

1. **The demo portal is significantly ahead of the formal spec** in some areas (PDCA matrix, Manager workspace, Client360 panel, lead reply threading with AI classification) but **completely missing** critical operational screens (finance, reports, LG pipeline, global domains, import tools, automation visibility).
2. **The SQL schema and TypeScript schema have diverged** -- the TS schema in the demo code is more advanced and correct for the UI, but the SQL schema in PROJECT_SPEC.md is the planned database. They must be reconciled.
3. **Critical missing table**: `lead_replies` exists in demo code but is absent from the SQL schema. Without it, reply threading, AI classification display, and conversation views are impossible.
4. **Critical missing table**: `client_ooo_routing` exists in demo code but is absent from the SQL schema. Required for the OOO campaign management automation.
5. **Critical missing table**: `client_pdca_phases` implied by the demo PDCA matrix/cards views but absent from SQL schema.
6. **The automation layer reveals hidden product requirements** -- SMS/email notification config per client, gender-based OOO campaign routing, Look4Lead LinkedIn integration, classification accuracy tracking, and blacklist management via Bison API.
7. **Lead qualification model conflict** between SQL (4 states + 4 booleans) and TS (9-state enum). The TS approach is better for UI.
8. **15+ admin pages from the spec have no demo implementation** yet.

## Main Risks

1. **Schema-UI mismatch** will cause rework if SQL schema is deployed before reconciliation with demo/TS types.
2. **Automation continuity** -- during migration, the Make.com automations still write to Google Sheets. The platform needs either a parallel-write strategy or a hard cutover plan.
3. **CS PDCA sheet has 127 columns** -- incomplete mapping will silently lose operational data.
4. **No import tooling exists yet** -- the MVP is useless without bulk data loading.
5. **Client notification forwarding** (SMS + email for new leads) is a live production feature in automations but has no schema or UI support.

## Major Missing Pieces

| Category | Missing Item | Impact |
|----------|-------------|--------|
| Schema | `lead_replies` table | Blocks reply thread UI, AI classification display |
| Schema | `client_ooo_routing` table | Blocks OOO automation management |
| Schema | `client_pdca_phases` table | Blocks PDCA matrix views |
| Schema | Schedule volume fields on snapshots | Blocks DoD schedule adherence view |
| Schema | Notification config (SMS phones, emails) | Blocks lead notification forwarding |
| UI | Finance section (cash flow, costs, invoices global) | No financial visibility |
| UI | Reports section (weekly, monthly, RR/BR) | No automated reporting |
| UI | LG Pipeline page | Agency sales pipeline invisible |
| UI | Global Domains page | Cross-client domain health invisible |
| UI | Data Import page | Cannot load data into the system |
| UI | Automation/Classification Logs | No visibility into AI classification or automation runs |
| UI | Client Campaigns tab (client portal) | Clients can't see campaign list |
| Workflow | Onboarding wizard | No structured client onboarding |
| Workflow | Audit trail / activity log | No accountability for changes |

---

# 2. Source Materials Reviewed

## 2.1 PROJECT_SPEC.md

- **Contains:** Complete formal specification including system overview, roles, full SQL schema (17 tables, 2 views), RLS policies, frontend route map (7 client pages, 30+ admin pages), user stories, business logic, data flow diagrams, migration plan, and Google Sheets mapping appendix.
- **Reveals:** The intended target architecture. Well-structured but represents design intent, not implementation reality.
- **Reliability:** High for architecture decisions. Medium for schema completeness (missing tables discovered). Low for UI detail (route list without interaction specs).
- **Role in future system:** Blueprint for database and backend. Must be updated with schema gaps found in this analysis.

## 2.2 ColdUnicorn _ Antal _ Report.xlsx (Client Report Workbook)

- **Contains:** 4 sheets -- Leads (1010 rows, 29 columns), Campaigns (214 rows, 8 columns), Dashboard (computed, 51 columns), Statistics (278 rows, 8 columns).
- **Reveals:** The exact data structure clients currently see. Leads have columns A-AC including Full Name, Job Title, Email, Phone, Phone Source, Company, Industry, Headcount, Lead Received date, Campaign Name, Message Title, Message #, Website, Qualification, Lead Response Time, Meetings (bool), Meetings Held (bool), Offer Sent (bool), Won (bool), Comments, Date, Mail from lead (response text), TIP, Month, Campaign ID, external IDs (Z), LinkedIn URL (AB), Country (AC). The Dashboard sheet is formula-driven with data series for charts (daily sent/reply/bounce, weekly/monthly leads, prospects, campaign stats). Statistics tracks daily per-campaign metrics (report-date, campaign-id, sent, reply, bounce, unique-open, positive-replies).
- **Reliability:** Very high -- this is the live production data.
- **Role in future system:** Defines the `leads`, `campaigns`, `campaign_daily_stats` schemas and the Client Dashboard data requirements.

### Columns in Report Leads NOT Covered by SQL Schema

| Column | Spreadsheet | SQL Schema | Status |
|--------|-------------|------------|--------|
| AC (Country) | Yes | No `country` field on leads | **MISSING** |
| Z (external ID 2) | Yes | Only `blacklist_id` and `domain_blacklist_id` | Partial |
| AB (LinkedIn URL) | Yes | `linkedin_url` exists | Covered |
| U (Date - seems like created date) | Yes | `created_at` | Covered |
| X (Month) | Computed | Can derive from dates | N/A |

## 2.3 ColdUnicorn _ PDCA (1).xlsx (PDCA Master Workbook)

- **Contains:** 20 sheets including the critical 127-column CS PDCA (962 rows), CRM (116 rows), CF/Cash Flow (40 rows), GH cost (13 rows), AUTH (75 rows), Daily stats (4,294 rows, 27 columns), Emails Exclude List (162 rows), Client CRM Details (1,002 rows), ABM LOSTS (1,000 rows), E5M CS (50 rows, 57 columns), LG PDCA (100 rows), Prospect Base (23 rows), Monthly (46 rows), DomainsPerformance (1,001 rows), Weekly (47 rows), Smartlead Accounts (5 rows), Dashboards (chart-only), RR & BR generator (25 rows).
- **Reveals:** The complete internal operating system of the agency. CS PDCA has sections: Customer info (A-G), Basic setup (H-Q), Issues (R), DoD schedule & daily sent (S-Z with 5-day windows), 3DoD leads (AA-AJ), WoW metrics (AK-BL with 4-week windows), 2Wo2W health (BM-BR), MoM totals (BS-CS with 4-month windows), Ecosystem integration (CT-DF), MoM invoices (DG-DN), MoM partnerships (DO-DR), Account Based Selling (DS-DW).
- **Reliability:** Very high -- this is the live operational data.
- **Role in future system:** Defines the entire admin portal data model and views.

### Critical CS PDCA Columns Missing from SQL Schema

| Column(s) | Purpose | SQL Status |
|-----------|---------|------------|
| CU | Notification email addresses | **MISSING** -- no notification config table |
| CT | SMS phone numbers for notifications | **MISSING** |
| CY | Auto-LI invitations API Key (Look4Lead) | **MISSING** from client_setup |
| Y-AA (Daily stats) | Schedule volume Today/Tomorrow/+2 | **MISSING** from client_daily_snapshots |
| DL | Opinion with status quo shock/surprise | **MISSING** explicit field (possibly in invoices.notes) |

### E5M CS Sheet Analysis

The E5M CS sheet is tagged "ignored" in the spec but contains a parallel view of client operations for the E5M sub-brand with fields including: server health, accounts blocked/total, lost probability, pricing, VAT, monthly invoice tracking (FV-10 through FV-03). **Decision**: Most fields are already covered by the SQL schema (health assessments, clients table). The monthly invoice columns map to the `invoices` table. E5M is a filtered view, not a separate data model. **No additional schema changes needed** from this sheet.

## 2.4 Automated Replies Management.xlsx

- **Contains:** 3 sheets -- ARM (1,000 rows: bison workspace id, bison ooo campaign id, gender), OOO Leads (4,561 rows: LeadID, ReplyID, WorkspaceID, Expected Return Date, Added to OOO Campaign?, Formatted Expected Date, Gender), Classification Test (202 rows: Workspace, Lead, Reply, AI Classification, Reasoning, Human Classification, Human Reasoning).
- **Reveals:** The OOO routing configuration (workspace → campaign × gender), the OOO lead queue, and an AI classification accuracy testing framework.
- **Reliability:** High -- live operational data.
- **Role in future system:** ARM → `client_ooo_routing` table. OOO Leads → fields on `leads` + `lead_replies`. Classification Test → a `classification_audit` or evaluation surface in admin.

## 2.5 Bison Replies Classification (Blueprint)

- **Trigger:** Webhook from Bison on reply received.
- **Flow:** Receive reply → AI classify via OpenAI (OOO/Interested/NRR/Spam_Inbound/Left_Company/other) → If lead already tagged Interested+MQL and new reply: forward via email → Otherwise: attach classification tag to lead in Bison.
- **Key reveal:** AI classification categories do NOT match either the SQL or TS schema enums. The automation uses: OOO, Interested, NRR, Spam_Inbound, Left_Company, other. Confidence is 0-100. Language detection (pl/en/de/other) is captured.
- **UI implications:** Need a classification log/audit view. Need to display AI confidence and reasoning per reply. Need to show classification category on lead replies.

## 2.6 Log Bison Replies in Spreadsheets (Blueprint)

- **Trigger:** Webhook from Bison on TAG_ATTACHED event.
- **Flow:** Most complex automation. Receives tag event → Looks up client config in PDCA → Gets lead data from Bison → Checks if lead exists in client spreadsheet → If new: enriches via Snov.io + Lusha, analyzes with OpenAI, writes to spreadsheet, sends SMS/email notifications, calls subscenario → If exists: updates qualification → If email mismatch: blacklists email/domain.
- **Key reveal:** Lead enrichment (Snov.io for position/industry/company/LinkedIn/country, Lusha for phone) is an automated step. Notification forwarding uses both SMS (Unitalk) and email (Bison forward). Response time is calculated and bucketed. Column mapping goes up to AC.
- **UI implications:** Lead enrichment source tracking needed. Notification configuration per client needed. Response time computation needed. Blacklist management surface needed.

## 2.7 Add OOO Leads into Campaigns (Blueprint)

- **Trigger:** Scheduled (daily cron).
- **Flow:** Searches OOO Leads sheet for leads with expected return date = 2 days ago → Groups by workspace → Looks up API key and follow-up campaign IDs → Splits by gender → Attaches leads to gender-appropriate follow-up campaigns via Bison API.
- **Key reveal:** Gender-based campaign routing is a live feature. The 2-day-after-return timing is business logic.
- **UI implications:** OOO routing configuration UI needed. OOO lead queue visibility needed. Gender must be tracked on leads.

## 2.8 Import Leads to Look4Leads Connect (Blueprint)

- **Trigger:** Scheduled (daily cron).
- **Flow:** Gets active clients with Look4Lead API keys from PDCA → For each: searches yesterday's leads with LinkedIn URLs → Pushes to Look4Lead AutoConnect automation.
- **Key reveal:** LinkedIn automation is a live feature gated by a per-client API key (column CY). Only leads with LinkedIn URLs are pushed.
- **UI implications:** Look4Lead integration toggle/config per client. LinkedIn URL as a visible and valuable field on leads.

## 2.9 PdcaFigmaTest (Demo Portal Code)

- **Contains:** A working React + Vite + shadcn/ui demo with three role-specific portals (Client, CS Manager, Admin) using mock data. Includes 19+ components, a TypeScript schema (16 interfaces + 8 enums), and comprehensive mock data.
- **Reveals:** The most current UI/UX thinking. The demo is more detailed than the spec in areas like Client360 panel (6 tabs with inline editing), lead reply threading with AI analysis, PDCA matrix/cards views, Manager daily workspace, and password/security settings.
- **Reliability:** Medium-high for UI patterns and data requirements. Not production code but represents validated design decisions.
- **Role in future system:** Component reference and interaction specification baseline.

---

# 3. Current-State System Decomposition

The current system consists of four interconnected layers:

## 3.1 Client-Facing Layer (Per-Client Google Sheet)

Each client gets a separate Google Sheet workbook containing:

| Sheet | Purpose | Records | Update Frequency |
|-------|---------|---------|-----------------|
| Leads | All leads from email campaigns | ~1,010 per client | Real-time via automation |
| Campaigns | Campaign registry | ~214 per client | Manual + automation |
| Statistics | Daily per-campaign metrics | ~278 rows (daily × campaigns) | Daily via automation |
| Dashboard | Charts and summaries | Computed (no raw data) | Auto-computed |

**Access model:** Clients receive a direct Google Sheets link. No authentication beyond Google account. No row-level filtering -- clients see the whole workbook.

## 3.2 Internal Operations Layer (PDCA Master Workbook)

A single master workbook shared internally with 20 sheets:

| Sheet | Purpose | Key Metric |
|-------|---------|-----------|
| CS PDCA | Central command -- 127 columns tracking every client dimension | THE operating view |
| CRM | ColdUnicorn's own sales pipeline | 116 prospects |
| CF | Cash flow projections | Monthly net/gross |
| GH cost | Agency cost breakdown | PLN totals |
| Daily stats | Time-series client snapshots | 4,294 rows |
| Emails Exclude List | Global email domain blacklist | 162 domains |
| Client CRM Details | Per-client CRM integration config | Platform + credentials |
| ABM LOSTS | Lost client tracking | Reasons + return possibility |
| LG PDCA | Lead generation pipeline (agency's own) | 100 deals |
| DomainsPerformance | All client email domains | ~1,000 domains |
| Weekly | Weekly MQL/ME/RR/BR per client | Rolling 4 weeks |
| Monthly | Monthly TMQL/WON per client | Rolling 12 months |
| RR & BR generator | Manual RR/BR calculation tool | Per team member |
| E5M CS | Sub-brand (E5M) operational view | Subset of CS PDCA |
| Smartlead Accounts | API credentials | 4 accounts |
| AUTH | Spreadsheet ID ↔ client mapping | Auth config |

## 3.3 Automation Layer (Make.com)

Four automations running in production:

| Automation | Trigger | Frequency | Critical Path? |
|-----------|---------|-----------|---------------|
| Bison Replies Classification | Webhook (reply received) | Real-time | Yes -- lead qualification |
| Log Bison Replies | Webhook (tag attached) | Real-time | Yes -- lead logging |
| Add OOO to Campaigns | Scheduled | Daily | Yes -- lead re-engagement |
| Import to Look4Leads | Scheduled | Daily | Medium -- LinkedIn outreach |

## 3.4 External Platform Layer

| Platform | Role | Integration Type |
|----------|------|-----------------|
| Bison (go.coldunicorn.com) | Email outreach execution | API + webhooks |
| Smartlead | Email outreach execution (legacy/parallel) | API keys |
| Snov.io | Lead enrichment (company, position, LinkedIn) | API |
| Lusha | Phone number discovery | API |
| Unitalk | SMS notifications | API |
| Look4Lead | LinkedIn automation | API |
| Google Sheets | Data store (being replaced) | Sheets API |
| OpenAI | Reply classification AI | API |

---

# 4. Target Product Model

## 4.1 Product Architecture

```
+----------------------------------------------------+
|                   Client Portal                      |
|  Dashboard | Pipeline | Campaigns | Analytics | Settings |
+---------------------------+------------------------+
                            |
                    Supabase (PostgreSQL + Auth + RLS)
                            |
+---------------------------+------------------------+
|                    Admin Portal                      |
|  Dashboard | Clients/360 | PDCA | CRM | Finance     |
|  Domains | Reports | Settings | Automations          |
+---------------------------+------------------------+
                            |
           +----------------+-------------------+
           |                |                   |
     Make.com/Edge    Bison/Smartlead      Enrichment
     Functions        Webhooks + API       (Snov.io, Lusha)
```

## 4.2 Portal Segmentation

| Portal | URL Pattern | Primary Users | Purpose |
|--------|-------------|---------------|---------|
| Client Portal | `/client/*` | Client users | View leads, campaigns, stats, dashboard |
| Admin Portal | `/admin/*` | super_admin, admin | Full agency management |
| Manager Workspace | `/admin/*` (filtered) | cs_manager | Daily operations for assigned clients |

**Design decision:** The Manager workspace is NOT a separate portal. It is the Admin portal with role-based filtering and a different default landing page. This avoids code duplication and allows managers to access admin features if their permissions expand.

## 4.3 Data Flow Model

```
External Platforms (Bison, Smartlead)
    |
    | Webhooks + Scheduled Sync
    v
Automation Layer (Make.com → Edge Functions)
    |
    | Writes classified, enriched leads + daily stats
    v
Database (Supabase PostgreSQL)
    |
    | RLS-filtered queries
    v
Frontend (React + TanStack Query)
    |
    +---> Client Portal (own data only)
    +---> Admin Portal (all data)
    +---> Manager Workspace (assigned clients)
```

---

# 5. Roles and Permission Matrix

## 5.1 Role Definitions

| Role | Identity | Scope | Count |
|------|----------|-------|-------|
| `super_admin` | ColdUnicorn founder (Lukasz) | Everything. Cannot be deleted. | 1 |
| `admin` | ColdUnicorn admin team | Nearly everything except user role escalation to super_admin | 2-5 |
| `cs_manager` | Customer Success / Growth Head (Ania, Natalia, Kacper, etc.) | Assigned clients only + shared read-only tools | 3-6 |
| `client` | External client user | Own client data only, client-visible tables only | ~35-70 |

## 5.2 Detailed Permission Matrix

### 5.2.1 Data Domain Permissions

| Data Domain | super_admin | admin | cs_manager | client |
|------------|:-----------:|:-----:|:----------:|:------:|
| **Leads** | CRUD all | CRUD all | CRUD assigned | Read own, update pipeline stages |
| **Lead Replies** | Read all | Read all | Read assigned | Read own |
| **Campaigns** | CRUD all | CRUD all | Read assigned | Read own |
| **Campaign Daily Stats** | CRUD all | CRUD all | Read assigned | Read own |
| **Client Daily Snapshots** | CRUD all | CRUD all | Read assigned | -- |
| **Health Assessments** | CRUD all | CRUD all | CRUD assigned | -- |
| **Client Setup** | CRUD all | CRUD all | Read+Edit assigned | -- |
| **Domains** | CRUD all | CRUD all | CRUD assigned | -- |
| **Client Issues** | CRUD all | CRUD all | CRUD assigned | -- |
| **Internal CRM** | CRUD | CRUD | -- | -- |
| **LG Pipeline** | CRUD | CRUD | -- | -- |
| **Invoices** | CRUD all | CRUD all | Read assigned | -- |
| **Partnerships** | CRUD all | CRUD all | Read assigned | -- |
| **Cash Flow** | CRUD | CRUD | -- | -- |
| **ABS (Account Based Selling)** | CRUD all | CRUD all | Read assigned | -- |
| **Email Exclude List** | CRUD | CRUD | Read | -- |
| **ABM Lost Clients** | CRUD | CRUD | Read | -- |
| **OOO Routing Config** | CRUD all | CRUD all | Read assigned | -- |
| **Users** | CRUD all + role management | CRUD (cannot create super_admin) | Read (own profile only editable) | Read (own profile only) |
| **Clients** | CRUD all | CRUD all | Read assigned | Read own |
| **PDCA Phases** | CRUD all | CRUD all | CRUD assigned | -- |
| **Automation Logs** | Read all | Read all | Read assigned | -- |
| **Notification Config** | CRUD all | CRUD all | Read assigned | -- |

### 5.2.2 Action Permissions

| Action | super_admin | admin | cs_manager | client |
|--------|:-----------:|:-----:|:----------:|:------:|
| Create client | Yes | Yes | No | No |
| Delete client | Yes | No (soft-delete only) | No | No |
| Assign CS Manager | Yes | Yes | No | No |
| Invite client user | Yes | Yes | Yes (own clients) | No |
| Deactivate user | Yes | Yes | No | No |
| Change user role | Yes | Yes (not to super_admin) | No | No |
| Import data (CSV/Excel) | Yes | Yes | Yes (own clients) | No |
| Export data | Yes | Yes | Yes (own clients) | Yes (own data) |
| Create health assessment | Yes | Yes | Yes (own clients) | No |
| Change lead qualification | Yes | Yes | Yes (own clients) | Yes (limited: meeting stages + won) |
| Edit campaign | Yes | Yes | No | No |
| Pause/resume campaign | Yes | Yes | No | No |
| Manage domains | Yes | Yes | Yes (own clients) | No |
| Create invoice | Yes | Yes | No | No |
| Edit cash flow | Yes | Yes | No | No |
| Edit CRM deal | Yes | Yes | No | No |
| Manage exclude list | Yes | Yes | No | No |
| View automation logs | Yes | Yes | Yes (own clients) | No |
| Configure notifications | Yes | Yes | No | No |
| Manage OOO routing | Yes | Yes | No | No |
| View finance section | Yes | Yes | No | No |
| Generate reports | Yes | Yes | Yes (own clients) | No |

### 5.2.3 Client Lead Qualification Restrictions

Clients can update their leads' pipeline stages, but only in a forward direction within client-visible stages:

| From | Allowed transitions (client) |
|------|------------------------------|
| preMQL | meeting_scheduled |
| MQL | meeting_scheduled |
| meeting_scheduled | meeting_held |
| meeting_held | offer_sent |
| offer_sent | won |

Clients CANNOT: change qualification to preMQL/MQL (that's CS Manager's job), reject leads, revert pipeline stages, or see unprocessed/unqualified leads.

CS Managers can set ANY qualification status and revert stages.

---

# 6. Entity and Data Model Review for UI Coverage

## 6.1 Entity Summary

| Entity | SQL Schema | TS Schema | UI Coverage | Verdict |
|--------|:----------:|:---------:|:-----------:|---------|
| organizations | Yes | Yes | Minimal (settings) | OK |
| users | Yes | Yes | Full (user mgmt) | OK |
| clients | Yes | Yes | Full (client list, 360) | OK |
| client_users | Yes | No (implicit) | User management | OK |
| client_setup | Yes | Yes | Client 360 Overview | OK -- needs minor additions |
| client_crm_integrations | Yes | Merged into setup | Client 360 CRM tab | OK -- TS simplified correctly |
| campaigns | Yes | Yes | Client portal + 360 | **Needs `type` field** |
| leads | Yes | Yes (diverged) | Central entity | **Needs reconciliation** |
| lead_replies | **MISSING** | Yes | Lead drawer, conversation | **CRITICAL GAP** |
| campaign_daily_stats | Yes | Yes | Charts, statistics | OK -- TS simplified |
| client_daily_snapshots | Yes | Yes (diverged) | PDCA, dashboards | **Needs schedule volumes** |
| client_health_assessments | Yes | Yes | Health views, 360 | OK |
| domains | Yes | Yes (diverged) | Domain management | OK -- minor field differences |
| crm_prospects | Yes | Yes (as AgencyCrmDeal) | CRM pipeline | OK -- TS renamed fields |
| lg_pipeline | Yes | No | LG Pipeline page | **Needs TS interface** |
| invoices | Yes | Yes (diverged) | Invoice management | **Needs reconciliation** |
| partnerships | Yes | No | Partnership management | **Needs TS interface** |
| cash_flow_projections | Yes | No | Cash flow page | **Needs TS interface** |
| account_based_selling | Yes | No | ABS page | **Needs TS interface** |
| email_exclude_list | Yes | Yes | Exclude list UI | OK |
| abm_lost_clients | Yes | Yes | Lost clients list | OK |
| client_issues | Yes | No | Issues management | **Needs TS interface** |
| client_ooo_routing | **MISSING** | Yes | OOO config UI | **CRITICAL GAP** |
| client_pdca_phases | **MISSING** | No (mock only) | PDCA matrix | **CRITICAL GAP** |
| classification_audit | **MISSING** | No | Classification review | **GAP** (post-MVP) |
| notification_config | **MISSING** | No | Notification settings | **GAP** |
| automation_log | **MISSING** | No | Automation visibility | **GAP** (post-MVP) |

## 6.2 Critical Schema Reconciliation: `leads` Table

**SQL Schema fields:**
```
id, client_id, campaign_id, full_name, job_title, email, phone_number, phone_source,
company_name, industry, headcount, website, linkedin_url, message_title, message_number,
qualification (4 values), lead_response_time, lead_received_at,
meeting_scheduled (bool), meeting_held (bool), offer_sent (bool), won (bool),
lead_response_text, comments, tip, external_campaign_id, blacklist_id,
domain_blacklist_id, created_at, updated_at
```

**TS Schema fields:**
```
id, client_id, campaign_id, email, full_name, job_title, company_name, linkedin_url,
gender, qualification (9 values), is_ooo, expected_return_date, latest_reply_at,
replied_at_step, total_replies_count, created_at, updated_at
```

**Spreadsheet Leads columns (actual data):**
```
Full Name, Job Title, Email, Phone Number, Phone Source, Company Name, Industry,
Headcount, Lead Received, Campaign Name, Message Title, Message #, Website,
Qualification, Lead Response Time, Meetings, Meetings Held, Offer Sent, Won,
Comments, Date, Mail from lead, TIP, Month, Campaign ID, (external IDs),
LinkedIn URL, Country
```

### Recommended Final `leads` Schema

```sql
CREATE TABLE leads (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id           UUID REFERENCES campaigns(id),

  -- Contact info
  full_name             TEXT,
  job_title             TEXT,
  email                 TEXT NOT NULL,
  phone_number          TEXT,
  phone_source          TEXT,
  company_name          TEXT,
  industry              TEXT,
  headcount             TEXT,
  website               TEXT,
  linkedin_url          TEXT,
  country               TEXT,                    -- NEW: from spreadsheet col AC + enrichment
  gender                TEXT CHECK (gender IN ('male', 'female', 'general')),  -- NEW: from OOO routing

  -- Campaign context
  message_title         TEXT,
  message_number        TEXT,

  -- Qualification (unified enum, replaces 4-value + 4 booleans)
  qualification         TEXT DEFAULT 'unprocessed'
                        CHECK (qualification IN (
                          'unprocessed', 'unqualified', 'preMQL', 'MQL',
                          'meeting_scheduled', 'meeting_held', 'offer_sent',
                          'won', 'rejected'
                        )),
  lead_response_time    TEXT,
  lead_received_at      TIMESTAMPTZ,

  -- OOO tracking
  is_ooo                BOOLEAN DEFAULT false,   -- NEW
  expected_return_date   DATE,                    -- NEW
  ooo_campaign_added    BOOLEAN DEFAULT false,    -- NEW: from OOO Leads sheet

  -- Reply tracking (denormalized for query performance)
  latest_reply_at       TIMESTAMPTZ,             -- NEW
  replied_at_step       INTEGER,                 -- NEW
  total_replies_count   INTEGER DEFAULT 0,       -- NEW

  -- Content
  lead_response_text    TEXT,
  comments              TEXT,
  tip                   TEXT,

  -- External references
  external_campaign_id  TEXT,
  external_lead_id      TEXT,                    -- NEW: Bison lead ID
  blacklist_id          TEXT,
  domain_blacklist_id   TEXT,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);
```

## 6.3 Missing Table: `lead_replies`

```sql
CREATE TABLE lead_replies (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  external_reply_id     TEXT,
  direction             TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sequence_step         INTEGER,
  message_subject       TEXT,
  message_text          TEXT NOT NULL,
  received_at           TIMESTAMPTZ NOT NULL,

  -- AI Classification
  ai_classification     TEXT CHECK (ai_classification IN (
    'ooo', 'interested', 'nrr', 'spam_inbound', 'left_company',
    'info_requested', 'other', 'unclassified'
  )),
  ai_reasoning          TEXT,
  ai_confidence         NUMERIC(5,2),            -- 0.00-1.00
  language_detected     TEXT,                     -- pl, en, de, other

  -- Enrichment source tracking
  extracted_date        DATE,                     -- for OOO return date extraction
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_replies_lead ON lead_replies(lead_id, received_at DESC);
```

## 6.4 Missing Table: `client_ooo_routing`

```sql
CREATE TABLE client_ooo_routing (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  gender          TEXT NOT NULL CHECK (gender IN ('male', 'female', 'general')),
  campaign_id     UUID REFERENCES campaigns(id),
  is_active       BOOLEAN DEFAULT true,
  UNIQUE(client_id, gender)
);
```

## 6.5 Missing Table: `client_pdca_phases`

```sql
CREATE TABLE client_pdca_phases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  phase           TEXT NOT NULL CHECK (phase IN ('plan', 'do', 'check', 'act')),
  status          TEXT NOT NULL CHECK (status IN ('done', 'in_progress', 'pending', 'blocked')),
  items           JSONB DEFAULT '[]',           -- array of action item strings
  due_date        DATE,
  note            TEXT,
  updated_by      UUID REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, phase)
);
```

## 6.6 Missing Fields on `client_daily_snapshots`

```sql
-- Add to client_daily_snapshots:
  schedule_volume_today       INTEGER,    -- from Daily stats col Y
  schedule_volume_tomorrow    INTEGER,    -- from Daily stats col Z
  schedule_volume_day_after   INTEGER,    -- from Daily stats col AA
```

## 6.7 Missing Fields on `client_setup`

```sql
-- Add to client_setup:
  notification_emails         TEXT[],     -- from PDCA col CU, for lead forwarding
  notification_sms_phones     TEXT[],     -- from PDCA col CT
  look4lead_api_key           TEXT,       -- from PDCA col CY
  cold_linkedin               BOOLEAN DEFAULT false,  -- already exists but confirm
```

## 6.8 Missing Field on `campaigns`

```sql
-- Add to campaigns:
  type    TEXT CHECK (type IN ('outreach', 'ooo', 'nurture')) DEFAULT 'outreach',
```

## 6.9 Recommended Additional Views

```sql
-- DoD view: last 5 days of daily snapshots per client
CREATE VIEW v_client_dod AS
SELECT
  client_id,
  snapshot_date,
  emails_sent_total,
  schedule_volume_today,
  schedule_volume_tomorrow,
  mql_diff,
  won_diff
FROM client_daily_snapshots
WHERE snapshot_date >= CURRENT_DATE - 5
ORDER BY client_id, snapshot_date DESC;
```

---

# 7. Final Information Architecture

## 7.1 Client Portal Navigation

```
Client Portal
├── Dashboard                    /client/dashboard
├── My Pipeline (Leads)          /client/leads
│   └── [Lead Drawer]            (slide-over, no route change)
├── Campaigns                    /client/campaigns
│   └── Campaign Detail          /client/campaigns/:id
├── Analytics (Statistics)       /client/analytics
└── Settings                     /client/settings
    ├── Profile
    ├── Notifications
    ├── Security
    └── Preferences
```

## 7.2 Admin Portal Navigation

```
Admin Portal
├── Dashboard (Executive)        /admin/dashboard
├── Clients & 360°               /admin/clients
│   └── Client 360° Panel        (slide-over or /admin/clients/:id)
│       ├── Overview
│       ├── Campaigns
│       ├── Leads
│       ├── Domains
│       ├── Health
│       ├── Invoices
│       ├── Setup & Integrations
│       ├── Issues
│       └── PDCA
├── PDCA Operations              /admin/pdca
│   ├── Day-over-Day             /admin/pdca/dod
│   ├── Week-over-Week           /admin/pdca/wow
│   ├── Biweekly Health          /admin/pdca/2wo2w
│   └── Month-over-Month         /admin/pdca/mom
├── Agency CRM                   /admin/crm
│   ├── Pipeline                 /admin/crm/pipeline
│   └── LG Pipeline              /admin/crm/lg-pipeline
├── Domains (Global)             /admin/domains
├── Finance                      /admin/finance
│   ├── Invoices (All)           /admin/finance/invoices
│   ├── Cash Flow                /admin/finance/cash-flow
│   └── Costs                    /admin/finance/costs
├── Reports                      /admin/reports
│   ├── Weekly                   /admin/reports/weekly
│   ├── Monthly                  /admin/reports/monthly
│   └── RR/BR Generator          /admin/reports/rr-br
├── Settings                     /admin/settings
│   ├── Users & Invitations      /admin/settings/users
│   ├── Email Blacklist           /admin/settings/blacklist
│   ├── Integrations             /admin/settings/integrations
│   ├── Lost Clients (ABM)       /admin/settings/lost-clients
│   └── Automation Logs          /admin/settings/automations
└── Data Import                  /admin/import
```

## 7.3 CS Manager Workspace

The CS Manager sees the Admin Portal with these modifications:

- **Landing page:** Manager Dashboard (not Executive Dashboard)
- **Sidebar sections visible:** Dashboard, My Clients (360°), Leads Workspace, PDCA, Reports (own clients only)
- **Hidden sections:** Finance, Agency CRM, LG Pipeline, User Management, Import, Automation Logs, Global Domains
- **All data filtered** to assigned clients only

```
CS Manager View
├── My Dashboard                 /admin/dashboard (manager variant)
├── My Clients (360°)            /admin/clients (filtered)
│   └── Client 360° Panel
├── Leads Workspace              /admin/leads (across assigned clients)
├── PDCA                         /admin/pdca (filtered)
│   ├── DoD / WoW / 2Wo2W / MoM
└── Reports                      /admin/reports (filtered)
```

## 7.4 Cross-Navigation Paths

| From | To | Trigger |
|------|----|---------|
| Admin Dashboard → Client 360 | Client row click | "At risk" client click |
| Admin Dashboard → CRM Pipeline | CRM widget click | Pipeline value click |
| Admin Dashboard → Invoices | Invoice alert banner | Overdue notice click |
| Client 360 → Lead Drawer | Lead row click | Any lead in leads tab |
| Client 360 → Campaign Detail | Campaign name click | In campaigns tab |
| PDCA DoD → Client 360 | Client name click | Any row |
| Manager Dashboard → Client 360 | Client card click | Attention items |
| Manager Dashboard → Leads Workspace | "Urgent leads" click | Pre-filtered |
| Client Dashboard → Pipeline | "View all leads" link | Navigation |
| Client Pipeline → Lead Drawer | Lead row click | Any row |
| Any page → Data Import | Import button | Where available |

---

# 8. Client Portal Functional Specification

## 8.1 Client Dashboard

- **Route:** `/client/dashboard`
- **Primary roles:** client
- **Primary purpose:** At-a-glance view of lead generation performance, campaign health, and pipeline velocity.
- **Business value:** Clients can self-serve daily/weekly check-ins without emailing their CS manager.
- **Key datasets:** `client_daily_snapshots`, `campaign_daily_stats`, `campaigns`, `leads`
- **Required fields:**
  - Snapshots: emails_sent_total, mql_diff, me_diff, won_diff, prospects_count, bounce_count
  - Campaign stats: report_date, sent_count, reply_count, bounce_count, unique_open_count
  - Leads: qualification, lead_received_at, meeting_held, won
  - Campaigns: name, status, database_size, positive_responses
- **Main UI sections:**
  1. Date range picker (default: Last 30 days)
  2. KPI cards row: MQLs Delivered (delta badge), Meetings Booked (delta), Deals Won (delta), Emails Sent (delta), Prospects (count)
  3. Daily Sent chart (bar, last 30 days)
  4. Leads by Week chart (bar)
  5. Leads by Month chart (bar)
  6. Velocity chart (composed: bar for sent, line for MQLs)
  7. Conversion Funnel (horizontal bars: Prospects → MQL → Meeting → Won, with conversion % between)
  8. Campaign Reply Rates list (color-coded: green >=5%, yellow >=3%, red <3%)
- **Filters/search/sort:** Date range picker only. All widgets filter by selected range.
- **Row actions:** N/A (no tables)
- **Bulk actions:** N/A
- **Edit capabilities:** None (read-only)
- **Validation rules:** N/A
- **Empty states:** "No campaign data yet. Your CS manager will set up your first campaigns soon." with illustration.
- **Loading states:** Skeleton cards for KPIs, skeleton chart placeholders.
- **Error states:** "Unable to load dashboard data. Please try again." with retry button.
- **Permission nuances:** Data is RLS-filtered to client's own data only. Client sees only client-visible lead qualifications (preMQL through won).
- **Entry points:** Sidebar "Dashboard" link (default landing page for clients).
- **Exit paths:** Sidebar navigation to Pipeline, Campaigns, Analytics, Settings. "View all leads" link in funnel → Pipeline.
- **Mobile/responsive considerations:** KPI cards stack to 2-column on tablet, 1-column on mobile. Charts stack vertically. Date picker becomes full-width modal on mobile.
- **Audit/history needs:** None.
- **Export/reporting needs:** None on dashboard itself.
- **Notes:** The demo has "Prospects added" and "Sent count for last three months" charts which are valuable additions beyond the spec. Keep them.

## 8.2 Client Pipeline (Leads)

- **Route:** `/client/leads`
- **Primary roles:** client
- **Primary purpose:** Browse, search, filter, and manage all leads. Update pipeline stages (meetings, offers, won).
- **Business value:** The core deliverable of the agency -- clients track what they're paying for.
- **Key datasets:** `leads`, `lead_replies`, `campaigns`
- **Required fields:**
  - Leads: full_name, email, company_name, job_title, qualification, campaign_id, replied_at_step, total_replies_count, latest_reply_at, is_ooo, expected_return_date, created_at, linkedin_url, phone_number
  - Replies: message_text, direction, sequence_step, ai_classification, ai_reasoning, ai_confidence, received_at
  - Campaigns: name
- **Main UI sections:**
  1. Header: page title, lead count, Export CSV button
  2. Status pill filters: Pre-MQL, MQL, Meeting Scheduled, Meeting Held, Offer Sent, Won, Rejected (with counts). "All" default.
  3. Search bar (name, company, email)
  4. Campaign filter dropdown
  5. OOO filter (All / Active / OOO only)
  6. Sortable data table:
     - Column: Lead (name + email + avatar)
     - Column: Company (name + job title)
     - Column: Status (inline dropdown -- client-limited stages)
     - Column: Campaign
     - Column: Step # (replied_at_step)
     - Column: Replies (count + latest AI classification badge)
     - Column: Last Reply (relative time)
     - Column: Added (created_at)
  7. Lead Drawer (slide-over on row click):
     - Header: avatar, name, title, company, qualification badge, OOO badge
     - AI Analysis section: classification badge, confidence bar, reasoning text
     - Update Pipeline: grid of stage buttons (client-restricted)
     - Contact: email (mailto), LinkedIn (external), phone
     - Details grid: Campaign, Step, Replies count, Gender, Created, Last Reply
     - Conversation thread: sorted replies with direction, step, classification, message text
     - Footer: Contact and LinkedIn buttons
- **Filters/search/sort:** Search by name/company/email. Filter by qualification, campaign, OOO status. Sort by: name, company, qualification, latest_reply_at, total_replies_count, created_at (ascending/descending toggle).
- **Row actions:** Click to open drawer. Inline status dropdown change.
- **Bulk actions:** Export CSV (all filtered results).
- **Edit capabilities:** Change lead qualification (client-restricted transitions only). No other edits.
- **Validation rules:** Qualification transitions are forward-only for clients (see Section 5.2.3).
- **Empty states:** "No leads yet. Once your campaigns start generating responses, they'll appear here." Filtered empty: "No leads match your filters."
- **Loading states:** Table skeleton rows. Drawer skeleton.
- **Error states:** "Unable to load leads" with retry. Individual lead load failure in drawer.
- **Permission nuances:** Clients do NOT see `unprocessed` or `unqualified` leads. They see preMQL and above. Clients cannot set qualification to preMQL/MQL/rejected (those are CS manager actions). Clients CAN set meeting_scheduled through won.
- **Entry points:** Sidebar "My Pipeline". Dashboard "View all leads" link.
- **Exit paths:** Drawer → LinkedIn (external). Drawer → email (mailto). Back to dashboard.
- **Mobile/responsive considerations:** Table becomes card list on mobile. Drawer becomes full-screen panel. Search and filters collapse into expandable section.
- **Audit/history needs:** Qualification changes should be logged (who changed, when, from what, to what). Visible in admin, not to client.
- **Export/reporting needs:** CSV export with columns: Name, Email, Company, Title, Qualification, Campaign, Step, Replies, Last Reply, Created.
- **Notes:** The `lead_response_text` from the old schema is replaced by the conversation thread from `lead_replies`. The old `comments` and `tip` fields should be visible in the drawer if populated.

## 8.3 Client Campaigns

- **Route:** `/client/campaigns`
- **Primary roles:** client
- **Primary purpose:** View all email campaigns, their status, size, and performance.
- **Business value:** Transparency into what outreach is being done on the client's behalf.
- **Key datasets:** `campaigns`, `campaign_daily_stats`, `leads`
- **Required fields:**
  - Campaigns: name, status, type, database_size, start_date, positive_responses, created_at
  - Stats: sent_count, reply_count, bounce_count, unique_open_count (aggregated)
  - Leads: count per campaign, qualification distribution
- **Main UI sections:**
  1. Header with campaign count
  2. Campaign cards or table:
     - Name
     - Status badge (active/paused/completed/draft)
     - Type badge (outreach/ooo/nurture) -- only outreach campaigns shown to clients
     - Database size
     - Positive responses count
     - Reply rate (computed)
     - Start date
  3. Click to expand or navigate to Campaign Detail
- **Filters/search/sort:** Search by name. Filter by status. Sort by name, start date, reply rate.
- **Row actions:** Click to Campaign Detail.
- **Bulk actions:** None.
- **Edit capabilities:** None (read-only for clients).
- **Validation rules:** N/A.
- **Empty states:** "No campaigns yet."
- **Loading states:** Skeleton cards.
- **Error states:** Standard error with retry.
- **Permission nuances:** Clients see only `outreach` type campaigns. `ooo` and `nurture` campaigns are internal.
- **Entry points:** Sidebar navigation.
- **Exit paths:** Campaign Detail page.
- **Mobile/responsive considerations:** Cards stack vertically.
- **Audit/history needs:** None.
- **Export/reporting needs:** None.
- **Notes:** **Status: Partially missing from demo** -- the demo removed the dedicated Campaigns page and merged campaign data into Dashboard and Analytics. Recommend restoring as a separate page per the spec.

## 8.4 Client Campaign Detail

- **Route:** `/client/campaigns/:id`
- **Primary roles:** client
- **Primary purpose:** Detailed view of a single campaign's daily performance and associated leads.
- **Business value:** Deep-dive into specific campaign effectiveness.
- **Key datasets:** `campaigns`, `campaign_daily_stats`, `leads`
- **Required fields:**
  - Campaign: all fields
  - Daily stats: report_date, sent_count, reply_count, bounce_count, unique_open_count, positive_replies
  - Leads: filtered by campaign_id
- **Main UI sections:**
  1. Campaign header: name, status, type, database size, date range
  2. KPI cards: Total Sent, Total Replies, Reply Rate %, Bounce Rate %, Positive Replies
  3. Daily performance chart (time-series): sent (bar), replies (line), bounces (line), opens (line)
  4. Leads from this campaign (table, same as Pipeline but pre-filtered)
- **Filters/search/sort:** Date range on chart. Lead table inherits Pipeline filters.
- **Row actions:** Lead row click opens Lead Drawer.
- **Bulk actions:** None.
- **Edit capabilities:** None.
- **Validation rules:** N/A.
- **Empty states:** "No statistics available for this campaign yet."
- **Loading states:** Standard.
- **Error states:** 404 if campaign not found or not owned by client.
- **Permission nuances:** RLS ensures client can only access own campaigns.
- **Entry points:** Campaigns list, Dashboard campaign links.
- **Exit paths:** Back to Campaigns list, Lead Drawer.
- **Mobile/responsive considerations:** Chart scrollable horizontally on small screens.
- **Audit/history needs:** None.
- **Export/reporting needs:** Export daily stats as CSV.
- **Notes:** **Status: Missing from demo.** Must be built.

## 8.5 Client Analytics (Statistics)

- **Route:** `/client/analytics`
- **Primary roles:** client
- **Primary purpose:** Interactive charts and conversion analysis across all campaigns.
- **Business value:** Performance trends and conversion rate visibility.
- **Key datasets:** `client_daily_snapshots`, `campaigns`, `campaign_daily_stats`, `leads`
- **Required fields:**
  - Snapshots: mql_diff, me_diff, won_diff, prospects_count, emails_sent_total
  - Leads: qualification distribution, created_at
  - Campaign stats: sent_count, reply_count, bounce_count per campaign
- **Main UI sections:**
  1. Date range picker
  2. KPI stat cards: MQLs (with prospect→MQL rate), Meetings (MQL→meeting rate), Won (meeting→won rate), Prospects
  3. Pipeline Activity line chart (MQLs, Meetings, Won over time)
  4. Current Pipeline funnel (horizontal bars by qualification)
  5. Conversion Rates panel (stage-to-stage percentages)
  6. Campaign Performance ranking (reply rate, color-coded, with sent counts)
- **Filters/search/sort:** Date range only.
- **Row actions:** None.
- **Bulk actions:** None.
- **Edit capabilities:** None.
- **Validation rules:** N/A.
- **Empty states:** "Not enough data to generate analytics. Check back after your campaigns have been running for at least a week."
- **Loading states:** Skeleton charts.
- **Error states:** Standard.
- **Permission nuances:** Same as Dashboard.
- **Entry points:** Sidebar.
- **Exit paths:** Cross-links to Pipeline (from funnel), Campaigns (from performance ranking).
- **Mobile/responsive considerations:** Charts stack. Conversion rates become vertical.
- **Audit/history needs:** None.
- **Export/reporting needs:** Export charts as PNG. Export underlying data as CSV.
- **Notes:** This merges the spec's "Statistics" page with richer analytics. The spec's Statistics page was a raw data table; the demo's Analytics is the better approach.

## 8.6 Client Settings

- **Route:** `/client/settings`
- **Primary roles:** client
- **Primary purpose:** Profile management, notification preferences, security, UI preferences.
- **Business value:** Client self-service for account management.
- **Key datasets:** `users`, `clients`, `client_setup`
- **Required fields:**
  - User: full_name, email, phone, job_title (needs addition), linkedin_url (on user)
  - Client: name, status, contract_due_date, cs_manager_id (read-only)
- **Main UI sections:**
  1. Left sidebar: Profile, Notifications, Security, Preferences
  2. Profile:
     - Personal Info: avatar, full name, job title, email (read-only), phone, LinkedIn URL
     - Company Info (read-only): name, status, contract due, CS Manager name
  3. Notifications:
     - Email toggles: New MQL, Meeting booked, Deal won, Weekly report, System notices
     - In-App toggles: New MQL banner, Meeting scheduled, OOO leads returned
  4. Security:
     - Change Password (current, new with strength meter, confirm)
     - Two-Factor Authentication toggle
     - Active Sessions list with revoke
  5. Preferences:
     - Theme (Dark/Light/System)
     - Date Format
     - Language (EN/PL/UA/DE)
     - Timezone with live clock
- **Filters/search/sort:** N/A.
- **Row actions:** Revoke session.
- **Bulk actions:** None.
- **Edit capabilities:** All profile fields except email and company info. All notification toggles. Password change. Theme/language/timezone.
- **Validation rules:** Password: min 8 chars, at least 1 uppercase, 1 number. Confirm must match. Phone: E.164 format or free text. LinkedIn URL: valid URL pattern.
- **Empty states:** N/A (always has data).
- **Loading states:** Form skeleton.
- **Error states:** Save failure toast. Password change failure message.
- **Permission nuances:** Clients can only edit their own profile. Company info is always read-only.
- **Entry points:** Sidebar "Settings". Sidebar user footer gear icon.
- **Exit paths:** Back to any main page.
- **Mobile/responsive considerations:** Settings sidebar becomes tabs on mobile. Forms full-width.
- **Audit/history needs:** Password changes should be logged internally.
- **Export/reporting needs:** None.
- **Notes:** The demo implementation is comprehensive. The spec didn't detail Settings beyond "Profile, notification preferences."

---

# 9. Admin Portal Functional Specification

## 9.1 Admin Executive Dashboard

- **Route:** `/admin/dashboard`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Agency-wide health overview. Revenue, client portfolio, alerts, trends.
- **Business value:** Founder/admin can assess entire business in 30 seconds.
- **Key datasets:** `clients`, `client_daily_snapshots`, `client_health_assessments`, `campaigns`, `campaign_daily_stats`, `invoices`, `crm_prospects` (AgencyCrmDeal)
- **Required fields:** All aggregate metrics from these entities.
- **Main UI sections:**
  1. 4 KPI cards: Active Clients (total), Monthly Revenue (MRR from contracted_amount), Active Campaigns (total sent), Total MQLs (meetings + won sub-counts)
  2. Alert banners: Overdue invoices, clients with red health, contracts expiring within 30 days
  3. MQL Trend chart (all clients aggregated, bar by date)
  4. Revenue Trend chart (bar by month)
  5. Health Distribution panel (green/yellow/red/unknown counts)
  6. Pipeline (CRM) summary: total pipeline value, top deals
  7. Invoice Status breakdown: paid/sent/draft/overdue counts and totals
  8. Client Portfolio Snapshot table: Client, Status, CS Manager, Health, MQLs, Meetings, Contract
- **Filters/search/sort:** None (executive overview is always "current state").
- **Row actions:** Client row click → Client 360 panel.
- **Bulk actions:** None.
- **Edit capabilities:** None (read-only overview).
- **Validation rules:** N/A.
- **Empty states:** "No clients yet. Create your first client to get started."
- **Loading states:** Skeleton cards + skeleton chart + skeleton table.
- **Error states:** Standard.
- **Permission nuances:** Admin-only data. CS managers get a different dashboard (see Section 10).
- **Entry points:** Default landing for admin/super_admin.
- **Exit paths:** Client 360 (row click), CRM Pipeline (widget click), Invoices (alert click).
- **Mobile/responsive considerations:** KPI cards 2-column. Table horizontal scroll.
- **Audit/history needs:** None.
- **Export/reporting needs:** None directly.
- **Notes:** The demo (AdminOverview) is well-implemented. Missing: contract expiry alerts.

## 9.2 Admin Clients & 360

- **Route:** `/admin/clients`
- **Primary roles:** super_admin, admin, cs_manager (filtered to assigned)
- **Primary purpose:** Central client registry. Entry point to Client 360 deep-dive panel.
- **Business value:** The "home base" for all client management.
- **Key datasets:** `clients`, `client_health_assessments`, `client_daily_snapshots`, `users`, `campaigns`
- **Required fields:**
  - Clients: name, status, cs_manager_id, kpi_leads, kpi_meetings, contracted_amount, contract_due_date
  - Latest health: overall health (computed from 5 dimensions)
  - Snapshots: latest mql_total, me_total
  - Campaigns: active count
- **Main UI sections:**
  1. Header: "Clients & 360°" title, "New Client" button
  2. Status pill filters: All, Active, Onboarding, Paused, Churned, Lost (with counts)
  3. Search bar + CS Manager filter dropdown
  4. Client table: Client (name+ID), Status (badge), CS Manager, Health (badge), MQLs (vs target), Meetings (vs target), Campaigns (active count), Contract (EUR/mo), Due Date (highlighted if <=60 days)
  5. Table footer: "X of Y clients"
  6. Client 360 Panel (slide-over on row click)
- **Filters/search/sort:** Search by client name. Filter by status, CS manager. Sort by name, status, health, MQLs, contract.
- **Row actions:** Click opens Client 360 Panel.
- **Bulk actions:** None.
- **Edit capabilities:** Via 360 panel (see below). "New Client" button opens creation modal.
- **Validation rules:** New client: company name required.
- **Empty states:** "No clients match your filters." or "No clients yet."
- **Loading states:** Table skeleton.
- **Error states:** Standard.
- **Permission nuances:** cs_manager sees only assigned clients. Admin/super_admin see all.
- **Entry points:** Sidebar. Dashboard client row click. PDCA client name click.
- **Exit paths:** Client 360 panel. New Client modal.
- **Mobile/responsive considerations:** Table becomes card list. 360 panel becomes full-screen.
- **Audit/history needs:** Client creation logged.
- **Export/reporting needs:** Client list CSV export.
- **Notes:** Demo implementation (AdminClients + Client360Panel) is comprehensive.

### 9.2.1 Client 360 Panel

The 360 Panel is a ~740px slide-over with tabbed content:

**Tab 1: Overview**
- 4 KPI cards: MQLs (vs target), Meetings (vs target), Won, Prospects
- Pipeline Trend area chart
- Client Info card (editable): Name, Status, CS Manager, Bison Workspace ID, MQL Target/mo, Meeting Target/mo, Contract EUR/mo, Contract Due Date
- Workspace Setup card (editable): Inboxes, Min sent/day, Prospects base, CRM Platform, OOO Routing toggle
- Health Assessment card: 5 health dots + insights + add new assessment form

**Tab 2: Campaigns**
- Portfolio aggregate stats (Sent, Reply Rate, Open Rate, Bounce Rate)
- Campaign cards: name (editable), status, type, pause/resume toggle, stats, expandable daily chart, edit mode

**Tab 3: Leads**
- Lead rows: name/email/title/company, qualification badge (editable), OOO badge (editable return date), last reply

**Tab 4: Domains**
- Domain rows: domain name, setup email, active toggle, blacklist toggle, warmup reputation (editable, 0-100), dates

**Tab 5: Health**
- Health assessment timeline (all assessments, newest first)
- Add new assessment form with 5+1 traffic-light selectors (IP, Domains, Warmup, Copy, Funnel, Server) + insights textarea

**Tab 6: Invoices**
- Summary: Total Invoiced, Outstanding
- Invoice rows: amount, date, status (editable dropdown), vindication stage

**Tab 7: Setup & Integrations** (NEW -- currently merged into Overview)
- Full setup checklist (all `client_setup` fields)
- CRM integration details
- OOO routing configuration (gender → campaign mapping)
- Notification config (email addresses, SMS phones)
- Look4Lead API key
- External IDs (Smartlead ID, Bison Workspace ID)

**Tab 8: Issues** (NEW -- not in demo)
- Issue list with priority, status, description, reported by, timestamps
- Add issue form

**Tab 9: PDCA**
- 4 phase cards (Plan/Do/Check/Act) with status, items, due date, note

**Missing from demo 360 panel:** Partnerships tab, ABS tab. These can be lower priority.

### 9.2.2 New Client Modal

Two-step wizard:
1. **Client Info:** Company name (required), Status, CS Manager, MQL Target, Meeting Target, Contract EUR/mo, Contract Due Date, Bison Workspace ID
2. **Workspace:** Inboxes count, Min emails/day, Prospects base, CRM Platform, OOO Routing toggle, summary preview

## 9.3 Admin PDCA Operations

### 9.3.1 PDCA Overview / Matrix

- **Route:** `/admin/pdca`
- **Primary roles:** super_admin, admin, cs_manager (filtered)
- **Primary purpose:** Cross-client PDCA phase tracking. Quick visual of Plan/Do/Check/Act status for all clients.
- **Business value:** Operational rhythm management -- ensures nothing falls through cracks.
- **Key datasets:** `client_pdca_phases`, `clients`, `client_health_assessments`, `users`
- **Main UI sections:**
  1. View toggle: Matrix / Cards
  2. Summary stat cards: Done, In Progress, Pending, Blocked counts
  3. Matrix view: rows = clients, columns = Plan/Do/Check/Act (expandable cells), Health column
  4. Cards view: one card per client with 4-column PDCA grid
- **Notes:** Demo is well-implemented. Needs real data binding.

### 9.3.2 Day-over-Day (DoD)

- **Route:** `/admin/pdca/dod`
- **Primary roles:** super_admin, admin, cs_manager (filtered)
- **Primary purpose:** Daily send volume monitoring and schedule adherence.
- **Business value:** Catch sending issues within 24 hours.
- **Key datasets:** `client_daily_snapshots` (last 7 days), `clients`, `client_setup`
- **Required fields:** emails_sent_total, schedule_volume_today/tomorrow/day_after, mql_diff, client.min_sent_daily
- **Main UI sections:**
  1. Date context header (today's date, day of week)
  2. Cross-client table:
     - Client name
     - Schedule adherence indicator (sent vs min_sent_daily)
     - Schedule volumes: +2, +1, Today
     - Daily sent: Today, -1, -2, -3, -4 (5-day window)
     - 3-Day Total leads received: Today through -4 (5-day window)
     - 3-Day SQL leads received: same window
  3. Color coding: green (>= 90% of target), yellow (60-90%), red (<60%)
  4. Totals row at bottom
- **Filters/search/sort:** Filter by CS manager. Sort by client name or any metric column.
- **Row actions:** Client name click → Client 360.
- **Bulk actions:** None.
- **Edit capabilities:** None (read-only operational view).
- **Empty states:** "No daily stats available. Import today's data."
- **Permission nuances:** cs_manager sees only assigned clients.
- **Notes:** **Status: Not in demo as separate page.** The demo has a generic PDCA matrix instead. This specific DoD view is critical for daily operations and must be built per the spec's CS PDCA columns S-AE.

### 9.3.3 Week-over-Week (WoW)

- **Route:** `/admin/pdca/wow`
- **Primary roles:** super_admin, admin, cs_manager (filtered)
- **Primary purpose:** Weekly performance trending. Detect deterioration across 4 weeks.
- **Key datasets:** `v_client_weekly_stats`, `clients`
- **Required fields:** avg_bounce_rate, avg_response_rate, avg_human_response_rate, avg_ooo_rate, avg_negative_rate, weekly_mql, weekly SQL leads (current + 3 previous weeks)
- **Main UI sections:**
  1. Week selector (current week default, can look back)
  2. Cross-client table with sub-sections:
     - Bounce Rate: Current, -1w, -2w, -3w (trend arrows, traffic-light)
     - Response Rate: same 4-week pattern
     - Human Response Rate: same
     - OOO Rate: same
     - Negative Rate: same
     - Total Leads: same
     - SQL Leads: same
  3. Trend arrows (up/down) with color coding
  4. Aggregation totals row
- **Notes:** **Status: Not in demo.** Must be built. Maps to CS PDCA columns AK-BL.

### 9.3.4 Biweekly Health (2Wo2W)

- **Route:** `/admin/pdca/2wo2w`
- **Primary roles:** super_admin, admin, cs_manager (filtered)
- **Primary purpose:** Health assessment form and history for all clients.
- **Key datasets:** `client_health_assessments`, `clients`
- **Main UI sections:**
  1. Cross-client table: Client, IP Health, Domains Health, Warmup Health, Copy Health, Funnel Health, Server Health, Insights (last assessment), Assessed Date
  2. Quick-assess button per row (opens inline form or modal)
  3. Assessment form: 6 traffic-light selectors (IP, Domains, Warmup, Copy, Funnel, Server) + Insights textarea + Accounts Blocked/Total
  4. History expandable per client
- **Notes:** Maps to CS PDCA columns BM-BR. Partially covered by Client 360 Health tab.

### 9.3.5 Month-over-Month (MoM)

- **Route:** `/admin/pdca/mom`
- **Primary roles:** super_admin, admin, cs_manager (filtered)
- **Primary purpose:** Monthly performance vs KPI targets. The "report card" view.
- **Key datasets:** `v_client_monthly_stats`, `clients` (kpi_leads, kpi_meetings, kpi_won)
- **Required fields:** monthly_mql, monthly_me, monthly_won + KPI comparisons
- **Main UI sections:**
  1. Month selector
  2. Cross-client table:
     - Total Leads: Current, -1m, -2m, -3m, KPI target, % of target
     - SQL Leads: same pattern
     - Meetings Rate: same + KPI comparison
     - WON Rate: same + KPI comparison
     - Additional LI MQL (if Look4Lead data available)
  3. Color coding: green (>=100% of KPI), yellow (60-100%), red (<60%)
  4. Totals and averages rows
- **Notes:** **Status: Not in demo.** Must be built. Maps to CS PDCA columns BS-CS.

## 9.4 Admin Agency CRM

- **Route:** `/admin/crm/pipeline`
- **Primary roles:** super_admin, admin
- **Primary purpose:** ColdUnicorn's own sales pipeline management.
- **Business value:** Track agency's own business development.
- **Key datasets:** `crm_prospects` (AgencyCrmDeal), `users`
- **Main UI sections:**
  1. View toggle: Kanban / Table
  2. Stat cards: Active Pipeline (EUR), Weighted Pipeline, Won Revenue, Win Rate
  3. Kanban: 7 columns (New → Contacted → Qualified → Proposal → Negotiation → Won → Lost), deal cards with drag/move
  4. Table: sortable with all fields
  5. Add Deal button → form
- **Notes:** Demo (AdminCRM) is well-implemented with kanban/table toggle and deal stage movement.

## 9.5 Admin LG Pipeline

- **Route:** `/admin/crm/lg-pipeline`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Lead generation pipeline for ColdUnicorn's own leads (separate from CRM).
- **Business value:** Track inbound/referred leads separately from outbound CRM.
- **Key datasets:** `lg_pipeline`, `users`
- **Required fields:** company_name, received_date, owner_id, source, estimated_value, win_chance, meeting_done (bool), offer_sent (bool), follow_ups_done (bool), contract_signed (bool), lead_magnet (bool), won (bool), lesson_learned
- **Main UI sections:**
  1. Deal table: Company, Received, Owner, Source, Value, Win Chance, pipeline stage checkboxes (Meeting → Offer → FU → Contract → Lead Magnet → Won), Lesson
  2. Add Deal form
  3. Filter by owner, source, won status
  4. Summary: total pipeline value, won deals count, average win chance
- **Filters/search/sort:** Search by company. Filter by owner, source. Sort by received date, value.
- **Row actions:** Inline checkbox toggles for pipeline stages. Click to expand for lesson_learned.
- **Bulk actions:** None.
- **Edit capabilities:** All fields editable inline or via detail view.
- **Notes:** **Status: Missing from demo.** Must be built. Maps directly to LG PDCA sheet.

## 9.6 Admin Global Domains

- **Route:** `/admin/domains`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Cross-client domain health monitoring. ~1,000 domains.
- **Business value:** Email deliverability depends on domain health. Centralized view catches problems.
- **Key datasets:** `domains`, `clients`
- **Required fields:** domain_name, client_id (→ client name), setup_email, purchase_date, exchange_date, exchange_cost, campaign_verif_date, campaign_status, warmup_reputation, warmup_verif_date, is_active, is_blacklisted
- **Main UI sections:**
  1. Summary: Total domains, Active, Blacklisted, Avg warmup reputation
  2. Filters: Client, Active/Inactive, Blacklisted, Reputation range
  3. Data table: Client, Domain, Setup Email, Purchase Date, Exchange Date, Campaign Status, Warmup Reputation (progress bar), Active toggle, Blacklisted toggle
  4. Bulk actions: Export CSV
- **Notes:** **Status: Missing from demo** as standalone page. Domains exist per-client in 360 panel. This cross-client view is needed for operational oversight.

## 9.7 Admin Finance Section

### 9.7.1 Invoices (All Clients)

- **Route:** `/admin/finance/invoices`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Cross-client invoice management. Payment tracking and vindication.
- **Key datasets:** `invoices`, `clients`
- **Required fields:** client_id (→ name), invoice_month, contracted_amount, chance_amount, status, vindication_in_progress, issue_time, notes, invoice_contact_email (from clients), sales_notification_email
- **Main UI sections:**
  1. Summary cards: Total Revenue, Outstanding, Overdue, Vindication count
  2. Filters: Client, Status, Month range
  3. Invoice table: Client, Month, Contracted, Chance, Status (editable dropdown), Issue Time, Vindication, Notes
  4. Add invoice button → form
- **Notes:** **Status: Missing from demo.** Must be built.

### 9.7.2 Cash Flow

- **Route:** `/admin/finance/cash-flow`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Monthly cash flow projections. Spreadsheet-like editing.
- **Key datasets:** `cash_flow_projections`
- **Required fields:** month, category, is_revenue, amount_net, notes
- **Main UI sections:**
  1. Spreadsheet-like grid: rows = categories (income items, cost items), columns = months
  2. Editable cells for amounts
  3. Auto-computed: total income, total costs, net cash flow per month
  4. Add category button
  5. Add month column
- **Notes:** **Status: Missing from demo.** Must be built. Maps to CF sheet.

### 9.7.3 Costs

- **Route:** `/admin/finance/costs`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Agency cost breakdown.
- **Key datasets:** `cash_flow_projections` (cost categories only)
- **Main UI sections:**
  1. Cost list: Name, Details, Amount (PLN)
  2. Add/edit/remove cost items
  3. Total
- **Notes:** **Status: Missing from demo.** Low priority -- can be a section within Cash Flow.

## 9.8 Admin Reports

### 9.8.1 Weekly Report

- **Route:** `/admin/reports/weekly`
- **Primary roles:** super_admin, admin, cs_manager (filtered)
- **Primary purpose:** Auto-generated weekly report: MQL, ME, RR, BR per client for current + 3 previous weeks.
- **Key datasets:** `v_client_weekly_stats`, `clients`, `users`
- **Main UI sections:**
  1. Week selector with date range display
  2. Cross-client table matching the "Weekly" sheet structure:
     - CS Manager, Client, Client Status
     - This week: MQL, ME, RR, BR
     - Previous week: same
     - Two weeks ago: same
     - Three weeks ago: same
  3. Totals row
  4. Export buttons: CSV, PDF
- **Notes:** **Status: Missing from demo.** Maps to Weekly sheet.

### 9.8.2 Monthly Report

- **Route:** `/admin/reports/monthly`
- **Primary roles:** super_admin, admin, cs_manager (filtered)
- **Primary purpose:** Monthly TMQL and WON per client, rolling 12 months.
- **Key datasets:** `v_client_monthly_stats`, `clients`
- **Main UI sections:**
  1. Month selector
  2. Table: CS Manager, Client, then pairs of TMQL/WON for current month through 12 months back
  3. Export: CSV, PDF
- **Notes:** **Status: Missing from demo.** Maps to Monthly sheet.

### 9.8.3 RR/BR Generator

- **Route:** `/admin/reports/rr-br`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Response Rate and Bounce Rate per team member, daily breakdown.
- **Key datasets:** `campaign_daily_stats`, `clients`, `users` (cs_manager mapping)
- **Main UI sections:**
  1. Period selector (last week default)
  2. Per-team-member blocks: Sent, Replied, Bounced for each day
  3. Computed RR% and BR% with indicators
  4. Instructions per sequencer (Smartlead, Woodpecker, Snov.io) for manual data entry (Phase 1)
- **Notes:** **Status: Missing from demo.** Maps to "RR & BR generator" sheet. In Phase 1, this may involve manual data entry.

## 9.9 Admin Settings

### 9.9.1 User Management

- **Route:** `/admin/settings/users`
- **Primary roles:** super_admin, admin
- **Primary purpose:** User CRUD, role assignment, client assignment, invitations.
- **Key datasets:** `users`, `client_users`, `clients`
- **Main UI sections:**
  1. Search + Role filter
  2. User cards/rows: Avatar, Name, Email, Role badge, Client assignments (for managers/clients), Active toggle
  3. Invite User button → form (email, role, client assignment)
  4. Role breakdown summary
- **Notes:** Demo (AdminUsers, tab 1) is well-implemented.

### 9.9.2 Email Blacklist

- **Route:** `/admin/settings/blacklist`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Manage global email domain exclude list.
- **Key datasets:** `email_exclude_list`
- **Main UI sections:**
  1. Add domain input + Add button
  2. Domain list: domain, added by, date, remove button
  3. Import from CSV button
- **Notes:** Demo (AdminUsers, tab 2) is implemented. Should be its own route.

### 9.9.3 Integrations

- **Route:** `/admin/settings/integrations`
- **Primary roles:** super_admin, admin
- **Primary purpose:** API keys, Smartlead accounts, Bison workspace management, global config.
- **Key datasets:** Smartlead Accounts data, client configs
- **Main UI sections:**
  1. Smartlead Accounts: account name + API key (4 accounts: RevGen, ConvertAI, E5M, ColdUnicorn)
  2. Global Bison webhook URL configuration
  3. OpenAI API key for classification
  4. Snov.io credentials
  5. Lusha credentials
  6. Unitalk (SMS) credentials
  7. Look4Lead global config
- **Notes:** **Status: Missing from demo.** Must be built. Sensitive -- API keys should be masked after entry.

### 9.9.4 Lost Clients (ABM)

- **Route:** `/admin/settings/lost-clients`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Track lost/churned clients, reasons, return possibility.
- **Key datasets:** `abm_lost_clients`
- **Main UI sections:**
  1. Lost client cards: name, CS manager, documents link, drive link, return possibility (badge), notes
  2. Add lost client form
- **Notes:** Demo (AdminUsers, tab 3) has basic implementation.

### 9.9.5 Automation Logs

- **Route:** `/admin/settings/automations`
- **Primary roles:** super_admin, admin
- **Primary purpose:** Visibility into Make.com automation runs, classification results, errors.
- **Business value:** Without this, automation failures are invisible.
- **Key datasets:** `automation_log` (new table needed, or pulled from Make.com API)
- **Main UI sections:**
  1. Automation status cards: each of the 4 automations with last-run time, success/fail count
  2. Recent classification log: Lead, Reply preview, AI Classification, Confidence, Timestamp
  3. Error log: failures, timeouts, API errors
  4. Classification accuracy: if human review data exists (from Classification Test sheet)
- **Notes:** **Status: Missing but recommended for post-MVP.** In Phase 1, can be a simple status page. In Phase 2, integrate with Make.com API for real-time logs.

## 9.10 Admin Data Import

- **Route:** `/admin/import`
- **Primary roles:** super_admin, admin, cs_manager (own clients)
- **Primary purpose:** Bulk import data from CSV/Excel files. Critical for initial migration and ongoing data loading.
- **Business value:** The system is useless without data. This is the MVP's data entry point.
- **Key datasets:** All major entities
- **Main UI sections:**
  1. Import type selector: Leads, Campaigns, Campaign Stats, Daily Snapshots, Domains, CRM Prospects, LG Pipeline, Invoices, Exclude List
  2. File upload zone (drag-and-drop + click)
  3. Column mapping UI: source columns → target fields (with auto-detect)
  4. Data preview table (first 20 rows)
  5. Validation summary: valid rows, warnings, errors (with row numbers)
  6. Client selector (for client-scoped imports)
  7. Confirm and Import button
  8. Post-import summary: imported count, skipped count, error details
- **Filters/search/sort:** N/A.
- **Edit capabilities:** Column mapping, error correction before import.
- **Validation rules:** Per entity type: required fields, data type validation, date format detection, duplicate detection (by email for leads, by name+date for campaigns), foreign key validation (client must exist).
- **Empty states:** "Select an import type and upload a file to get started."
- **Error states:** File parse error. Validation failure summary. Import execution errors.
- **Permission nuances:** cs_manager can only import for assigned clients. Cannot import CRM, LG Pipeline, or financial data.
- **Notes:** **Status: Missing from demo.** Must be built for MVP. The spec describes the flow but no UI detail. The column mapping step is critical because source spreadsheets have varying formats.

---

# 10. CS Manager Operational Workspace

The CS Manager experience is not a separate portal but a role-filtered view of the admin portal with a distinct landing page and sidebar.

## 10.1 Manager Dashboard

- **Route:** `/admin/dashboard` (manager variant auto-detected from role)
- **Primary roles:** cs_manager
- **Primary purpose:** Daily operating view for assigned clients. What needs attention RIGHT NOW.
- **Business value:** Replace the CS manager's morning routine of scrolling through the PDCA spreadsheet.
- **Key datasets:** `clients` (assigned), `client_daily_snapshots`, `client_health_assessments`, `campaigns`, `leads`, `lead_replies`
- **Main UI sections:**
  1. Header: "My Dashboard" + manager name + client count
  2. 4 KPI cards: Total MQLs, Meetings, Deals Won, Urgent Leads (amber if >0)
  3. Attention items: alert banners for red/yellow health, clients with unprocessed leads, schedule adherence issues
  4. MQL Trend chart (assigned clients)
  5. Campaign Reply Rates (top 5 campaigns across assigned clients)
  6. Client cards grid (2-column): per-client summary card showing name, status, health, contract, 4 mini-KPIs, MQL target progress, urgent leads, latest health insights
- **Notes:** Demo (ManagerDashboard) is well-implemented. Add: schedule adherence alerts, unprocessed lead counts.

## 10.2 Manager Leads Workspace

- **Route:** `/admin/leads` (manager sees assigned clients only)
- **Primary roles:** cs_manager
- **Primary purpose:** Cross-client lead management. The core daily work tool.
- **Business value:** Process new leads, update qualifications, monitor reply quality.
- **Key datasets:** `leads` (across assigned clients), `lead_replies`, `campaigns`, `clients`
- **Main UI sections:**
  1. Header: lead count, Export button
  2. Status pill filters: ALL qualifications including unprocessed and unqualified (manager can see everything)
  3. Search + Client filter dropdown
  4. Sortable table with Client column (not in client portal)
  5. Inline status dropdown with ALL 9 qualifications
- **Permission nuances:** Managers see ALL qualification states including unprocessed/unqualified. Managers can set ANY qualification. This is the key difference from client leads view.
- **Notes:** Demo (ManagerLeads) is well-implemented. Missing: lead drawer (currently only table inline editing). Should add drawer for detailed lead review.

## 10.3 Manager Client 360

- **Route:** `/admin/clients` (filtered to assigned)
- **Primary roles:** cs_manager
- **Primary purpose:** Deep-dive into assigned clients.
- **Notes:** Same Client 360 Panel as admin but limited to assigned clients. CS managers CAN edit setup, health assessments, domains, and PDCA phases for their clients.

## 10.4 Manager PDCA

- **Route:** `/admin/pdca` (filtered to assigned)
- **Primary roles:** cs_manager
- **Primary purpose:** PDCA phase management for assigned clients.
- **Notes:** Demo (ManagerPDCA) has a split-view (client list + phase detail). This is a good pattern for managers. Admins see the full matrix; managers see their client subset with a detail pane.

## 10.5 Manager Daily Workflow

The ideal CS manager daily workflow in the new system:

```
1. Open Manager Dashboard
   → Check attention banners (red health, unprocessed leads, schedule issues)

2. Process urgent items:
   → Click "Urgent Leads" → Leads Workspace (filtered to unprocessed)
   → Review AI classification and reply text
   → Set qualification (preMQL/MQL/reject)

3. Check DoD schedule adherence:
   → PDCA → DoD tab
   → Verify all clients are sending within targets

4. Health check (biweekly):
   → PDCA → 2Wo2W
   → Fill out health assessment forms for each client

5. Client deep-dive (as needed):
   → My Clients → Client card → 360 Panel
   → Review campaigns, domains, pipeline progress

6. Weekly review:
   → Reports → Weekly Report
   → Compare WoW trends
   → Update PDCA phases
```

---

# 11. Automation-Driven UI Requirements

## 11.1 Reply Classification Visibility

**Source:** Bison Replies Classification automation

The AI classifies every inbound reply with:
- Category: OOO, Interested, NRR, Spam_Inbound, Left_Company, other
- Confidence: 0-100
- Short reason (max 200 chars)
- Language detected: pl, en, de, other

**UI Requirements:**
1. **Lead Drawer / Reply Thread:** Each reply must show AI classification badge, confidence indicator (progress bar or percentage), and reasoning text.
2. **Lead Table:** "Replies" column shows latest AI classification as a colored badge.
3. **Leads Workspace (Manager):** Filter by AI classification category.
4. **Classification Override:** CS managers should be able to override AI classification (human review). This maps to the "Classification Test" sheet.
5. **Classification Accuracy Dashboard (post-MVP):** Compare AI vs human classifications.

**Schema impact:** `lead_replies.ai_classification`, `ai_reasoning`, `ai_confidence`, `language_detected` (all proposed in Section 6.3).

## 11.2 OOO Lead Management

**Source:** OOO automation + ARM sheet

OOO leads follow a lifecycle:
1. Reply classified as OOO → `is_ooo = true`, `expected_return_date` extracted
2. Lead logged with OOO status
3. Scheduled job: 2 days after expected return → lead added to gender-specific follow-up campaign
4. Flag `ooo_campaign_added = true`

**UI Requirements:**
1. **OOO Badge:** Visible on lead rows with expected return date.
2. **OOO Filter:** On leads table (All / Active / OOO Only).
3. **OOO Routing Config (Admin → Client 360 → Setup tab):**
   - Table showing gender → campaign mapping per client
   - Add/edit/remove routing rules
   - Enable/disable toggle
4. **OOO Queue View (post-MVP):** Show OOO leads approaching return date.

**Schema impact:** `client_ooo_routing` table (proposed in Section 6.4), `leads.is_ooo`, `leads.expected_return_date`, `leads.ooo_campaign_added`.

## 11.3 Lead Enrichment Tracking

**Source:** Log Bison Replies automation (Snov.io + Lusha)

Enriched fields: job title/position (Snov.io), company industry (Snov.io), company size (Snov.io), LinkedIn URL (Snov.io), country (Snov.io), phone number (Lusha).

**UI Requirements:**
1. **Enrichment source badges:** In lead detail, show which fields were auto-enriched vs manually entered.
2. **Phone source field:** Already exists (`phone_source`). Values: EmailText, Lusha, Manual.

**Schema impact:** Already covered by existing `phone_source` field. Consider adding `enrichment_source` JSONB field to track which provider filled which fields.

## 11.4 Notification Configuration

**Source:** Log Bison Replies automation (SMS + email forwarding)

When a new lead is logged:
- SMS sent to phone numbers in CS PDCA column CT
- Email forwarded to addresses in CS PDCA column CU

**UI Requirements:**
1. **Client 360 → Setup tab:** Notification Emails (multi-value text input), SMS Phone Numbers (multi-value text input).
2. **Admin Settings → Notification Defaults:** Global notification settings.
3. **Client Settings (client portal):** Clients may want to add/manage their own notification addresses.

**Schema impact:** `client_setup.notification_emails` (TEXT[]), `client_setup.notification_sms_phones` (TEXT[]).

## 11.5 Blacklist Management

**Source:** Log Bison Replies automation (email/domain blacklisting on mismatch)

When reply email doesn't match lead email:
1. Email gets blacklisted in Bison
2. If not a public domain, domain gets blacklisted in Bison

**UI Requirements:**
1. **Email Blacklist (admin):** Already planned. Needs sync with Bison API blacklist.
2. **Domain Blacklist indicator:** On domains table, show if domain is blacklisted.
3. **Blacklist action on lead:** Admin can manually trigger blacklist.

**Schema impact:** `domains.is_blacklisted` exists in TS schema. Email exclude list exists. Consider adding `lead_blacklists` for per-lead tracking.

## 11.6 LinkedIn Integration (Look4Lead)

**Source:** Import leads to Look4Leads Connect automation

Active clients with Look4Lead API key automatically push yesterday's LinkedIn-enriched leads to AutoConnect.

**UI Requirements:**
1. **Client 360 → Setup tab:** Look4Lead API Key field, "LinkedIn Automation Enabled" indicator.
2. **Lead table column:** LinkedIn URL (clickable external link).
3. **Look4Lead sync status (post-MVP):** Show which leads were pushed to Look4Lead.

**Schema impact:** `client_setup.look4lead_api_key` (proposed in Section 6.7).

---

# 12. Missing Interfaces and Product Gaps

## 12.1 Interfaces Missing from Both Spec AND Demo

| # | Missing Interface | Priority | Rationale |
|---|-------------------|----------|-----------|
| 1 | **Audit/Activity Log** | Should-have (MVP+1) | No accountability for who changed what. Critical for multi-user operations. |
| 2 | **Notification Center (in-app)** | Should-have (MVP+1) | Spec mentions email notifications but no in-app notification UI. |
| 3 | **Client Onboarding Wizard** | Nice-to-have | "Onboarding" status exists but no guided flow. |
| 4 | **Bulk Lead Reassignment** | Should-have | When CS manager changes, leads need rebinding. |
| 5 | **Data Export Hub** | Should-have | Scattered export buttons but no centralized export/reporting tool. |
| 6 | **Search (Global)** | Should-have | No way to search across leads, clients, campaigns from a single search bar. |
| 7 | **Mobile App / PWA** | Post-MVP | No mobile strategy beyond responsive web. |
| 8 | **Client Dashboard Sharing/PDF** | Should-have | Clients may want to share dashboard snapshots with their teams. |
| 9 | **Webhook Management UI** | Post-MVP | No way to configure Bison webhook endpoints from the UI. |
| 10 | **Classification Accuracy Review** | Post-MVP | The Classification Test sheet implies human review exists but has no UI. |

## 12.2 Interfaces in Spec but Missing from Demo

| # | Missing Interface | Spec Route | Priority |
|---|-------------------|------------|----------|
| 1 | Client Campaigns page | `/client/campaigns` | Must-have (MVP) |
| 2 | Client Campaign Detail | `/client/campaigns/:id` | Must-have (MVP) |
| 3 | PDCA DoD view | `/admin/pdca/dod` | Must-have (MVP) |
| 4 | PDCA WoW view | `/admin/pdca/wow` | Must-have (MVP) |
| 5 | PDCA 2Wo2W view | `/admin/pdca/2wo2w` | Must-have (MVP) |
| 6 | PDCA MoM view | `/admin/pdca/mom` | Must-have (MVP) |
| 7 | LG Pipeline | `/admin/lg-pipeline` | Should-have |
| 8 | All Domains (global) | `/admin/domains` | Should-have |
| 9 | Invoices (all) | `/admin/finance/invoices` | Should-have |
| 10 | Cash Flow | `/admin/finance/cash-flow` | Should-have |
| 11 | Costs | `/admin/finance/costs` | Nice-to-have |
| 12 | Weekly Report | `/admin/reports/weekly` | Must-have (operational parity) |
| 13 | Monthly Report | `/admin/reports/monthly` | Must-have (operational parity) |
| 14 | RR/BR Generator | `/admin/reports/rr-br` | Should-have |
| 15 | Integrations settings | `/admin/settings/integrations` | Should-have |
| 16 | Data Import | `/admin/import` | Must-have (MVP) |
| 17 | Prospect Detail (CRM) | `/admin/crm/prospects/:id` | Nice-to-have (inline is fine) |
| 18 | Partnerships management | `/admin/clients/:id/partnerships` | Nice-to-have |
| 19 | ABS management | `/admin/clients/:id/abs` | Nice-to-have |

## 12.3 Missing Page States

| Page | Missing State | Description |
|------|---------------|-------------|
| All pages | First-run / empty state | What does a brand new deployment look like? |
| Client Dashboard | No data for selected date range | Show appropriate message, not empty charts |
| Client Leads | All leads filtered out | "No leads match your filters" with clear filters button |
| Admin PDCA views | No snapshots for period | "No data for this period. Import daily stats." |
| Client 360 | Client has zero campaigns | Show onboarding checklist instead |
| Client 360 | Client has zero domains | Show "Set up domains" prompt |
| Data Import | File parsing failure | Show specific error (encoding, format, corrupted) |
| Data Import | Partial import with errors | Show success/fail breakdown with downloadable error report |
| All tables | Server error | Show error state with retry, not blank table |
| All tables | Slow load (>3s) | Show skeleton + "Loading..." text |

## 12.4 Missing Role Behaviors

| Role | Missing Behavior | Description |
|------|------------------|-------------|
| client | Cannot see own classification details | Should clients see AI classification reasoning? **Decision needed.** Recommend: No. Clients see qualification status but not AI internals. |
| cs_manager | No notification when new lead arrives | Managers need real-time or daily digest alerts. |
| cs_manager | No way to trigger re-classification | If AI got it wrong, manager should be able to request re-classification. Post-MVP. |
| super_admin | No user impersonation | Founder may need to "see as client" for support. Post-MVP. |
| All | No session management | No way to see/revoke active sessions (partially in client settings but not admin). |

---

# 13. Database Schema Gaps Relative to UI Needs

## 13.1 Tables to Add (Critical)

| Table | Required By | Priority |
|-------|------------|----------|
| `lead_replies` | Lead drawer, conversation view, AI classification display | **CRITICAL - MVP** |
| `client_ooo_routing` | OOO automation management, OOO config UI | **CRITICAL - MVP** |
| `client_pdca_phases` | PDCA matrix/cards views | **HIGH - MVP** |

## 13.2 Fields to Add (Critical)

| Table | Field | Type | Required By |
|-------|-------|------|------------|
| `leads` | `gender` | TEXT (male/female/general) | OOO routing |
| `leads` | `is_ooo` | BOOLEAN | OOO tracking |
| `leads` | `expected_return_date` | DATE | OOO lifecycle |
| `leads` | `ooo_campaign_added` | BOOLEAN | OOO automation tracking |
| `leads` | `latest_reply_at` | TIMESTAMPTZ | Leads table sort/display |
| `leads` | `replied_at_step` | INTEGER | Lead detail display |
| `leads` | `total_replies_count` | INTEGER | Leads table display |
| `leads` | `country` | TEXT | Enrichment data display |
| `leads` | `external_lead_id` | TEXT | Bison integration |
| `campaigns` | `type` | TEXT (outreach/ooo/nurture) | Campaign filtering (hide OOO from clients) |
| `client_daily_snapshots` | `schedule_volume_today` | INTEGER | DoD schedule view |
| `client_daily_snapshots` | `schedule_volume_tomorrow` | INTEGER | DoD schedule view |
| `client_daily_snapshots` | `schedule_volume_day_after` | INTEGER | DoD schedule view |
| `client_setup` | `notification_emails` | TEXT[] | Lead notification forwarding |
| `client_setup` | `notification_sms_phones` | TEXT[] | Lead notification forwarding |
| `client_setup` | `look4lead_api_key` | TEXT | LinkedIn automation |

## 13.3 Enum Reconciliation

| Entity | SQL Enum | Recommended Final Enum | Change |
|--------|----------|----------------------|--------|
| `leads.qualification` | unqualified, preMQL, MQL, SQL | unprocessed, unqualified, preMQL, MQL, meeting_scheduled, meeting_held, offer_sent, won, rejected | **Expand to 9 values, remove SQL, add pipeline stages** |
| `lead_replies.ai_classification` | N/A (table doesn't exist) | ooo, interested, nrr, spam_inbound, left_company, info_requested, other, unclassified | **New** |
| `campaigns.status` | draft, active, paused, completed, archived | Same | OK |
| `invoices.status` | pending, issued, sent, paid, overdue, vindication | draft, sent, paid, overdue (simplify) | Consider simplifying |

## 13.4 Views to Add

| View | Purpose | Source Tables |
|------|---------|--------------|
| `v_client_dod` | DoD schedule + sent volume last 5 days | client_daily_snapshots |
| `v_lead_with_latest_reply` | Lead with denormalized latest reply info | leads + lead_replies |

## 13.5 Indexes to Add

```sql
CREATE INDEX idx_replies_lead_date ON lead_replies(lead_id, received_at DESC);
CREATE INDEX idx_pdca_client ON client_pdca_phases(client_id);
CREATE INDEX idx_ooo_routing_client ON client_ooo_routing(client_id);
CREATE INDEX idx_snapshots_dod ON client_daily_snapshots(client_id, snapshot_date DESC);
```

## 13.6 RLS Policies to Add

```sql
-- lead_replies follows leads access pattern
ALTER TABLE lead_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_replies_via_leads" ON lead_replies FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM leads WHERE leads.id = lead_replies.lead_id
    -- This leverages existing leads RLS policies via the join
  )
);

-- client_ooo_routing follows clients access pattern (internal only)
ALTER TABLE client_ooo_routing ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal_ooo_routing" ON client_ooo_routing FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'cs_manager'))
);

-- client_pdca_phases follows clients access pattern (internal only)
ALTER TABLE client_pdca_phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal_pdca" ON client_pdca_phases FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'cs_manager'))
);
```

---

# 14. MVP Scope Recommendation

## 14.1 MVP Goal

**Fastest useful migration** that allows ColdUnicorn to stop using Google Sheets for daily operations without losing critical functionality.

## 14.2 MVP Inclusions

### Tier 1: Absolutely Required (Blocks Migration)

| # | Item | Justification |
|---|------|--------------|
| 1 | Auth system (login, magic links, roles) | Can't start without authentication |
| 2 | Schema deployment (all tables incl. missing ones) | Foundation |
| 3 | Data Import tool (CSV/Excel) | Can't populate system without it |
| 4 | Client Portal: Dashboard | Client-facing deliverable #1 |
| 5 | Client Portal: Pipeline (Leads) with drawer | Client-facing deliverable #2 |
| 6 | Client Portal: Campaigns + Campaign Detail | Client-facing deliverable #3 |
| 7 | Client Portal: Analytics | Client-facing deliverable #4 |
| 8 | Client Portal: Settings (profile, notifications) | Client self-service |
| 9 | Admin: Client List + Client 360 Panel | Central management |
| 10 | Admin: PDCA DoD view | Daily operational necessity |
| 11 | Admin: PDCA WoW view | Weekly operational necessity |
| 12 | Admin: Executive Dashboard | Admin landing page |
| 13 | Admin: User Management | Invite clients, assign roles |
| 14 | Manager: Dashboard | CS manager landing page |
| 15 | Manager: Leads Workspace | Core CS manager work tool |
| 16 | RLS policies (all) | Security requirement |

### Tier 2: Required for Operational Parity (Can Launch Without but Painful)

| # | Item | Justification |
|---|------|--------------|
| 17 | Admin: PDCA 2Wo2W (Health) | Biweekly health assessments currently happen in sheets |
| 18 | Admin: PDCA MoM | Monthly review happens in sheets |
| 19 | Admin: Weekly Report | Currently generated from sheets |
| 20 | Admin: Monthly Report | Currently generated from sheets |
| 21 | Admin: Email Blacklist | Currently in sheets (162 domains) |
| 22 | Admin: New Client Modal | Must be able to add clients |
| 23 | Manager: PDCA view | Manager operational tool |
| 24 | Export CSV (leads, reports) | Clients expect exportable data |

## 14.3 MVP Exclusions (Phase 2+)

| Item | Why Excluded |
|------|-------------|
| Agency CRM | ColdUnicorn can continue using CRM sheet temporarily |
| LG Pipeline | Can continue in sheets |
| Finance (invoices, cash flow, costs) | Can continue in sheets |
| Global Domains page | Per-client domains in 360 panel is sufficient for now |
| RR/BR Generator | Can continue as manual calculation |
| Integrations settings | API keys can be configured directly in Supabase |
| Lost Clients (ABM) | Low volume, can stay in sheets |
| Partnerships | Low priority |
| ABS | Low priority |
| Automation logs | Nice-to-have |
| API integrations (Smartlead, Bison sync) | Phase 2 per spec |
| Mobile optimization | Responsive web is sufficient |
| In-app notifications | Email notifications are sufficient |
| Audit trail | Important but not blocking |

## 14.4 MVP Timeline Estimate

Based on the spec's Phase structure and the existing demo code:

| Phase | Weeks | Scope |
|-------|-------|-------|
| Foundation (schema, auth, infra) | 1-3 | Schema + RLS + auth + deploy pipeline |
| Data Import + Migration | 3-5 | Import tool + migrate both spreadsheets |
| Client Portal | 5-8 | All 5 client pages (demo code accelerates this) |
| Admin Portal Core | 8-12 | Dashboard, Clients/360, PDCA views, User Mgmt |
| Manager Workspace | 12-14 | Manager dashboard, leads workspace, filtered views |
| Reports + Polish | 14-16 | Weekly/Monthly reports, export, testing |

---

# 15. Post-MVP / Phase 2 Recommendation

## Phase 2A: Operational Completeness (Weeks 16-20)

| Item | Priority |
|------|----------|
| Agency CRM (kanban + table) | High -- demo code exists |
| LG Pipeline | High |
| Global Domains page | Medium |
| Finance: Invoices (all) | High |
| Finance: Cash Flow | Medium |
| RR/BR Generator | Medium |
| Lost Clients / ABM | Low |
| Partnerships | Low |
| ABS | Low |

## Phase 2B: Automation Integration (Weeks 20-24)

| Item | Priority |
|------|----------|
| Bison webhook receiver (replace Make.com) | High |
| Smartlead API daily sync | High |
| Bison API daily sync | High |
| CRM push (qualified leads → client CRM) | Medium |
| Automation status dashboard | Medium |
| Classification accuracy review UI | Low |

## Phase 2C: Advanced Features (Weeks 24-28)

| Item | Priority |
|------|----------|
| In-app notification center | Medium |
| Audit trail / activity log | Medium |
| Global search | Medium |
| Client onboarding wizard | Low |
| User impersonation (support tool) | Low |
| PDF report generation | Medium |
| Mobile PWA | Low |

---

# 16. Risks, Ambiguities, and Product Decisions Needed

## 16.1 Unresolved Product Decisions

| # | Decision | Context | Recommendation |
|---|----------|---------|----------------|
| 1 | **Should clients see AI classification details?** | The demo shows AI classification badge, confidence, and reasoning in the client-facing lead drawer. The automations classify for internal use. | **No** -- hide AI internals from clients. Show only the final qualification status. AI details visible to cs_manager and admin only. |
| 2 | **Should lead qualification use a flat enum or enum + booleans?** | SQL schema uses 4-value enum + 4 booleans. TS uses 9-value enum. | **Use 9-value flat enum** for primary pipeline stage. Optionally retain booleans as audit fields to track "was this milestone ever reached" (useful if a lead goes backward). |
| 3 | **Should the Manager workspace be a separate route tree or filtered admin?** | Demo has separate ManagerApp with its own sidebar. Spec implies shared admin routes. | **Shared admin routes with role-based filtering.** Single codebase is more maintainable. Manager gets a different sidebar config and landing page but same underlying components. |
| 4 | **How should OOO campaigns be hidden from clients?** | OOO and nurture campaigns are internal. Clients should only see outreach campaigns. | **Filter by `campaign.type`** -- only show `type = 'outreach'` to clients. Add type field to campaigns table. |
| 5 | **Is the PDCA Matrix (Plan/Do/Check/Act per client) a core or supplementary feature?** | The demo has it. The spec doesn't explicitly have a `client_pdca_phases` table. | **Core feature for admin/manager.** Add the table. This replaces the informal tracking that happens in PDCA spreadsheet margins. |
| 6 | **Should invoice management be per-client-only or have a global view?** | Spec has both. Demo has only per-client (in 360 panel). | **Both.** Per-client in 360 panel (exists). Global in `/admin/finance/invoices` (needs building). Finance team needs cross-client view. |
| 7 | **What happens to E5M CS sheet data?** | Spec says "ignored". But E5M is a sub-brand with ~20 clients. | **E5M is a label/filter, not a separate data model.** All E5M clients are already in CS PDCA. The E5M CS sheet is a filtered view. No separate table needed. |
| 8 | **Should the system support multiple CS managers per client?** | Current model: 1 CS manager per client. `clients.cs_manager_id` is singular. | **Keep singular for now.** The schema supports it. If needed later, create a `client_managers` junction table. |
| 9 | **What is the `super_admin` vs `admin` distinction in practice?** | Spec defines both but the demo doesn't differentiate. | **super_admin can:** manage all users (including creating admins), delete clients permanently, access system configuration, view all API keys. **admin cannot:** escalate roles to super_admin, permanently delete, or see raw API keys. |
| 10 | **Should the platform handle the Bison webhook directly or continue using Make.com?** | Currently Make.com processes webhooks. Long term, edge functions should. | **Phase 1: Keep Make.com.** The automations are complex and proven. **Phase 2: Migrate to Edge Functions.** Build the import/export from Make.com format. |

## 16.2 Data Ambiguities

| # | Ambiguity | Impact | Recommendation |
|---|-----------|--------|----------------|
| 1 | CS PDCA "Issues" column (R) -- is it a count, a list, or freetext? | Affects client_issues table design | Check actual data. Likely freetext. The `client_issues` table (structured) is a better approach regardless. |
| 2 | "Warsztaty S" and "Warsztaty O" (columns DA-DF) -- JSONB in schema. What's the actual structure? | Affects client setup UI | These are "Workshop" configs (W1, W2 sub-columns). Model as JSONB with known keys or add explicit boolean fields. |
| 3 | "Opinion with status quo shock/surprise" (column DL) -- what is this? | Missing from schema as explicit field | Appears to be a sales tactic flag on invoicing. Add as a boolean or text field on invoices. |
| 4 | Dashboards sheet is chart-only (empty cells) -- what charts exist? | Missing dashboard requirements | The client Dashboard sheet has data series. The PDCA Dashboards sheet is visual-only. Recreate from the data, not from the charts. |
| 5 | CRM "status lub data sprzedazy" (column S) -- is this a status or a date? | Affects CRM prospect model | It's dual-purpose: either a status text or a sale date. Model as `status_date` and `notes`. |

## 16.3 Technical Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|-----------|
| 1 | 127-column CS PDCA migration may have unmapped fields | High | Complete column audit (done in this doc). Verify against sample data rows during migration scripting. |
| 2 | Daily snapshots computed views may be slow at scale | Medium | Current scale (~35 clients × 365 days = ~12,775 rows/year) is fine. Add materialized views if needed. Index `(client_id, snapshot_date DESC)`. |
| 3 | Make.com automations continue writing to Google Sheets after migration | High | Plan a parallel-write phase: automations write to both sheets AND new database. Verify data consistency before cutting over. |
| 4 | RLS performance on deep joins (lead_replies via leads via client_users) | Medium | Test with production-scale data. Consider denormalizing `client_id` onto `lead_replies` for faster RLS. |
| 5 | Client report spreadsheet IDs are per-client -- automation must update to write to new DB | High | Critical migration step: update Make.com automations to write to Supabase via Edge Functions instead of Google Sheets. |

---

# 17. Final Build Checklist

## 17.1 Schema & Infrastructure

- [ ] Deploy all SQL tables from PROJECT_SPEC.md Section 3
- [ ] Add `lead_replies` table (Section 6.3)
- [ ] Add `client_ooo_routing` table (Section 6.4)
- [ ] Add `client_pdca_phases` table (Section 6.5)
- [ ] Add missing fields to `leads` (gender, is_ooo, expected_return_date, ooo_campaign_added, latest_reply_at, replied_at_step, total_replies_count, country, external_lead_id)
- [ ] Add `type` field to `campaigns`
- [ ] Add schedule volume fields to `client_daily_snapshots`
- [ ] Add notification config fields to `client_setup`
- [ ] Update `leads.qualification` enum to 9 values
- [ ] Deploy all RLS policies including new tables
- [ ] Create SQL views (weekly, monthly, DoD)
- [ ] Create indexes per Section 6.5
- [ ] Set up Supabase Auth (email/password + magic links)
- [ ] Configure storage buckets (for import files, exports)

## 17.2 Data Migration

- [ ] Write migration script: CS PDCA → clients + client_setup + client_health_assessments
- [ ] Write migration script: Client Report Leads → leads
- [ ] Write migration script: Client Report Campaigns → campaigns
- [ ] Write migration script: Client Report Statistics → campaign_daily_stats
- [ ] Write migration script: Daily stats → client_daily_snapshots
- [ ] Write migration script: CRM → crm_prospects
- [ ] Write migration script: DomainsPerformance → domains
- [ ] Write migration script: LG PDCA → lg_pipeline
- [ ] Write migration script: Emails Exclude List → email_exclude_list
- [ ] Write migration script: ABM LOSTS → abm_lost_clients
- [ ] Write migration script: Client CRM Details → client_crm_integrations
- [ ] Write migration script: ARM → client_ooo_routing
- [ ] Write migration script: CF → cash_flow_projections
- [ ] Write migration script: AUTH → users + client_users
- [ ] Verify data integrity post-migration (row counts, spot checks)

## 17.3 Client Portal

- [ ] Auth flow (login, magic link, password reset)
- [ ] Client Dashboard (Section 8.1)
- [ ] Client Pipeline / Leads with Lead Drawer (Section 8.2)
- [ ] Client Campaigns list (Section 8.3)
- [ ] Client Campaign Detail (Section 8.4)
- [ ] Client Analytics (Section 8.5)
- [ ] Client Settings (Section 8.6)
- [ ] CSV Export (leads)
- [ ] Empty states for all pages
- [ ] Loading/error states for all pages
- [ ] Mobile responsive layouts

## 17.4 Admin Portal (MVP)

- [ ] Admin auth + role-based routing
- [ ] Executive Dashboard (Section 9.1)
- [ ] Clients & 360° with all tabs (Section 9.2)
- [ ] New Client Modal (Section 9.2.2)
- [ ] PDCA Matrix/Cards (Section 9.3.1)
- [ ] PDCA DoD (Section 9.3.2)
- [ ] PDCA WoW (Section 9.3.3)
- [ ] PDCA 2Wo2W (Section 9.3.4)
- [ ] PDCA MoM (Section 9.3.5)
- [ ] User Management (Section 9.9.1)
- [ ] Email Blacklist (Section 9.9.2)
- [ ] Data Import tool (Section 9.10)
- [ ] Weekly Report (Section 9.8.1)
- [ ] Monthly Report (Section 9.8.2)

## 17.5 Manager Workspace (MVP)

- [ ] Manager Dashboard variant (Section 10.1)
- [ ] Manager Leads Workspace (Section 10.2)
- [ ] Manager Client 360 (filtered) (Section 10.3)
- [ ] Manager PDCA (filtered) (Section 10.4)

## 17.6 Admin Portal (Post-MVP)

- [ ] Agency CRM kanban + table (Section 9.4)
- [ ] LG Pipeline (Section 9.5)
- [ ] Global Domains (Section 9.6)
- [ ] Invoices - all clients (Section 9.7.1)
- [ ] Cash Flow (Section 9.7.2)
- [ ] Costs (Section 9.7.3)
- [ ] RR/BR Generator (Section 9.8.3)
- [ ] Integrations settings (Section 9.9.3)
- [ ] Lost Clients / ABM (Section 9.9.4)
- [ ] Automation Logs (Section 9.9.5)

## 17.7 Automation Migration

- [ ] Design parallel-write strategy (Make.com → sheets + Supabase)
- [ ] Build Edge Function: receive Bison webhook (classification)
- [ ] Build Edge Function: receive Bison webhook (tag attached → lead logging)
- [ ] Build Edge Function: scheduled OOO lead campaign attachment
- [ ] Build Edge Function: scheduled Look4Lead import
- [ ] Build Edge Function: daily stats sync (Smartlead + Bison)
- [ ] Test automation parity with Make.com
- [ ] Cut over from Make.com to Edge Functions

## 17.8 Quality & Launch

- [ ] Performance testing (PDCA views with 35 clients, lead tables with 1000+ rows)
- [ ] RLS policy testing (verify client isolation)
- [ ] Cross-browser testing (Chrome, Safari, Firefox, Edge)
- [ ] Mobile testing (iOS Safari, Android Chrome)
- [ ] Data reconciliation: compare new system outputs with current Google Sheets
- [ ] User acceptance testing with CS managers
- [ ] Client beta testing (2-3 friendly clients)
- [ ] Production deployment
- [ ] DNS + SSL setup
- [ ] Monitoring + error tracking setup
- [ ] Client communication and training

---

*End of Master Functional Specification*
