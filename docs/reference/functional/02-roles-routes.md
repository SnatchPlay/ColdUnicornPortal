# 02 · Roles & Routes

## Contents

1. [Roles](#1-roles)
2. [Route tree](#2-route-tree)
3. [Role gating](#3-role-gating)
4. [Navigation menu per role](#4-navigation-menu-per-role)
5. [Dispatch pages](#5-dispatch-pages-role-aware-components)
6. [Blockers & error screens](#6-blockers--error-screens)
7. [Impersonation](#7-impersonation)
8. [Settings page role-conditional sections](#8-settings-page-role-conditional-sections)

---

## 1. Roles

Defined in `AppRole` at [`types/core.ts`](../../../src/app/types/core.ts):

```ts
type AppRole = "super_admin" | "admin" | "manager" | "client";
```

Display label via `getRoleLabel()` in [`selectors.ts:15`](../../../src/app/lib/selectors.ts#L15):

| Role | Label shown to user |
|------|---------------------|
| `super_admin` | "super admin" |
| `admin` | "admin" |
| `manager` | **"CS Manager"** (explicitly renamed) |
| `client` | "client" |

Invite-eligible roles (via `AdminUserManagementPage`): `admin`, `manager`, `client`. `super_admin` cannot be invited — it must be promoted manually in the database.

### Identity model

`Identity` ([`types/core.ts`]):

```ts
interface Identity {
  id: string;          // users.id
  fullName: string;
  email: string;
  role: AppRole;
  clientId?: string;   // present only for client role; resolved via client_users mapping
}
```

`AuthContext` exposes two identities:

- `actorIdentity` — the real logged-in user.
- `identity` — the **effective** identity (equal to `actorIdentity` unless a super-admin is impersonating someone else; see §7).

When `actorIdentity.role === "super_admin"`, the super-admin may impersonate an admin/manager/client. `isImpersonating === true` in that case.

---

## 2. Route tree

Defined in [`App.tsx`](../../../src/app/App.tsx). Public routes sit at the top; everything else is behind `RequireAuth`.

```
/                       HomeRedirect      (redirect to role home)
/home                   Navigate to /
/login                  LoginPage         (public)
/reset-password         ResetPasswordPage (public; Supabase recovery link target)

── RequireAuth ────────────────────────────────
/*                      ProtectedApp
    /                   HomeRedirect

    client/ ── RequireRole allowed=["client"]
        dashboard       DashboardPage*    (guarded by identity.clientId)
        leads           LeadsPage*        (guarded by identity.clientId)
        campaigns       CampaignsPage*    (guarded by identity.clientId)
        statistics      StatisticsPage*   (guarded by identity.clientId)
        settings        SettingsPage      (no clientId guard)

    manager/ ── RequireRole allowed=["manager"]
        dashboard       DashboardPage
        clients         ClientsPage
        leads           LeadsPage
        campaigns       CampaignsPage
        statistics      StatisticsPage
        domains         DomainsPage
        invoices        InvoicesPage
        blacklist       BlacklistPage
        settings        SettingsPage

    admin/ ── RequireRole allowed=["admin", "super_admin"]
        dashboard       DashboardPage
        users           AdminUserManagementPage
        clients         ClientsPage
        leads           LeadsPage
        campaigns       CampaignsPage
        statistics      StatisticsPage
        domains         DomainsPage
        invoices        InvoicesPage
        blacklist       BlacklistPage
        settings        SettingsPage

    *                   HomeRedirect      (catch-all)
```

Pages are loaded via React `lazy()` — [App.tsx:14-32](../../../src/app/App.tsx#L14-L32) — so switching shells triggers a code-split fetch. The fallback during suspension is `<LoadingState />`.

The `*Page` components marked with `*` above additionally check `identity.clientId`; if missing, they render `<ClientAccessBlocker />` in place of the page ([App.tsx:175-178](../../../src/app/App.tsx#L175-L178)). Client settings is intentionally reachable even without a clientId so the user can contact support via the sign-out button.

### `roleHomePath`

[`App.tsx:34-38`](../../../src/app/App.tsx#L34-L38):

```ts
function roleHomePath(role) {
  if (role === "super_admin" || role === "admin") return "/admin/dashboard";
  if (role === "manager") return "/manager/dashboard";
  return "/client/dashboard";
}
```

Used by `HomeRedirect`, `RequireRole`, and the "Return to super admin" impersonation exit.

---

## 3. Role gating

### `RequireAuth`

[`App.tsx:91-96`](../../../src/app/App.tsx#L91-L96). Shows `<LoadingState />` while auth bootstraps; redirects to `/login` if no session; otherwise renders `<Outlet />`.

### `RequireRole`

[`App.tsx:98-107`](../../../src/app/App.tsx#L98-L107).

```ts
function RequireRole({ allowed }: { allowed: AppRole[] }) {
  if (loading) return <LoadingState />;
  if (!session) return <Navigate to="/login" replace />;
  if (!identity) return <SessionAccessBlocker />;
  if (!allowed.includes(identity.role)) return <Navigate to={roleHomePath(identity.role)} replace />;
  return <Outlet />;
}
```

Consequences:

- Logging in as `client` and typing `/admin/dashboard` redirects you to `/client/dashboard`.
- Logging in as `manager` and typing `/admin/users` redirects to `/manager/dashboard`.
- Super-admin has admin routes available by virtue of `allowed=["admin", "super_admin"]` on the `/admin` branch.

### Client-portal extra guard

For the four data-bearing client routes, the element is conditionally rendered:

```tsx
<Route path="dashboard" element={identity.clientId ? <DashboardPage /> : <ClientAccessBlocker />} />
```

This protects the UI from running queries with `clientId = undefined` when a client's `client_users` row is not yet provisioned.

---

## 4. Navigation menu per role

Defined in `NAV_BY_ROLE` at [`app-shell.tsx:55-76`](../../../src/app/components/app-shell.tsx#L55-L76).

### Client

| Label | Path | Icon |
|-------|------|------|
| Dashboard | `/client/dashboard` | LayoutDashboard |
| **My Pipeline** | `/client/leads` | Users |
| Campaigns | `/client/campaigns` | Rocket |
| Analytics | `/client/statistics` | BarChart3 |
| Settings | `/client/settings` | Settings |

### Manager

| Label | Path | Icon |
|-------|------|------|
| Dashboard | `/manager/dashboard` | LayoutDashboard |
| Clients | `/manager/clients` | Building2 |
| Leads | `/manager/leads` | Users |
| Campaigns | `/manager/campaigns` | Rocket |
| Analytics | `/manager/statistics` | BarChart3 |
| Domains | `/manager/domains` | Globe2 |
| Invoices | `/manager/invoices` | ReceiptText |
| Blacklist | `/manager/blacklist` | ShieldBan |
| Settings | `/manager/settings` | Settings |

### Admin / Super-admin

Same as Manager **plus** `User management` at position 2, and the whole block points at `/admin/*`.

| Label | Path | Icon |
|-------|------|------|
| Dashboard | `/admin/dashboard` | LayoutDashboard |
| **User management** | `/admin/users` | UserCog |
| Clients | `/admin/clients` | Building2 |
| Leads | `/admin/leads` | Users |
| Campaigns | `/admin/campaigns` | Rocket |
| Analytics | `/admin/statistics` | BarChart3 |
| Domains | `/admin/domains` | Globe2 |
| Invoices | `/admin/invoices` | ReceiptText |
| Blacklist | `/admin/blacklist` | ShieldBan |
| Settings | `/admin/settings` | Settings |

### Sidebar anatomy

From top to bottom ([`app-shell.tsx:133-286`](../../../src/app/components/app-shell.tsx#L133-L286)):

1. **Logo** (`imports/logo white with name.png`) + tagline "ColdUnicorn PDCA Platform".
2. **Workspace strip** — "Client workspace" + the active client's `name` for clients, or "Workspace" + `getRoleLabel(role)` for internal users.
3. **Nav list** — `NAV_BY_ROLE[role]` rendered as `NavLink` with active styling (`border-[#3a3a3a] bg-[#232323]`).
4. **Contract KPI mini-card** (client only, when `identity.clientId` resolves to a client) — `kpi_leads`/mo and `kpi_meetings`/mo. These are read from `clients.kpi_leads` and `clients.kpi_meetings`.
5. **Impersonation panel** — only for `actorIdentity.role === "super_admin"` when `runtimeConfig.allowInternalImpersonation` is truthy. See §7.
6. **User footer** — initials avatar, `fullName`, `getRoleLabel(role)`, sign-out icon button.

Desktop sidebar state is binary and persisted in `localStorage`:

- shown
- hidden

Storage key: `app_shell_sidebar_hidden` (`"1"`/`"0"`), with backward-compatible read from legacy `app_shell_sidebar_mode === 'hidden'`.

On mobile (below `lg`):

- sidebar opens via hamburger `Sheet` for full navigation
- fixed **bottom nav** shows 4 primary destinations per role
- secondary destinations stay in the `Sheet`

### Header controls and breadcrumbs

- Top content header renders breadcrumbs (`role -> current page`) for route orientation.
- Desktop uses one burger-style `Menu` toggle button for sidebar show/hide (no multi-mode states).

---

## 5. Dispatch pages (role-aware components)

The same URL path (e.g. `/manager/dashboard` vs `/client/dashboard`) is served by a single entry component that dispatches by `identity.role`:

- `DashboardPage` → `ClientDashboardPage` | `ManagerDashboardPage` | `AdminDashboardPage`
- `LeadsPage` → `ClientLeadsPage` | `InternalLeadsPage`
- `CampaignsPage` → `ClientCampaignsPage` | `InternalCampaignsPage`
- `StatisticsPage` → `ClientStatisticsPage` | `InternalStatisticsPage`

The client-specific components live in their own files (`client-dashboard-page.tsx`, `client-leads-page.tsx`, …). The internal (manager/admin) views are in the non-prefixed files (`manager-dashboard-page.tsx`, `admin-dashboard-page.tsx`, `leads-page.tsx`, etc.).

**Why?** ADR-0002 keeps URL shells distinct per role, but the app avoids duplicating route declarations. A role flip at the component level keeps navigation consistent.

---

## 6. Blockers & error screens

### `SessionAccessBlocker`

[`App.tsx:59-89`](../../../src/app/App.tsx#L59-L89). Shown when `session` exists but `identity` cannot be resolved. Message depends on `errorCode` from `useAuth()`:

| `errorCode` | Message |
|-------------|---------|
| `profile_missing` | "Your account is authenticated, but the workspace profile is still being provisioned." |
| `client_mapping_missing` | "Your client account is authenticated, but client access mapping is not assigned yet." |
| `permission` | "Your authenticated session does not have permission to load this workspace." |
| `session_invalid` | "Your session is no longer valid. Sign in again to continue." |
| `network` | "The workspace could not be loaded because the network connection is unstable." (warning tone, not danger) |
| _other_ | "The workspace could not be resolved for this authenticated session." |

Actions: "Retry account check" → `refreshIdentity()`; "Sign out" → `signOut()`.

### `ClientAccessBlocker`

[`App.tsx:109-139`](../../../src/app/App.tsx#L109-L139). Shown for the four client-scoped routes when `identity.role === "client"` but `identity.clientId` is falsy — typically a race between invite acceptance and `client_users` insertion. Shows "Access to this workspace will be enabled after your account setup is completed." Actions mirror the session blocker.

### Banner in `ProtectedApp`

When impersonation is active, a top banner ([App.tsx:158-163](../../../src/app/App.tsx#L158-L163)) always shows:

> Impersonation mode is active. Actor: _{fullName}_ ({role}). Effective role: _{role}_.

When `useAuth().error` is non-null (non-fatal snapshot warning), a warning banner shows the error plus the current role.

### Error boundary

`AppErrorBoundary` wraps the entire routed surface ([App.tsx:155](../../../src/app/App.tsx#L155)). Uncaught render errors produce a generic recovery screen.

### Runtime-config screen

If env vars are missing, `App` returns `<RuntimeConfigScreen />` before mounting providers ([App.tsx:259-257](../../../src/app/App.tsx#L259)). Lists the expected env vars.

---

## 7. Impersonation

Intended for super-admin support/debugging. Feature-flagged by `runtimeConfig.allowInternalImpersonation` (env var `VITE_ALLOW_INTERNAL_IMPERSONATION`).

Control UI: sidebar panel visible **only** when `actorIdentity?.role === "super_admin"` and the flag is on ([`app-shell.tsx:190-260`](../../../src/app/components/app-shell.tsx#L190-L260)).

Three entry points:

1. **Open admin view** — `impersonate({ ...actorIdentity, role: "admin" })` → `navigate("/admin/dashboard")`.
2. **Manager selector + Open manager view** — pick a manager from `users.role === "manager"`; `impersonate({ id, fullName, email, role: "manager" })` → `navigate("/manager/dashboard")`.
3. **Client selector + Open client view** — pick a `clients` row; `impersonate({ id: client.id, fullName: "<name> client view", email: notification_emails?.[0] ?? "client-view:<id>", role: "client", clientId: client.id })` → `navigate("/client/dashboard")`.

Exit: **Return to super admin** button — `stopImpersonation()` → `navigate(roleHomePath(actorIdentity.role))`.

### Scoping during impersonation

`AuthProvider` exposes `identity` as the impersonated one when active, so all downstream queries and scope functions (`scopeClients`, `scopeCampaigns`, …) behave as the target role. The actor identity is retained to drive the banner and to allow exiting.

**Caveat:** impersonation does *not* bypass RLS. The super-admin's real Supabase session is what signs the queries, so `auth.uid()` remains the super-admin's UUID. Row visibility is determined by RLS helpers which test the real user, not the effective `identity`. This means impersonation is a **UI-only** preview — it shows the target's menu and uses target-role client-side filters, but the data loaded is still the super-admin's snapshot. For a faithful role preview of a specific client, combine impersonation with filter controls.

---

## 8. Settings page role-conditional sections

`SettingsPage` is served on all three shells but renders different sections based on role ([`settings-page.tsx`](../../../src/app/pages/settings-page.tsx)).

| Section | Client | Manager | Admin |
|---------|:------:|:-------:|:-----:|
| Current Identity card (actor, effective, impersonation status) | ✖ | ✓ | ✓ |
| Profile name form (`displayName`) | ✓ | ✓ | ✓ |
| Change password form | ✓ | ✓ | ✓ |
| Request reset link form | ✖ | ✓ | ✓ |
| Sign out | ✓ | ✓ | ✓ |

See [05-client-portal §Settings](./05-client-portal.md#settings) and [06-manager-portal §Settings](./06-manager-portal.md#settings) for per-field details.

Next: [03 · Data model](./03-data-model.md).
