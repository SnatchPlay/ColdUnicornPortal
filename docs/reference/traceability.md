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
| 8 | Missing routing is visible, never dropped | `ooo_followups`, `client_ooo_routing` | `resolve_ooo_routing`, `record_ooo_followup` | `loadClientOooRouting` | client drawer → OOO routing editor | — | `bison-workspace-setup` fills an EMPTY rule at provisioning (never re-points one, never fills from a `completed`/`stopped` campaign) | `ooo-invariants.sql` | ⚠️ |
| 9 | Routing key is explicit `male\|female\|general` | `client_ooo_routing` | partial unique index | `updateClientOooRouting` | OOO routing editor | — | ⚠️ `ooo-detect-and-log` reads `gender` from a Bison custom variable; `bison-workspace-setup` derives the key from the campaign NAME suffix and drops anything else | — | ⚠️ |
| 10 | Config change recovers parked episodes | `ooo_followups` | `recover_skipped_ooo_followups` | routing editor save | OOO routing editor | — | — | `ooo-invariants.sql` | ✅ |
| 11 | Cancellation preserves history | `ooo_followups` | `cancel_active_ooo_followup` | — | — | — | ⚠️ sibling `ZZ0ughB302WdDJOf` **deletes** the sheet row | `ooo-invariants.sql` | ⚠️ |
| 12 | Positive reply cancels the active episode | `ooo_followups`, `leads` | `promote_contact_to_lead` | — | — | — | ⛔ | `ooo-invariants.sql` | ⚠️ |
| 13 | NRR creates no lead and no `final_outcome` | `replies` | — | — | CRM view | NRR counts | ⛔ **email NRR is implemented nowhere** — `1hHbU2hYYcsktLUP` is managed but has never executed and is now `deprecated`: the classifier's `Category Is Not NRR?` node suppresses the tag, so the HUB gate can never fire. Owner decided 2026-08-15 not to revive it ([C1](n8n/defect-backlog.md#c1)). The rule still holds *vacuously* for email (no NRR row exists to violate it) and is genuinely exercised on **Aimfox**, where `aimfox-classification` writes all 103 NRR replies | `ooo-invariants.sql` | ⚠️ |
| 14 | OOO data is internal-only (never `client` role) | `sequencer_contacts`, `ooo_followups` | `private.can_manage_client` | — | — | — | — | `ooo-invariants.sql` (RLS isolation) | ✅ |
| 17 | A paused OOO campaign is switched back on automatically | `campaigns`, `client_ooo_routing` | — | — | Clients page **OOO** column (what the automation could NOT fix) | — | `bison-ooo-campaign-revive` — daily; resumes only what the VENDOR reports as `paused`, never `archived` (no such endpoint exists: /unarchive and /restore both 404, probed 2026-08-20) | offline harness over the real 2026-08-20 shape: 3 paused, 19 archived, plus stale-key and already-active paths | ⚠️ built, never run |
| 16 | The three OOO campaigns must be `active`, and the portal says when they are not | `campaigns`, `client_ooo_routing` | — | `loadClientOooRouting`, `loadClientsOverview` | Clients page **OOO** column (`live/routed`) + drawer OOO routing warnings | — | `bison-workspace-setup` reports `steps.routing`; nothing alerts — the surface is derived on read | `ooo-health.test.ts` (rank/word), prod baseline 2026-08-19: 0 of 16 Active clients at 3/3 | ⚠️ |
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
| 7a | Per-campaign facts live on the campaign, not on a day | `campaigns` (`invites_sent`, `invites_accepted`, `message_steps`, `metrics_synced_at`) | — | `loadClientsMetricsSummary` | Clients grid — LinkedIn capacity band, Workspaces `Li`/`Lf` | acceptance rate, remaining database (04-metrics §18.3/§18.4) | `aimfox-daily-metrics` branch S UPDATEs the four metric columns; `aimfox-campaign-sync` owns identity / status / `database_size` — disjoint column sets, one row | `aimfox-active-campaigns.test.ts`, `aimfox-capacity-rules.test.ts`; UPDATE exercised against real vendor data locally | ✅ |
| 7b | `sequencer_daily_stats.remaining_database_size` is not read | `sequencer_daily_stats` | — | — | — | — | still written (correctly, since 2026-08-19); the grid derives the number from `campaigns` instead — the daily column subtracted from Aimfox `audience_size`, a fixed vendor ceiling, and ran ~20x high | column comment + contract `@deprecated` | ⚠️ deprecated |
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

