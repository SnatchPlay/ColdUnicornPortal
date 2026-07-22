# n8n migration backlog

Inventory re-taken 2026-07-22 (evening): **37 workflows, 29 active, 18 managed, 19 orphan.**
(Managed: the four OOO/NRR workflows of §1, `[child-1]` lead enrichment, all five Aimfox workflows of
§5, the four Bison ingestion workflows of §3, the failure recorder, the credential sync of §8, and
the two completed backfills of §9.)

> **Read [§0 · where this stands](#0--where-this-stands) first if you are picking this up fresh.**

Reproduce with `pnpm n8n:inventory`.

Priority is by *risk*, not by convenience: a workflow that blocks a migration or contradicts an ADR
comes before one that is merely undocumented.

---

## 0 · Where this stands

The state of the migration in one table. Everything here is measured against production, not planned.

| Process | Phase | Evidence |
|---|---|---|
| OOO / NRR (§1) | **A, live** — all four workflows call the RPCs | `ooo_followups` still 0 rows; see the open gap below |
| Bison ingestion (§3) | **C** — Supabase-only by construction | repaired 2026-07-22 after days of silent failure |
| Bison lead enrichment (§2) | **A, live** — branch S writes leads via `promote_contact_to_lead` | credentials no longer come from Sheets |
| Aimfox metrics (§5) | **A, live** — branch S writes `sequencer_daily_stats` per account | execution 50246 |
| Aimfox lead flows (§5) | **0** — nothing reaches Supabase | blocked on `sequencer_contacts` for LinkedIn |
| Bison credentials (§8) | **A, live** — synced every 6 hours | 39 of 42 workspaces keyed |
| Historical import (§9) | **done** | 184 leads, 117 Aimfox client-days |

**The three things most worth doing next**, in order:

1. **Chase the OOO episode gap.** Contact and reply rows are written; `ooo_followups` is still empty
   and the RPC is verified working. Something between them fails silently. This is the oldest
   unexplained defect in the estate — §1.
2. **Give LinkedIn contacts an identity.** `sequencer_contacts` has 0 aimfox rows, `campaigns` has 0
   aimfox rows. Until both exist, neither Aimfox lead flow can move off phase 0, and the 30
   back-filled Aimfox leads keep a NULL `campaign_id` — §5.
3. **Delete the sheet fallback in `bison-lead-enrichment`.** It exists only because SalesBook, Tryumf
   and Kamiński have no `clients` row. That is a business act, not an automation one — §8.

**Do not** build a recurring Sheets → Supabase sync for leads or stats. Two one-off backfills covered
the history; a standing sync would race branch S — [reconciliation](../processes/outreach/sheets-supabase-reconciliation.md).

---

## 1 · OOO cutover

**Priority: highest. Blocks a deferred migration and 13 rows of the traceability matrix.**

[ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md) shipped the whole OOO model —
tables, RPCs, RLS, ~70 invariant assertions — on 2026-07-21. **Automation has not cut over.** OOO
state still lives in the `OOO Leads` Google Sheet; `ooo_followups` has 0 rows in production.

Migration is by **dual-write**, not replacement
([ADR-0017](../../adr/0017-sheets-to-supabase-dual-write-transition.md)). Every row below **keeps its
sheet write** and **adds** the Supabase one; the sheet stops only at phase C, once nothing reads it.

| Remote | Name | Supabase side to add | Sheet side |
|---|---|---|---|
| `O4DqMEu1Z9LcxikE` | `[child-3] TAG_ATTACHED · OOO · Detect return date and log` | `upsert_sequencer_contact` → `upsert_reply` → `record_ooo_followup` | kept; must first become append-or-**update** on a stable key |
| `ZZ0ughB302WdDJOf` | `[child-7] TAG_REMOVED · OOO · Remove from OOO Leads` | `cancel_active_ooo_followup` (cancels, never deletes) | kept — note the semantic gap: the sheet **deletes**, Supabase **cancels and keeps history** |
| `zaPkpSAuvjibUUDU` | `Add OOO Leads` (scheduled re-enrolment) | the worker: `claim_ooo_followup` → attach → `mark_ooo_submitted` / `mark_ooo_failed` | kept; **reads** the sheet in phase A, reads `ooo_followups` from phase B |
| `1hHbU2hYYcsktLUP` | `[child-2] TAG_ATTACHED · NRR · Daily stats` | `upsert_reply` with `NRR`; no lead, no episode | kept |

The `leads` write in child-3 is **not** part of dual-write — it is removed. A second store does not
license bypassing the RPC contract (ADR-0015 §5), and it has never landed a row.

**Blocking, in order:**

1. **Resolve the open question in
   [`ooo-detect-and-log/README.md` defect 9](../../../automation/n8n/workflows/outreach/ooo-detect-and-log/README.md#known-defects).**
   The two output branches read the LLM node with incompatible shapes. If the sheet's
   `$json.expected_return_date` is also undefined, every OOO contact has silently been scheduled at
   `today + 14` and the gpt-5-mini extraction is decorative. Check the sheet before porting any
   extraction logic, or the cutover will faithfully reproduce a broken behaviour.
2. Decide the oldest-vs-newest reply question (defect 8): `[326]` deliberately takes the **oldest**
   reply. For a repeat OOO that is almost certainly wrong.
3. ~~Move per-client Bison API keys from the CS PDCA sheet to `client_sequencers.api_key`~~ —
   **done for the data (§8)**, and done for `bison-lead-enrichment`. The four OOO/NRR workflows still
   read `col_6` and must be repointed at `[S0]`-style resolution before their sheet reads can go.
4. Make the sheet append **idempotent** (append-or-update on `LeadID` + `ReplyID`). Precondition for
   phase A: two stores with different duplicate behaviour diverge by construction.
5. Add the Supabase side to the four workflows — Sheets first, Supabase second, Supabase failure
   non-fatal and logged to `integration_sync_runs`. This is **phase A**.
6. Remove the direct `leads` write, then apply
   [`20260722z_drop_legacy_ooo_columns.sql`](../../../supabase/migrations/deferred/20260722z_drop_legacy_ooo_columns.sql).
   Unblocked by phase A — no phase writes the legacy lead columns.
7. Build the reconciliation (sheet rows vs `ooo_followups`, compared on the natural key) and run it
   until the two agree. Parity is the entry condition for **phase B**; record the number in the manifest.
8. Backfill the sheet's open absences into `ooo_followups`, or accept starting empty — a product
   decision, not a technical one. Note it proves the data copies, not that the write path works, so
   it belongs after phase A rather than instead of it.
9. **Phase C** only once the sheet has no readers left — including the dashboards and reports built
   on it, which are outside this repository.

**Accepted violations expire 2026-10-31.** After that, `pnpm n8n:validate` fails.

**Risk if not done:** the legacy columns cannot be dropped; invariants 4, 5, 6 and 8 remain
unenforced; OOO data stays outside RLS in a shared spreadsheet.

---

## 2 · HUB dispatcher

**Priority: high — security-relevant, and the parent of everything in §1.**

| Remote | Name |
|---|---|
| `xPzdtWQiY3lGtqI1` | `[HUB] Bison Replies Dispatcher` |

The entry point for **all** reply processing: an `n8n-nodes-base.webhook` normalizes the Bison
payload and fans out to seven children. Import it next, because:

- it defines the payload contract every child depends on — currently reverse-engineered in
  [`hub-child-input.schema.json`](../../../automation/n8n/workflows/outreach/ooo-detect-and-log/contracts/hub-child-input.schema.json)
  and enforced by nothing at runtime;
- its webhook authentication is **unverified**
  ([security.md §3](security.md#3-the-hub-webhook-is-the-entry-point-for-all-reply-processing--medium)).
  `scan.mjs` will answer this the moment it is imported.

Children not covered by §1: `bEB3aOHEq2lEpubp` (child-4, blacklist add), `FZSFz5bcgigUneQZ`
(child-5, unblacklist), `wJZbg0cRsdF58ylE` (child-6, MQL delete + unblacklist).

**child-1 is done.** `lBOyL8ZPA3SZSvDW` was imported as
[`bison-lead-enrichment`](../../../automation/n8n/workflows/outreach/bison-lead-enrichment/README.md)
and reached **phase A** on 2026-07-22: a five-node branch S writes the contact, the reply and the
lead through `upsert_sequencer_contact` → `upsert_reply` → `promote_contact_to_lead`. That is the
first caller `promote_contact_to_lead` has ever had.

It also turned out to contain **31 orphaned Supabase nodes** — an unfinished branch that was never
wired to its trigger, whose root selects a dropped column, and which writes `leads` directly in
violation of ADR-0015 §5. Recorded as an accepted violation expiring 2026-09-30; the right fix is
deletion, which is a human's call.

child-6 still **deletes** leads and is worth questioning against
[ADR-0004](../../adr/0004-lead-state-boundaries.md).

---

## 3 · Ingestion workflows already documented in `11-integrations`

**Priority: medium.** These write ingestion-only tables the portal reads, so their contracts are
already documented — importing them mostly means proving doc and reality agree.

| Remote | Name | Documented at |
|---|---|---|
| `yjztuv4q07uysvkA` | `Winnr Daily Sync - Supabase v2` | §2 `email_accounts`, `email_account_warming_daily`, `domains` |
| `oF6fP3ea2zglhAop` | `Winnr Sync - Error Handler` | §2 `integration_sync_runs` |
| `sVev5d0N6rtrbcgI` | `Get Metrics from Aimfox` | §2 `sequencer_daily_stats` — **imported**, see §5 |
| `8uRWXHe9FIfglq1u` | `Get Winnr Domains` (inactive) | §2 |
| `AEgpCGoSpiZ7PA90` | `Bison campaign daily stats` | **imported** — [`ingestion/bison-campaign-daily-stats`](../../../automation/n8n/workflows/ingestion/bison-campaign-daily-stats/README.md) |
| `amJdB2eGXxUNyCPY` | `Bison daily stats population` | **imported** — [`ingestion/bison-daily-stats-population`](../../../automation/n8n/workflows/ingestion/bison-daily-stats-population/README.md) |
| `BQbFKHUaIcEKPc01` | `Daily Stats Process` | **imported** — [`ingestion/bison-daily-stats-process`](../../../automation/n8n/workflows/ingestion/bison-daily-stats-process/README.md) |
| `UXpSOrgsN2TxjXUu` | `Bison campaign sync` | **imported** — [`ingestion/bison-campaign-sync`](../../../automation/n8n/workflows/ingestion/bison-campaign-sync/README.md) |

**The ADR-0012 sequencer cutover had NOT happened, and it was a live outage.** This entry asked
"nobody has verified that they did" — the answer, found 2026-07-22, is that all three top-level Bison
workflows had been failing every run on the dropped `clients.external_*` columns. `daily_stats` was
stale since 2026-07-20 and `campaign_daily_stats` since 2026-07-19, with nothing surfacing it.

Repaired and imported the same day; the incident, the remaining 2026-07-21 hole and the EvidencePrime
gap are written up in [process · Bison ingestion](../processes/outreach/bison-ingestion.md). The
remaining Winnr workflows in this group are still unverified against the same question.

---

## 4 · CRM sync

**Priority: medium.** Crosses into the legacy CRM Supabase project ([ADR-0010](../../adr/0010-legacy-crm-integration.md)).

`mfmMYQqK73Nsx6uO` (`[HUB] CRMs Add/Update Lead Dispatcher`) plus five children:
`mqReFD2sIBP7MsVJ` HubSpot · `eljNaDBmHqDSMkm9` LiveSpace · `S33uaGcmtIjcE1bw` Pipedrive ·
`Lisejns90BSzGfUi` Salesforce · `am3gYNrZSTbrkRFa` Zoho. Also `JpjMC7rj6pfd6FVH` (`Get Zoho Lead`,
inactive).

A clean dispatcher + per-provider-child pattern; likely the best-structured group on the instance.

---

## 5 · Aimfox / LinkedIn

**Priority: high. All five imported 2026-07-22; both critical secret findings closed.
`aimfox-daily-metrics` reached phase A the same day — branch S writes `sequencer_daily_stats`, one
row per LinkedIn account. The other four are still phase 0.**

The whole channel is now described in one place:
[process · LinkedIn outreach (Aimfox)](../processes/outreach/linkedin-aimfox.md).

| Remote | Name | Repository state |
|---|---|---|
| `sVev5d0N6rtrbcgI` | `Get Metrics from Aimfox` | **imported** — [`ingestion/aimfox-daily-metrics`](../../../automation/n8n/workflows/ingestion/aimfox-daily-metrics/README.md) |
| `nG6Q4KEGeXk7tBHm` | `Import leads to Aimfox connection` | **imported** — [`outreach/aimfox-import-to-connection`](../../../automation/n8n/workflows/outreach/aimfox-import-to-connection/README.md) |
| `JnvRBXtRNar7ejeM` | `AimFox Classification` | **imported** — [`outreach/aimfox-classification`](../../../automation/n8n/workflows/outreach/aimfox-classification/README.md) |
| `4OjNRWLaG2IWK6kd` | `AimFox Leads Processing` | **imported** — [`outreach/aimfox-leads-processing`](../../../automation/n8n/workflows/outreach/aimfox-leads-processing/README.md) |
| `s0GqDtCzyLAvVnm1` | `preMGL tag added (Aimfox) -> Add lead to PDCA` | **imported** — [`outreach/aimfox-premql-to-pdca`](../../../automation/n8n/workflows/outreach/aimfox-premql-to-pdca/README.md) |

Those three were unreachable until 2026-07-22: `pnpm n8n:export` refuses a file the scanner rejects
(security.md layer 4), so the most security-sensitive workflows in the family were the ones the
repository could not see. Moving their literals into the `Aimfox Master` and `OpenAi account`
credentials closed that.

**The channel is phase 0.** Not one of the five contains a Postgres node or a Supabase URL. Meanwhile
`sequencers` has an `aimfox` row, `client_sequencers` carries the token field, and
`sequencer_daily_stats` was designed *by reading* `Get Metrics from Aimfox`
([`20260705`](../../../supabase/migrations/20260705_sequencer_daily_stats_schedule.sql)). The model is
specified and unused. [11-integrations §2](../functional/11-integrations.md) described that row as a
live write until this inventory corrected it.

**Blocking, in order:**

1. ~~Move the two leaked secrets into n8n credentials and import the three blocked workflows~~ —
   **done 2026-07-22** (findings 7 and 8). Rotating the old values in Aimfox and OpenAI is still
   outstanding and is the owner's step.
2. **Authenticate the two Aimfox webhooks** (`aimfox-classifier`, `preMQL-Aimfox`) — finding 3.
   **Open.**
3. ~~Seed `client_sequencers` for aimfox~~ — **done 2026-07-22**: five clients, `api_key` from CS
   PDCA `col_105` and `external_workspace_id` read from each token's own `GET /accounts`. FitMech has
   no workspace id (no LinkedIn account connected); EvidencePrime had no `emailbison` row at all and
   was resolved by name.
4. ~~Phase A on the capacity flow first (`aimfox-daily-metrics`)~~ — **done 2026-07-22.** Branch S is
   fully parallel (own client resolution, own Aimfox calls) and fixed **four** defects rather than
   three: the fourth, a lying leading bucket in the interactions series, was found by probing the API
   and is invisible in the code. One question is deliberately left open — the per-account
   interactions filter is unverified, so branch S writes nothing for a client with more than one
   LinkedIn account. Re-probe before a second account appears
   ([README](../../../automation/n8n/workflows/ingestion/aimfox-daily-metrics/README.md)).
5. **Then the lead flows.** `4OjNRWLaG2IWK6kd` and `s0GqDtCzyLAvVnm1` create leads — check against
   invariants 1–3 of the process doc before any cutover, and note that neither can store a contact
   identity today, so `sequencer_contacts` comes first.
6. **`aimfox-import-to-connection` last.** It POSTs to a campaign audience, which queues LinkedIn
   invites to real people — the A1 shadow case ([ADR-0017 §1b](../../adr/0017-sheets-to-supabase-dual-write-transition.md)).
   Its idempotency claim is **unverified**: nobody has tested whether the audience endpoint ignores a
   profile it already holds.

**Risk if not done:** a master credential and an OpenAI key stay in plaintext on the instance; two
open webhooks can drive blacklisting; and the LinkedIn channel contributes nothing to any portal
metric, because none of its data exists in the database.

---

## 6 · Reply classification

**Priority: medium.** `XdTMd1KJX0cRmF9u` — `Bison Replies Classification - Sheets Primary 401
Fallback`.

The name states the problem: **Sheets is primary.** It produces the `replies.classification` values
that [11-integrations §6](../functional/11-integrations.md#6-reply-classification) treats as the live
contract, and ADR-0015 chose not to rename that enum precisely because it is the live contract. Worth
importing before anything depends further on it.

---

## 7 · Housekeeping — delete or claim

**Priority: low, but cheap.**

| Remote | Name | Note |
|---|---|---|
| `VaHl6jl0ZOYpeBWG` | `My workflow` | inactive, unnamed, `availableInMCP: false` |
| `EXHqX33z4ub9ie5n` | `My workflow 2` | inactive, unnamed, `availableInMCP: false` |
| `zpv962y3zIf2aqSS` | `Make.com get` | inactive — residue of the Make → n8n move? |
| `rftk2VS5tXWQ0TFW` | `Add team member to workspace` | inactive, ops utility |

Each is either dead or undocumented. Deleting requires an explicit decision
([environments.md](environments.md)) — but leaving unnamed workflows on a production instance makes
every future inventory noisier.

---

## 8 · Bison credentials out of the spreadsheet

**Priority: high — a precondition for every other cutover, and security finding 1.**

| Remote | Name | State |
|---|---|---|
| `Hzar4pwdAXrDHAwn` | `[CRED] CS PDCA → client_sequencers · Bison keys` | **active**, every 6 hours |

Per-client Bison keys lived only in CS PDCA `col_6`. Every Bison call in the estate read them from
there, which meant the whole pipeline died the moment Sheets was disconnected — a dependency that
survived even after `bison-lead-enrichment` grew a "parallel" branch S, because branch S sat
downstream of API calls the sheet was authenticating.

Done 2026-07-22: the sync, plus `[S0] Resolve Bison credentials` in `bison-lead-enrichment`, where
all eight Bison `Authorization` headers now read `client_sequencers.api_key`.

**Remaining:**

1. **Three clients have no `clients` row at all** — SalesBook, Tryumf, Kamiński. Until they exist the
   guarded sheet fallback cannot be deleted. A business act.
2. **`RedIntoGreen DAPR` (workspace 149) does not match the client named `DAPR`.** The sync refuses to
   guess; someone must confirm they are the same client.
3. **Repoint the four OOO/NRR workflows** the same way — they still read `col_6`.
4. **Aimfox keys have no sync.** They were seeded once by hand for five clients.

---

## 9 · Historical import from Sheets — done, do not repeat

**Priority: closed.** Recorded because the *shape* matters more than the result.

| Remote | Name | Result |
|---|---|---|
| `KoLN4bU7qe7RwnGT` | `[BACKFILL] Sheets → Supabase · leads` | 184 leads (30 Aimfox); `leads` 4787 → 4971 |
| `YLfQZBprSRIT6hLm` | `[BACKFILL] Sheets → Supabase · Aimfox daily metrics` | 117 client-days; the first rows `sequencer_daily_stats` ever held |

Both are `deprecated` and deactivated. **Do not turn either into a recurring sync** — branch S of
`bison-lead-enrichment` owns new leads through `promote_contact_to_lead`, and a second writer would
race it.

Two findings worth keeping:

- **The five "empty" outcome columns of `daily_stats` are not a broken sync.** `mql_count`, `me_count`,
  `won_count`, `negative_count` and `prospects_in_base` are empty in the *sheet* too — `WON` is
  non-zero in none of its 6734 rows. Nothing computes them on either side. Deriving them from `leads`
  is the honest fix; syncing is not.
- **`ooo_count` in `daily_stats` is a mislabelled copy of `automated_replies_count`.** The Bison
  worker computes it from the automated-replies total and fetches no OOO at all.

Still not imported, deliberately: **1583 `daily_stats` rows for 30 churned workspaces.** Nothing in
the workbook maps a retired workspace id to a client, so attribution would be guesswork
([reconciliation](../processes/outreach/sheets-supabase-reconciliation.md)).

---

## Cross-cutting

1. **No development instance.** The single highest-value fix: without it, no cutover in this backlog
   can be built or tested without touching production.
2. **Google Sheets is a load-bearing data store** — CS PDCA (credentials + client config), OOO Leads
   (OOO state), Daily Stats (counters), plus the dashboards and reports the agency actually uses.
   This is the system the portal is replacing, and it is migrated **by dual-write**, process by
   process ([ADR-0017](../../adr/0017-sheets-to-supabase-dual-write-transition.md)) — not deleted.
   [ADR-0001](../../adr/0001-live-supabase-source-of-truth.md) is unaffected: it governs what the
   *portal* reads, and the portal never reads a spreadsheet in any phase.
   The one exception is **credentials** — per-client API keys in CS PDCA are not business data and
   move to `client_sequencers.api_key` independently, and sooner.
3. ~~**No error handling outside the Winnr flows.**~~ **Closed 2026-07-22.**
   [`automation-failure-recorder`](../../../automation/n8n/workflows/ops/automation-failure-recorder/README.md)
   is bound as `settings.errorWorkflow` on every managed workflow and writes one
   `integration_sync_runs` row per failed execution. It is a floor, not a ceiling: it fires on
   **workflow** failure, so a node with `onError: continueRegularOutput` still fails silently — which
   is most of the ingestion HTTP nodes. The 20 orphan workflows are still unbound.
4. **Idempotency is mostly undocumented**, and in the OOO path absent.
