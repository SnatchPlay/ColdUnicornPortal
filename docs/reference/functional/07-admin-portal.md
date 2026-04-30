# 07 В· Admin Portal

Pages served under `/admin/*` for `admin` and `super_admin` roles. All pages from the [manager portal](./06-manager-portal.md) are available with widened scope (everything, not only assigned clients). This file documents the **admin-specific** behaviours and the admin-only pages.

## Contents

1. [Dashboard](#1-dashboard--admindashboardpage)
2. [User management](#2-user-management--adminusermanagementpage)
3. [Blacklist (write mode)](#3-blacklist-write-mode)
4. [Super-admin impersonation](#4-super-admin-impersonation)
5. [Settings: condition rules builder](#5-settings-condition-rules-builder)
6. [Scope differences vs manager](#6-scope-differences-vs-manager)

---

## 1. Dashboard вЂ” `AdminDashboardPage`

File: [`src/app/pages/admin-dashboard-page.tsx`](../../../src/app/pages/admin-dashboard-page.tsx). Route: `/admin/dashboard`.

### 1.1 Purpose

Global operational command center. Designed for a single glance: send-trend health, flag clients needing attention, and surface manager load.

### 1.2 Metric cards (3) вЂ” [04-metrics В§12](./04-metrics-catalog.md#12-manager-dashboard-aggregates)

| # | Label | Value | Hint |
|---|-------|-------|------|
| 1 | Clients | `scopedClients.length` | number of clients without assigned manager, e.g. "3 without manager" |
| 2 | Active campaigns | `count(scopedCampaigns WHERE status='active')` | `"global operational volume"` |
| 3 | Lead pipeline | `scopedLeads.length` | `${wonLeads} closed` |

Scope functions resolve to all rows for admin/super_admin.

### 1.3 Campaign momentum surfaces (3 separate 21-day charts)

Three separate `Surface` blocks, each with its own recharts `AreaChart` ([В§13 Admin campaign momentum](./04-metrics-catalog.md#13-admin-campaign-momentum)).

- **Charts:**
  - `Campaign momentum: Sent` вЂ” `sent` series, cyan `#38bdf8`.
  - `Campaign momentum: Replies` вЂ” `replies` series, green `#22c55e`.
  - `Campaign momentum: Positive` вЂ” `positive` series, amber `#f59e0b`.
- **X axis:** `label` (date formatted `d MMM`).
- **Grid:** `CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" vertical={false}`.
- **Tooltip:** admin `TOOLTIP` object (dark slate, `cursor: false`).
- **Data:** inline aggregation of `scopedCampaignStats` over last 21 days by `report_date` (not the `admin_dashboard_daily` view, though the view is equivalent).
- **Empty state:** each chart displays "No campaign trend data".

### 1.4 Manager capacity surface

One row per user with `role='manager'`.

| Column | Formula |
|--------|---------|
| Manager | `users.first_name + last_name` |
| Clients | `count(clients WHERE manager_id = user.id)` |
| Active campaigns | `count(campaigns WHERE status='active' AND client's manager = user.id)` |
| Leads | `count(leads WHERE client's manager = user.id)` |

Purpose: identify over- or under-loaded managers.

### 1.5 Controls

No timeframe picker on this dashboard вЂ” the momentum chart is hard-wired to the last 21 days, the surfaces are snapshots as of "now". The manager dashboard is similar.

---

## 2. User management вЂ” `AdminUserManagementPage`

File: [`src/app/pages/admin-user-management-page.tsx`](../../../src/app/pages/admin-user-management-page.tsx). Route: `/admin/users`.

### 2.1 Purpose

Invite-based lifecycle for agency users (`admin` / `manager`) and client users (`client`). All write operations go through edge functions (`send-invite`, `manage-invites`) that assume the service role and perform the corresponding mutations on `auth.users` + `public.users` + `public.client_users`.

### 2.2 Send invite form

| Field | Control | Validation |
|-------|---------|------------|
| `email` | text input | RFC-ish regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` |
| `role` | Select (`admin` / `manager` / `client`) | must pick one |
| `client` | Select, **shown only when `role === "client"`** | required when role is `client`; options from `clients` |

Submit button is disabled while `isSendingInvite`, and the label flips to "Sending...". Validation errors display in a `Banner`.

On success (`ok: true` from edge function):

- Inputs cleared.
- Message banner: "Invitation sent to <email>".
- Invites list refreshed.

Handler chain: `useCoreData().sendInvite(payload)` в†’ `repository.sendInvite(payload)` в†’ `invokeInviteEdgeFunction("send-invite", вЂ¦)`. Full error handling in [09 В§3](./09-mutations-rls.md#3-edge-functions).

### 2.3 Invites list

Displayed with tab filters: **Overview** (all), **Pending**, **Accepted**, **Expired**. Tab count is shown next to each label.

Row columns:

| Column | Source |
|--------|--------|
| Email | `invite.email` |
| Role | `invite.role` badge |
| Status | `invite.status` badge |
| Sent | `invite.created_at` formatted |
| Accepted | `invite.accepted_at` or `вЂ”` |
| Actions | Resend / Revoke buttons (only for `pending` and `expired`) |

Status badge palette:

- Pending в†’ sky (`border-sky-500/30 bg-sky-500/10 text-sky-200`)
- Accepted в†’ emerald
- Expired в†’ amber

Row actions:

- **Resend** в†’ `repository.resendInvite(id)` в†’ new expiry; Supabase sends a new email.
- **Revoke** в†’ `repository.revokeInvite(id)` в†’ marks the invite revoked; removes from pending.

List data comes from `repository.listInvites()` on mount and after each mutation.

### 2.4 Mapping to `client_users`

When a `client` invitation is accepted, the backend edge function creates both the `users` row and the `client_users` mapping. `AdminUserManagementPage` doesn't directly manage mappings in the common flow, but `useCoreData().upsertClientUserMapping(userId, clientId)` is exposed via the repository for programmatic reassignment if ever needed.

### 2.5 Feature availability

- Admin and super_admin can invite `admin`, `manager`, `client`.
- Invitations for `super_admin` are **not** offered вЂ” that role must be promoted directly in SQL.

---

## 3. Blacklist (write mode)

File: [`src/app/pages/blacklist-page.tsx`](../../../src/app/pages/blacklist-page.tsx). Route: `/admin/blacklist`.

### 3.1 Header

Banner announcing write access (in contrast to manager's read-only banner).

### 3.2 Add domain form

- `domain` text input, trimmed and lower-cased on submit (client-side normalisation).
- "Add domain" submit button.
- Submit handler: `useCoreData().upsertEmailExcludeDomain(domain)` в†’ `repository.upsertEmailExcludeDomain`.
- Validation: non-empty after trim; no duplicate prevention beyond the DB UNIQUE constraint on the primary key `domain`.

### 3.3 Entries list

One row per entry, reverse-chronological by default:

- `domain`
- `created_at` formatted
- **Remove** button (admin only). Click triggers `useCoreData().deleteEmailExcludeDomain(domain)` with a confirmation toast.

No pagination; the blacklist is expected to be short (hundreds).

---

## 4. Super-admin impersonation

See [02 В§7](./02-roles-routes.md#7-impersonation). Only the super_admin role sees the impersonation panel in the sidebar; it is additionally gated by the env flag `VITE_ALLOW_INTERNAL_IMPERSONATION`.

Three entry points вЂ” Admin view, Manager view (from dropdown), Client view (from dropdown). `stopImpersonation()` returns control.

### Caveat

Impersonation is a **UI-only** preview. The Supabase session still belongs to the super-admin, so RLS evaluates against the super-admin's UUID. This means:

- The menu, URL shell, and client-side scope functions reflect the impersonated role.
- The snapshot contains the super-admin's visible data, **not** the target's. Scope functions filter this down to what the target *would* see, so usually the result matches.
- Any mutation performed during impersonation is signed by the super-admin and will pass/fail RLS accordingly. This can diverge from what the target role would experience.

For a faithful end-to-end role test, sign in as the target user directly.

---

## 4.5 Planned: Agency CRM kanban (`agency_crm_deals`)

The `agency_crm_deals` table and RLS exist (admin sees all; manager sees their own as `salesperson_id`). UI is **not yet built**; tracked as **BL-5** ([decision](../../BUSINESS_LOGIC.md#decision-2026-04-25-implement-agency-crm-ui)). When implemented it lives under `/admin/crm` (or similar) and offers a kanban / table view over the agency's own sales pipeline.

---

## 5. Settings: condition rules builder

File: [`src/app/pages/settings-page.tsx`](../../../src/app/pages/settings-page.tsx). Route: `/admin/settings`.

Admin and super-admin users get an additional **Condition rules** section inside Settings.

### 5.1 Rule list and quick controls

- Search by `key`, `name`, `metric`.
- Filter by surface and enabled state.
- Quick toggle: enable/disable rule.
- Quick edit: priority value.

### 5.2 Visual no-code editor

- Metadata fields: `key`, `name`, `surface`, `metricKey`, `target`, `scope`, `applyTo`, `columnKey`, source metadata, notes.
- Branch editor: severity, label, message.
- Recursive condition-tree editor: `comparison`, `all`, `any` nodes.
- Operand editor supports metric refs, static values, optional multiplier, optional transform.
- Base-filter editor uses the same condition tree primitives.
- Live JSON preview and validation errors before save.

### 5.3 Permissions

- Admin/super_admin: create/update/delete rules.
- Manager/client: no builder controls.

Rule runtime behavior and seeded rule set are documented in [14 · Condition rules](./14-condition-rules.md).

---

## 6. Scope differences vs manager

For the pages shared with [the manager portal](./06-manager-portal.md), admin differences are:

| Page | Manager sees | Admin sees |
|------|--------------|------------|
| Dashboard | Assigned-client aggregates | Global aggregates + 21-day momentum + manager capacity |
| Clients | `manager_id = identity.id` subset | All clients |
| Leads | `client_id в€€ assigned` | All leads |
| Campaigns | Assigned | All |
| Statistics | Scoped | All; client+campaign filters span the whole org |
| Domains | Assigned | All |
| Invoices | Assigned | All |
| Blacklist | Read-only | Write (add, remove) |
| User management | **not available** in sidebar | Available |

The actual row-level gate is enforced by Postgres via `private.can_access_client` returning true for admin. The page components are the same codepath; the broader dataset just naturally appears.

Next: [08 В· Charts catalog](./08-charts-catalog.md).



