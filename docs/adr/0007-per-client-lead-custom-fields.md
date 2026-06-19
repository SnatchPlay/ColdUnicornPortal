# ADR 0007: Per-client custom lead-report columns

## Status
Accepted (2026-06-18)

## Context

Client Feedback Batch 4 asks for the Leads tab to replace the client's Google Sheets report, including the ability to add **custom columns for individual clients** at the manager/admin level. An existing generic custom-field system already serves the Clients mega-table (`client_custom_fields` / `client_custom_field_values`, master-admin-defined, global). That system is **not** client-scoped and is keyed on `client_id` values, so it cannot express "a column that exists only for client X's leads."

## Decision

Introduce a parallel, **client-scoped** field system for leads, mirroring the client custom-field shape but adding a `client_id` scope on the definition and keying values on `lead_id`:

- `lead_custom_fields(id, client_id → clients, name, field_type, options, position, editable_by[], created_by, created_at)`
- `lead_custom_field_values(lead_id → leads, field_id → lead_custom_fields, value, updated_at, updated_by, PK(lead_id, field_id))`

`field_type` reuses the client set: `text | number | currency | checkbox | droplist | link`. Values are stored as raw text; numeric sorting/parsing is frontend-only (`getCustomFieldSortValue`, reused).

**Permissions (Batch 4 decision):**
- **Define** columns (create/update/delete definitions): `super_admin` / `admin` / `master_admin` only — **not** managers. Enforced by the `lcf_write_admin` RLS policy.
- **Edit values:** any role listed in the field's `editable_by` array who can access the lead's client (default `{admin, master_admin}`); `manager` **and `client`** can be granted per field via the "Manage columns" UI. A `client`-editable column lets the client fill that cell directly on their report — `lcfv_write_scoped` already permits it (`private.current_app_role()` = `'client'` ∈ `editable_by` and `can_access_client` true), so no schema change is needed to enable it.
- **Read** definitions + values: anyone who can access the owning client, **including the client role** — the report is client-facing.

**Scoping & isolation:** all policies are set-based (ADR-0006). Definitions are filtered by `client_id IN (SELECT id FROM clients WHERE private.can_access_client(id))`; values by the lead's client. A column defined for client A never appears on client B's report because `loadLeadsList` only returns definitions for the `client_id`s of the rows on the page.

**Payload:** `loadLeadsList` returns `customFields` (definitions for the page's clients) and `customValues` (only for the returned lead ids) — no global fetch. Mutations go through `repository.createLeadCustomField / updateLeadCustomField / deleteLeadCustomField / upsertLeadCustomFieldValue` → orm-gateway actions.

## Alternatives considered

- **Extend `client_custom_fields` with a nullable `client_id` + an `entity` discriminator.** Rejected: overloads a table with two scoping models and two value tables' worth of semantics; higher risk to the shipped Clients feature.
- **Store custom values as JSONB on `leads`.** Rejected: no per-field RLS/editable_by, no clean definition metadata, awkward sorting.

## Consequences

- Two custom-field systems now exist (clients-global, leads-per-client). They share the frontend sort helper and field-type vocabulary but have separate tables, gateway actions, and config UIs. Keep them in sync where the field-type set evolves.
- The leads config UI lives on the internal Leads page ("Manage columns", admin-only) scoped to one client at a time, rather than in global Settings, because definitions are per-client.
- Custom columns are **not** server-sortable from the header (server pagination would only sort the visible page); they render/edit/export but rely on base columns for sort. Revisit if full custom-column sort is needed.

## Related
- [ADR-0006](0006-set-based-rls-predicates.md) — set-based RLS predicates.
- [ADR-0004](0004-lead-state-boundaries.md) — lead editable-field boundaries.
- `supabase/migrations/20260618c_lead_custom_fields.sql`
- [docs/reference/functional/09-mutations-rls.md](../reference/functional/09-mutations-rls.md)
