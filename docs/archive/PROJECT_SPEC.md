> Legacy archive: this document is historical context only.
> It is not the source of truth for the current frontend runtime.
> It may reference mock-only modules, old table names, and deprecated architecture.

# ColdUnicorn PDCA Platform - Project Specification

## 1. System Overview

### 1.1 About

ColdUnicorn is a B2B cold email lead generation agency. They run email campaigns for clients through platforms like Smartlead and Bison. The current system is built entirely on Google Sheets: each client gets a separate spreadsheet with their leads, campaigns, statistics, and a dashboard. The internal team operates from a 20-sheet master workbook (PDCA) with a 127-column "CS PDCA" sheet tracking day-over-day, week-over-week, and month-over-month metrics.

### 1.2 Problem

- Google Sheets does not scale: the 127-column CS PDCA sheet is unmanageable
- Temporal data is encoded as column offsets (current, -1, -2, -3 weeks) instead of proper time-series
- Data is duplicated across multiple sheets (Weekly, Monthly overlap with CS PDCA)
- No proper access control - clients access Google Sheets directly
- No automation for daily stats collection
- Manual reporting process is error-prone

### 1.3 Solution

A custom platform built with **React** (frontend) + **Supabase** (backend, database, auth) consisting of:

- **Client Portal** - clients see their leads, campaigns, statistics, and dashboards
- **Admin Portal** - internal team manages operations, tracks PDCA metrics, CRM, finances, domain health

### 1.4 Architecture

```
+-------------------+     +-------------------+
|  Client Portal    |     |  Admin Portal     |
|  (React + Vite)   |     |  (React + Vite)   |
+--------+----------+     +--------+----------+
         |                          |
         +------------+-------------+
                      |
              +-------v--------+
              |   Supabase     |
              |  - PostgreSQL  |
              |  - Auth        |
              |  - RLS         |
              |  - Edge Funcs  |
              |  - Storage     |
              +-------+--------+
                      |
         +------------+-------------+
         |                          |
  +------v------+          +-------v-------+
  | Manual      |          | API (Phase 2) |
  | CSV/Excel   |          | Smartlead     |
  | Import      |          | Bison         |
  +-------------+          +---------------+
```

### 1.5 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | React + Vite + TypeScript | Fast dev cycle, strong typing |
| UI | Shadcn/ui + Tailwind CSS | Production-quality components |
| Charts | Recharts | React-native, good for time-series |
| Tables | TanStack Table | Sorting, filtering, pagination |
| Data fetching | TanStack Query + Supabase JS | Caching, optimistic updates |
| Auth | Supabase Auth | Email/password + magic links |
| Database | Supabase (PostgreSQL) | RLS, Edge Functions, Realtime |
| Automation | Supabase Edge Functions | API integrations, cron jobs |
| Storage | Supabase Storage | Reports, documents |
| Deploy | Vercel (frontend) + Supabase (backend) | Zero-config, auto-scaling |

---

## 2. User Roles & Permissions

### 2.1 Roles

| Role | Scope | Description |
|------|-------|-------------|
| `super_admin` | Full system | ColdUnicorn founder, full access to everything |
| `admin` | Full system | ColdUnicorn admin team, nearly full access |
| `cs_manager` | Assigned clients | Customer Success / Growth Head - manages assigned clients |
| `client` | Own data only | External client user - sees only their own leads, campaigns, stats |

### 2.2 Data Visibility Matrix

| Data | super_admin | admin | cs_manager | client |
|------|:-----------:|:-----:|:----------:|:------:|
| Leads | All | All | Assigned clients | Own client |
| Campaigns | All | All | Assigned clients | Own client |
| Campaign daily stats | All | All | Assigned clients | Own client |
| Client daily snapshots | All | All | Assigned clients | -- |
| Health assessments | All | All | Assigned clients | -- |
| Client setup & config | All | All | Assigned clients | -- |
| Domains | All | All | Assigned clients | -- |
| Issues | All | All | Assigned clients | -- |
| Internal CRM | All | All | -- | -- |
| LG Pipeline | All | All | -- | -- |
| Finances (invoices, CF) | All | All | Assigned clients | -- |
| Email exclude list | All | All | All | -- |
| ABM Lost clients | All | All | -- | -- |

---

## 3. Supabase Database Schema

### 3.1 Core Identity & Access

```sql
-- Organizations (single org for now, multi-org ready)
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- Users (extends Supabase auth.users)
CREATE TABLE users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id),
  organization_id UUID REFERENCES organizations(id),
  email           TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('super_admin', 'admin', 'cs_manager', 'client')),
  phone           TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 Client Management

```sql
-- Clients (main entity, ~35 active clients)
CREATE TABLE clients (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID REFERENCES organizations(id),
  name                    TEXT NOT NULL,
  status                  TEXT NOT NULL CHECK (status IN ('active', 'onboarding', 'paused', 'churned', 'lost')),
  smartlead_id            TEXT,
  bison_workspace_id      TEXT,
  bison_api_key           TEXT,
  sequencer               TEXT CHECK (sequencer IN ('smartlead', 'bison', 'woodpecker', 'snovio')),
  cs_manager_id           UUID REFERENCES users(id),
  report_link             TEXT,
  folder_link             TEXT,
  contract_due_date       DATE,
  contracted_amount       NUMERIC(12,2),
  pricing_model           TEXT,
  vat_rate                NUMERIC(5,2),
  invoice_contact_email   TEXT,
  sales_notification_email TEXT,
  kpi_leads               INTEGER,
  kpi_meetings            INTEGER,
  kpi_won                 INTEGER,
  notes                   TEXT,
  created_at              TIMESTAMPTZ DEFAULT now(),
  updated_at              TIMESTAMPTZ DEFAULT now()
);

