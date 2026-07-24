# Aimfox · phase A design

Counterpart of [ooo-phase-a.md](ooo-phase-a.md), for the LinkedIn channel.
Process: [LinkedIn outreach (Aimfox)](../processes/outreach/linkedin-aimfox.md) ·
Transition rules: [ADR-0017](../../adr/0017-sheets-to-supabase-dual-write-transition.md)

**Status 2026-07-22: all five imported and `managed`. Both blockers cleared.
Four of five are now PHASE A — branch S live on `aimfox-daily-metrics`, `aimfox-classification`,
`aimfox-premql-to-pdca` and `aimfox-leads-processing`. Only `aimfox-import-to-connection` remains at
phase 0 — it queues real LinkedIn invites, so it gets the A1 shadow treatment on its own terms.**

> **Two different things put Aimfox data into Supabase on 2026-07-22, and only one of them is
> progress on this page.** One-off sheet backfills wrote 30 Aimfox-attributed leads and 117
> `sequencer_daily_stats` rollup rows
> ([reconciliation](../processes/outreach/sheets-supabase-reconciliation.md)) — that is imported
> history, not automation. Branch S of `aimfox-daily-metrics` is the real move: a workflow writing
> `sequencer_daily_stats` per LinkedIn account, every two hours. The other four workflows still write
> only to Sheets.

---

## Where the channel actually is

| Workflow | Repository | Postgres branch |
|---|---|---|
| `aimfox-daily-metrics` | imported, `managed` | **live 2026-07-22** — one row per account per day |
| `aimfox-classification` | imported, `managed` | **live 2026-07-22** — gives a reply a home; unblocks the two below |
| `aimfox-import-to-connection` | imported, `managed` | none — last, needs an A1 shadow |
| `aimfox-premql-to-pdca` | imported, `managed` | none — next, now has a stored contact to attach a lead to |
| `aimfox-leads-processing` | imported, `managed` | none — after that, also writes the clients' CRMs |

Verified against production: `sequencer_daily_stats` **0 rows before 2026-07-22**; `client_sequencers` with
`sequencers.key='aimfox'` **5 rows** as of 2026-07-22 (35 `emailbison` rows, all enabled and keyed).

## ~~Blocker 1~~ · the Aimfox organisation token — cleared 2026-07-22

The node `Get Workspace Api Key` carries `Authorization: Bearer <token>` as a **literal**, in three
workflows. That token mints per-workspace tokens, so it is the master key to every client's LinkedIn
workspace ([security §7](security.md)). `pnpm n8n:export` refuses any artifact containing it, so
those three workflows cannot enter the repository at all.

Resolved: the credential **`Aimfox Master`** (`httpBearerAuth`, id `Sow8iVXceVMZM5b3`) was created in
the n8n UI — the MCP exposes no credential tools, so this needed a human. All three
`Get Workspace Api Key` nodes now use `authentication: "genericCredentialType"`,
`genericAuthType: "httpBearerAuth"`, and all three workflows are committed.

The same pass moved the OpenAI key in `aimfox-classification` to the existing `OpenAi account`
credential via `predefinedCredentialType`, leaving both request bodies byte-identical so the strict
`json_schema` structured output survives.

**Still outstanding, and the owner's step:** rotate both values at the vendor. They sat in plaintext
workflow JSON, so they must be treated as exposed.

## ~~Blocker 2~~ · per-client Aimfox tokens — cleared 2026-07-22

Branch S has to make its **own** Aimfox calls — that is what makes branch L disconnectable in one
move (ADR-0017 §1a). Its token must therefore come from `client_sequencers.api_key`, not from the CS
PDCA sheet.

Seeding is a **credential** move, not a data migration: per-client API keys are not business data, and
[migration-backlog cross-cutting §2](migration-backlog.md) already carves them out as something that
moves sooner and independently of the Sheets transition.

**Done 2026-07-22 — five rows.** Of 21 active CS PDCA clients, five carry an Aimfox token in
`col_105`; all five tokens authenticated. Each client's `external_workspace_id` was read from its own
`GET /accounts` rather than guessed, so the value is the Aimfox workspace the token actually belongs
to.

| Client | Aimfox workspace | Note |
|---|---|---|
| Bent Iron PL | seeded | — |
| ColdUnicorn PL | seeded | — |
| Runmageddon | seeded | — |
| EvidencePrime | seeded | had **no** `client_sequencers` row at all (bison workspace 130 was never mapped); resolved by client name instead |
| FitMech | **null** | token valid, but the workspace has no LinkedIn account connected, so no workspace id exists yet |

FitMech can therefore authenticate API calls but cannot resolve an inbound webhook until an account
is connected.

The statement used, kept here as the shape for future clients — it resolves each client through the
`emailbison` row it already has, so the only input is `(bison workspace id from CS PDCA col_5, Aimfox
token from col_105, Aimfox workspace id)`. Verified in a rolled-back transaction before running:

```sql
with seed(bison_workspace_id, aimfox_api_key, aimfox_workspace_id) as (
  values
    ('<col_5>', '<col_105>', '<aimfox workspace id>')
    -- one row per active client
)
insert into public.client_sequencers (client_id, sequencer_id, api_key, external_workspace_id, enabled)
select cs.client_id,
       '00000000-0000-4000-a000-000000000003'::uuid,   -- sequencers.key = 'aimfox'
       s.aimfox_api_key,
       s.aimfox_workspace_id,
       true
from seed s
join public.client_sequencers cs on cs.external_workspace_id = s.bison_workspace_id
join public.sequencers sq        on sq.id = cs.sequencer_id and sq.key = 'emailbison'
on conflict (client_id, sequencer_id) do update
  set api_key               = excluded.api_key,
      external_workspace_id = coalesce(excluded.external_workspace_id,
                                       public.client_sequencers.external_workspace_id),
      enabled               = true,
      updated_at            = now();
```

