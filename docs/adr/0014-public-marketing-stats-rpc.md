# ADR 0014: Public marketing stats as a narrow anon RPC

## Status
Accepted 2026-07-21

## Context

The agency's new marketing website (Webflow) wants to display social-proof counters: leads received
yesterday, in the last week, month, quarter, and since the beginning. It needs one HTTP call that
returns finished numbers, callable by Webflow custom code or by an automation platform (Make,
Zapier, n8n).

Nothing in the portal serves an unauthenticated caller. Every read goes through the `orm-gateway`
edge function, which requires the caller's JWT and re-establishes their claims inside the
transaction ([ADR-0008](0008-orm-gateway-edge-function.md)). Every RLS policy in this database is
granted to `authenticated` only — the `anon` role sees zero rows from `leads`, `clients`,
`campaigns`, `replies`, `users` and `daily_stats`. That is the correct state and must not change.

So the question is not "how do we let the website read the data" — it is "what is the smallest
possible hole, and where does it live".

## Decision

**A single `SECURITY DEFINER` SQL function, `public.public_lead_stats()`, with `EXECUTE` granted to
`anon`** (`supabase/migrations/20260721_public_lead_stats_rpc.sql`). Webflow calls it as a PostgREST
RPC:

```
POST https://<project-ref>.supabase.co/rest/v1/rpc/public_lead_stats
apikey: <publishable key>
→ {"yesterday":0,"last_7_days":37,"last_30_days":322,"last_90_days":1553,"all_time":4723,
   "generated_at":"2026-07-21T07:02:13Z"}
```

Four properties make this narrow enough to be safe:

1. **Zero arguments.** There is no parameter to inject through and no way to ask it a different
   question than the one it was written to answer.
2. **Aggregates only.** The return type is a JSON object of five counters plus a timestamp. No row,
   no `client_id`, no lead identity, no per-client or per-campaign breakdown ever leaves it.
3. **`set search_path to 'public'`** pinned on the function, per the convention already used by the
   `private.*` helpers (`20260520_master_admin_rls.sql`).
4. **`revoke all … from public`, then an explicit grant** to `anon, authenticated` — future roles do
   not inherit it.

This is not a new mechanism. The admin user-management RPCs
([09-mutations-rls §3.6](../reference/functional/09-mutations-rls.md)) already sit outside the
gateway as `SECURITY DEFINER` functions with exactly this `revoke`/`grant` shape, for the same
reason: the whole feature ships in a migration, with every permission rule enforced in SQL. The only
delta here is that the grant includes `anon` and the function is read-only and argument-less.

`SECURITY DEFINER` is required, not incidental: `anon` has no SELECT policy on `leads` and must
never get one. The privilege lives in the function, not in the role.

**No new secret is exposed.** The `apikey` is the project's publishable key, which already ships
inside the portal's JS bundle (`VITE_SUPABASE_PUBLISHABLE_KEY`). Putting it in the Webflow page
reveals nothing that was not already public.

### The boundary

This surface may return **aggregates with no per-client or per-campaign dimension, and nothing
else**. Any sliced public metric — per client, per campaign, per manager, a time series, a named
logo — requires a new ADR. Do not add parameters to this function; add a new, equally narrow one.

### What counts as a lead

`count(leads)` excluding OOO / NRR / rejected. The predicate mirrors `deriveContactDisposition()`
([src/app/lib/crm/lead-status.ts:73](../../src/app/lib/crm/lead-status.ts#L73)): the canonical
`contact_disposition` column plus the legacy fallback for rows where n8n still writes `OOO`/`NRR`
into `qualification` ([11-integrations.md §6](../reference/functional/11-integrations.md)). The SQL
is a deliberate duplicate of that TS logic — Postgres cannot import the module. When n8n cuts over,
**keep the legacy `CASE` branch**: historical rows retain those qualification values forever.

This number is **not** the same as any portal KPI. `getClientKpis` counts MQLs
([client-view-models.ts:37](../../src/app/lib/client-view-models.ts#L37)); the public counter counts
all non-OOO/NRR/rejected leads and is therefore larger. Expected, documented in
[04-metrics-catalog.md](../reference/functional/04-metrics-catalog.md).

### Windows

Anchored to UTC midnight, matching `isoDaysAgo()` in the gateway
([orm-gateway/index.ts:117](../../supabase/functions/orm-gateway/index.ts#L117)):

| Key | Window |
|---|---|
| `yesterday` | previous whole UTC day, `[midnight−1d, midnight)` |
| `last_7_days` / `last_30_days` / `last_90_days` | `created_at >= midnight − Nd` — N whole days **plus** today so far, so the site's number ticks up during the day |
| `all_time` | every row |

## Alternatives considered

- **A new `public-stats` edge function.** `verify_jwt = true` is a security invariant for every
  function in this project ([supabase/config.toml](../../supabase/config.toml)) — the gateway decodes
  JWTs without re-verifying the signature, which is only safe because the platform verified it
  first. A public function would either break that invariant, or keep it and still require the same
  publishable key the RPC uses. Same exposure, more Deno code to maintain, an extra deploy step.
- **Extending the ORM gateway.** Its whole model is "a caller with claims". There is no anonymous
  caller in it, and inventing one would weaken the single mechanism the entire security boundary
  rests on.
- **A materialized counter table refreshed by cron.** Premature: the query is one seq scan,
  9.5 ms over 4,723 rows. Revisit only if request volume makes it matter.
- **Excluding test/QA clients.** Deferred — there is no `is_test` flag on `clients` and no live
  demand. Adding one is a small migration if the numbers ever need it.

## Consequences

- The endpoint is open to anyone holding the (public) key, with no rate limit beyond the platform's.
  Accepted: it returns five numbers that are being printed on a public website anyway. The only risk
  is request cost, not disclosure.
- **No index was added.** `all_time` counts every row, so a seq scan is unavoidable and an index on
  `leads.created_at` would buy nothing. Measured: `Aggregate → Seq Scan on leads`, 318 shared
  buffers, 9.456 ms on a local copy of the production dump (2026-07-21).
- The definition of "lead" now lives in two places (SQL + TS). Both carry a comment pointing at the
  other; a change to one is incomplete without the other.
- This is the first data consumer outside the gateway and outside an authenticated session. The
  boundary section above exists so the next one is a deliberate decision, not a drift.