-- Client-User mapping (which users can access which client's data)
CREATE TABLE client_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT DEFAULT 'viewer' CHECK (role IN ('viewer', 'admin')),
  UNIQUE(client_id, user_id)
);
```

### 3.3 Client Setup & Configuration

```sql
-- Client setup checklist & ABM ecosystem config (1:1 with clients)
CREATE TABLE client_setup (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  bi_setup_complete     BOOLEAN DEFAULT false,
  folder_setup_link     TEXT,
  setup_exchange_aba    TEXT,
  inboxes_count         INTEGER,
  prospects_signed      INTEGER,
  prospects_added       INTEGER,
  min_sent_daily        INTEGER,
  sms_phone_number      TEXT,
  contact_email         TEXT,
  crm_status            BOOLEAN DEFAULT false,
  crm_api_key           TEXT,
  auto_ooo_enabled      BOOLEAN DEFAULT false,
  auto_li_api_key       TEXT,
  cold_linkedin         BOOLEAN DEFAULT false,
  cold_ads              BOOLEAN DEFAULT false,
  warsztaty_s           JSONB,
  warsztaty_o           JSONB,
  harmonogramy          BOOLEAN DEFAULT false,
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- CRM platform integrations per client (Livespace, Pipedrive, Zoho, Salesforce)
CREATE TABLE client_crm_integrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  crm_platform    TEXT NOT NULL CHECK (crm_platform IN ('livespace', 'pipedrive', 'zoho', 'salesforce', 'hubspot', 'other')),
  workspace_id    TEXT,
  api_key         TEXT,
  api_secret      TEXT,
  subdomain       TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 3.4 Campaigns

```sql
-- Email campaigns per client
CREATE TABLE campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  external_id         TEXT,
  name                TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  sequencer           TEXT,
  start_date          DATE,
  database_size       INTEGER,
  week_start          DATE,
  positive_responses  INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
```

### 3.5 Leads

This is the core entity - every lead response from email campaigns. Replaces the "Leads" sheet in client reports.

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

  -- Campaign context
  message_title         TEXT,
  message_number        TEXT,

  -- Qualification & pipeline
  qualification         TEXT DEFAULT 'unqualified'
                        CHECK (qualification IN ('unqualified', 'preMQL', 'MQL', 'SQL')),
  lead_response_time    TEXT,
  lead_received_at      TIMESTAMPTZ,

  -- Pipeline stages
  meeting_scheduled     BOOLEAN DEFAULT false,
  meeting_held          BOOLEAN DEFAULT false,
  offer_sent            BOOLEAN DEFAULT false,
  won                   BOOLEAN DEFAULT false,

  -- Content
  lead_response_text    TEXT,
  comments              TEXT,
  tip                   TEXT,

  -- External references
  external_campaign_id  TEXT,
  blacklist_id          TEXT,
  domain_blacklist_id   TEXT,

  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_leads_client_id ON leads(client_id);
CREATE INDEX idx_leads_received ON leads(lead_received_at);
CREATE INDEX idx_leads_qualification ON leads(qualification);
CREATE INDEX idx_leads_email ON leads(email);
```

### 3.6 Campaign Daily Statistics

Replaces the "Statistics" sheet in client reports. Daily metrics per campaign - time series.

```sql
CREATE TABLE campaign_daily_stats (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  campaign_id           UUID REFERENCES campaigns(id),
  report_date           DATE NOT NULL,
  sent_count            INTEGER DEFAULT 0,
  reply_count           INTEGER DEFAULT 0,
  bounce_count          INTEGER DEFAULT 0,
  unique_open_count     INTEGER DEFAULT 0,
  positive_replies      INTEGER DEFAULT 0,
  negative_replies      INTEGER DEFAULT 0,
  ooo_replies           INTEGER DEFAULT 0,
  human_replies         INTEGER DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, campaign_id, report_date)
);

CREATE INDEX idx_cds_client_date ON campaign_daily_stats(client_id, report_date);
```

### 3.7 Client Daily Snapshots

**The KEY table** - replaces both the "Daily Stats" sheet (4294 rows) AND the temporal columns in CS PDCA (127 columns). Instead of storing data as column offsets (current week, -1 week, -2 weeks...), we store one row per client per day. Rolling windows (DoD, WoW, MoM) are computed by SQL views.

```sql
CREATE TABLE client_daily_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_date           DATE NOT NULL,
  sequencer               TEXT,

  -- Accumulated totals (from Smartlead/Bison)
  emails_sent_total       INTEGER DEFAULT 0,
  prospects_in_base       INTEGER DEFAULT 0,
  mql_total               INTEGER DEFAULT 0,
  me_total                INTEGER DEFAULT 0,
  response_count          INTEGER DEFAULT 0,
  bounce_count            INTEGER DEFAULT 0,
  won_total               INTEGER DEFAULT 0,
  negative_total          INTEGER DEFAULT 0,
  ooo_accumulated         INTEGER DEFAULT 0,
  human_replies_accum     INTEGER DEFAULT 0,

  -- Daily deltas
  mql_diff                INTEGER DEFAULT 0,
  me_diff                 INTEGER DEFAULT 0,
  won_diff                INTEGER DEFAULT 0,

  -- Infrastructure
  inboxes_count           INTEGER,
  prospects_count         INTEGER,

  -- Time dimensions (for fast aggregation)
  week_number             INTEGER,
  month_number            INTEGER,
  year_number             INTEGER,

  created_at              TIMESTAMPTZ DEFAULT now(),
  UNIQUE(client_id, snapshot_date)
);

