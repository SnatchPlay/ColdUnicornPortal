# n8n migration backlog

Inventory taken 2026-07-21: **33 workflows, 27 active, 1 managed, 32 orphan.**

Reproduce with `pnpm n8n:inventory`.

Priority is by *risk*, not by convenience: a workflow that blocks a migration or contradicts an ADR
comes before one that is merely undocumented.

---

## 1 · OOO cutover

**Priority: highest. Blocks a deferred migration and 13 rows of the traceability matrix.**

[ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md) shipped the whole OOO model —
tables, RPCs, RLS, ~70 invariant assertions — on 2026-07-21. **Automation has not cut over.** OOO
state still lives in the `OOO Leads` Google Sheet; `ooo_followups` has 0 rows in production.

| Remote | Name | Role after cutover |
|---|---|---|
| `O4DqMEu1Z9LcxikE` | `[child-3] TAG_ATTACHED · OOO · Detect return date and log` | **managed** → call `upsert_sequencer_contact` → `upsert_reply` → `record_ooo_followup`; delete the sheet append |
| `ZZ0ughB302WdDJOf` | `[child-7] TAG_REMOVED · OOO · Remove from OOO Leads` | → `cancel_active_ooo_followup` (cancels, never deletes) |
| `zaPkpSAuvjibUUDU` | `Add OOO Leads` (scheduled re-enrolment) | → the worker: `claim_ooo_followup` → attach → `mark_ooo_submitted` / `mark_ooo_failed` |
| `1hHbU2hYYcsktLUP` | `[child-2] TAG_ATTACHED · NRR · Daily stats` | → `upsert_reply` with `NRR`; no lead, no episode |

**Blocking, in order:**

1. **Resolve the open question in
   [`ooo-detect-and-log/README.md` defect 9](../../../automation/n8n/workflows/outreach/ooo-detect-and-log/README.md#known-defects).**
   The two output branches read the LLM node with incompatible shapes. If the sheet's
   `$json.expected_return_date` is also undefined, every OOO contact has silently been scheduled at
   `today + 14` and the gpt-5-mini extraction is decorative. Check the sheet before porting any
   extraction logic, or the cutover will faithfully reproduce a broken behaviour.
2. Decide the oldest-vs-newest reply question (defect 8): `[326]` deliberately takes the **oldest**
   reply. For a repeat OOO that is almost certainly wrong.
3. Move per-client Bison API keys from the CS PDCA sheet to `client_sequencers.api_key`
   ([security.md §1](security.md#1-per-client-bison-api-keys-live-in-a-google-sheet--high)).
4. Cut over the four workflows above.
5. **Only then** apply
   [`20260722z_drop_legacy_ooo_columns.sql`](../../../supabase/migrations/deferred/20260722z_drop_legacy_ooo_columns.sql).
   Its precondition is exactly "n8n has stopped writing the legacy columns".
6. Backfill the sheet's open absences into `ooo_followups`, or accept starting empty — a product
   decision, not a technical one.

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

Children not covered by §1: `lBOyL8ZPA3SZSvDW` (child-1, Interested/PreMQL enrichment),
`bEB3aOHEq2lEpubp` (child-4, blacklist add), `FZSFz5bcgigUneQZ` (child-5, unblacklist),
`wJZbg0cRsdF58ylE` (child-6, MQL delete + unblacklist).

Note child-1 and child-6 create and **delete** leads — they must be checked against invariants 1–3
before any cutover, and child-6's "delete the row from Leads" is worth questioning against
[ADR-0004](../../adr/0004-lead-state-boundaries.md).

---

## 3 · Ingestion workflows already documented in `11-integrations`

**Priority: medium.** These write ingestion-only tables the portal reads, so their contracts are
already documented — importing them mostly means proving doc and reality agree.

| Remote | Name | Documented at |
|---|---|---|
| `yjztuv4q07uysvkA` | `Winnr Daily Sync - Supabase v2` | §2 `email_accounts`, `email_account_warming_daily`, `domains` |
| `oF6fP3ea2zglhAop` | `Winnr Sync - Error Handler` | §2 `integration_sync_runs` |
| `sVev5d0N6rtrbcgI` | `Get Metrics from Aimfox` | §2 `sequencer_daily_stats` (+ the documented double-subtraction quirk) |
| `8uRWXHe9FIfglq1u` | `Get Winnr Domains` (inactive) | §2 |
| `AEgpCGoSpiZ7PA90` | `Bison campaign daily stats` | §2 `campaign_daily_stats` |
| `amJdB2eGXxUNyCPY` | `Bison daily stats population` | §2 `daily_stats` (incl. `ooo_count`) |
| `BQbFKHUaIcEKPc01` | `Daily Stats Process` | §2 |
| `UXpSOrgsN2TxjXUu` | `Bison campaign sync` | §2 `campaigns` |

Check specifically: has the **ADR-0012 sequencer cutover** actually happened? §3 documents a
migration from `clients.external_api_key` to `client_sequencers`, with
`20260704b_drop_client_sequencer_credentials.sql` deferred until every workflow has switched. Nobody
has verified that they did.

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

**Priority: low-medium.** `JnvRBXtRNar7ejeM` (classification), `4OjNRWLaG2IWK6kd` (leads
processing), `nG6Q4KEGeXk7tBHm` (import to connection), `s0GqDtCzyLAvVnm1` (preMQL → PDCA).

Note `4OjNRWLaG2IWK6kd` and `s0GqDtCzyLAvVnm1` create leads — check against invariants 1–3.

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

## Cross-cutting

1. **No development instance.** The single highest-value fix: without it, no cutover in this backlog
   can be built or tested without touching production.
2. **Google Sheets is a load-bearing data store** — CS PDCA (credentials + client config), OOO Leads
   (OOO state), Daily Stats (counters). This contradicts
   [ADR-0001](../../adr/0001-live-supabase-source-of-truth.md), which says Supabase is the only data
   system. Either migrate it or amend the ADR; the present state is that the ADR is simply untrue.
3. **No error handling outside the Winnr flows.** Only `oF6fP3ea2zglhAop` exists as an error handler.
4. **Idempotency is mostly undocumented**, and in the OOO path absent.
