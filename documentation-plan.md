Functional Reference Documentation for PdcaFigmaTest
Context
The repository ships working code, short ADRs (docs/adr/*), and terse reference snippets (docs/reference/route-map.md, query-map.md, mutation-ownership-matrix.md, etc.), but there is no single comprehensive reference that explains end-to-end how the portal behaves per role, where every chart/KPI pulls data from, and how each metric is calculated.

The archived docs/archive/MASTER_FUNCTIONAL_SPECIFICATION.md was a starting point but is out of date with the post-refactor code (recent commits "Refactor Manager Dashboard and Settings Page", "enhance UI responsiveness", and the new Drizzle schema).

The user needs a living functional reference that documents:

All pages/tabs/widgets per role
Every chart (recharts + custom funnel bars) with its data source and formula
Every KPI tile and its calculation
Every table (columns, sort/filter, row actions, editable fields)
Every mutation and who is allowed to invoke it (RLS + frontend)
Data flow from Supabase tables → selectors → view models → UI
Non-functional aspects (auth, impersonation, RLS strategy, snapshot loading windows, error states)
Outcome: a documentation set under docs/reference/functional/ that a new engineer or analyst can read to fully understand the portal without reading source code first.

Decisions (confirmed with the user)
Language: English (matches existing docs).
Structure: Set of topic-oriented files inside docs/reference/functional/, with an INDEX.md as the entry point.
Detail level: Maximum — formulas, file:line anchors, SQL/JS snippets, time windows, edge cases.
Location: docs/reference/functional/ (adjacent to existing short references; the archive stays untouched).
Files to create
All new files under docs/reference/functional/:

INDEX.md — one-screen table of contents + how to navigate + "if you're a new X, start here" quick paths (dev / analyst / PM).

01-overview.md — purpose, high-level architecture (React SPA + Supabase + RLS), tech stack, top-level folder map (src/app/*), and pointers to ADRs 0001–0004.

02-roles-routes.md — complete routing tree from App.tsx:

RequireAuth → RequireRole → page component
Role → navigation items table (from NAV_BY_ROLE in app-shell.tsx)
Role blockers (SessionAccessBlocker, ClientAccessBlocker) and what triggers them
Impersonation subsystem (actorIdentity vs identity, controls, scoping)
Settings page role-conditional sections
03-data-model.md — every table and enum from schema.ts grouped by domain (Auth/Users, Clients & Mapping, Campaigns, Leads & Replies, Stats, Domains, Invoices, Blacklist, CRM Deals). For each: columns + types + FKs + indexes + applicable RLS policies and helper functions (private.can_access_client, can_manage_client, is_internal_user, is_admin_user, current_app_role). Includes the admin_dashboard_daily view and the performance-fix migrations.

04-metrics-catalog.md — the centerpiece. One subsection per metric. For each:

Name and where it appears
Formula (SQL/JS) with code snippet
Source table(s) and column(s)
file:line where computed (primarily client-metrics.ts, client-view-models.ts, dashboard pages)
Time window / rollup rules (e.g. 90-day campaign_daily_stats, 180-day daily_stats, ISO-week boundaries, calendar-month boundaries)
Null/edge handling (toRate returning null when denominator ≤ 0; database_size → prospects_added fallback)
Role in which it is visible Metric groups: Client KPIs (MQLs, Meetings, Won, Emails Sent, Prospects), Conversion Funnel, Campaign Reply Rate, Pipeline Activity, DoD / 3-DoD / WoW / MoM buckets, Admin campaign momentum (21-day rollup), Manager client portfolio aggregates, lead stage lifecycle (getLeadStage).
05-client-portal.md — every client-role page:

ClientDashboardPage (client-dashboard-page.tsx): 5 KPI cards w/ sparklines, 8 charts (daily sent, weekly leads, monthly leads, prospects added daily, 3-month sent, prospects by month, velocity composed chart, conversion funnel + campaign reply list). For each: feeding hook, formula reference to 04-metrics-catalog.md, empty/loading states.
ClientLeadsPage (client-leads-page.tsx): filters (search, campaign, reply scope, stage chips), table columns, CSV export, read-only LeadDrawer with replies history.
ClientCampaignsPage (client-campaigns-page.tsx): portfolio cards, daily volume line chart (4 series), top-10 sent bar chart, read-only campaign metadata.
ClientStatisticsPage (client-statistics-page.tsx): 4 KPI tiles, pipeline activity line chart, daily sent area chart, campaign reply rates bar chart, conversion funnel.
SettingsPage (settings-page.tsx) client-visible sections (name, password, sign out).
06-manager-portal.md — manager-role pages:

ManagerDashboardPage (manager-dashboard-page.tsx): 4 metric cards, campaign watchlist, assigned-client portfolio with KPI progress vs clients.kpi_leads/kpi_meetings, lead queue.
ClientsPage tabs (Overview / DoD / 3-DoD / WoW / MoM) (clients-page.tsx): all columns per tab, editable drawer fields, how each column maps back to 04-metrics-catalog.md.
InternalLeadsPage (leads-page.tsx): editable qualification drawer, replies list, filtering.
InternalCampaignsPage (campaigns-page.tsx): editable metadata + daily performance chart.
InternalStatisticsPage (statistics-page.tsx): trend line chart (sent/replies/opens/bounces), qualification pie chart, campaign portfolio cards.
DomainsPage, InvoicesPage, BlacklistPage (read-only for manager) — filters, columns, editable fields.
Settings extras (Current Identity card, Send reset link form).
07-admin-portal.md — admin-role pages (what differs from manager):

AdminDashboardPage (admin-dashboard-page.tsx): 4 global metric cards, 21-day Campaign momentum area chart (sent / replies / positive), at-risk clients surface, manager capacity surface.
AdminUserManagementPage (admin-user-management-page.tsx): send invite form (role-conditional client select), invite list tabs (Overview/Pending/Accepted/Expired), row actions (resend/revoke), edge-function flows (send-invite, manage-invites).
BlacklistPage write mode.
Super-admin impersonation controls (sidebar).
08-charts-catalog.md — one table per chart, cross-referenced from role pages. Columns: chart ID, location page, recharts type, data hook, series + colors, axes, tooltip config (PORTAL_CHART_TOOLTIP vs admin TOOLTIP), empty state label, interactions (timeframe, filter). Includes the custom SVG sparkline (DashboardKpiCard) and HTML-bar conversion funnel since they are not recharts.

09-mutations-rls.md — every write path:

Direct PostgREST updates: updateClient, updateCampaign, updateLead, updateDomain, updateInvoice, upsertEmailExcludeDomain, deleteEmailExcludeDomain, upsertClientUserMapping, deleteClientUserMapping (repository.ts)
Edge functions: send-invite, manage-invites (list/resend/revoke)
Per mutation: target table, RLS policy enforced, role allowed (matching docs/reference/mutation-ownership-matrix.md), optimistic update behavior (setSnapshot rollback on error), error taxonomy (RepositoryError kinds: permission, timeout, network, unknown).
Snapshot reload strategy (no realtime; manual refresh()).
10-nfr.md — non-functional:

Data loading strategy (bulk snapshot on mount, 90d/180d windows, no subscriptions, rationale from core-data.tsx)
Auth flow (Supabase session, identity load, error kinds: profile_missing, client_mapping_missing, permission, session_invalid, network)
RLS performance rewrite (set-based subqueries, 10.48s → 0.30s, see supabase/migrations/20260421_fix_rls_performance.sql)
UI state patterns (LoadingState / EmptyState / Banner with retry)
Responsiveness + column resizing persistence (useResizableColumns with localStorage keys table:campaigns:columns, table:leads:columns, table:clients:overview:columns, table:client-leads:columns)
Client-side scope + DB RLS (defence in depth)
Testing (vitest unit, playwright smoke)
Build/deploy notes (SPA rewrites, HTTPS, publishable key only)
Critical files to read while writing
Source-of-truth files that each section must cross-reference:

Routing / roles: src/app/App.tsx, src/app/providers/auth.tsx, src/app/components/app-shell.tsx, src/app/types/core.ts
Data access: src/app/data/repository.ts, src/app/providers/core-data.tsx, src/app/lib/supabase.ts
Selectors + view models: src/app/lib/selectors.ts, src/app/lib/client-view-models.ts, src/app/lib/client-metrics.ts, src/app/lib/timeframe.ts
Schema: supabase/drizzle/schema.ts, supabase/migrations/*, docs/reference/supabase-production-rls.sql
UI kit: src/app/components/portal-ui.tsx, src/app/components/app-ui.tsx
Existing short references: docs/reference/route-map.md, query-map.md, mutation-ownership-matrix.md, role-visibility-matrix.md, db-ui-mapping.md, ui-states.md, client-metrics-coverage.md
ADRs: 0001-live-supabase-source-of-truth.md, 0002-route-based-role-shells.md, 0003-client-campaign-visibility.md, 0004-lead-state-boundaries.md
Writing approach
Read each source-of-truth file fresh (not relying on exploration summaries) before writing the corresponding section — the summaries are a draft, but claims like formulas, line numbers, and RLS conditions must be verified from code.
Write INDEX.md first as a skeleton, then fill each file top-to-bottom.
Every metric entry follows a fixed template: Name · Formula · Source · File:line · Displayed in · Time window · Edge cases · Visible to.
Every chart entry follows: ID · Page · Type · Data hook · Series + colors · Interactions · Empty state.
Cross-link between files with relative Markdown links ([see Conversion Funnel](./04-metrics-catalog.md#conversion-funnel)).
Do not copy-paste huge code blocks; quote formulas and small helper functions (e.g. toRate, valueByDayOffset, getLeadStage) where they materially explain behavior. Link to file:line instead of inlining long components.
Short sub-ToC at the top of each file (#1–#N anchors) for navigation.
Verification
 ls docs/reference/functional/ lists all 11 files (INDEX + 10 topic files).
 Every file:line anchor resolves (quick check: grep a sampled function name to confirm it still lives there).
 Every metric in 04-metrics-catalog.md is referenced from at least one role file (5, 6, or 7).
 Every chart in 08-charts-catalog.md is referenced from its role file and its metric lookup in 04.
 Every mutation in 09-mutations-rls.md matches docs/reference/mutation-ownership-matrix.md (no contradictions).
 INDEX.md links every file and each file's internal ToC works.
 No edits to source code, migrations, or any file outside docs/reference/functional/.
 README.md is optionally updated with a single pointer line "See docs/reference/functional/INDEX.md for the full functional reference" (confirm with user before touching README).
Out of scope (explicit)
No code changes, no schema changes, no test changes.
No updates to docs/archive/* (kept as historical record).
No Mermaid diagrams unless a section is unintelligible without one (prefer tables).
No i18n / Ukrainian translation in this pass (English-only per user decision).