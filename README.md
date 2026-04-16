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
```

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Notes

- Backend tenant mapping and RLS are still blockers for a safe client-facing release.
- The repository intentionally has no alternate local-data runtime path.
- Runtime docs live in `docs/adr` and `docs/reference`.
