# ADR 0010: Legacy CRM as a Read-Only Second Supabase Project

## Status

Accepted 2026-07-14 (records an exception already shipped; written retroactively to stop it being
mistaken for a violation).

## Context

[ADR-0001](0001-live-supabase-source-of-truth.md) says Supabase project `bnetnuzxynmdftiadwef` is
the **only** data system, and [CLAUDE.md](../../CLAUDE.md) forbids importing `supabase-js` outside
`data/` and `lib/supabase.ts`.

[`src/app/lib/crm-integration.ts`](../../src/app/lib/crm-integration.ts) does both: it calls
`createClient(...)` to open a **second** Supabase client against a **different** project
(`VITE_LEGACY_CRM_SUPABASE_URL` / `VITE_LEGACY_CRM_PUBLISHABLE_KEY`) and reads `crm_providers` /
`crm_provider_fields` from it with `.from(...)`.

Read literally, that is an ADR-0001 violation sitting in `main`. It is not — it is an
intentional, bounded exception that was never written down. An agent auditing the codebase against
the docs would "fix" it by deleting a working feature, so it needs a record.

The CRM provider catalogue (which CRMs exist, what fields each needs to connect, which webhook to
call) lives in an older Hyra system that still owns it. The portal only needs to *render* that
catalogue so a client can pick a provider and fill in its fields — the actual CRM sync is executed
downstream, not by the portal.

## Decision

The legacy CRM project is permitted as **the single documented exception** to ADR-0001, under
strict limits:

1. **Read-only.** The portal `SELECT`s the provider catalogue. It never writes to the legacy
   project. There is no migration, no schema ownership, no RLS reasoning on our side.
2. **Config surface only.** The data crossing this boundary is *configuration metadata* (provider
   names, field definitions, webhook URLs) — never leads, replies, campaigns, or any operational
   record. Operational data stays exclusively in the primary project.
3. **Anonymous, sessionless client.** The second client is constructed with
   `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`, using the
   legacy project's **publishable** key. It carries no portal user identity and shares no auth
   state with the primary client.
4. **Fails closed and silently.** If `legacyCrmConfigured` is false (env vars absent), the module
   returns `null`/empty and the CRM card degrades to an empty state. The legacy project being
   down must never break the Settings page.
5. **Quarantined to one module.** All legacy access lives in `lib/crm-integration.ts`. Its only
   consumers are `components/crm-integration-card.tsx` and `pages/settings-page.tsx`. No other
   file may import `@supabase/supabase-js` to reach it, and it must not be routed through the ORM
   gateway (the gateway's `DATABASE_URL` belongs to the primary project only).

## Alternatives considered

- **Proxy the catalogue through the `orm-gateway`.** Rejected for now: the gateway holds a
  `DATABASE_URL` for the *primary* project; giving it a second connection would double its
  credential surface (ADR-0008) to serve a read-only config list.
- **Copy the provider catalogue into the primary project.** Rejected: it would fork a table the
  legacy system still owns and mutates — we would be maintaining a stale mirror and inventing a
  sync problem.
- **Hardcode the provider list in the frontend.** Rejected: a provider/field change would become
  a frontend deploy.
- **Fetch via n8n.** Deferred — this is the most likely long-term home (n8n already owns the
  external-system boundary per [11-integrations.md](../reference/functional/11-integrations.md)),
  but it does not exist today.

## Consequences

- ADR-0001 now reads as "one data system **for operational data**, plus one read-only legacy
  config source". Any *third* data source requires a new ADR — this is not a precedent for
  "just add a client".
- The `supabase-js` import rule in the working agreement carries a named exception for
  `lib/crm-integration.ts`; a linter rule enforcing it must allowlist that path.
- If the legacy CRM project is ever decommissioned, the blast radius is exactly one module and one
  settings card.
- **Migration trigger:** the moment this boundary needs to carry anything beyond config metadata —
  or needs a write — it must move behind n8n or the gateway, and this ADR must be superseded.
