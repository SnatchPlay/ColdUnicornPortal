# Traceability matrix

One row per business rule, from the rule down to the test that proves it.

```
Business process → Rule → Table → RPC/function → Gateway action → Portal surface → Metric → n8n workflow → Test
```

**Update this file in the same change** whenever any link in a chain moves. A row whose cells no
longer exist is worse than a missing row.

This complements the existing matrices rather than replacing them — [query-map](query-map.md),
[db-ui-mapping](db-ui-mapping.md), [mutation-ownership-matrix](mutation-ownership-matrix.md) and
[route-map](route-map.md) each cut the system a different way. This one is cut by *process*, and is
the only one that reaches into `automation/`.

Legend: **✅** implemented and verified · **⚠️** implemented, diverges from the rule · **⛔** not implemented.

---

## Process: OOO follow-ups

[Process doc](processes/outreach/ooo-followups.md) · [ADR-0015](../adr/0015-sequencer-contacts-and-ooo-followups.md)

| # | Rule | Tables | RPC | Gateway action | Portal surface | Metric | n8n workflow | Test | State |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A CRM lead is created only by a positive reply | `leads`, `replies`, `sequencer_contacts` | `promote_contact_to_lead` | — (ingestion) | — | preMQL→MQL conversion | `ooo-detect-and-log` ⚠️ writes `leads` directly | `ooo-invariants.sql` | ⚠️ |
| 2 | One contact → at most one CRM lead | `leads` | `uq_leads_source_sequencer_contact` | — | — | lead counts | — | `ooo-invariants.sql` | ✅ |
| 3 | OOO/NRR are never a lead qualification | `leads` | `promote_contact_to_lead` whitelist | — | CRM view (`crm_stage`) | — | `ooo-detect-and-log` ⚠️ sets `qualification='OOO'` | `ooo-invariants.sql` | ⚠️ |
| 4 | At most one **active** episode per contact | `ooo_followups` | `uq_ooo_followups_active` | — | — | active follow-ups | ⛔ not enforced (Google Sheet) | `ooo-invariants.sql` | ⚠️ |
| 5 | One episode per source reply (redelivery-safe) | `ooo_followups` | `uq_ooo_followups_source_reply` | — | — | — | ⛔ sheet append is unconditional | `ooo-invariants.sql` | ⚠️ |
| 6 | `expected_return_date` is NULL unless parsed | `ooo_followups` | `record_ooo_followup` | — | — | — | `ooo-detect-and-log` ⚠️ writes `$now+14d` | `ooo-invariants.sql` | ⚠️ |
| 7 | `scheduled_for` may use the fallback (today + 2) | `ooo_followups` | `record_ooo_followup` | — | — | due follow-ups | ⛔ | `ooo-invariants.sql` | ⚠️ |
| 8 | Missing routing is visible, never dropped | `ooo_followups`, `client_ooo_routing` | `resolve_ooo_routing`, `record_ooo_followup` | `loadClientsPage` (rules) | client drawer → OOO routing editor | — | ⛔ | `ooo-invariants.sql` | ⚠️ |
| 9 | Routing key is explicit `male\|female\|general` | `client_ooo_routing` | partial unique index | `updateClientOooRouting` | OOO routing editor | — | ⚠️ reads `gender` from a Bison custom variable | — | ⚠️ |
| 10 | Config change recovers parked episodes | `ooo_followups` | `recover_skipped_ooo_followups` | routing editor save | OOO routing editor | — | — | `ooo-invariants.sql` | ✅ |
| 11 | Cancellation preserves history | `ooo_followups` | `cancel_active_ooo_followup` | — | — | — | ⚠️ sibling `ZZ0ughB302WdDJOf` **deletes** the sheet row | `ooo-invariants.sql` | ⚠️ |
| 12 | Positive reply cancels the active episode | `ooo_followups`, `leads` | `promote_contact_to_lead` | — | — | — | ⛔ | `ooo-invariants.sql` | ⚠️ |
| 13 | NRR creates no lead and no `final_outcome` | `replies` | — | — | CRM view | NRR counts | `1hHbU2hYYcsktLUP` (orphan) | `ooo-invariants.sql` | ⚠️ |
| 14 | OOO data is internal-only (never `client` role) | `sequencer_contacts`, `ooo_followups` | `private.can_manage_client` | — | — | — | — | `ooo-invariants.sql` (RLS isolation) | ✅ |
| 15 | `daily_stats.ooo_count` is an outreach event count, not a CRM figure | `daily_stats` | — | `loadDashboard*` | manager/client dashboards | `ooo_count` | `amJdB2eGXxUNyCPY` (orphan) | — | ✅ |