CREATE INDEX idx_snapshots_date ON client_daily_snapshots(snapshot_date);
CREATE INDEX idx_snapshots_client_month ON client_daily_snapshots(client_id, year_number, month_number);
```

### 3.8 Health Assessments

Replaces the "2Wo2W" (biweekly) columns in CS PDCA: IP health, domains health, warmup health, copy health, funnel health.

```sql
CREATE TABLE client_health_assessments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assessed_at       TIMESTAMPTZ DEFAULT now(),
  assessed_by       UUID REFERENCES users(id),

  ip_health         TEXT CHECK (ip_health IN ('green', 'yellow', 'red', 'unknown')),
  domains_health    TEXT CHECK (domains_health IN ('green', 'yellow', 'red', 'unknown')),
  warmup_health     TEXT CHECK (warmup_health IN ('green', 'yellow', 'red', 'unknown')),
  copy_health       TEXT CHECK (copy_health IN ('green', 'yellow', 'red', 'unknown')),
  funnel_health     TEXT CHECK (funnel_health IN ('green', 'yellow', 'red', 'unknown')),
  server_health     TEXT CHECK (server_health IN ('green', 'yellow', 'red', 'unknown')),

  accounts_blocked  INTEGER DEFAULT 0,
  accounts_total    INTEGER DEFAULT 0,
  lost_probability  TEXT,
  insights          TEXT
);

