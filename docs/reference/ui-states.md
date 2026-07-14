# UI States

Every list, panel, and page must render an explicit state — never a blank table, never a silent
failure, never a fixture fallback (ADR-0001).

Two parallel families of state surfaces exist, split by role-surface. **Pick by surface, not by
taste.** Tokens and visual specs: [design-system §7](./design-system.md#7-state-surfaces--which-one-to-use).

---

## 1. The state surfaces

| State | Internal (admin / manager) — [`app-ui.tsx`](../../src/app/components/app-ui.tsx) | Client portal — [`portal-ui.tsx`](../../src/app/components/portal-ui.tsx) |
|---|---|---|
| **Loading** | `LoadingState()` ([`app-ui.tsx:120`](../../src/app/components/app-ui.tsx#L120)) — centred spinner chip in a `min-h-[40vh]` box. Fixed copy ("Loading workspace data"), no props. | `PortalLoadingState({title?, description?})` ([`portal-ui.tsx:308`](../../src/app/components/portal-ui.tsx#L308)) — bordered card, spinner in a ring, customisable copy. |
| **Empty** | `EmptyState({title, description})` ([`app-ui.tsx:105`](../../src/app/components/app-ui.tsx#L105)) — dashed border on `#080808`. | `EmptyPortalState({title, description})` ([`portal-ui.tsx:299`](../../src/app/components/portal-ui.tsx#L299)) — same treatment, portal-namespaced. |
| **Error (retryable)** | *no internal equivalent* — reuse `PortalErrorState` or add retry to `Banner`. | `PortalErrorState({title, description, onRetry?})` ([`portal-ui.tsx:326`](../../src/app/components/portal-ui.tsx#L326)) — red card with an `AlertCircle` well and a **Retry** button. The only state surface with a retry affordance. |
| **Error / blocker (non-retryable)** | `Banner tone="danger"` ([`app-ui.tsx:25`](../../src/app/components/app-ui.tsx#L25)) — inline red notice. | `Banner tone="danger"` — the portal has no separate warning surface and reuses `Banner`. |
| **Persistent context / warning** | `Banner tone="warning"` (snapshot staleness, degraded scope) or `tone="info"` (impersonation). | `Banner` (same three tones). |
| **Transient mutation feedback** | `sonner` — `toast.success` / `toast.error`. Never a `Banner`. | same |

`Banner` tones: `info` → emerald, `warning` → amber, `danger` → red ([`app-ui.tsx:32-37`](../../src/app/components/app-ui.tsx#L32)).

---

## 2. Which one to use

| Situation | Use |
|---|---|
| Page-level data still loading | `LoadingState` / `PortalLoadingState` |
| Panel inside a loaded page still loading | the same loading surface **inside** the `Surface` / `PortalSurface` |
| Query succeeded, returned zero rows | `EmptyState` / `EmptyPortalState` |
| Query failed and retrying could work (network, timeout, cold start) | `PortalErrorState` **with `onRetry`** |
| Query failed for a reason retrying cannot fix (permission, missing tenant mapping) | `Banner tone="danger"` — state the blocker, do not offer retry |
| Standing context the user must keep seeing (impersonation, 90/180-day snapshot window) | `Banner` (`info` / `warning`) |
| A mutation just succeeded or failed | `sonner` toast |

Rules:

- **Never render a blank table or a bare `null`.** Every list gets an empty state.
- **Never fall back to fixtures or mock data on error** (ADR-0001). Surface the blocker.
- **Toasts are for transient feedback only.** Anything the user must still see after 5 seconds is a
  `Banner`.
- **Don't hand-roll a fourth error card.** If `PortalErrorState` is not the right shape, add a prop.

---

## 3. Optimistic mutations

The lead drawer and inline table edits apply optimistic updates around `repository.updateX(...)`
(e.g. [`leads-page.tsx:510`](../../src/app/pages/leads-page.tsx#L510), [`:697`](../../src/app/pages/leads-page.tsx#L697)).
On failure: **roll back the local state, then `toast.error`.** Do not leave the optimistic value on
screen and do not swap the whole panel to an error surface — the page is still valid, only the write
failed.

---

## 4. Blocker alignment (backend)

- Auth identity mapping must resolve a usable role identity before protected routes are considered
  ready. Failure surfaces via `useAuth().errorCode`, not a spinner that never resolves.
- Tenant access mapping (`client_users`) is required for client shell access and must not be
  bypassed. A missing mapping is a **blocker**, rendered as `Banner tone="danger"`.
- RLS gaps are release blockers. The frontend surfaces permission errors explicitly
  (`RepositoryError.kind === "permission"`) and never falls back to unscoped data.
- `RepositoryError.kind` maps to copy via `mapDashboardError()`
  ([`dashboard-momentum.ts:48-57`](../../src/app/lib/dashboard-momentum.ts#L48)): `timeout` →
  "performance issue", `permission` → "blocked by your permissions", `network` → "try again".
  Reuse it rather than writing new error copy.

---

## 5. Global behaviours you get for free

- **Reduced motion:** all animation/transition durations collapse to 0.01ms and `.animate-spin` is
  disabled under `prefers-reduced-motion` ([`theme.css:318-331`](../../src/styles/theme.css#L318)).
  Loading spinners degrade to a static icon — that is intentional; do not add a fallback.
- **Error boundary:** `AppErrorBoundary` ([`app-error-boundary.tsx`](../../src/app/components/app-error-boundary.tsx))
  wraps the routed surface. Do not duplicate it per page.
- **Chart a11y:** pair every chart with `ChartTextSummary` (`sr-only` prose summary).
