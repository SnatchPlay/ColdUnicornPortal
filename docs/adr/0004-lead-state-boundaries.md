# ADR 0004: Lead State Boundaries

## Status
Accepted (revised 2026-06-18)

## Decision

The `leads` row is the editable source of truth for **manager/admin** through the orm-gateway. As of revision 2026-05-19, the editable field set expands beyond pipeline state to cover identity and firmographic enrichment fields that operators routinely need to correct after ingestion.

**Editable by manager/admin** (whitelisted in `mapLeadPatch`):

- **Pipeline state:** `qualification`, `meeting_booked`, `meeting_held`, `offer_sent`, `won`
- **Report notes (Batch 4, 2026-06-18):** `client_note` (renamed from `comments`; client-facing), `coldunicorn_note` (internal-only — gateway nulls it for the client role in `loadLeadsList`)
- **Report highlight (Batch 4):** `highlight` — manual row colour `green` | `yellow` | `red` | null
- **Identity:** `email`, `first_name`, `last_name`, `job_title`, `company_name`, `linkedin_url`, `phone_number`, `phone_source`, `gender`
- **Firmographics:** `country`, `industry`, `headcount_range`, `website`
- **OOO state:** `expected_return_date`, `added_to_ooo_campaign`

> **2026-06-18 (Batch 4 — Leads report).** The legacy `comments` column was renamed to `client_note` (data preserved; it was already the client-facing note surfaced in the portal drawer). `coldunicorn_note` and `highlight` were added. The micro-CRM **booleans and `qualification` semantics are unchanged this batch** — the report's "Status" column is derived read-only from `getLeadStage()`. A future status-model change (qualification as single source of truth) is deferred pending client confirmation. Per-client custom lead columns are governed separately — see [ADR-0007](0007-per-client-lead-custom-fields.md).

**Never editable from the portal** (ingestion-owned, n8n-derived, or integration foreign keys):

- `id`, `client_id`, `campaign_id`, `created_at`, `updated_at`
- `external_id`, `external_blacklist_id`, `external_domain_blacklist_id`
- `source`, `reply_text`
- `response_time_hours`, `response_time_label`
- `message_title`, `message_number`

**Client role** stays read-only on `leads` at the UI level (drawer disables every input when `identity.role === "client"`). RLS on `leads` permits update for any actor with `can_access_client(client_id)` — the field whitelist + UI disable are the effective gates against client writes for editable fields.

**Replies** (`replies` table) remain ingestion-only. n8n classifies and writes replies; the portal never mutates them.

## Why we expanded the scope

Original ADR (2025) restricted edits to pipeline state because enrichment data was assumed authoritative from the upstream provider. In practice operators routinely need to:

- Correct mis-enriched emails / names / company before further outreach.
- Add manually-verified phone numbers from sales conversations.
- Override stale firmographics (country, industry, headcount).
- Manage OOO state (`expected_return_date`, `added_to_ooo_campaign`) when n8n classification missed nuance.

Restricting these to "raise a ticket → ingestion team fixes" was a friction cost without a security or correctness benefit, since the same data flows through n8n on next sync anyway.

## Consequences

- `mapLeadPatch` in `supabase/functions/orm-gateway/index.ts` is the **single point of enforcement** for the field whitelist. Any new editable field requires extending it.
- Operators may overwrite values that n8n later refreshes from upstream sources. We accept this: n8n is the source of truth for newly-ingested data, but a manual override stands until the next ingestion run touches that field.
- The lead drawer is now primarily an edit form for manager/admin. The client drawer remains a read-only view (with the same fields visible but no inputs).
- If a field is added to `LeadRecord` and should NOT be editable, do nothing — it is read-only by default. Only adding it to `mapLeadPatch` exposes it.

## Related
- [ADR-0003](0003-client-campaign-visibility.md) — client visibility filter.
- [docs/reference/functional/09-mutations-rls.md](../reference/functional/09-mutations-rls.md) — current whitelist + RLS policies.
- [docs/reference/functional/12-hidden-rules.md](../reference/functional/12-hidden-rules.md) — additional invariants.
