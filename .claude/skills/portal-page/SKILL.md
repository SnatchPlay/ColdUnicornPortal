---
name: portal-page
description: "Use when adding or restructuring a page/route in the portal — a new screen for any role, a new tab on an existing page, or migrating a page's data loading. Covers role dispatch, the per-page hook pattern with the loadIdRef stale guard, identity scoping, loading/empty/error states, tables, and drawers. Not for small copy or styling tweaks inside an existing page."
user-invocable: true
---

# Authoring a Portal Page

Every page owns its data. There is no global store — the universal snapshot was deleted
([ADR-0009](../../../docs/adr/0009-per-page-data-contracts.md)). If you find yourself wanting to
"read it from context", you want a gateway action instead (see the `gateway-action` skill).

## Route + role shape

- Routes live in one tree in [`App.tsx`](../../../src/app/App.tsx), behind
  `<RequireRole allowed={[...]}>`. Role prefixes are fixed: `/client`, `/manager`, `/admin`
  ([ADR-0002](../../../docs/adr/0002-route-based-role-shells.md)). Never add a runtime role
  switcher — use impersonation.
- Page components are lazy: `lazy(() => import("./pages/x").then((m) => ({ default: m.X })))`.
- A page serving several roles **dispatches on `identity.role` inside the component** — do not
  split the route. (`DashboardPage`, `LeadsPage`, `CampaignsPage`, `StatisticsPage` all do this.)
- Roles: `super_admin`, `admin`, `master_admin`, `manager` (shown as "CS Manager"), `client`.
  "Internal" = anything that is not `client`.

## The per-page hook (mandatory)

One page → one hook → one gateway select action. The `loadIdRef` guard is **not optional**: without
it a slow in-flight request overwrites the state of a newer fast one.

```ts
const loadIdRef = useRef(0);

useEffect(() => {
  const id = ++loadIdRef.current;
  setLoading(true);
  repository
    .loadSomethingPage(params)
    .then((result) => {
      if (id !== loadIdRef.current) return; // stale — discard
      setData(result);
      setError(null);
    })
    .catch((err) => {
      if (id !== loadIdRef.current) return;
      setError(toMessage(err));
    })
    .finally(() => {
      if (id === loadIdRef.current) setLoading(false);
    });
}, [paramsKey]);
```

**Canonical implementation: [`use-campaigns.ts`](../../../src/app/lib/use-campaigns.ts)** — copy it.
Also `use-domains`, `use-invoices`, `use-blacklist`, `use-analytics`, `use-settings`.

`use-leads.ts` is the odd one out: it guards with a `cancelled` flag in the effect cleanup instead of
a counter. That is safe against param changes but does **not** guard a manual `refresh()` racing an
in-flight load. Prefer `loadIdRef`; don't propagate the `use-leads` variant to new hooks.

Put the hook in `src/app/lib/use-*.ts` if it is shared; co-locate it in the page file if it serves
exactly one page.

`useShellData()` gives you the lightweight lookups every route needs (`usersLite`, `clientsLite`,
`clientUsers`). It is the *only* global data. Don't reach for it as a general cache.

## Scoping

Run data through the right selector from [`lib/selectors.ts`](../../../src/app/lib/selectors.ts)
(`scopeClients`, `scopeCampaigns`, `scopeLeads`, …) before rendering. RLS is the security boundary;
client-side scoping keeps the UI consistent — especially under impersonation. Clients see only
`campaigns.type='outreach'` ([ADR-0003](../../../docs/adr/0003-client-campaign-visibility.md)).

## Mutations

Call `repository.updateX(...)` **directly from the page**. There is no provider wrapper. Update
local state optimistically where it helps and roll back on failure. Use `sonner`
(`toast.success` / `toast.error`) for transient feedback, `<Banner>` for persistent context.

Editable lead fields are fixed: `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`,
`won`, `comments` ([ADR-0004](../../../docs/adr/0004-lead-state-boundaries.md)). Replies are
read-only; the portal never writes to ingestion-only tables (`replies`, `campaign_daily_stats`,
`daily_stats`).

## Reuse before you build

Search [reuse-catalog.md](../../../docs/reuse-catalog.md) first. In particular:

- **Internal pages** → `PageHeader`, `Surface`, `Banner`, `MetricCard`, `EmptyState`, `LoadingState`
  from [`app-ui.tsx`](../../../src/app/components/app-ui.tsx).
- **Client portal** → `PortalPageHeader`, `PortalSurface`, `KpiTile`, `ChartPanel`, `LeadDrawer`,
  `PortalLoadingState`, `PortalErrorState`, `EmptyPortalState` from
  [`portal-ui.tsx`](../../../src/app/components/portal-ui.tsx).
- **Lead drawer internals** → `LeadConversation`, `LeadMetaSection`, `LeadEditForm` are the
  composition seam. Reuse them; don't fork a second drawer.
- Only 16 shadcn primitives remain in `components/ui/` — the unused ones were deleted. `sheet` is
  replaced by `lightweight-sheet`, `avatar` by `user-avatar`. Check what exists before importing.

## Required states

Every data page renders **loading**, **empty**, and **error** (with retry). See
[ui-states.md](../../../docs/reference/ui-states.md) for which surface to use per role.

## Tables & drawers

- CSS-grid table + `useResizableColumns({ storageKey, defaultWidths })` (options object — not
  positional args). Storage keys look like `table:<page>:columns`.
- Pagination: numbered `<Pagination>` on leads; "Load more" on campaigns/clients. Match the page
  you are extending rather than introducing a third pattern.
- Drawer pattern: local `draft` seeded from the selected record, `isDraftDirty` gates Save/Cancel,
  `Escape` closes.

## Checklist

- [ ] Route behind `RequireRole` with the correct `allowed`
- [ ] Per-page hook with `loadIdRef` stale guard
- [ ] `scopeX` applied where data crosses roles
- [ ] Loading / empty / error states + retry
- [ ] Mutations via `repository.*` with toast + rollback
- [ ] Reused existing primitives (no near-duplicate component)
- [ ] Docs: role page file (05/06/07), plus 04-metrics/08-charts if you added one
- [ ] `pnpm lint`, `pnpm test:run`, `pnpm build`
- [ ] Screenshots per affected role — see the `visual-verify` skill
