# Local Supabase & auto-deploy

Develop against a **full local Supabase stack** (Postgres + Auth + Edge Functions), and let a push
to `main` deploy **migrations + edge functions** to the cloud automatically. This replaces the old
flow where the only way to test a DB/function change was to push it straight to production.

## Architecture (what runs where)

| Piece | Production | Local |
|---|---|---|
| Frontend (Vite build) | self-hosted Docker + Traefik, deployed by SSH ([ci.yml](../../.github/workflows/ci.yml) `deploy`) | `pnpm dev` |
| Postgres + Auth + Edge Functions | Supabase cloud project `bnetnuzxynmdftiadwef` | `supabase start` (Docker) |
| Migrations | `pnpm db:migrate` → cloud (CI `db-migrate` job) | `pnpm db:migrate:local` |
| Edge functions | `supabase functions deploy` (CI `deploy-functions` job) | `supabase functions serve` |

The frontend calls `${VITE_SUPABASE_URL}/functions/v1/<fn>`, so pointing `VITE_SUPABASE_URL` at the
local API (`http://127.0.0.1:54321`) routes the whole chain — auth, gateway, DB — through the local
stack.

> **Migrations are not owned by the Supabase CLI.** They are applied by
> [`scripts/db-apply-migrations.mjs`](../../scripts/db-apply-migrations.mjs), which tracks state in
> `private.schema_migrations` keyed by filename. This is why we did **not** rename migrations to the
> CLI's 14-digit format — the cloud history table already references the current names. The CLI is
> used only to run the stack and to deploy/serve functions.

## One-time bootstrap

1. **Install the Supabase CLI** (no Homebrew on this machine):
   ```bash
   npm i -g supabase        # or use `npx supabase ...` for every command
   ```
2. **Start Docker Desktop** (already installed; the daemon must be running).
3. **Rotate the leaked DB password.** `scripts/db-apply-migrations.mjs` previously hardcoded the
   production pooler password; it is in git history. Rotate it in the Supabase dashboard
   (Project → Database → reset password), then update the cloud pooler consumers and the CI secret
   below. The scripts now **require** `SUPABASE_DB_URL` and have no fallback.
4. **Add GitHub Actions secrets + variables** (Repo → Settings):
   - Secret `SUPABASE_DB_URL` — the cloud pooler connection string (post-rotation).
   - Secret `SUPABASE_ACCESS_TOKEN` — a Supabase personal access token (dashboard → Account →
     Access Tokens) for `functions deploy`.
   - Variable `ENABLE_DB_MIGRATE=true` — turns on the CI migration job.
   - Variable `ENABLE_FUNCTION_DEPLOY=true` — turns on the CI function-deploy job. **Before setting
     this**, confirm each function's `verify_jwt` in [config.toml](../../supabase/config.toml)
     matches production — deploying applies those values.

   Both deploy jobs stay dormant until their variable is `true`, so merging this change does not
   disturb the current SSH frontend deploy.

## Provisioning the local DB (one-time)

The base schema (tables, `private.*` helpers, RLS, enums) lives **only in the cloud**.
`supabase/migrations/` holds *delta* migrations on top of it — **not** a from-zero schema — and the
Supabase CLI skips the `YYYYMMDD`**`b`**`_…`-style filenames it cannot parse. So the CLI must **not**
build the schema (a plain `supabase start`/`db reset` fails with `relation … does not exist`).
Instead, restore a **full cloud dump** and keep applying new deltas with the runner:

```bash
export CLOUD_DB_URL='postgresql://…pooler.supabase.com:5432/postgres'   # cloud pooler (kept secret)
./scripts/supabase-local-reset.sh                                       # empty stack → full dump → new migrations
```

What the script does (do it by hand if you prefer): boot an **empty** stack with the delta
migrations moved aside so the CLI does not try (and fail) to apply them → restore a full dump
(schema + data) from the cloud into the local DB → restore the migrations → apply any *new* ones
with `pnpm db:migrate:local`.

> The dump holds **real data (PII)**. It lands under `supabase/.local/` (gitignored) and in your
> Docker volume — never commit or copy it. It includes `auth.users`, so the same accounts (and
> passwords) that work in production work locally.

## Daily local loop

**One-time setup** (fills the two env files the app + gateway read):

```bash
cp .env.local.example .env.local                  # fill VITE_SUPABASE_PUBLISHABLE_KEY from `supabase start` output
cp supabase/functions/.env.local.example supabase/functions/.env.local
```

