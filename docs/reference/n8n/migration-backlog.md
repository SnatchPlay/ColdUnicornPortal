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
| OOO / NRR (§1) | **A, live** — all four workflows call the RPCs | 66 `ooo_followups` rows (2026-07-22) — the "0 rows" gap had already closed; the real defect found instead: 100% had `date_source='fallback'` even when the LLM found a real date (accessor bug, fixed 2026-07-22) |
| Bison ingestion (§3) | **C** — Supabase-only by construction | repaired 2026-07-22 after days of silent failure |
| Bison lead enrichment (§2) | **A, live, independent** — branch S writes leads via `promote_contact_to_lead` on its own Bison/Snov.io/Lusha/OpenAI calls | repaired 2026-07-22: branch L reverted to CS PDCA col_6, branch S given its own data-fetch chain — neither branch's credential resolution references the other |
| Aimfox metrics (§5) | **A, live** — branch S writes `sequencer_daily_stats` per account, every 2h | execution 50246; runs verified successful through 17:00 on 2026-07-22. **Completeness verified 2026-07-22**: backfill captured all 118 sheet candidates (117 written, UniTalk's 1 day accepted-as-lost); 3 garbage `__workspace_total__` overlap rows for 07-22 deleted; date gaps confirmed as zero-activity days by the backfill's own filter. Residual: a live sheet↔Supabase Aimfox diff can't be run from a headless session (public n8n REST can't execute a workflow) — only needed if paranoid about the zero-activity gaps before the sheet is deleted |
| Aimfox classification (§5) | **A, live** — branch S writes `sequencer_contacts` + `replies` | shipped 2026-07-22, execution 50518 — real inbound reply, verified end to end |
| Aimfox lead flows (§5) | **A, live** on both — `aimfox-premql-to-pdca` and `aimfox-leads-processing` write `leads` via `promote_contact_to_lead` | shipped 2026-07-22; campaign attribution resolved for both (see item 2 below), not yet exercised by a real production execution |
| Bison credentials (§8) | **A, live** — synced every 6 hours | 39 of 42 workspaces keyed |
| Historical import (§9) | **done** | 184 leads, 117 Aimfox client-days |

**The three things most worth doing next**, in order:

