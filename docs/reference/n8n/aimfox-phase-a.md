# Aimfox · phase A design

Counterpart of [ooo-phase-a.md](ooo-phase-a.md), for the LinkedIn channel.
Process: [LinkedIn outreach (Aimfox)](../processes/outreach/linkedin-aimfox.md) ·
Transition rules: [ADR-0017](../../adr/0017-sheets-to-supabase-dual-write-transition.md)

**Status 2026-07-22: phase 0 on all five workflows. Two blockers, both requiring a human.**

---

## Where the channel actually is

| Workflow | Repository | Postgres branch |
|---|---|---|
| `aimfox-daily-metrics` | imported, `managed` | none — **first candidate** |
| `aimfox-import-to-connection` | imported, `managed` | none — last, needs an A1 shadow |
| `aimfox-classification` | **cannot be imported** | none |
| `aimfox-leads-processing` | **cannot be imported** | none |
| `aimfox-premql-to-pdca` | **cannot be imported** | none |

Verified against production: `sequencer_daily_stats` 0 rows, `client_sequencers` with
`sequencers.key='aimfox'` 0 rows (35 `emailbison` rows, all enabled and keyed).

## Blocker 1 · the Aimfox organisation token

The node `Get Workspace Api Key` carries `Authorization: Bearer <token>` as a **literal**, in three
workflows. That token mints per-workspace tokens, so it is the master key to every client's LinkedIn
workspace ([security §7](security.md)). `pnpm n8n:export` refuses any artifact containing it, so
those three workflows cannot enter the repository at all.

**Needs a human**: the n8n MCP exposes no credential tools — 13 tools, none of them credential
management. Create it in the n8n UI:

- Type: **Header Auth**
- Name: `Aimfox Org Token`
- Header name: `Authorization`
- Header value: `Bearer <token>` — **rotate the token in Aimfox first**; the current value has been
  sitting in plaintext workflow JSON and in every export of it.

Then the three `Get Workspace Api Key` nodes switch to
`authentication: "genericCredentialType"`, `genericAuthType: "httpHeaderAuth"`, and the literal
disappears. Credentials are re-attached automatically on re-authoring
([workflow-lifecycle · the SDK authoring contract](workflow-lifecycle.md)), so no manual repair is
needed afterwards.

## Blocker 2 · per-client Aimfox tokens

Branch S has to make its **own** Aimfox calls — that is what makes branch L disconnectable in one
move (ADR-0017 §1a). Its token must therefore come from `client_sequencers.api_key`, not from the CS
PDCA sheet. Today that table has no `aimfox` rows.

Seeding is a **credential** move, not a data migration: per-client API keys are not business data, and
[migration-backlog cross-cutting §2](migration-backlog.md) already carves them out as something that
moves sooner and independently of the Sheets transition.

The statement below resolves each client through the `emailbison` row it already has, so the only
thing to supply is `(bison workspace id from CS PDCA col_5, Aimfox token from col_105, Aimfox
workspace id)`. Verified against production in a rolled-back transaction:

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

## Then: branch S on `aimfox-daily-metrics`

The only part of this channel that needs no A1 shadow — derived numbers, no person touched, no
external write endpoint.

```
Schedule (2h) ─┬─ [L] CS PDCA → Aimfox → PDCA + Daily stats cells        (unchanged)
               └─ [S] client_sequencers (aimfox, enabled)
                     └─ own Aimfox calls with client_sequencers.api_key
                        └─ UPSERT sequencer_daily_stats
                           on (client_id, sequencer_id, profile_id, report_date)
```

Branch S must **fix, not port**, three defects of branch L
([README](../../../automation/n8n/workflows/ingestion/aimfox-daily-metrics/README.md)):

1. `remaining_limit` double-subtracts `buckets[0]`;
2. `profile_id` must be the Aimfox account id, not a spreadsheet row number (process invariant 4);
3. no averaging of identifiers — one row **per account**, which is what the unique key was designed
   for.

An imported defect is still a defect ([ADR-0016](../../adr/0016-repository-as-automation-source-of-truth.md) §1).

**Reconciliation (the A → B gate):** per `report_date` and client, the PDCA cells and the
`sequencer_daily_stats` rows agree. Expect one honest difference: branch S has per-account rows where
the sheet has a single client rollup, so compare the **sum** across `profile_id`. Record the agreeing
date range in `transition.parityEvidence`.

## Order for the rest

1. `aimfox-classification` — no lead writes; the safest of the three blocked workflows to import once
   its secrets are gone. Its output (`category`) is the LinkedIn analogue of `replies.classification`.
2. `aimfox-premql-to-pdca` and `aimfox-leads-processing` — both create leads. They need
   `sequencer_contacts` first (process invariants 1–3): a LinkedIn contact identity exists nowhere
   today, so there is nothing for a lead to hang off.
3. `aimfox-import-to-connection` — last. It queues invites to real people, so it gets the A1 shadow
   treatment, and its idempotency assumption must be tested against the Aimfox API before anything
   relies on it.
