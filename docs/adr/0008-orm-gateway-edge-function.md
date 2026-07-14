# ADR 0008: ORM Gateway Edge Function

## Status

Accepted 2026-07-14 (records a decision already shipped; written retroactively).

## Context

The portal originally read Supabase through PostgREST (`supabase.from(...)`) directly from the
browser. That path had three structural problems:

1. **Query shape was dictated by the client.** Every page assembled its own `select(...)` chains,
   so the same entity was fetched in a dozen slightly different shapes. Aggregation had to happen
   in the browser over raw rows, which is what forced the huge universal snapshot (see ADR-0009).
2. **No server-side aggregation.** PostgREST cannot express the roll-ups the dashboards need
   (per-client bucketed summaries, momentum series, funnel projections) without either a view per
   metric or shipping every raw row to the client. We were shipping the rows — megabytes per boot.
3. **RLS was the only contract.** Any new column was implicitly exposed to any page that asked
   for it; the trust boundary and the data contract were the same object.

We needed server-side query control **without** giving up RLS as the security boundary, and
without standing up a separate backend service (which ADR-0001 rules out).

## Decision

All runtime domain data — reads **and** writes — goes through a single Supabase **Edge Function**
gateway: `supabase/functions/orm-gateway/` (Deno + Drizzle ORM + postgres.js).

- **Transport.** The frontend POSTs to `${VITE_SUPABASE_URL}/functions/v1/${ormGatewayFunction}`
  with `{ action, ...payload }` and gets back an envelope `{ ok, data, _serverMs, _requestId }`.
  `VITE_ORM_GATEWAY_FUNCTION` selects the deployed function (`orm-gateway`, or `orm-gateway-next`
  for a staged deploy — a thin twin that re-exports the same handler).
- **Typed contract.** Every action's request/response is declared in
  [`src/app/data/orm-gateway-contract.ts`](../../src/app/data/orm-gateway-contract.ts) and
  [`src/app/types/view-contracts.ts`](../../src/app/types/view-contracts.ts). The edge function
  imports the *same* contract module and validates each request with `parseOrmGatewayRequest`.
  One definition, both sides.