CREATE INDEX idx_health_client ON client_health_assessments(client_id, assessed_at DESC);
```

### 3.9 Domains

Replaces the "DomainsPerformance" sheet (~1000 domain records).

```sql
CREATE TABLE domains (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain_name           TEXT NOT NULL,
  setup_email           TEXT,
  purchase_date         DATE,
  exchange_date         DATE,
  exchange_cost         NUMERIC(10,2),
  campaign_verif_date   DATE,
  campaign_status       TEXT,
  warmup_reputation     TEXT,
  warmup_verif_date     DATE,
  is_active             BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_domains_client ON domains(client_id);
CREATE INDEX idx_domains_name ON domains(domain_name);
```

### 3.10 Internal CRM

Replaces the "CRM" sheet (ColdUnicorn own sales pipeline, 109 rows).

```sql
CREATE TABLE crm_prospects (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name      TEXT NOT NULL,
  contact_name      TEXT,
  email             TEXT,
  phone             TEXT,
  source            TEXT,
  salesperson_id    UUID REFERENCES users(id),

  -- Pipeline stages (checkboxes in original)
  contact_date      DATE,
  intro_done        BOOLEAN DEFAULT false,
  linkedin_sent     BOOLEAN DEFAULT false,
  meeting_scheduled BOOLEAN DEFAULT false,
  meeting_held      BOOLEAN DEFAULT false,
  offer_sent        BOOLEAN DEFAULT false,
  follow_up_1       BOOLEAN DEFAULT false,
  follow_up_2       BOOLEAN DEFAULT false,
  follow_up_3       BOOLEAN DEFAULT false,
  follow_up_warm    BOOLEAN DEFAULT false,
  workshops         BOOLEAN DEFAULT false,

  status            TEXT CHECK (status IN ('new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  status_date       DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
```

### 3.11 LG Pipeline

Replaces the "LG PDCA" sheet (lead generation pipeline for ColdUnicorn itself).

```sql
CREATE TABLE lg_pipeline (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name      TEXT NOT NULL,
  received_date     DATE,
  owner_id          UUID REFERENCES users(id),
  source            TEXT,
  estimated_value   NUMERIC(12,2),
  win_chance        TEXT,

  meeting_done      BOOLEAN DEFAULT false,
  offer_sent        BOOLEAN DEFAULT false,
  follow_ups_done   BOOLEAN DEFAULT false,
  contract_signed   BOOLEAN DEFAULT false,
  lead_magnet       BOOLEAN DEFAULT false,
  won               BOOLEAN DEFAULT false,

  lesson_learned    TEXT,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
```

### 3.12 Financial Tables

```sql
-- Invoices per client per month (replaces "MoM - invoices" in CS PDCA)
CREATE TABLE invoices (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  invoice_month             DATE NOT NULL,
  contracted_amount         NUMERIC(12,2),
  chance_amount             NUMERIC(12,2),
  issue_time                TEXT,
  status                    TEXT CHECK (status IN ('pending', 'issued', 'sent', 'paid', 'overdue', 'vindication')),
  vindication_in_progress   BOOLEAN DEFAULT false,
  opinion_status_quo        BOOLEAN DEFAULT false,
  notes                     TEXT,
  created_at                TIMESTAMPTZ DEFAULT now()
);

-- Partnerships (replaces "MoM - partnerships" in CS PDCA)
CREATE TABLE partnerships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID REFERENCES clients(id),
  partner_name        TEXT NOT NULL,
  reported_for_month  DATE,
  invoice_received    BOOLEAN DEFAULT false,
  paid                BOOLEAN DEFAULT false,
  amount              NUMERIC(12,2),
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Cash flow projections (replaces "CF" sheet)
CREATE TABLE cash_flow_projections (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month         DATE NOT NULL,
  category      TEXT NOT NULL,
  is_revenue    BOOLEAN DEFAULT false,
  amount_net    NUMERIC(12,2),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(month, category)
);

-- Account Based Selling scoring (replaces "MoM - Account Based Selling" in CS PDCA)
CREATE TABLE account_based_selling (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  customer_lifetime_value   NUMERIC(12,2),
  market_size               TEXT,
  score                     NUMERIC(5,2),
  strategy                  TEXT,
  target_date               DATE,
  updated_at                TIMESTAMPTZ DEFAULT now()
);
```

### 3.13 Supporting Tables

```sql
-- Email exclude list (replaces "Emails Exclude List" sheet, ~162 domains)
CREATE TABLE email_exclude_list (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL UNIQUE,
  added_by    UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Lost clients tracking (replaces "ABM LOSTS" sheet)
CREATE TABLE abm_lost_clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name         TEXT NOT NULL,
  cs_manager_name     TEXT,
  documents_link      TEXT,
  drive_link          TEXT,
  notes               TEXT,
  return_possibility  TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- Client issues tracking
CREATE TABLE client_issues (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  reported_by     UUID REFERENCES users(id),
  issue_type      TEXT,
  description     TEXT NOT NULL,
  status          TEXT CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority        TEXT CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

### 3.14 SQL Views (replace rolling-window columns from CS PDCA)

These views replace the DoD/WoW/MoM column groups in the 127-column CS PDCA sheet. Instead of pre-computing and storing window values, they compute on the fly from time-series data.

```sql
-- Weekly aggregation per client (replaces WoW columns)
CREATE VIEW v_client_weekly_stats AS
SELECT
  client_id,
  date_trunc('week', snapshot_date)::DATE AS week_start,
  SUM(mql_diff) AS weekly_mql,
  SUM(me_diff) AS weekly_me,
  SUM(won_diff) AS weekly_won,
  AVG(bounce_count::NUMERIC / NULLIF(emails_sent_total, 0)) AS avg_bounce_rate,
  AVG(response_count::NUMERIC / NULLIF(emails_sent_total, 0)) AS avg_response_rate,
  AVG(human_replies_accum::NUMERIC / NULLIF(emails_sent_total, 0)) AS avg_human_response_rate,
  AVG(ooo_accumulated::NUMERIC / NULLIF(emails_sent_total, 0)) AS avg_ooo_rate,
  AVG(negative_total::NUMERIC / NULLIF(emails_sent_total, 0)) AS avg_negative_rate
FROM client_daily_snapshots
GROUP BY client_id, date_trunc('week', snapshot_date);

-- Monthly aggregation per client (replaces MoM columns)
CREATE VIEW v_client_monthly_stats AS
SELECT
  client_id,
  date_trunc('month', snapshot_date)::DATE AS month_start,
  SUM(mql_diff) AS monthly_mql,
  SUM(me_diff) AS monthly_me,
  SUM(won_diff) AS monthly_won,
  MAX(mql_total) - MIN(mql_total) AS mql_gained,
  MAX(me_total) - MIN(me_total) AS me_gained
FROM client_daily_snapshots
GROUP BY client_id, date_trunc('month', snapshot_date);
```

---

## 4. Row Level Security (RLS)

All tables have RLS enabled. Policies follow these principles:
- Admins (`super_admin`, `admin`) see all data
- CS Managers see data for their assigned clients only
- Client users see only their own client's data, and only client-visible tables

### 4.1 Key RLS Policies

```sql
-- Enable RLS on all tables
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_health_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE lg_pipeline ENABLE ROW LEVEL SECURITY;

-- CLIENTS: Admins see all
CREATE POLICY "admins_select_all_clients" ON clients FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);

-- CLIENTS: CS Managers see assigned
CREATE POLICY "cs_manager_select_assigned" ON clients FOR SELECT USING (
  cs_manager_id = auth.uid()
);

-- CLIENTS: Client users see own
CREATE POLICY "client_select_own" ON clients FOR SELECT USING (
  EXISTS (SELECT 1 FROM client_users WHERE client_id = clients.id AND user_id = auth.uid())
);

-- LEADS: Admins see all
CREATE POLICY "admins_select_all_leads" ON leads FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);

-- LEADS: CS Managers see assigned clients' leads
CREATE POLICY "cs_manager_select_leads" ON leads FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM clients
    WHERE clients.id = leads.client_id AND clients.cs_manager_id = auth.uid()
  )
);

-- LEADS: Client users see own leads
CREATE POLICY "client_select_own_leads" ON leads FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM client_users
    WHERE client_users.client_id = leads.client_id AND client_users.user_id = auth.uid()
  )
);

-- INTERNAL-ONLY tables (health, issues, snapshots, domains, setup, invoices):
-- No client access, only internal staff
CREATE POLICY "internal_only_health" ON client_health_assessments FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'cs_manager'))
);

-- CRM & LG Pipeline: Admin only
CREATE POLICY "admin_only_crm" ON crm_prospects FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);

CREATE POLICY "admin_only_lg" ON lg_pipeline FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('super_admin', 'admin'))
);
```

---

## 5. Frontend Pages

### 5.1 Client Portal

| Route | Page | Description |
|-------|------|-------------|
| `/client/dashboard` | Dashboard | Main dashboard: leads by week/month charts, daily sent/reply/bounce trends, current month summary, total prospects |
| `/client/leads` | Leads List | Searchable/filterable lead table with qualification badges (MQL/preMQL), pipeline stage indicators |
| `/client/leads/:id` | Lead Detail | Full contact info, email response text, qualification status, meeting/offer/won tracking |
| `/client/campaigns` | Campaigns | Campaign list with status, database size, positive responses count |
| `/client/campaigns/:id` | Campaign Detail | Daily stats chart (sent/reply/bounce), leads from this campaign |
| `/client/statistics` | Statistics | Interactive charts: sent/reply/bounce/opens over time, per campaign or aggregated |
| `/client/settings` | Settings | Profile, notification preferences |

### 5.2 Admin Portal

| Route | Page | Description |
|-------|------|-------------|
| **Dashboard** | | |
| `/admin/dashboard` | Executive Dashboard | Total clients, active campaigns, leads this month, revenue, health heatmap |
| **Client Management** | | |
| `/admin/clients` | Client List | All clients with status indicators, search, filter by status/cs_manager |
| `/admin/clients/:id/overview` | Client Overview | Key metrics, status, assigned CS manager, KPI targets |
| `/admin/clients/:id/setup` | Client Setup | Setup checklist: bi-setup, folders, inboxes, exchange A-B-A |
| `/admin/clients/:id/leads` | Client Leads | All leads + internal fields (same as client sees plus admin actions) |
| `/admin/clients/:id/campaigns` | Client Campaigns | Campaign management, create/edit/archive |
| `/admin/clients/:id/health` | Health History | Health assessment timeline (IP, domain, warmup, copy, funnel) with traffic-light indicators |
| `/admin/clients/:id/domains` | Client Domains | Domain management: purchase, exchange, verification, warmup reputation |
| `/admin/clients/:id/invoicing` | Invoicing | Invoice history, contracted amount, vindication status |
| `/admin/clients/:id/partnerships` | Partnerships | Partner management for this client |
| `/admin/clients/:id/abs` | ABS | Account Based Selling: CLV, market size, score, strategy |
| `/admin/clients/:id/issues` | Issues | Issue tracker for this client |
| `/admin/clients/:id/crm` | CRM Integration | CRM platform connection settings (Livespace, Pipedrive, Zoho, Salesforce) |
| **PDCA Operations** (replaces 127-column CS PDCA sheet) | | |
| `/admin/pdca/dod` | Day-over-Day | All clients: daily send volumes (last 5 days), schedule adherence |
| `/admin/pdca/wow` | Week-over-Week | All clients: bounce rate, response rate, human RR, OOO rate, negative rate, total leads, SQL leads (current + 3 prev weeks) |
| `/admin/pdca/2wo2w` | Biweekly Health | Health assessment form + history for all clients |
| `/admin/pdca/mom` | Month-over-Month | All clients: total leads, SQL leads, meetings rate, WON rate vs KPI targets (current + 3 prev months) |
| **ColdUnicorn Sales** | | |
| `/admin/crm/pipeline` | Sales CRM | Pipeline view (kanban or table) of ColdUnicorn own prospects |
| `/admin/crm/prospects/:id` | Prospect Detail | Full prospect detail with pipeline stages |
| `/admin/lg-pipeline` | LG Pipeline | Lead generation deals, win chance, contract stages |
| **Domains** | | |
| `/admin/domains` | All Domains | Cross-client domain overview (~1000 domains), performance, health |
| **Finance** | | |
| `/admin/finance/invoices` | Invoices | All invoices across all clients |
| `/admin/finance/cash-flow` | Cash Flow | Monthly CF projections by category |
| `/admin/finance/costs` | Costs | GH cost breakdown |
| **Reports** | | |
| `/admin/reports/weekly` | Weekly Report | Auto-aggregated weekly: MQL, ME, RR, BR per client (current + 3 prev weeks) |
| `/admin/reports/monthly` | Monthly Report | Auto-aggregated monthly: TMQL, WON per client (current + prev months) |
| `/admin/reports/rr-br` | RR/BR Generator | Response Rate & Bounce Rate report per team member |
| **Settings** | | |
| `/admin/settings/users` | User Management | Invite users, assign roles, assign clients |
| `/admin/settings/blacklist` | Email Blacklist | Email exclude list management (~162 domains) |
| `/admin/settings/integrations` | Integrations | API keys, Bison workspaces, CRM platform configs |

---

## 6. User Stories

### 6.1 Client User Stories

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-C1 | As a client, I want to see all my leads in a searchable table so I can review campaign responses | Lead table with search, sort, pagination. Shows: name, company, qualification, date, campaign |
| US-C2 | As a client, I want a dashboard with leads by week/month, daily sent/reply/bounce charts, and total prospects | Charts load within 2s, data updates daily, shows current month summary |
| US-C3 | As a client, I want to view the full email response text for each lead | Lead detail page shows full response, contact info, LinkedIn URL |
| US-C4 | As a client, I want to filter leads by qualification, campaign, date range, and pipeline stage | Filter UI with dropdowns/date pickers, filters combine with AND logic |
| US-C5 | As a client, I want to see my campaign list with status, database size, and positive response count | Campaign table with status badges, sortable columns |
| US-C6 | As a client, I want daily statistics per campaign in chart form | Time-series chart: sent (bar), replies (line), bounces (line), opens (line) |
| US-C7 | As a client, I want to mark leads as meeting held / offer sent / won | Clickable pipeline stage buttons on lead detail, changes save immediately |
| US-C8 | As a client, I want email notifications when new leads come in | Configurable in settings: immediate, daily digest, or off |

### 6.2 CS Manager Stories

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-M1 | As a CS manager, I want Day-over-Day view of all assigned clients' daily send volumes | Table: client rows x day columns (last 5 days), color-coded vs min_sent_daily target |
| US-M2 | As a CS manager, I want WoW comparison of bounce rate, response rate, human RR, OOO rate, negative rate | Table with 4 columns (current, -1w, -2w, -3w), trend arrows, red/yellow/green coding |
| US-M3 | As a CS manager, I want to perform biweekly health assessments per client | Form with 6 traffic-light selectors (IP, domains, warmup, copy, funnel, server), insights text area |
| US-M4 | As a CS manager, I want MoM views of total leads, SQL leads, meeting rate, WON rate vs KPI targets | Table with 4 month columns, KPI comparison, percentage of target achieved |
| US-M5 | As a CS manager, I want to see ecosystem integration status for each client at a glance | Dashboard widget with checkmarks: SMS, CRM, OOO, LinkedIn, workshops, ads |
| US-M6 | As a CS manager, I want to track issues and ColdUnicorn response times per client | Issue list with priority, status, response time metric, resolution tracking |
| US-M7 | As a CS manager, I want to manage domains per client | Domain table: domain name, setup email, purchase date, verification status, warmup reputation |

### 6.3 Admin Stories

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| US-A1 | As an admin, I want a global dashboard: total clients, leads, MQL, revenue, clients at risk | Summary cards + trend charts + at-risk client list (red health or high lost probability) |
| US-A2 | As an admin, I want to manage ColdUnicorn sales CRM: prospects, pipeline stages, follow-ups | Kanban board or table with drag-and-drop stages, prospect CRUD |
| US-A3 | As an admin, I want to manage LG pipeline: deals, win chance, contracts | Deal table with win chance badges, source tracking, won/lost recording |
| US-A4 | As an admin, I want to view/edit cash flow projections by month | Spreadsheet-like grid: months as columns, cost categories as rows, editable cells |
| US-A5 | As an admin, I want to manage users: invite clients with magic links, assign roles and clients | User list, invite form (email + role + client assignment), deactivate users |
| US-A6 | As an admin, I want to manage the email exclude list | Simple list with add/remove, import from CSV |
| US-A7 | As an admin, I want auto-generated weekly and monthly reports | Reports page showing pre-computed tables, exportable to CSV/PDF |
| US-A8 | As an admin, I want to track lost clients with reasons and return possibility | Lost client table with documents links, return assessment |
| US-A9 | As an admin, I want RR/BR reports per team member | Response rate and bounce rate by team member, daily breakdown |
| US-A10 | As an admin, I want to import leads, campaigns, stats via CSV/Excel upload | Upload form with column mapping, validation, preview before import |

---

## 7. Business Logic

### 7.1 Lead Qualification Flow

```
Lead arrives (manual import or future: webhook)
  |
  v
qualification = 'unqualified' (default)
  |
  v  [CS Manager reviews lead response]
  |
  +---> 'preMQL' (positive response, not yet fully qualified)
  |       |
  |       v  [Meets ICP criteria, strong intent]
  |       +---> 'MQL' (Marketing Qualified Lead)
  |               |
  |               v  meeting_scheduled = true
  |               v  meeting_held = true
  |               v  offer_sent = true
  |               v  won = true --> 'SQL' (Sales Qualified Lead)
  |
  +---> stays 'unqualified' (negative, OOO, not a fit)
```

### 7.2 Campaign Management Flow

1. Admin creates campaign record: links to client, enters name, status, external ID
2. Campaign stats are imported manually (CSV upload or form entry) - Phase 1
3. Stats are stored in `campaign_daily_stats` (one row per campaign per day)
4. Dashboard views aggregate from time-series tables automatically
5. When leads respond, they are imported and linked to the campaign
6. Future (Phase 2): Smartlead/Bison API auto-syncs stats and leads daily

### 7.3 PDCA Metric Computation

The 127-column CS PDCA sheet is replaced by SQL queries over time-series data:

| PDCA Section | Original | New Computation |
|---|---|---|
| DoD Daily Sent | 5 columns for last 5 days | `SELECT snapshot_date, emails_sent_total FROM client_daily_snapshots WHERE client_id = $1 ORDER BY snapshot_date DESC LIMIT 5` |
| 3DoD Total Leads | 5 columns (sum last 5 days) | `SELECT SUM(mql_diff) FROM client_daily_snapshots WHERE client_id = $1 AND snapshot_date >= CURRENT_DATE - 5` |
| WoW Bounce Rate | 4 columns (current + 3 prev weeks) | `SELECT week_start, avg_bounce_rate FROM v_client_weekly_stats WHERE client_id = $1 ORDER BY week_start DESC LIMIT 4` |
| WoW Response Rate | 4 columns | Same view, `avg_response_rate` |
| WoW Human RR | 4 columns | Same view, `avg_human_response_rate` |
| WoW OOO Rate | 4 columns | Same view, `avg_ooo_rate` |
| WoW Negative Rate | 4 columns | Same view, `avg_negative_rate` |
| WoW Total Leads | 4 columns | Same view, `weekly_mql` |
| 2Wo2W Health | 6 traffic-light columns | `SELECT * FROM client_health_assessments WHERE client_id = $1 ORDER BY assessed_at DESC LIMIT 1` |
| MoM Total Leads | 4 columns (current + 3 prev months) | `SELECT month_start, monthly_mql FROM v_client_monthly_stats WHERE client_id = $1 ORDER BY month_start DESC LIMIT 4` |
| MoM SQL Leads | 5 columns + KPI comparison | Same view + `clients.kpi_leads` for comparison |
| MoM Meetings Rate | 5 columns | `SELECT date_trunc('month', lead_received_at), COUNT(*) FILTER (WHERE meeting_held) FROM leads GROUP BY 1` |
| MoM WON Rate | 5 columns | Same but `FILTER (WHERE won)` |

### 7.4 Data Import (Phase 1)

For the first phase, data enters the system via manual import:

**CSV/Excel Import for:**
- Leads (bulk upload from Smartlead/Bison export)
- Campaign daily stats (from sequencer analytics export)
- Client daily snapshots (from daily stats export)
- Domains (bulk domain list import)

**Manual form entry for:**
- Client creation and setup
- Campaign creation
- Health assessments
- CRM prospects
- LG pipeline deals
- Invoices and financial data
- Issues

**Import flow:**
1. User uploads CSV/Excel file
2. System shows column mapping UI (source column -> target field)
3. Data preview with validation (required fields, data types, duplicates)
4. Confirmation and import
5. Post-import summary (imported, skipped, errors)

### 7.5 CRM Push to Client CRM (Future Phase)

When a lead is qualified to MQL+ and client has CRM integration enabled:
1. Database trigger fires on `leads` UPDATE where `qualification` changes
2. Edge Function reads `client_crm_integrations` for the client
3. Pushes lead to client CRM via appropriate API (Livespace, Pipedrive, Zoho, Salesforce)

---

## 8. API Integrations (Phase 2 - Future)

### 8.1 Smartlead Integration

```
Endpoints needed:
  GET /api/v1/campaigns              -- List campaigns
  GET /api/v1/campaigns/{id}/analytics  -- Daily stats
  GET /api/v1/campaigns/{id}/leads   -- Lead responses
  GET /api/v1/email-accounts         -- Inbox health, count

Webhook (incoming):
  POST /webhooks/smartlead/lead      -- New lead notification

Auth: API key per Smartlead account (4 accounts: RevGen, ConvertAI, E5M, ColdUnicorn)
```

### 8.2 Bison Integration

```
Endpoints needed:
  GET /workspaces/{id}/campaigns     -- Campaign list
  GET /workspaces/{id}/analytics     -- Daily stats
  GET /workspaces/{id}/leads         -- Lead responses

Auth: Workspace ID + API Key per client
```

### 8.3 CRM Integrations

| Platform | Auth | Use |
|----------|------|-----|
| Livespace | API key + secret, subdomain | Push qualified leads |
| Pipedrive | API token | Push qualified leads |
| Zoho | OAuth2 | Push qualified leads |
| Salesforce | OAuth2 + Connected App | Push qualified leads |

### 8.4 Edge Functions (Future)

```
supabase/functions/
  sync-daily-stats/       -- Cron: Daily stats from Smartlead/Bison
  sync-leads/             -- Cron: Fetch new lead responses
  webhook-smartlead/      -- Webhook: Receive lead notifications
  push-to-crm/            -- Triggered: Push lead to client CRM
  generate-weekly-report/ -- Cron: Weekly aggregation
  health-check/           -- Cron: Check domain/server health
```

---

## 9. Data Flow

### 9.1 Lead Lifecycle

```
[Manual CSV/Excel Import]  -->  (Future: Smartlead/Bison webhook)
         |
         v
  [leads table]
         |
    RLS filters
    /          \
   v            v
[Client Portal]  [Admin Portal]
/client/leads    /admin/clients/:id/leads
         |
         v  (CS Manager qualifies)
  [qualification updated: MQL -> SQL]
         |
         v  (Future: if CRM enabled)
  [Push to client CRM via Edge Function]
```

### 9.2 Stats Collection

```
[Manual CSV/Excel Import]  -->  (Future: Smartlead/Bison API daily sync)
         |
         v
  [campaign_daily_stats]  +  [client_daily_snapshots]
         |
         v
  [SQL Views: v_client_weekly_stats, v_client_monthly_stats]
         |
    /           \            \
   v             v            v
[Client Dashboard]  [Admin PDCA]  [Admin Reports]
Charts & summaries  DoD/WoW/MoM   Weekly/Monthly
```

### 9.3 Client Dashboard Data Sources

| Dashboard Widget | SQL Query |
|---|---|
| Daily sent/reply/bounce chart | `SELECT report_date, SUM(sent_count), SUM(reply_count), SUM(bounce_count) FROM campaign_daily_stats WHERE client_id = $1 GROUP BY report_date ORDER BY report_date` |
| Leads by week | `SELECT date_trunc('week', lead_received_at) AS week, COUNT(*) FROM leads WHERE client_id = $1 GROUP BY 1 ORDER BY 1` |
| Leads by month | Same, `date_trunc('month', ...)` |
| Current month sent | `SELECT SUM(sent_count) FROM campaign_daily_stats WHERE client_id = $1 AND report_date >= date_trunc('month', now())` |
| Campaign overview | `SELECT name, status, database_size, positive_responses FROM campaigns WHERE client_id = $1` |

---

## 10. Migration Plan

### Phase 1: Foundation (Weeks 1-3)
- Supabase project setup
- Schema creation (all tables from Section 3)
- RLS policies (Section 4)
- Auth configuration (email/password + magic links)
- Core tables populated: organizations, users

### Phase 2: Data Import & Core Features (Weeks 3-6)
- CSV/Excel import functionality
- Migration scripts for both Excel files:
  - CS PDCA 127 columns -> `clients` + `client_setup` + `client_health_assessments`
  - Client Report Leads -> `leads`
  - Client Report Campaigns -> `campaigns`
  - Client Report Statistics -> `campaign_daily_stats`
  - Daily Stats sheet -> `client_daily_snapshots`
  - CRM sheet -> `crm_prospects`
  - DomainsPerformance -> `domains`
  - Other sheets -> respective tables
- Client portal: auth flow, leads page, campaigns page

### Phase 3: Client Portal Complete (Weeks 6-9)
- Statistics page with charts
- Dashboard page (all widgets)
- Lead detail page
- Campaign detail page
- Settings page
- Email notifications for new leads

### Phase 4: Admin Portal Core (Weeks 9-13)
- Admin auth & dashboard
- Client management (CRUD + tabbed detail pages)
- PDCA views (DoD, WoW, 2Wo2W, MoM)
- Health assessment forms
- Domain management

### Phase 5: Admin Portal Extended (Weeks 13-16)
- Internal CRM (pipeline view)
- LG Pipeline
- Invoicing & financial management
- Cash flow projections
- Weekly/Monthly report generation
- RR/BR generator
- User management (invites, roles)

### Phase 6: API Integration (Weeks 16-19)
- Smartlead API sync (daily stats + leads)
- Bison API sync
- Webhook receivers for real-time lead notifications
- CRM push integration
- Automated daily/weekly cron jobs

### Phase 7: Polish & Launch (Weeks 19-21)
- Performance optimization
- Export capabilities (CSV, PDF)
- Mobile responsiveness
- User acceptance testing
- Data reconciliation against Google Sheets
- Production deployment

---

## 11. Database Schema Diagram

```
organizations ──< users
                    |
                    |── client_users >── clients
                    |                      |
                    |                      |──< campaigns ──< campaign_daily_stats
                    |                      |──< leads
                    |                      |──< client_daily_snapshots
                    |                      |──< client_health_assessments
                    |                      |──< client_setup (1:1)
                    |                      |──< client_crm_integrations
                    |                      |──< domains
                    |                      |──< invoices
                    |                      |──< partnerships
                    |                      |──< account_based_selling
                    |                      |──< client_issues
                    |
                    |──< crm_prospects (salesperson_id)
                    |──< lg_pipeline (owner_id)

Standalone:
  email_exclude_list
  cash_flow_projections
  abm_lost_clients

Views:
  v_client_weekly_stats (from client_daily_snapshots)
  v_client_monthly_stats (from client_daily_snapshots)
```

---

## Appendix A: Original Google Sheets Mapping

| Original Sheet | Target Table(s) | Notes |
|---|---|---|
| **Client Report: Leads** | `leads` | 29 columns -> normalized lead table |
| **Client Report: Campaigns** | `campaigns` | 8 columns -> direct mapping |
| **Client Report: Statistics** | `campaign_daily_stats` | 8 columns -> daily time series |
| **Client Report: Dashboard** | Computed from tables above | No storage needed - computed on the fly |
| **PDCA: CS PDCA** | `clients`, `client_setup`, `client_health_assessments`, `client_daily_snapshots`, `invoices`, `partnerships`, `account_based_selling` | 127 columns decomposed into 7 normalized tables |
| **PDCA: CRM** | `crm_prospects` | 19 columns -> direct mapping |
| **PDCA: CF** | `cash_flow_projections` | Monthly cash flow categories |
| **PDCA: CXX ideas** | Not migrated | Business ideation, not operational data |
| **PDCA: GH cost** | `cash_flow_projections` (costs) | Merged into CF table |
| **PDCA: AUTH** | `users` + `client_users` + Supabase Auth + RLS | Replaced by proper auth system |
| **PDCA: Daily stats** | `client_daily_snapshots` | 4294 rows -> direct migration |
| **PDCA: Emails Exclude List** | `email_exclude_list` | 162 domains -> direct migration |
| **PDCA: Client CRM Details** | `client_crm_integrations` | CRM platform connections |
| **PDCA: ABM LOSTS** | `abm_lost_clients` | Lost client tracking |
| **PDCA: LG PDCA** | `lg_pipeline` | 13 columns -> direct mapping |
| **PDCA: DomainsPerformance** | `domains` | 1001 rows -> domain records |
| **PDCA: Weekly** | `v_client_weekly_stats` (view) | Computed, not stored |
| **PDCA: Dashboards** | Admin Dashboard page | UI only |
| **PDCA: RR & BR generator** | Admin Report page | Computed from daily stats |

### Ignored sheets (per scope decision):
- E5M CS
- Smartlead Accounts
- Monthly
- Prospect Base
- Arkusz18 (empty)