**Every day:**

```bash
pnpm dev                                           # app at http://127.0.0.1:5173 → local stack
```

`pnpm dev` ([scripts/dev-local.mjs](../../scripts/dev-local.mjs)) now runs the whole stack:
`supabase start` → `pnpm db:migrate:local` → `supabase functions serve` → `vite`, all in one
process. Ctrl-C stops the edge runtime + Vite it started; the core `supabase start` containers keep
running (fast restart next time). It resolves the `supabase` CLI from `PATH` or `npx`, so a global
install is optional.

> Serving the edge functions is **not** optional: the frontend talks only to the `orm-gateway` edge
> function, so if the edge runtime is down every page 503s with `name resolution failed` (that's Kong
> failing to reach the function, not the function erroring). This is exactly why `pnpm dev` bundles
> it — the old `pnpm dev` was just `vite` and left the gateway dead.

Need the app alone against an already-running stack? `pnpm dev:web` is the old bare `vite`.

**By hand** (what `pnpm dev` automates, if you want the pieces separately):

```bash
supabase start                                    # fast after the first boot — the DB volume persists
supabase functions serve --env-file supabase/functions/.env.local   # serve the gateway + invite fns
pnpm dev:web                                       # just vite
```

**Studio** (DB browser / auth users): http://127.0.0.1:54323 · **Inbucket** (captured invite /
magic-link emails): http://127.0.0.1:54324. If another local Supabase project is already running,
its containers already hold ports 54321-54327 — `supabase stop` it first, or bump the ports in
`config.toml`.

## Writing a new migration locally

1. Add `supabase/migrations/<YYYYMMDD[letter]>_<name>.sql` (same naming as the rest — see
   `rls-migration`).
2. Apply just the new file to the local DB:
   ```bash
   pnpm db:migrate:local
   ```
   The runner skips already-applied files (recorded in `private.schema_migrations`, which the prod
   dump brought in) and applies only the new one.
3. Test the change end-to-end against the local stack.
4. Refresh the Drizzle schema if the shape changed: `pnpm db:introspect`.

On merge to `main`, the CI `db-migrate` job runs the same runner against the cloud DB, so local and
prod apply migrations identically.

## Deploy on push to `main` (once the variables are set)

`verify` (lint + tests + build) → `db-migrate` (cloud migrations) → `deploy-functions` (edge
functions) → `deploy` (frontend SSH). The frontend job waits for `db-migrate` and **aborts if it
failed**, so a bundle never ships against an un-migrated schema. Edge functions land only after
migrations, so function code never precedes the schema it needs.

To ship a function or migration on its own, push to `main` — the relevant job runs; unrelated jobs
no-op (nothing to migrate / unchanged function code redeploys harmlessly).

## Notes & gotchas

- **PII.** The prod dump contains real customer data. It lives only under `supabase/.local/`
  (gitignored) and in your local Docker volume. Do not copy it elsewhere or commit it.
- **Legacy CRM** ([ADR-0010](../adr/0010-legacy-crm-integration.md)) is a separate cloud project;
  leave `VITE_LEGACY_CRM_*` blank locally — the CRM card degrades to empty.
- **`orm-gateway`** is the single canonical gateway function. To target a WIP copy from a dev build
  without touching production, deploy it under a temporary name and point `VITE_ORM_GATEWAY_FUNCTION`
  at it. (The old always-deployed `orm-gateway-next` twin was removed once the per-page migration shipped.)
- **TLS.** `db:migrate` auto-disables TLS for localhost and requires it for the cloud pooler;
  override with `SUPABASE_DB_SSL=require|disable` if your connection string is unusual. The gateway
  (`orm-gateway/index.ts`) applies the same rule to its own connection.
- **`.ts` import extensions.** The shared contract chain the gateway pulls
  (`data/orm-gateway-contract.ts` → `types/view-contracts.ts` ↔ `lib/client-metrics.ts`,
  `types/core.ts`) uses explicit `.ts` extensions on its relative imports. That is **required** so
  the local edge runtime (`supabase functions serve`, Deno) can resolve them — do not strip them.
  Vite/esbuild accept them; there is no tsconfig to object.
- **Verified end-to-end (2026-07-15):** `supabase start` + `scripts/supabase-local-reset.sh` +
  `supabase functions serve` + `pnpm dev` → sign in with a real account and the Clients grid loads
  from the local DB through the locally-served gateway.
