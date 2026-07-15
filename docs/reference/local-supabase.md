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

## Daily local loop

```bash
supabase start                                   # boots Postgres/Auth/Edge/Studio; prints the anon key + URLs
cp .env.local.example .env.local                 # fill VITE_SUPABASE_PUBLISHABLE_KEY from the start output
cp supabase/functions/.env.local.example supabase/functions/.env.local

# Hydrate local data from a prod snapshot (real data — the dump is gitignored; never commit it):
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f supabase/.local/prod-data.sql
supabase db reset                                # rebuild schema from supabase/migrations, then:
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f supabase/.local/prod-data.sql
#   No host psql? Pipe through the stack's DB container instead:
#   docker exec -i supabase_db_bnetnuzxynmdftiadwef psql -U postgres -d postgres < supabase/.local/prod-data.sql

supabase functions serve --env-file supabase/functions/.env.local   # serve the gateway + invite fns
pnpm dev                                          # app at http://127.0.0.1:5173 → local stack
```

Because the dump is `--data-only`, the schema comes from `supabase/migrations` (via `supabase db
reset`) and the rows come from prod — no schema/dump conflict. The dump includes `auth.users`, so
the same accounts (and passwords) that work in production also work locally.

**Studio** (DB browser, auth users, logs): http://127.0.0.1:54323 · **Inbucket** (captured invite /
magic-link emails): http://127.0.0.1:54324.

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
- **`orm-gateway-next`** runs identical code to `orm-gateway`; it exists so dev traffic can target a
  WIP function without touching production. Point `VITE_ORM_GATEWAY_FUNCTION` at it when needed.
- **TLS.** `db:migrate` auto-disables TLS for localhost and requires it for the cloud pooler;
  override with `SUPABASE_DB_SSL=require|disable` if your connection string is unusual.