- **RLS is preserved, not bypassed.** The gateway holds a `DATABASE_URL` (transaction-pooler)
  connection, so it connects as a privileged Postgres user. It therefore re-establishes the
  caller's identity **inside every transaction**
  ([`index.ts:710-719`](../../supabase/functions/orm-gateway/index.ts#L710)):

  ```sql
  set_config('request.jwt.claims',    <claims>, true),
  set_config('request.jwt.claim.sub', <sub>,    true),
  set_config('request.jwt.claim.role',<role>,   true),
  set_config('role',                  <role>,   true)   -- ≡ SET LOCAL ROLE
  ```

  The `true` third argument makes each setting **transaction-local**, so a leaked setting cannot
  outlive the request on a pooled connection. `resolvePassthroughRole` clamps the role to the
  allowlist `{anon, authenticated, service_role}` and defaults to `authenticated`
  ([`rls-context.ts:1-17`](../../supabase/functions/orm-gateway/rls-context.ts)).

- **Server-side aggregation is now allowed and expected.** Dashboard/analytics actions return
  computed facts (bucketed summaries, momentum series, filtered+paginated lists), not raw tables.
  The split is: **the gateway computes facts, the client computes formulas** — presentation-level
  ratios and view models stay in `lib/client-view-models.ts` / `lib/client-metrics.ts`.

### The JWT-signature question (read this before changing `rls-context.ts`)

`parseJwtClaims` **decodes the JWT payload without verifying the signature**
([`rls-context.ts:20-34`](../../supabase/functions/orm-gateway/rls-context.ts#L20)). That looks
alarming and is deliberate:

- Supabase's Edge Function runtime **already verified the JWT** before our handler runs. This is
  not an assumption — it is deployment state, verified 2026-07-14: `orm-gateway` and
  `orm-gateway-next` are both deployed with **`verify_jwt: true`**
  (`supabase functions list --project-ref bnetnuzxynmdftiadwef`). A request with a forged token
  never reaches this code.
- Even if it did, the claims are only ever used to *narrow* privilege — they are fed into
  `set_config` and Postgres then re-enforces **every** RLS policy against them. A forged `sub`
  would have to correspond to a real user row to see anything, and the role is clamped to the
  allowlist.

**Why:** re-verifying the signature in the handler would mean shipping the JWKS fetch + crypto
into every cold start for a guarantee the platform already provides.
**Trade-off:** the gateway's safety depends on JWT verification staying enabled at the platform
level. If you ever deploy this function with `--no-verify-jwt`, you must add signature
verification to `parseJwtClaims` in the same change. This is the single most important invariant
in the file.

**How to check it:** `supabase functions list --project-ref bnetnuzxynmdftiadwef` → `orm-gateway`
must show `verify_jwt: true`. Re-check after any deploy that was not made from this repo.

> **Contrast with the invite functions.** `send-invite` and `manage-invites` are deployed with
> **`verify_jwt: false`** — deliberately, not by accident. They hold the service-role key, so they
> do the verification *themselves*: reject a missing bearer token (401), call `auth.getUser()`
> (which verifies the signature server-side via the Auth API), then re-read the actor's role from
> `public.users` and gate on it (403). Two different, both-valid patterns — but never assume a
> function is protected just because it is an edge function. Check `verify_jwt`, and if it is
> `false`, read the handler.

## Alternatives considered

- **Keep PostgREST + database views per metric.** Rejected: every roll-up becomes a migration,
  views need their own RLS reasoning, and the client still can't be given a stable typed contract.
- **A separate Node/Nest API service.** Rejected: contradicts ADR-0001's "one system" premise,
  adds a deploy target, a second auth integration, and a network hop, for capability we can get
  inside the existing Supabase project.
- **`service_role` in the edge function with hand-written `WHERE` scoping.** Rejected outright:
  it moves the security boundary from RLS (declarative, tested, one place) into application code
  (imperative, easy to forget). The whole point of the `set_config` dance is to *keep* RLS as the
  boundary while gaining query control.
- **Postgres functions (RPC) per action.** Rejected: SQL-in-migrations is a poor authoring
  surface for 40+ actions, has no shared type contract with the client, and every change becomes
  a migration.

## Consequences

- **The gateway holds a database credential.** `DATABASE_URL` (transaction pooler) is a secret at
  least as sensitive as the service key. It lives only in Supabase function secrets and must never
  be echoed into logs or responses.
- **Pages never call `supabase.from(...)`.** Direct supabase-js survives only for: `auth.*`, a
  handful of `SECURITY DEFINER` admin RPCs, Storage (avatars), and the legacy CRM read path
  (ADR-0010).
- **Adding a field is a three-file change**: contract → gateway handler → consuming hook. Use the
  `gateway-action` skill; do not shortcut it by widening an existing action's response "just in
  case".
- **Cold starts are real.** A cold instance pays connection setup (~1 s). The client logs
  `[GATEWAY_OVERHEAD]` when `fetchMs - _serverMs.total > 1500 ms`. This is expected on a cold
  instance and is **not** a bug to work around in page code.
- **RLS performance still matters** — arguably more, since one action can touch several tables in
  a single transaction. ADR-0006 (set-based predicates) is a hard prerequisite, not an
  optimisation.
- Window constants (`CAMPAIGN_DAILY_STATS_WINDOW_DAYS = 90`, `DAILY_STATS_WINDOW_DAYS = 180`,
  `REPLIES_WINDOW_DAYS = 180`) now live in the gateway
  ([`index.ts:19-21`](../../supabase/functions/orm-gateway/index.ts#L19)), not in the frontend.