## Process: workspace provisioning

[Process doc](processes/ops/workspace-provisioning.md) ·
[ADR-0012](../adr/0012-multi-sequencer-model.md) ·
[ADR-0016](../adr/0016-repository-as-automation-source-of-truth.md)

Bringing one client's Aimfox or Bison workspace from "exists at the vendor" to "fully wired". Two
workflows, one contract, one portal surface. Both write halves exist; only Aimfox's has run against
a vendor with `dry_run: false`.

| # | Rule | Tables | RPC | Gateway action | Portal surface | Metric | n8n workflow | Test | State |
|---|---|---|---|---|---|---|---|---|---|
| 1 | A workspace belongs to exactly one client | `client_sequencers` | — | — | — | — | candidate list subtracts every `external_workspace_id` already stored, any client, any sequencer | execution `70393`: 12 workspaces − 9 claimed = 3 offered | ✅ |
| 2 | A workspace is never assigned on a guess | `client_sequencers` | — | — | — | — | resolution is explicit → stored → **exact** name → `needs_selection` | `70393` (Bent Iron PL) before/after the `stored` fix | ✅ |
| 3 | Provisioning is idempotent — read before every write | — | — | — | — | — | both workflows | ✅ Aimfox `70489` created FortumEnergia's missing `preMQL`; `70490`, same input, created nothing | ✅ Aimfox · ⚠️ Bison write path never exercised — no Active workspace is missing a canonical tag |
| 4 | A webhook is identified by `url` + `events`, never by name | — | — | — | — | — | both workflows | proven twice independently: Aimfox GIC `Manual Tag`, Bison UniTalk `Reply Classification` | ✅ |
| 5 | The canonical set is closed, and differs per vendor | — | — | — | — | — | Aimfox: `preMQL` + `MQL` + `AutoConnect`; Bison: `preMQL` + `OOO` + the three `OOO automation` campaigns | measured 2026-08-07 — 9 Aimfox workspaces, 16 Active Bison; Bison `MQL` 7/16 and not a gap | ✅ |
| 9 | Provisioning creates containers, never content | — | — | — | — | — | Bison creates a campaign as a `draft` + schedule; `sequence-steps` is never POSTed and no campaign is started | offline run of the committed code nodes, 8 scenarios, 2026-08-14 | ⚠️ never run against a vendor |
| 10 | A campaign provisioning created is routable the moment it exists | `campaigns.type` | — | `loadClientOooRouting` / `upsertClientOooRouting` (unchanged) | OOO routing editor | — | `Record` seeds `type = 'ooo_followup'`; the sync owns `name`/`status` and never touches `type` | `created_campaigns` payload asserted offline 2026-08-14 (`[]` on dry run, 2 of 3 after a vendor rejection); the whole `Record` statement plans clean against production (`EXPLAIN`, 2026-08-19) with `campaigns_external_id_key` as the arbiter on both campaign CTEs | ⚠️ never written against a database |
| 11 | A routing rule is created, never re-pointed | `client_ooo_routing` | — | `updateClientOooRouting` owns every later change | drawer OOO routing section | — | `routed` CTE: `WHERE NOT EXISTS (… AND is_active)` + `ON CONFLICT (client_id, routing_key) WHERE is_active DO NOTHING`, and `status NOT IN ('completed','stopped')` | simulated read-only against production 2026-08-19 — UniTalk (3 occupied rules) yields 0 writable rows, Gbbc (3 empty rules, 3 `completed` campaigns) yields 0 after the status predicate | ⚠️ never written against a database |
| 6 | The result the portal shows is the result of a real run | `client_sequencers.setup_state` | — | rides on `loadClientsOverview` ✅ (no new action needed) | Clients page **Workspaces** column + drawer section ✅ | — | `dry_run` returns the same `steps` as a live run | screenshotted in both roles 2026-08-08; migration live since PR #28 and a post-merge run returned `recorded: true` | ✅ |
| 7 | A master key never leaves n8n | — | — | `requestWorkspaceSetup` ✅ built | **Check** / **Set up** ✅ built | — | gateway calls n8n, never a vendor; result stripped of `api_key`/`token` at the boundary | contract forbids it (`additionalProperties: false`) + explicit delete in the handler; a live response was scanned for `api_key`/`token` and had none | ⚠️ webhook is UNAUTHENTICATED by decision — knownViolations, review 2026-11-30 |
| 8 | No terminal path is silent | — | — | — | — | — | `client_not_found` + `alwaysOutputData` on Resolve Client | added after a run ended `success` with no output | ✅ |

