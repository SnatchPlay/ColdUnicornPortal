# ADR 0013: Lead CRM view, child entities, and status taxonomy

## Status
Accepted 2026-07-19

## Context

The client extends per-lead work with a **CRM view** on the existing leads table (Cold CRM / PDCA
spec, Appendices A–F): a `PDCA | CRM | PDCA+CRM` mode switch, ordered columns grouped into visual
"stages", and per-cell **health colours** (neutral / pending / green / yellow / orange / red) derived
from prerequisite + deadline/SLA rules. It also introduces lifecycle-rich child data (meetings,
offers, next-step tasks, additional-value deliveries) that does not fit as flat columns on `leads`,
and a canonical **status taxonomy** (`preMQL / MQL / SQL / won / lost / lost_premql`).

This collides with [ADR-0004](0004-lead-state-boundaries.md), which on 2026-06-18 **deferred** the
status-model change ("qualification as single source of truth… deferred pending client confirmation").
The product owner has now confirmed: implement the taxonomy. This ADR is that confirmation and
supersedes the deferral clause of ADR-0004.

## Decision

### 1. Child entities are normalized tables, not columns on `leads`
Four new tables — `lead_meetings` (intro/summary/general), `lead_offers`, `lead_tasks`,
`lead_value_deliveries` — each `lead_id`-owned, `ON DELETE CASCADE`. Rationale: they are repeated and
lifecycle-rich; duplicating them as `leads` columns would not model revisions, sequence, or per-meeting
AI artifacts. Intro/summary are one-per-lead (partial unique index); general repeats. **No** DB CHECK
coupling meeting `status` to timestamps (spec §2). AI text (insights, scores) lives on the object it
analyzes (the meeting row), not on `leads`.

### 2. Stages are visual only — no stage table, no `current_stage`
Stage headers group ordered columns in the CRM view. Progress is conveyed by per-cell health, not a
stored stage. We do **not** create a stage machine or transition history (spec §2, Appendix B.1).

### 3. Health colours are derived at read time, never stored
A single deterministic, dependency-free TS module (`src/app/lib/crm/lead-health.ts` +
`business-days.ts`) computes the six health states from `(value, prerequisite active?, deadline
passed?, terminal status, business rules)`. It is imported by **both** the browser and the Deno
`orm-gateway` (same relative-import mechanism as `orm-gateway-contract.ts`), so backend and frontend
can never disagree. Deadlines are evaluated against an explicit `asOf` (server clock), never the
browser clock. The existing `leads.highlight` (manual green/yellow/red) is unrelated and untouched.
This is **not** the conditions engine ([ADR-0011](0011-conditions-rules-engine.md)): CRM health is
fixed product logic needing `not_applicable`/`pending` + `deadline_at`, not a user-configurable DSL.

### 4. Status taxonomy is SPLIT (derived stage + stored terminal + separate disposition); KPIs untouched
> Refined 2026-07-19 after mapping every status consumer. A single mixed `crm_status` column was
> rejected because it conflates two orthogonal axes and creates a manual-vs-derived clobber problem.

The taxonomy is three separate things:
- **`crm_stage`** (`preMQL | MQL | SQL`) — the non-terminal funnel position, **DERIVED on read** from
  activity facts (`deriveCrmStage` in `src/app/lib/crm/lead-status.ts`), never stored → no backfill, no
  drift, no re-derivation trigger.
- **`final_outcome`** (`won | lost | lost_premql`) — the explicit terminal decision, the ONLY stored
  column (`leads.final_outcome`), set atomically with `conclusion` + `concluded_at` by the conclusion
  action (Phase 5). A CHECK enforces `final_outcome ⇒ concluded_at`.
- ~~**`contact_disposition`** (`ooo | nrr`)~~ — **SUPERSEDED by ADR-0015, removed 2026-07-22.** This
  was a derived dimension over the n8n-owned `leads.qualification`. Under ADR-0015 OOO/NRR are outreach
  states of a `sequencer_contacts` row (`ooo_followups`), never a lead dimension; migration `20260722z`
  dropped the `contact_disposition` column and the `OOO`/`NRR` `lead_qualification` values, and the
  `deriveContactDisposition` resolver + CRM "Disposition" column were deleted with it.

`resolveCrmStatus` collapses stage + outcome into the single display/health status and bridges the
legacy terminal signals (`won` boolean, `qualification='rejected'`). Terminal `lost`/`lost_premql`
suppress future SLA warnings (spec Appendix D.4).

**Existing KPI dashboards are NOT migrated.** Mapping showed the activity-count KPIs (meetings
booked/held, offers sent, conversion-funnel widths, MoM meetings) cannot be reconstructed from the
coarse taxonomy, and the status-count KPIs would silently change meaning (point-in-time `qualification`
stamp vs funnel position). They keep their booleans/`qualification` semantics; metric convergence is a
separate, product-sign-off-gated decision. The legacy booleans + `qualification` **remain** authoritative
for KPIs (spec §11 risk note).

