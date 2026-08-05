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
| 1 | A CRM lead is created only by a positive reply | `leads`, `replies`, `sequencer_contacts` | `promote_contact_to_lead` | — (ingestion) | — | preMQL→MQL conversion | ✅ `bison-lead-enrichment` branch S calls the RPC (2026-07-22); `ooo-detect-and-log` ⚠️ still writes `leads` directly | `ooo-invariants.sql` | ⚠️ |
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

[`20260722z_drop_legacy_ooo_columns.sql`](../../supabase/migrations/20260722z_drop_legacy_ooo_columns.sql)
is now unblocked in code: the direct `leads` write is gone and the portal/gateway read-side was
removed on 2026-07-22 (`contact_disposition` / `expected_return_date` / `added_to_ooo_campaign`, the
`replyScope` OOO filter, and the `OOO`/`NRR` `lead_qualification` values). The file was moved out of
`deferred/`; the only remaining gate is deploy ordering — **redeploy `orm-gateway` before applying it**.

---

## Process: LinkedIn outreach (Aimfox)

[Process doc](processes/outreach/linkedin-aimfox.md) · [ADR-0012](../adr/0012-multi-sequencer-model.md)

Four of five workflows write Supabase as of 2026-07-22 (branch S, phase A); only
`aimfox-import-to-connection` is still Sheets-only, deliberately last —
[migration-backlog §5](n8n/migration-backlog.md).

| # | Rule | Tables | RPC | Gateway action | Portal surface | Metric | n8n workflow | Test | State |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A LinkedIn contact is not a lead; `preMQL` creates it | `leads`, `sequencer_contacts` | `promote_contact_to_lead` | — (ingestion) | CRM view | lead counts | `aimfox-premql-to-pdca` ✅ branch S (60 leads by 2026-08-05), `aimfox-leads-processing` ✅ branch S. `aimfox-premql-to-pdca` sent only 7 of the 14 whitelisted lead fields — `linkedin_url` + `country` added 2026-08-05 and history repaired by `aimfox:backfill-profile-fields` (60/60); `aimfox-leads-processing` still does not ⚠️ [gap table](../../automation/n8n/workflows/outreach/aimfox-premql-to-pdca/README.md#what-branch-s-still-throws-away) | parity harness over 8 real executions vs branch L: 0 differences; SQL exercised in `begin … rollback`; post-write check — Aimfox `linkedin_url` 90/90 | ⚠️ |
| 2 | Contact identity is scoped `(client_sequencer_id, external_contact_id)` | `sequencer_contacts` | `upsert_sequencer_contact` | — | — | — | `aimfox-classification`, `aimfox-premql-to-pdca`, `aimfox-leads-processing` all call it | `ooo-invariants.sql` (contract only) | ✅ |
| 3 | A lead carries its channel (`sequencer_id` = aimfox) | `leads` | — | — | CRM view | per-channel splits | `promote_contact_to_lead` reads `sequencer_id` from the contact's `client_sequencers` row, not the campaign — always aimfox here | — | ✅ |
| 4 | `profile_id` is the Aimfox **account** id | `sequencer_daily_stats` | — | — | — | capacity per profile | `aimfox-daily-metrics` ✅ branch S fixed it (2026-07-22) | — | ✅ |
| 5 | Invite counters never mix channels | `sequencer_daily_stats`, `daily_stats` | — | — | — | invites vs sends | `aimfox-daily-metrics` branch S writes `sequencer_daily_stats` only | — | ✅ |
| 6 | Snapshots are overwritten, per-day facts are keyed | `sequencer_daily_stats` | unique `(client, sequencer, profile, date)` | — | — | — | `aimfox-daily-metrics` branch S UPSERTs on that key | — | ✅ |
| 7 | Blacklisting follows an explicit classification only | `replies` | `upsert_reply` | — | — | — | `aimfox-classification` branch S now records every classification as a `replies` row (execution 50518 — real reply, `classification='other'`); `aimfox-premql-to-pdca` blacklists the converted contact + company after `promote_contact_to_lead` (exported 2026-08-05) — the tag is the classification, and the company is chosen from a closed `enum` of the lead's own current experience, "none" = no call | — | ✅ |
| 8 | Audience loading is a live send; no blind second branch | — | — | — | — | — | `aimfox-import-to-connection` — A1 shadow required at cutover | — | ⛔ |
| 9 | A lead is dated by when the prospect answered, not by when the event was delivered | `leads.created_at`, `replies.received_at` | `upsert_reply` → `promote_contact_to_lead` | — (ingestion) | CRM view, Clients grid | every DoD / WoW / MoM lead bucket | `aimfox-premql-to-pdca` ✅ fixed 2026-08-03 (branch S took `body.event.timestamp`, a batched label-event time, while the sheet took the conversation message); history repaired by `sheets-lead-date-backfill` ✅ applied 2026-08-03, 18 leads in 3 clients | branch-parity harness over the committed artifact; SQL exercised in `begin … rollback`; post-write check — 0 of 52 Aimfox leads disagree with their reply | ✅ |