`external_workspace_id` is what a webhook's `body.workspace.id` is matched against, so a row without
it can still authenticate API calls but cannot resolve an inbound event. Fill it when known; the
column is nullable precisely so seeding is not blocked on it.

**Do not commit real values.** Run the statement from a local file, and keep the mapping out of the
repository ([security.md](security.md)).

## Done: branch S on `aimfox-daily-metrics` — live 2026-07-22

The only part of this channel that needs no A1 shadow — derived numbers, no person touched, no
external write endpoint.

```
Schedule (2h) ─┬─ [L] CS PDCA → Aimfox → PDCA + Daily stats cells        (unchanged)
               └─ [S] client_sequencers (aimfox, enabled)
                     └─ own Aimfox calls with client_sequencers.api_key
                        └─ UPSERT sequencer_daily_stats
                           on (client_id, sequencer_id, profile_id, report_date)
```

Branch S **fixed, rather than ported, four defects** of branch L
([README](../../../automation/n8n/workflows/ingestion/aimfox-daily-metrics/README.md)):

1. `remaining_limit` double-subtracts `buckets[0]`;
2. `profile_id` was a spreadsheet row number, not the Aimfox account id (process invariant 4);
3. `Summarize` averaged `account_id` and `workspace_id` — one row **per account** instead;
4. **found by probing, not by reading:** a single-day interactions query returns two buckets and the
   leading one is a boundary artefact — it reported `sent=0` for 2026-07-20 where a multi-day query
   gave `33`. Branch L reads `buckets[1] − buckets[0]` and is saved only by that artefact currently
   being zero for `sent_connections`.

**Open question, deliberately left open:** the per-account interactions filter is unverified —
`account_ids` returns HTTP 500 and the other spellings return the workspace numbers unchanged, which
with exactly one account per client is indistinguishable from the parameter being ignored. Branch S
therefore writes nothing for a client with more than one account. Re-probe before a second account
appears anywhere.

An imported defect is still a defect ([ADR-0016](../../adr/0016-repository-as-automation-source-of-truth.md) §1).

**Reconciliation (the A → B gate):** per `report_date` and client, the PDCA cells and the
`sequencer_daily_stats` rows agree. Expect one honest difference: branch S has per-account rows where
the sheet has a single client rollup, so compare the **sum** across `profile_id`. Record the agreeing
date range in `transition.parityEvidence`.

> **Sum across `profile_id` only after excluding `'__workspace_total__'`.** The table is no longer
> empty: the sheet backfill wrote 117 rollup rows under that sentinel for 5 clients over
> 2026-06-18…07-22 — exactly the window branch S will first produce. Summing naively would double
> every one of those days and make a broken branch look like it reconciles.
>
> ```sql
> where profile_id <> '__workspace_total__'
> ```
>
> Decide before branch S goes live whether the backfilled rows are deleted once real per-account rows
> cover the same dates, or kept as the sheet-era record. Keeping both silently is the one option that
> is wrong.

## Order for the rest

1. ~~`aimfox-classification`~~ — **done 2026-07-22, and proven with live traffic.** Branch S:
   `upsert_sequencer_contact` + `upsert_reply`, hung off the already-Supabase-only `Get Workspace Api
   Key` node. No blacklist call in branch S. First real inbound reply (execution 50518, Bent Iron PL,
   category `other`) created the **first aimfox `sequencer_contacts` row from live automation**
   (`ef5bf256…`) and its `replies` row (`f7a20837…`, `lead_id` NULL — not promoted, correct) — see the
   workflow manifest's `parityEvidence`.
2. ~~`aimfox-premql-to-pdca` and `aimfox-leads-processing`~~ — **done 2026-07-22, both.** Each got its
   own RPC chain (`upsert_sequencer_contact` → `upsert_reply` → `Resolve campaign` →
   `promote_contact_to_lead`), fully independent of branch L in both directions. Neither has been
   exercised by a real production execution yet (both are new — watch the first one of each).

   Along the way, `aimfox-leads-processing`'s manifest claim about its own trigger turned out to be
   wrong: it said "called by the Bison HUB," but grepping all 57 live workflows for its own node id
   showed the real (only) caller is **`aimfox-classification`**'s `Call 'Test aimfox'` node, gated on
   `category=='interested'`. That also retired this doc's own "A1 shadow" caution for that workflow —
   it existed to stop branch S duplicating a CRM write, but branch S never calls the CRM dispatcher at
   all (same as `bison-lead-enrichment`'s and `aimfox-classification`'s branch S), so the risk it named
   doesn't apply. Confirmed with the user before building rather than silently reversing it.

   **Task B (campaign attribution) turned out to be resolvable, not a design decision to defer.**
   `aimfox-premql-to-pdca`: its own `GET lead info Aimfox` response carries `lead.origins[0].id` — the
   same Aimfox campaign UUID [`aimfox-campaign-sync`](../../../automation/n8n/workflows/ingestion/aimfox-campaign-sync/README.md)
   catalogs (verified by cross-referencing a real lead profile against a real campaign-sync execution:
   same id, same name, "Lipiec | K"). `aimfox-leads-processing`: its webhook body already carries
   `event.campaign.id` directly — no extra lookup needed. Both now resolve a real `campaign_id`
   through `[S] Resolve campaign`; no reply→lead bridge was needed after all.
3. `aimfox-import-to-connection` — last, and now the only workflow left at phase 0. It queues invites
   to real people, so it gets the A1 shadow treatment, and its idempotency assumption must be tested
   against the Aimfox API before anything relies on it.