**Reading the ⚠️ column.** Rows 1–13 are ⚠️ for one reason: the database contract is in place and
tested, and the automation has not started writing to it. The invariants exist but nothing exercises
them under load. All four workflows reached **phase A** on 2026-07-21 — a Supabase branch now runs in
parallel with the sheet — but the sheet is still authoritative
([dual-write transition](../adr/0017-sheets-to-supabase-dual-write-transition.md)). These rows go ✅ at
**phase B**, when Supabase becomes authoritative and the invariants are the ones actually enforcing.
Closing them *is* [migration-backlog §1](n8n/migration-backlog.md#1-ooo-cutover).

⚠️ here means "the rule holds in the database and nothing routes through it yet" — not "the rule is
violated". The genuine violations are narrower: row 3 (a direct `leads` write bypassing the RPC
contract) and row 11 (the sheet **deletes** where the contract **cancels and keeps history** — a
semantic gap dual-write must reconcile, not paper over).

Rows 3 and 6 additionally block
[`20260722z_drop_legacy_ooo_columns.sql`](../../supabase/migrations/deferred/20260722z_drop_legacy_ooo_columns.sql).

---

## Process: LinkedIn outreach (Aimfox)

[Process doc](processes/outreach/linkedin-aimfox.md) · [ADR-0012](../adr/0012-multi-sequencer-model.md)

Every row is ⛔ or ⚠️ for the same reason: **no Aimfox workflow writes Supabase at all.** The model is
specified, the automation is entirely Sheets-based ([migration-backlog §5](n8n/migration-backlog.md)).

| # | Rule | Tables | RPC | Gateway action | Portal surface | Metric | n8n workflow | Test | State |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A LinkedIn contact is not a lead; `preMQL` creates it | `leads`, `sequencer_contacts` | `promote_contact_to_lead` | — (ingestion) | CRM view | lead counts | `aimfox-premql-to-pdca` ⛔ appends a spreadsheet row | — | ⛔ |
| 2 | Contact identity is scoped `(client_sequencer_id, external_contact_id)` | `sequencer_contacts` | `upsert_sequencer_contact` | — | — | — | ⛔ no LinkedIn contact is stored anywhere | `ooo-invariants.sql` (contract only) | ⛔ |
| 3 | A lead carries its channel (`sequencer_id` = aimfox) | `leads` | — | — | CRM view | per-channel splits | ⛔ | — | ⛔ |
| 4 | `profile_id` is the Aimfox **account** id | `sequencer_daily_stats` | — | — | — | capacity per profile | `aimfox-daily-metrics` ⚠️ uses the sheet **row number** | — | ⚠️ |
| 5 | Invite counters never mix channels | `sequencer_daily_stats`, `daily_stats` | — | — | — | invites vs sends | ⛔ table never written | — | ⛔ |
| 6 | Snapshots are overwritten, per-day facts are keyed | `sequencer_daily_stats` | unique `(client, sequencer, profile, date)` | — | — | — | ⛔ | — | ⛔ |
| 7 | Blacklisting follows an explicit classification only | — (no table) | — | — | — | — | `aimfox-classification` ⚠️ classifies correctly, records nothing | — | ⚠️ |
| 8 | Audience loading is a live send; no blind second branch | — | — | — | — | — | `aimfox-import-to-connection` — A1 shadow required at cutover | — | ⛔ |

**What closes these.** Row 4 is a defect in a workflow this repository now owns and can fix. Rows 5
and 6 close together, with the capacity branch S. Rows 1–3 needed `client_sequencers` seeded — done
2026-07-22, five clients — and now need branch S on the classification and lead flows, in that order.
Row 7 closes when a classification produces a `replies` row, which is the same step as rows 1–2.

All five workflows are `managed` as of 2026-07-22, so every row above is now a defect this repository
can see and fix rather than one it merely suspects.

---

## Adding a process

1. Write the process document under [processes/](processes/).
2. Add a section here, one row per invariant.
3. If a workflow implements it, register the workflow in
   [automation/n8n/registry.yaml](../../automation/n8n/registry.yaml) and link it in the row.
4. Point the row's Test cell at something that actually runs.
