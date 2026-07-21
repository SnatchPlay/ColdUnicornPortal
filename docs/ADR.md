# Architectural Decision Records

## Purpose

ADRs capture structural decisions that affect how the portal is built and why. They exist so
future work does not have to reverse-engineer architectural intent from git history.

An ADR is the answer to "why is it like this?" — not "how does it work?" (that is the
[functional reference](reference/functional/INDEX.md)) and not "what is the product?" (that is
[BUSINESS_LOGIC.md](BUSINESS_LOGIC.md)).

## Location

- Index: `docs/ADR.md` (this file)
- Records: `docs/adr/NNNN-*.md`

## Format

Each record contains: title, status (+ date), context, decision, alternatives considered,
consequences. Do not renumber published ADRs.

## When to create or update an ADR

Create one when a change affects:

- the data path (how the frontend reaches Postgres)
- the trust/security boundary (RLS, auth, role model, credentials)
- role topology or route shells
- what the portal is allowed to write vs what an external system owns
- a cross-cutting engine (conditions, custom fields, metrics)
- performance policy that constrains future work (query shape, windows, indexes)

Do **not** write one for a UI tweak, a new chart, or an isolated bug fix. Those belong in the
functional reference and [design-system.md](reference/design-system.md).

## Index

| ADR | Title | Status | Rule in one line |
|-----|-------|--------|------------------|
| [0001](adr/0001-live-supabase-source-of-truth.md) | Live Supabase is the runtime source of truth | Accepted | No alternative backend, no local-first mode, no mock-mode runtime branch. One exception: [0010](adr/0010-legacy-crm-integration.md). |
| [0002](adr/0002-route-based-role-shells.md) | Route-based role shells | Accepted | Each role owns a URL prefix (`/client`, `/manager`, `/admin`). No runtime role switcher — use impersonation. |
| [0003](adr/0003-client-campaign-visibility.md) | Client campaign visibility | Accepted | Clients see only `campaigns.type='outreach'`. Enforced in BOTH RLS and `scopeCampaigns`. |
| [0004](adr/0004-lead-state-boundaries.md) | Lead state boundaries | Accepted (rev. 2026-06-18) | Only `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`, `comments` are editable. Replies are read-only. |
| [0005](adr/0005-master-admin-role.md) | `master_admin` role | Accepted 2026-05-22 | A fifth role above `admin` for cross-tenant configuration. |
| [0006](adr/0006-set-based-rls-predicates.md) | Set-based RLS predicates for high-volume tables | Accepted 2026-06-01 | `USING (id IN (SELECT …))`, never a per-row `private.fn(col)` call on >1k-row tables. |
| [0007](adr/0007-per-client-lead-custom-fields.md) | Per-client custom lead-report columns | Accepted 2026-06-18 | Lead custom fields are per-client, not global. |
| [0008](adr/0008-orm-gateway-edge-function.md) | ORM gateway edge function | Accepted 2026-07-14 | The frontend reaches Postgres through one Deno edge function (Drizzle + postgres.js) with transaction-local RLS passthrough — not PostgREST. |
| [0009](adr/0009-per-page-data-contracts.md) | Per-page data contracts (snapshot retired) | Accepted 2026-07-14 | No universal snapshot. One gateway select action per page + `loadShellData`. No legacy fallback. |
| [0010](adr/0010-legacy-crm-integration.md) | Legacy CRM as a read-only second Supabase project | Accepted 2026-07-14 | The single documented exception to ADR-0001. Read-only, config-surface only. |
| [0011](adr/0011-conditions-rules-engine.md) | Conditions rules engine (JSON DSL) | Accepted 2026-07-14 | Client-health rules are a stored JSON DSL evaluated client-side — not free-form formulas, not SQL. |
| [0012](adr/0012-multi-sequencer-model.md) | Multi-sequencer model (catalog + per-client credentials) | Accepted 2026-07-04 | Sequencers (Smartlead/EmailBison/Aimfox) are first-class: `sequencers` catalog + `client_sequencers` credentials; `campaigns`/`leads` carry `sequencer_id`. |
| [0013](adr/0013-lead-crm-view-and-status-taxonomy.md) | Lead CRM view, child entities, and status taxonomy | Accepted 2026-07-19 | CRM view over `leads`: 4 child tables, derived health colours (shared TS module, not the conditions engine), split status model (derived `crm_stage` + stored `final_outcome` + derived `contact_disposition`), DB-trigger boolean recompute. KPIs untouched. |
| [0014](adr/0014-public-marketing-stats-rpc.md) | Public marketing stats as a narrow anon RPC | Accepted 2026-07-21 | The marketing site reads lead counters via one argument-less `SECURITY DEFINER` function granted to `anon`. Aggregates only — no per-client or per-campaign dimension, ever. A sliced public metric needs a new ADR. |
| [0015](adr/0015-sequencer-contacts-and-ooo-followups.md) | Sequencer contacts and OOO follow-ups as first-class entities | Accepted 2026-07-22 | OOO/NRR leave `leads`: an external contact gets a scoped identity (`client_sequencer_id` + `external_contact_id`) and each absence becomes an `ooo_followups` episode. A CRM lead is created only by a positive reply, one per contact. Invariants live in the DB behind `service_role` RPCs; the portal writes through one guarded wrapper. |
| [0017](adr/0017-sheets-to-supabase-dual-write-transition.md) | Google Sheets → Supabase migration by dual-write | Accepted 2026-07-21 | The agency's operations were built on Google Sheets and still run on them. Migration is a strangler-fig by process: phase A dual-write (Sheets authoritative), phase B parity (Supabase authoritative), phase C Supabase only. Sheets first / Supabase second / Supabase failure non-fatal in phase A; both sides independently idempotent; divergence measured before advancing. Scopes ADR-0001 to "the only data system the **portal** reads". |
| [0016](adr/0016-repository-as-automation-source-of-truth.md) | The repository is the source of truth for automation | Accepted 2026-07-21 | n8n workflows become tracked artifacts under `automation/n8n/`, keyed by a stable logical ID. Five-level hierarchy (business rules → ADRs → data contracts → application → automation); conflicts resolve downward, so a workflow contradicting a rule is a defect in the workflow. Repository is canonical, the instance is a deployment target, drift is reported and never auto-resolved. Contradictions are registered as expiring `knownViolations`, not hidden. |

## Superseded / amended

- ADR-0001's "only data system" clause is **narrowed** by ADR-0010 (legacy CRM read path).
- ADR-0009 **supersedes** the bulk-snapshot loading strategy described in pre-2026-07 revisions
  of `10-nfr.md` and `01-overview.md`.
- ADR-0013 **supersedes** ADR-0004's deferral of the status-model change: the `preMQL/MQL/SQL/won/
  lost/lost_premql` taxonomy is now in scope (coexisting with the legacy booleans during migration).
