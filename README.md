# PdcaFigmaTest

Production-oriented frontend foundation for the GHEADS PDCA portal.

## What This Repo Now Contains

- Route-based workspaces for `client`, `manager`, and `admin`
- Live-schema frontend contracts aligned to Supabase project `bnetnuzxynmdftiadwef`
- Shared data layer that reads and mutates only through Supabase
- Core screens for:
  - dashboards
  - leads
  - campaigns
  - statistics
  - client settings / operational config
- ADRs and reference docs for architecture, route map, visibility rules, and data ownership

## Environment

Copy `.env.example` to `.env` and provide the Supabase values:

Example:

```env
VITE_SUPABASE_URL=https://bnetnuzxynmdftiadwef.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_6jbWFa2hOX-5U6TWS_KtrQ_5JXYCRG2
VITE_APP_BASE_URL=http://localhost:5175
VITE_APP_ENV=development
VITE_AUTH_ALLOW_SELF_SIGNUP=false
VITE_AUTH_ALLOW_MAGIC_LINK=true
```

## Development

```bash
corepack pnpm install
corepack pnpm dev
```

## Build

```bash
corepack pnpm build
```

## Verification

```bash
corepack pnpm test:run
corepack pnpm build
corepack pnpm test:smoke
```

## Notes

- Self-service signup is intentionally disabled for production readiness. Provision accounts through staff/admin workflow.
- Password reset redirects require `VITE_APP_BASE_URL` to match the deployed frontend origin.
- Production deployment requires SPA rewrites to `index.html`, HTTPS, publishable-key-only frontend config, and verified Supabase RLS policies.
- The repository intentionally has no alternate local-data runtime path.
- Runtime docs live in `docs/adr` and `docs/reference`.
