---
name: gateway-action
description: "Use when adding, changing, or removing a data action in the orm-gateway edge function — any new read/write the frontend needs from Postgres, a new field on an existing payload, or a new server-side aggregate. Covers the typed contract, the Drizzle handler, RLS passthrough, windows, and deploy. Not for pure UI changes that consume an action that already exists."
user-invocable: true
---

# Adding an ORM Gateway Action

The frontend never calls `supabase.from(...)`. Every read and write goes through one Deno edge
function — `supabase/functions/orm-gateway/` — running Drizzle + postgres.js with transaction-local
RLS passthrough. Read [ADR-0008](../../../docs/adr/0008-orm-gateway-edge-function.md) before your
first action; it explains the trust model (including why the JWT signature is not re-verified).

An action is a **three-file change**. Doing only two of them is the most common failure.

## 1. Declare the contract (shared by both sides)

Both the browser and the edge function import the *same* contract module. There is one definition.

- **Request payload** → [`src/app/data/orm-gateway-contract.ts`](../../../src/app/data/orm-gateway-contract.ts)
  1. `export interface LoadThingPayload { action: "loadThing"; ...params }`
  2. add it to the `OrmGatewayRequest` union
  3. add `loadThing: ThingPayload;` to `OrmGatewayResponseMap`
  4. add a validation branch in `parseOrmGatewayRequest` — validate **every** caller-supplied field
- **Response shape** → [`src/app/types/view-contracts.ts`](../../../src/app/types/view-contracts.ts).
  Name it for the page it serves (`DomainsPagePayload`), not for a table. Return the facts the
  page renders, not raw tables.

## 2. Implement the handler

In [`supabase/functions/orm-gateway/index.ts`](../../../supabase/functions/orm-gateway/index.ts):

- Add the action to the dispatch switch and register it in `ORM_ACTION_META` in
  [`repository.ts`](../../../src/app/data/repository.ts) (`{ table, operation }` — drives error
  reporting).
- Query with **Drizzle**, against the schema in `supabase/drizzle/schema.ts`.
- **Do not re-implement scoping in SQL.** The transaction already ran
  `set_config('role', …)` + the JWT claims, so RLS applies. Your `WHERE` clause is about *what the
  page needs*, never about *what the user is allowed to see* — that is RLS's job. If you find
  yourself writing `WHERE client_id = <caller's client>`, stop: that is a policy, and it belongs in
  RLS (see the `rls-migration` skill).
- Respect the window constants at the top of the file — `CAMPAIGN_DAILY_STATS_WINDOW_DAYS = 90`,
  `DAILY_STATS_WINDOW_DAYS = 180`, `REPLIES_WINDOW_DAYS = 180`. Widening one is a perf decision,
  not a detail: justify it and record it.
- **Aggregate server-side.** The gateway computes *facts* (counts, buckets, series, filtered +
  paginated lists). The client computes *formulas* (ratios, view models) in
  `lib/client-view-models.ts` / `lib/client-metrics.ts`. Don't ship raw rows so the browser can
  count them.

## 3. Expose it to the app

- Add the method to the `Repository` interface + implementation in
  [`repository.ts`](../../../src/app/data/repository.ts). Selects go through
  `invokeOrmGatewaySelectWithRetry` (2 retries: 250 ms / 600 ms; a 401 refreshes the session and
  retries once). Mutations do not retry.
- Consume it from a per-page hook with a `loadIdRef` stale guard — see the `portal-page` skill.
  Never add a global provider.

## Deploy

The edge function is **not** deployed by `pnpm build`. It ships separately, and there is no
Supabase CLI wired into this repo — deploy via the Supabase MCP (`deploy_edge_function`) or the
dashboard. Until it is deployed, the new action returns an "unknown action" error in production
even though the frontend types compile.

`orm-gateway-next` is a thin twin that re-exports the same handler, for staging a deploy behind
`VITE_ORM_GATEWAY_FUNCTION` without touching the live function.

## Checklist

- [ ] Contract: payload interface + union member + response-map entry + `parseOrmGatewayRequest` branch
- [ ] `ORM_ACTION_META` entry
- [ ] Handler queries via Drizzle; no hand-rolled row scoping; windows respected
- [ ] `Repository` interface + implementation
- [ ] Consumed by a per-page hook with `loadIdRef`
- [ ] Edge function deployed (or the change is explicitly flagged as pending deploy)
- [ ] Docs: [09-mutations-rls.md](../../../docs/reference/functional/09-mutations-rls.md) for a
      write, [03-data-model.md](../../../docs/reference/functional/03-data-model.md) if columns
      changed, [04-metrics-catalog.md](../../../docs/reference/functional/04-metrics-catalog.md)
      if it computes a metric
- [ ] `pnpm test:run` + `pnpm lint` clean