### 5. Legacy booleans are kept in sync by a DB trigger that **recomputes** from child rows
Because n8n writes child tables **directly, bypassing the gateway**, boolean sync cannot live only in
a gateway transaction — it is an `AFTER INSERT/UPDATE/DELETE` trigger on `lead_meetings`/`lead_offers`:
- `meeting_booked` = EXISTS an active (scheduled/held, not cancelled/no_show) intro/summary/general
  meeting; `meeting_held` = EXISTS a held meeting; `offer_sent` = EXISTS a sent/accepted offer.
- **Recompute, not latch:** cancelling a meeting un-counts it (product decision, 2026-07-19). This can
  lower historical KPI numbers versus the old latch behaviour — accepted.
- **Guard:** the trigger only recomputes a lead that has ≥1 child row of the relevant type. Leads with
  no child rows keep their ingestion-set booleans (spec §11: "static booleans may remain without a
  detailed child record"), so the CRM rollout never wipes pre-existing KPI state.
- `won` is **not** trigger-managed — it belongs to the conclusion/status action, edited via the
  whitelist. The trigger only *derives* booleans; it never reads a client-supplied lead patch, so
  ADR-0004's `mapLeadPatch` remains the single whitelist for direct edits.

### 6. Read model is a gateway action, not a SQL view
`loadLeadCrmList` returns one flat fact row per lead (LATERAL joins for current offer / next task,
filtered joins for intro/summary meetings and value deliveries 1/2, the existing reply aggregate) plus
`asOf` and the business-day config. A SQL view is rejected: it cannot do per-role suppression of
internal-only fields (`call_script`, `transcription_url`, `pre_meeting_insights`, `process_score`,
`conversion_insights`, `conclusion`, `coldunicorn_note`), which the gateway nulls for the client role
(extending the pattern already in `loadLeadsList`). Per [ADR-0008](0008-orm-gateway-edge-function.md)
the gateway returns facts; the client computes `field_health` via the shared module.

### 7. Access boundaries follow existing lead RLS
Child-table RLS mirrors `lead_custom_field_values` (set-based, [ADR-0006](0006-set-based-rls-predicates.md)):
SELECT scoped `lead_id → leads → clients` via `private.can_access_client`; writes gated by
`private.can_manage_client` + role. Clients stay **read-only** on CRM data (spec §10). Managers/admins
write via the gateway; n8n/service role writes automation fields.

## Alternatives considered

- **Extend the conditions engine (ADR-0011) for health colours.** Rejected: it is data-driven and
  client-configurable with 5 severities and no prerequisite/pending/deadline concept — the wrong tool
  for fixed SLA logic that must also run server-side.
- **Latch booleans (keep the old KPI semantics).** Rejected by the product owner in favour of
  recompute (cancellations should un-count).
- **A `public.lead_crm_view` SQL view.** Rejected — no per-role field suppression, second place to run
  the mandatory EXPLAIN gate.
- **Keep deferring the status taxonomy.** Rejected — the client confirmed it is in scope now.
- **A single mixed `crm_status` column + KPI migration.** Rejected (2026-07-19) — see §4: the taxonomy is
  coarser than the booleans (lossy for activity KPIs) and would silently change status-KPI meaning, for
  no benefit to the CRM view.

## Consequences

- **KPIs are NOT migrated to the taxonomy** (§4). The ~10 boolean/`qualification` KPI sites
  (`getClientKpis`, conversion funnel, manager/admin dashboard SQL group-bys, MoM) keep their current
  semantics; the split model touches none of them. `crm_stage`/`final_outcome` are consumed only by the
  new CRM view (M column, health gating) and the Phase-5 conclusion action. Metric convergence, if ever
  wanted, is a separate change with product sign-off on the new definitions.
- Adding the 6 new `leads` columns and 4 tables is a three-artifact change each: SQL migration →
  `supabase/drizzle/schema.ts` → `src/app/types/core.ts` (+ `mapLeadPatch` for anything editable).
- OPEN parameters ship as flagged defaults, not invented rules (spec Appendix F.1): business-day
  timezone/holidays/16:00-cutoff (default `Europe/Warsaw`), the exact AO counted-step list, the
  score 30/50/70 and negotiation 30/60/90 boundaries, and the canonical status mapping. Colours are
  "indicative, not authoritative" until the client confirms these.

## Related
- [ADR-0004](0004-lead-state-boundaries.md) — status-model deferral, now superseded; `mapLeadPatch` whitelist.
- [ADR-0006](0006-set-based-rls-predicates.md) — set-based child-table RLS.
- [ADR-0008](0008-orm-gateway-edge-function.md) — gateway computes facts, client computes formulas.
- [ADR-0011](0011-conditions-rules-engine.md) — why CRM health is a separate mechanism.
- Source spec: Cold CRM / PDCA developer specification (Appendices A–F).
