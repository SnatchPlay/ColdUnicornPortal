# Production Release Checklist

## Runtime env

- `VITE_SUPABASE_URL`: target Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY`: publishable frontend key only.
- `VITE_APP_BASE_URL`: deployed frontend origin, used for password reset redirects.
- `VITE_APP_ENV=production`
- `VITE_AUTH_ALLOW_SELF_SIGNUP=false`
- `VITE_AUTH_ALLOW_MAGIC_LINK=true` only if passwordless access for provisioned users is desired.

## Deployment requirements

- Serve the built SPA over HTTPS only.
- Rewrite unknown application routes to `index.html`.
- Cache hashed assets aggressively; do not cache `index.html` as immutable.
- Keep source maps private to the hosting/logging platform; do not expose them casually.
- Do not inject secret or service-role keys into the frontend build.

## CI gates

- `corepack pnpm install --frozen-lockfile`
- `corepack pnpm test:run`
- `corepack pnpm build`

## Supabase auth settings

- Disable public self signups for the production project.
- Configure allowed redirect URLs to include `${VITE_APP_BASE_URL}/reset-password`.
- Provision accounts through staff/admin workflow before first sign-in.
- Verify the production frontend uses a publishable key, not legacy service credentials.

## Launch signoff

- Validate representative `client`, `manager`, `admin`, and `super_admin` accounts.
- Confirm unresolved `users` profile and missing `client_users` mapping produce blocker states instead of route leakage.
- Verify RLS behavior for current runtime queries and mutations before exposing the deployment externally.