1. ~~Chase the OOO episode gap~~ — **turned out to already be closed, then a real bug was found and
   fixed in its place (both 2026-07-22).** `ooo_followups` was not stuck at 0 — 66 rows existed by the
   time this was re-checked against production rather than trusted from the earlier note. What *was*
   broken, and confirmed on real data: `[S] record_ooo_followup` and branch L's `[327] Add OOO Leads
   row` both read the gpt-5-mini return-date extraction at the wrong JSON path
   (`$json.returnDate`/`$json.expected_return_date`, flat) — the real value nests at
   `output[0].content[0].text.{returnDate|return_date}`. Result: **100% of the 66 rows had
   `date_source='fallback'`, including runs where the LLM had demonstrably returned a real date.** Not
   "correctly falling back when the AI found nothing" — the AI's answer was silently discarded every
   time, on both branches. Fixed on both consumers — see
   [`ooo-detect-and-log/README.md` defect 9](../../../automation/n8n/workflows/outreach/ooo-detect-and-log/README.md#known-defects).
   Proven on the first real event after the fix (execution 51232, 13:49 UTC): LLM returned
   `"2026-07-24"` on both branches, the sheet got the real date instead of the today+14 fallback, and
   `ooo_followups` got its first-ever `date_source='reply_parsed'` row.
2. ~~Give `campaigns` aimfox rows~~ / ~~task B attribution~~ — **both done 2026-07-22.** The catalog
   ([`aimfox-campaign-sync`](../../../automation/n8n/workflows/ingestion/aimfox-campaign-sync/README.md),
   `t6a53dLc85FOKFqX`) exists, and attribution turned out not to need the reply→lead bridge design this
   entry called for: `aimfox-premql-to-pdca`'s `GET lead info Aimfox` response carries
   `lead.origins[0].id` (the same campaign UUID the catalog keys on — verified against a real execution),
   and `aimfox-leads-processing`'s webhook body carries `event.campaign.id` directly. Both lead flows'
   branch S resolve a real `campaign_id` now — §5.
3. ~~Delete the sheet fallback in `bison-lead-enrichment`~~ — the three missing `clients` rows
   (SalesBook, Tryumf, Kamiński) now exist, and `RedIntoGreen DAPR`'s `client_sequencers` row points at
   the existing `DAPR` client (done 2026-07-22). The fallback itself is still in the graph — remove it
   once `sheets-bison-credential-sync`'s next run confirms all three are keyed — §8.

**Do not** build a recurring Sheets → Supabase sync for leads or stats. Two one-off backfills covered
the history; a standing sync would race branch S — [reconciliation](../processes/outreach/sheets-supabase-reconciliation.md).

---

## 1 · OOO cutover

**Priority: highest. Blocks a deferred migration and 13 rows of the traceability matrix.**

[ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md) shipped the whole OOO model —
tables, RPCs, RLS, ~70 invariant assertions — on 2026-07-21. Automation cut over the same week: all
four workflows below call the RPCs, and `ooo_followups` carries 66 rows as of 2026-07-22 (this line
previously said "0 rows" — stale, corrected after re-checking production directly). OOO state still
lives in the `OOO Leads` Google Sheet too, unchanged — that's branch L, by design, not a gap.

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

1. ~~Resolve the open question in
   [`ooo-detect-and-log/README.md` defect 9](../../../automation/n8n/workflows/outreach/ooo-detect-and-log/README.md#known-defects)~~
   — **checked and fixed 2026-07-22.** It was the worse of the two possibilities: not "the AI
   genuinely finds nothing, so today+14 is a correct fallback," but the LLM's real answer being
   silently discarded on **every single event** because both consumers (`[327]` on branch L, `[S]
   record_ooo_followup` on branch S) read a flat field that never existed in the response shape. Proof
   pulled from real execution data, not inferred: of 66 `ooo_followups` rows, 100% were
   `date_source='fallback'`, including runs where the LLM had returned a real date. Fixed on both
   consumers by reading the correct nested path.
2. ~~Decide the oldest-vs-newest reply question (defect 8)~~ — **fixed 2026-07-22.** Branch L's
   `[326]` sorted ascending and fed the LLM the *oldest* reply; for a repeat OOO that is the wrong
   message. Flipped the comparator to descending and renamed the node "Set last_reply (**newest** by
   date_received)", matching branch S's `[S] Pick newest OOO reply` (already correct). PUT to
   production and verified live; committed artifact updated by hand and confirmed byte-identical to the
   live graph (`pnpm n8n:export` was blocked — see the `availableInMCP` note below). Detail:
   [`ooo-detect-and-log/README.md` defect 8](../../../automation/n8n/workflows/outreach/ooo-detect-and-log/README.md#known-defects).
3. ~~Move per-client Bison API keys from the CS PDCA sheet to `client_sequencers.api_key`~~ —
   **done, including the four OOO/NRR workflows.** This entry was stale: checked all four against a
   fresh production `GET` (2026-07-22), not assumed. Each already resolves branch S's own Bison
   auth from `client_sequencers.api_key` via its own `[S] Resolve client sequencer` node (which returns
   `api_key` directly — no separate token-wrapping step needed) — `ooo-detect-and-log` and
   `nrr-daily-stats` each make their own `[S]`-prefixed Bison calls with it;
   `ooo-remove-on-tag-removed`'s branch S needs no Bison call at all (resolves the contact straight
   from Postgres — a sticky note in the workflow explains why a call would be "worse, not more
   faithful"); `ooo-enrol-followups`'s branch S is an A1 shadow that also makes no Bison call, by
   design. **`col_6` is read only by branch L** in the two workflows that use it at all
   (`ooo-detect-and-log`, `ooo-remove-on-tag-removed`) — unchanged, sheet-authenticated, exactly as
   intended. No coupling in either direction.
4. ~~Add the Supabase side to the four workflows~~ — **done.** All four call the ADR-0015 RPCs; see
   item 3. `onError: continueRegularOutput` throughout, confirmed on every `[S]` node.
5. ~~Remove the direct `leads` write, then apply
   [`20260722z_drop_legacy_ooo_columns.sql`](../../../supabase/migrations/20260722z_drop_legacy_ooo_columns.sql)~~
   — **done 2026-07-22.** Direct write was already gone (`ooo-detect-and-log` had no such node).
   Portal/gateway read-side removed the same day — `contact_disposition` / `expected_return_date` /
   `added_to_ooo_campaign` deleted from `LeadRecord`, the drizzle schema, every `orm-gateway`
   mapper/SELECT, the CRM "Disposition" column, and the `replyScope` OOO filter; `OOO`/`NRR` removed
   from the `lead_qualification` union + enum. Deploy order followed exactly: `orm-gateway` redeployed
   first (confirmed by the user), then the migration dry-run (`begin`/`rollback`, clean), then applied
   for real via the Management API. Verified against production: the three columns and
   `client_ooo_routing.gender` are gone, the enum holds exactly 7 values (no `OOO`/`NRR`),
   `public_lead_stats()` returns real numbers, and the exact `orm-gateway` SELECT shape runs clean
   against live data. Migration file lives in `migrations/`, not `deferred/`, going forward.
6. ~~Build the OOO reconciliation (sheet rows vs `ooo_followups`)~~ — **decided 2026-07-22: not
   building.** The `OOO Leads` sheet is being disconnected within the week; it holds **secondary** OOO
   data (the authoritative episode record is `ooo_followups`, written by branch S since 2026-07-22).
   Standing up a probe just to compare a store that is about to disappear is wasted effort. Formal
   parity was the paper entry condition for phase B, but with the sheet retired that gate is moot —
   branch S simply becomes the only writer. `transition.reconciliation` / `parityEvidence` stay `null`;
   phase advances by the sheet going away, not by a measured comparison. **Do not re-raise.**
7. ~~Backfill the sheet's open absences into `ooo_followups`~~ — **decided 2026-07-22: not backfilling.**
   Same objection as the leads backfill in
   [`sheets-supabase-reconciliation.md`](../processes/outreach/sheets-supabase-reconciliation.md#what-this-means-for-a-sync):
   `ooo_followups.source_reply_id` exists precisely to prove an episode came from a real, RPC-recorded
   reply. Historical `OOO Leads` sheet rows predate branch S and have no `replies` row underneath them
   — backfilling would mean fabricating a `sequencer_contacts`/`replies` pair (or leaving
   `source_reply_id` NULL) for provenance that was never actually captured through the pipeline, which
   is exactly the invariant this table exists to preserve. The sheet keeps being the historical record
   until phase C; nothing forces it into Supabase early, and starting `ooo_followups` from "only new
   episodes onward" is not data loss — it is the honest state. **Do not re-raise without a concrete
   product need** (e.g. a report that must show pre-2026-07-22 OOO history from Supabase specifically)
   — proving "the data copies" was never the open question; whether fabricated provenance is
   acceptable is, and the answer here is no.
8. **Phase C** only once the sheet has no readers left — including the dashboards and reports built
   on it, which are outside this repository.

**Accepted violations expire 2026-10-31.** After that, `pnpm n8n:validate` fails.

**Risk if not done:** the legacy columns cannot be dropped; invariants 4, 5, 6 and 8 remain
unenforced; OOO data stays outside RLS in a shared spreadsheet.

---

## 2 · HUB dispatcher

**Deprioritized 2026-07-22 — not pursuing for now.** Do not re-propose importing this without a new
reason to (e.g. a concrete incident traced to the unverified webhook auth, or a child workflow that
needs changing). The security-relevant part (unauthenticated webhook) stays correctly tracked as an
open finding in [security.md §3](security.md#3-the-hub-webhook-is-the-entry-point-for-all-reply-processing--medium)
regardless of whether this repository ever imports the HUB workflow itself.

| Remote | Name |
|---|---|
| `xPzdtWQiY3lGtqI1` | `[HUB] Bison Replies Dispatcher` |

The entry point for **all** reply processing: an `n8n-nodes-base.webhook` normalizes the Bison
payload and fans out to seven children.

- it defines the payload contract every child depends on — currently reverse-engineered in
  [`hub-child-input.schema.json`](../../../automation/n8n/workflows/outreach/ooo-detect-and-log/contracts/hub-child-input.schema.json)
  and enforced by nothing at runtime;
- its webhook authentication is **unverified** — see security.md §3 above. `scan.mjs` would answer
  this the moment it is imported, but importing it is not planned.

Children not covered by §1: `bEB3aOHEq2lEpubp` (child-4, blacklist add), `FZSFz5bcgigUneQZ`
(child-5, unblacklist), `wJZbg0cRsdF58ylE` (child-6, MQL delete + unblacklist). None of these three
are being imported either.

**child-1 is done.** `lBOyL8ZPA3SZSvDW` was imported as
[`bison-lead-enrichment`](../../../automation/n8n/workflows/outreach/bison-lead-enrichment/README.md)
and reached **phase A** on 2026-07-22: a five-node branch S writes the contact, the reply and the
lead through `upsert_sequencer_contact` → `upsert_reply` → `promote_contact_to_lead`. That is the
first caller `promote_contact_to_lead` has ever had.

It also turned out to contain **31 orphaned Supabase nodes** — an unfinished branch that was never
wired to its trigger, whose root selected a dropped column, and which wrote `leads` directly in
violation of ADR-0015 §5.

**Resolved 2026-07-22, same day.** 18 of the 31 were exactly what branch S needed for real
independence from branch L (its first version shared branch L's Bison/Snov.io/Lusha/OpenAI calls,
which turned out to make branch L depend on `client_sequencers` data quality — the coupling problem
just moved, it didn't disappear) — repaired and wired to `[S0]`. The other 11 (direct-`leads`-write
nodes, a redundant dedup check, and a duplicate blacklist path branch S doesn't need) were deleted.
`knownViolations` is now empty for this workflow. Detail:
[`bison-lead-enrichment/README.md`](../../../automation/n8n/workflows/outreach/bison-lead-enrichment/README.md#the-two-branches-share-nothing-2026-07-22).

~~child-6 still **deletes** leads and is worth questioning against
[ADR-0004](../../adr/0004-lead-state-boundaries.md).~~ — **deprioritized 2026-07-22 along with the
rest of this section.** Still true (child-6 is uninspected, per the note above), just not being
pursued right now. Do not re-raise without importing the HUB family first.

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
Four of five reached phase A the same day: `aimfox-daily-metrics`, `aimfox-classification`,
`aimfox-premql-to-pdca` and `aimfox-leads-processing`. Only `aimfox-import-to-connection` remains
phase 0 — it queues real LinkedIn invites, so it gets its own A1 shadow treatment.**

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

**Four of five are phase A.** `aimfox-daily-metrics`, `aimfox-classification`, `aimfox-premql-to-pdca`
and `aimfox-leads-processing` all write Supabase now. Only `aimfox-import-to-connection` still doesn't —
`sequencers` has an `aimfox` row, `client_sequencers` carries the token field, and
`sequencer_daily_stats` was designed *by reading* `Get Metrics from Aimfox`
([`20260705`](../../../supabase/migrations/20260705_sequencer_daily_stats_schedule.sql)). The model is
specified and increasingly used. [11-integrations §2](../functional/11-integrations.md) described that
row as a live write before this inventory corrected it in the first place.

**Blocking, in order:**

1. ~~Move the two leaked secrets into n8n credentials and import the three blocked workflows~~ —
   **done 2026-07-22** (findings 7 and 8). ~~Rotating the old values in Aimfox and OpenAI is still
   outstanding~~ — **owner action, deprioritized from this backlog 2026-07-22.** Correctly tracked as
   the owner's step in [security.md findings 7](security.md#7-an-aimfox-organisation-token-written-literally-into-three-workflow-graphs--resolved-2026-07-22)/[8](security.md#8-an-openai-api-key-written-literally-into-aimfox-classification--resolved-2026-07-22);
   not something this repo tracks as an actionable task, since nobody here can rotate a third-party key.
2. ~~Authenticate the two Aimfox webhooks (`aimfox-classifier`, `preMQL-Aimfox`)~~ — finding 3,
   **owner action, deprioritized from this backlog 2026-07-22.** Stays correctly tracked as an open
   finding in [security.md §3](security.md#3-the-hub-webhook-is-the-entry-point-for-all-reply-processing--medium);
   configuring webhook auth in n8n is an instance-config change, not something to re-propose here
   without a reason to (e.g. evidence one of the two paths is actually being hit externally).
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
5. ~~Phase A on `aimfox-classification` (contact identity)~~ — **done 2026-07-22.** Branch S:
   `upsert_sequencer_contact` + `upsert_reply`, hung off the already-Supabase-only
   `Get Workspace Api Key` node — no blacklist call in branch S
   ([README](../../../automation/n8n/workflows/outreach/aimfox-classification/README.md)).
6. ~~Then the lead flows~~ — **done 2026-07-22, both.** `4OjNRWLaG2IWK6kd` (`aimfox-leads-processing`)
   and `s0GqDtCzyLAvVnm1` (`aimfox-premql-to-pdca`) each got their own RPC chain
   (`upsert_sequencer_contact` → `upsert_reply` → `Resolve campaign` → `promote_contact_to_lead`), fully
   independent of branch L. Along the way: `aimfox-leads-processing`'s manifest wrongly claimed the
   Bison HUB as its trigger — the real caller is `aimfox-classification`'s `Call 'Test aimfox'` node,
   found by grepping all 57 live workflows for its own node id. That also retired the "needs A1 shadow"
   caution: branch S never calls the CRM dispatcher, so the duplicate-write risk the caution was
   written for doesn't apply (confirmed with the user before building). Neither has been exercised by a
   real production execution yet — watch the first one.
7. **`aimfox-import-to-connection` last.** It POSTs to a campaign audience, which queues LinkedIn
   invites to real people — the A1 shadow case ([ADR-0017 §1b](../../adr/0017-sheets-to-supabase-dual-write-transition.md)).
   Its idempotency claim is **unverified**: nobody has tested whether the audience endpoint ignores a
   profile it already holds.

**Risk if not done:** a master credential and an OpenAI key stay in plaintext on the instance; two
open webhooks can drive blacklisting; and the LinkedIn channel contributes nothing to any portal
metric, because none of its data exists in the database.

---

## 6 · Reply classification

**Deprioritized 2026-07-22 — not pursuing for now.** `XdTMd1KJX0cRmF9u` — `Bison Replies
Classification - Sheets Primary 401 Fallback`.

The name states the problem: **Sheets is primary.** It produces the `replies.classification` values
that [11-integrations §6](../functional/11-integrations.md#6-reply-classification) treats as the live
contract, and ADR-0015 chose not to rename that enum precisely because it is the live contract. Do not
re-propose importing this without a new reason to.

---

## 7 · Housekeeping — delete or claim

**Deprioritized 2026-07-22 — not pursuing for now.** Do not re-propose without a new reason to (e.g.
one of these turns out to be live and undocumented, not just orphaned).

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

Done 2026-07-22: the sync, plus `[S0] Resolve Bison credentials` in `bison-lead-enrichment`. Same day,
corrected same day: `[S0]` first became the primary source for all eight of branch L's + branch S's
Bison `Authorization` headers (sheet as fallback) — which fixed branch S but made branch L depend on
`client_sequencers` data quality, the coupling problem in the other direction. Branch L's 8 headers now
read only `col_6` again; branch S has its own 5, reading only `[S0]`, no fallback — see
[`bison-lead-enrichment/README.md`](../../../automation/n8n/workflows/outreach/bison-lead-enrichment/README.md#the-two-branches-share-nothing-2026-07-22).

**Remaining:**

1. ~~Three clients have no `clients` row at all~~ — **done 2026-07-22.** SalesBook, Tryumf and Kamiński
   now have a `clients` row (`status='On hold'`, `manager_id`=Natalia, `kpi_leads` from CS PDCA
   `col_15`), waiting on the sync's next run (≤6h) to key them. The guarded sheet fallback on branch
   L's headers is still in the graph — remove it once confirmed keyed.
2. ~~`RedIntoGreen DAPR` (workspace 149) does not match the client named `DAPR`~~ — **confirmed same
   client 2026-07-22** (human decision, not the sync's to make). Its `client_sequencers` row was
   created directly (client_id = the existing `DAPR` row), `api_key` left NULL for the sync to fill.
3. ~~Repoint the four OOO/NRR workflows the same way~~ — **already done, this entry was stale.**
   Duplicated [§1 item 3](#1--ooo-cutover): branch S in all four already resolves Bison auth from
   `client_sequencers.api_key` via its own `[S] Resolve client sequencer` node; branch L's `col_6`
   reads are unchanged, sheet-authenticated, exactly as intended. Verified against a fresh production
   `GET` 2026-07-22, not assumed.
4. ~~Aimfox keys have no sync~~ — **decided 2026-07-22: not pursuing.** Seeded once by hand for five
   clients; there are only five (vs. Bison's ~42 workspaces), Aimfox onboarding is far slower than
   Bison's, and a scheduled sync workflow is real ongoing maintenance for a credential set that changes
   rarely. Re-seed by hand when a client is added or a key rotates. **Do not re-raise unless Aimfox
   client count grows enough that manual seeding becomes the actual bottleneck.**

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