**What's left.** Row 9 is closed on both arms — forward fix deployed and history repaired
(18 leads, verified after the write). Row 8 (`aimfox-import-to-connection`)
remains — it queues real LinkedIn invites,
so a second branch cannot simply be duplicated the way rows 1–7 were; it needs the A1 shadow treatment
(build the intended action, compare, only then wire a real send). Rows 1 and 3 are unproven under real
traffic — both lead-flow branch S builds shipped 2026-07-22 but have not yet processed a live event;
watch the first execution of each before treating them as more than wired-correctly.

---

## Process: per-client sequencer credentials

[Process doc](processes/outreach/bison-ingestion.md) · [ADR-0012](../adr/0012-multi-sequencer-model.md) ·
[ADR-0017](../adr/0017-sheets-to-supabase-dual-write-transition.md)

Per-client vendor API keys are a **credential** move, not a data migration — they leave the CS PDCA
sheet sooner and independently of everything else
([migration-backlog cross-cutting §2](n8n/migration-backlog.md)). Two workflows own it: a 6-hourly
sweep and an edit-driven webhook.

| # | Rule | Tables | RPC | Gateway action | Portal surface | Metric | n8n workflow | Test | State |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A vendor key lives in `client_sequencers.api_key`, not in a spreadsheet | `client_sequencers` | — | — | — | — | `sheets-bison-credential-sync` (sweep) + `sheets-credential-sync-on-edit` (webhook) ✅ | reconciliation query in each README | ⚠️ sheet is still where a human types it (phase A) |
| 2 | A client is matched on the workspace id, never on a name | `client_sequencers` | — | — | — | — | both workflows match `external_workspace_id`; the sweep uses an exact case-insensitive name match **only** to create a row that does not exist | rolled-back dry runs, both READMEs | ✅ |
| 3 | An unresolvable workspace is reported, never guessed | `client_sequencers` | — | — | — | — | `unmatched` / `unmatched_workspaces` in each statement's result | dry run 2026-07-29 returned `999999` | ✅ |
| 4 | A key is written only when it actually differs | `client_sequencers` | — | — | — | — | `api_key IS DISTINCT FROM` in both | `keys_refreshed=0` on the sweep's first live run (execution 50229) | ✅ |
| 5 | Aimfox keys reach Supabase without a manual seed | `client_sequencers` | — | — | — | — | `sheets-credential-sync-on-edit` upserts on `(client_id, sequencer_id)` ✅ (2026-07-29) | dry run: `aimfox_rows_created=1` | ✅ |
| 6 | A new Aimfox row's `external_workspace_id` is left NULL, not invented | `client_sequencers` | — | — | — | — | insert omits the column; only that token's `GET /accounts` knows it | — | ⚠️ must be filled by hand |
| 7 | The credential write path is authenticated | — | — | — | — | — | ⛔ `POST /webhook/credential-sync` is open — [security finding 10](n8n/security.md) | — | ⛔ |

**What's left.** Row 7. Everything else is wired and proven; row 7 is the reason this section is not
green, and it is an instance-config plus Apps-Script change, not a graph change.

---

## Adding a process

1. Write the process document under [processes/](processes/).
2. Add a section here, one row per invariant.
3. If a workflow implements it, register the workflow in
   [automation/n8n/registry.yaml](../../automation/n8n/registry.yaml) and link it in the row.
4. Point the row's Test cell at something that actually runs.
