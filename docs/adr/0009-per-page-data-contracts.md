# ADR 0009: Per-Page Data Contracts (Universal Snapshot Retired)

## Status

Accepted 2026-07-14. The cutover is **complete** — `loadSnapshot`, `CoreSnapshot`,
`CoreDataProvider`, `useCoreData` and `LegacySnapshotOutlet` are deleted from the codebase.

## Context

The portal used to boot by loading a **universal snapshot**: `repository.loadSnapshot()` pulled
eleven tables in parallel into a `CoreDataProvider` context, and every page derived what it needed
from that in-memory blob with `useMemo`.

It worked at 5 clients and fell over as the data grew:

- **Boot cost was the worst page's cost.** Opening *any* route paid for *every* table. The
  snapshot reached ~12–16 MB; `JSON.parse` alone was a measurable stall, and a signature change in
  auth could trigger it twice.
- **Every page paid for every other page's columns.** A column added for the leads table was
  fetched for someone opening Invoices.
- **Time windows became load-bearing hacks.** The 90/180-day caps existed to keep the snapshot
  under the authenticated-role `statement_timeout` — a query-shape problem being solved with a
  data-volume cap.
- **Refresh was all-or-nothing.** Any mutation either patched the in-memory snapshot by hand
  (bug-prone, and the patch logic drifted from the server's shape) or re-fetched all eleven tables.

ADR-0008 gave us the missing capability: the gateway can compute exactly what a page needs.

## Decision

**There is no global data store. Each page loads its own data through exactly one gateway select
action.**

- **Shell data only, globally.** `ShellDataProvider` ([`providers/shell-data.tsx`](../../src/app/providers/shell-data.tsx))
  loads `loadShellData` once — the lightweight lookups every route needs (`usersLite`,
  `clientsLite`, `clientUsers`). Nothing else is global.
- **One page, one action, one hook.** Each page has a hook (`src/app/lib/use-*.ts`, or co-located
  when it serves a single page) that owns `data`/`loading`/`error`/`refresh` and calls one
  `repository.loadXPage(...)` action.

  *One sanctioned exception — a **view switch**, not a second data source.* Both leads pages render
  the same scoped rows through a PDCA or a CRM table ([ADR-0013](0013-lead-crm-view-and-status-taxonomy.md)),
  and the two shapes come from two actions. `useLeadViewModeList`
  ([`lib/use-lead-crm.ts`](../../src/app/lib/use-lead-crm.ts)) composes the two hooks behind an
  `enabled` flag and still returns **one** `data`/`loading`/`error`/`refresh` set: only the active
  mode fetches, and the page body never learns there are two. A new exception needs the same shape —
  one composed hook in `lib/`, never a second `data` binding in a page body.
- **Mandatory stale-response guard.** Every such hook uses a `loadIdRef` counter so a slow
  in-flight response can never overwrite state from a newer request:

  ```ts
  const loadIdRef = useRef(0);
  useEffect(() => {
    const id = ++loadIdRef.current;
    repository.loadSomething(params).then((result) => {
      if (id !== loadIdRef.current) return; // stale — discard
      setData(result);
    });
  }, [paramsKey]);
  ```

  Canonical implementation: [`use-campaigns.ts`](../../src/app/lib/use-campaigns.ts) (also
  `use-domains`, `use-invoices`, `use-blacklist`, `use-analytics`, `use-settings`).
  [`use-leads.ts`](../../src/app/lib/use-leads.ts) uses an older `cancelled`-flag variant which does
  not guard a manual `refresh()` racing an in-flight load — do not copy it.
- **Mutations are direct.** Pages call `repository.updateX(...)` and update their own local state
  (optimistic where it helps, with rollback on failure). There is no provider wrapper to route
  through, and nothing to "patch into the snapshot".
- **No legacy fallback.** This was a hard cut, not a dual-path migration. A regression test —
  [`snapshot-cutover-guard.test.ts`](../../src/app/data/__tests__/snapshot-cutover-guard.test.ts) —
  fails the build if any app-runtime file references `loadSnapshot`, and bans the string
  `useLegacySnapshot` outright. Its allowlist is empty and must stay empty.

**Why no fallback:** a dual-path period would have meant maintaining snapshot-patching *and*
per-page refresh for every mutation, and the fallback would have quietly become the path of least
resistance for new pages — which is exactly the thing being removed.

## Alternatives considered

- **Keep the snapshot, shrink it** (fewer columns, tighter windows). Rejected: it postpones the
  problem by one growth cycle and keeps every page coupled to every table.
- **React Query / SWR with per-entity caching.** Rejected *for now*: it solves caching and
  dedup, but the per-page contract (one action returning exactly one page's facts) is the part
  that actually fixed the payload problem. Adopting a cache layer later is compatible with this
  ADR — it would sit under the hooks, not replace the contracts.
- **Keep a global store, hydrate it per-page.** Rejected: that is the snapshot again, with extra
  steps and a harder invalidation story.

## Consequences

- **Boot loads shell data only.** Route cost is now the route's own cost.
- **Adding a page means adding an action.** You cannot "just read it from context" any more. Use
  the `portal-page` and `gateway-action` skills.
- **Two pages showing the same entity may fetch it twice.** Accepted — the payloads are small and
  page-shaped, and the duplication is visible instead of hidden in a shared blob. Revisit if a
  measured hotspot appears.
- **`refresh()` is per-hook.** There is no app-wide refresh. `useShellData().refresh()` only
  refreshes the shell lookups.
- **The time windows survive** (90/180 days) but are now a gateway-side policy in
  [`orm-gateway/index.ts:19-21`](../../supabase/functions/orm-gateway/index.ts#L19), not a
  workaround for snapshot size.
- The `loadClientsStats` action still exists in the contract but the clients page now uses
  `loadClientsMetricsSummary` + `loadClientsOverview`. It is a **dead action** pending removal on
  the next gateway deploy.