**What's left.** Row 7's authentication, and exercising the Bison write path — which needs a workspace that is actually missing something, and none of the 16 Active ones is. It will first run for real on a new client.

**Found by running it, out of scope to fix here.** Both belong to other processes and are recorded
in the [process document](processes/ops/workspace-provisioning.md):

| Finding | Where it belongs |
|---|---|
| `public.campaigns` keeps campaigns the vendor no longer has — `bison-campaign-sync` is `INSERT … ON CONFLICT DO UPDATE` with no removal path, so Bent Iron PL shows six OOO campaigns where workspace 73 has three | [Bison ingestion](processes/outreach/bison-ingestion.md) |
| ~~`bison-campaign-sync` could never write `ooo_followup`~~ — **fixed 2026-08-14.** The string was absent from the workflow, so every OOO campaign arrived as `nurture` (unroutable) or `outreach` (client-visible, 25 of them). Now classified by name at insert time, in the sync, and seeded directly by `bison-workspace-setup` for the campaigns it creates. `type` stays out of the `ON CONFLICT` list on both sides | [Bison ingestion](processes/outreach/bison-ingestion.md) |
| `typeMap[c.type] \|\| 'outreach'` — an unrecognised Bison campaign type still defaults to the one type clients can see. No longer affects OOO campaigns (name match wins), so this is about everything else; `nurture` is the right default. Open | [Bison ingestion](processes/outreach/bison-ingestion.md) |
| `campaigns.positive_responses` is overwritten hourly from Bison's `interested`, while [04-metrics-catalog §](functional/04-metrics-catalog.md) calls it user-editable and the gateway accepts a patch for it. A portal edit survives at most an hour. Open | [Bison ingestion](processes/outreach/bison-ingestion.md) |
| ~~`client_ooo_routing` has three rows pointing at another client's campaign — all FortumEnergia → GIC~~ — **closed.** `client_ooo_routing_campaign_same_client_fkey (campaign_id, client_id) → campaigns(id, client_id)` makes the row uninsertable; re-measured 2026-08-19, 0 cross-client rows | [OOO follow-ups](processes/outreach/ooo-followups.md) |
| The Clients page **OOO** column inherits the sync's missing removal path: a campaign deleted at the vendor keeps its last status here forever, so a rule pointing at a ghost scores as live. Bounded — 3 rows, all Bent Iron PL — and fixed only by giving the sync a removal path | [Bison ingestion](processes/outreach/bison-ingestion.md) |
| `ooo-enrol-followups` still joins `campaigns` with no `status` predicate: 80 `pending` episodes target a `stopped` (50) or `completed` (30) campaign as of 2026-08-19. Deliberately **not** fixed alongside the health surface — owner's call — because the natural fix (`resolve_ooo_routing` gaining `status='active'`) would reclassify 22 live rules across 12 clients as a side effect of a UI change | [OOO follow-ups](processes/outreach/ooo-followups.md) |

---

## Adding a process

1. Write the process document under [processes/](processes/).
2. Add a section here, one row per invariant.
3. If a workflow implements it, register the workflow in
   [automation/n8n/registry.yaml](../../automation/n8n/registry.yaml) and link it in the row.
4. Point the row's Test cell at something that actually runs.
