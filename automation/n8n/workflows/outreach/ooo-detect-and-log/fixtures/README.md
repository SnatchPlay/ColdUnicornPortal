# Fixtures

Sanitized example payloads for `ooo-detect-and-log`, matching
[`contracts/hub-child-input.schema.json`](../contracts/hub-child-input.schema.json).

**All values are synthetic.** No real contact, email address, workspace id, Bison lead id or reply
body appears here. Every OOO reply is an out-of-office auto-response for an invented person at an
invented company. Fixtures must never be produced by copying a production execution — see
[security.md](../../../../../../docs/reference/n8n/security.md).

These are inputs for **reasoning and review**, not a runnable test harness: this workflow calls the
Bison API, OpenAI and Google Sheets, so it cannot be executed against a fixture without either
live credentials or a mock instance. `pnpm n8n:validate` checks that each fixture parses and
conforms to the input schema. Do **not** run `execute_workflow` on production to "try" one.

| File | Case | Expected behaviour under the TARGET contract (ADR-0015) |
|---|---|---|
| `valid-input.json` | OOO reply with an explicit return date | `record_ooo_followup(expected_return_date='2026-08-04', scheduled_for='2026-08-04', date_source='reply_parsed')` → `pending` |
| `no-parseable-date.json` | OOO reply with no date ("currently away") | `expected_return_date = NULL`, `scheduled_for = today + 2`, `date_source='fallback'` → `pending`. **Today's workflow instead stores `today + 14` as the expected date — defect 2.** |
| `duplicate-event.json` | The same `TAG_ATTACHED` redelivered | Same `source_reply_id` → `uq_ooo_followups_source_reply` returns the existing episode. **Today: a second `OOO Leads` sheet row — defect 5.** |
| `missing-routing.json` | Client has no `client_ooo_routing` row for the contact's category | Episode recorded as `skipped` + `routing_missing` — visible, recoverable via `recover_skipped_ooo_followups`. Never a silent drop. |
| `automation-disabled.json` | `clients.auto_ooo_enabled = false` | Episode recorded as `skipped` + `automation_disabled`. |
| `repeat-absence.json` | A second, later OOO after the first episode reached `submitted` | A **new** episode opens (`submitted` is not "active"), so repeat absences accumulate as history instead of overwriting. |
| `positive-reply-cancels.json` | An `Interested` reply for a contact with an active episode | `promote_contact_to_lead` creates the CRM lead (one per contact) **and** cancels the active episode. NRR would create no lead at all. |
