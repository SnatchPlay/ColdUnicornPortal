# sheets-credential-sync-on-edit

**Logical ID:** `sheets-credential-sync-on-edit` · **Domain:** `ops` · **Criticality:** high
**Remote (production):** `ATPnIVnO0sAB9GQx` — `[CRED] CS PDCA edit → client_sequencers · Bison + Aimfox keys`
**Trigger:** webhook, `POST /webhook/credential-sync`

> The edit-driven half of a pair. [`sheets-bison-credential-sync`](../sheets-bison-credential-sync/README.md)
> sweeps CS PDCA every 6 hours; this one reacts in seconds when someone pastes a key into the sheet
> by hand.

## Why it exists

[ADR-0012](../../../../../docs/adr/0012-multi-sequencer-model.md) puts per-client vendor credentials
in `client_sequencers`. The sheet is still where a human types them. The 6-hourly sweep closes that
gap eventually; "eventually" is the wrong latency for a credential, because between the edit and the
sweep every Bison and Aimfox call for that client authenticates with the **old** key.

It also closes a gap the sweep never covered at all: **Aimfox keys had no sync**
([migration-backlog §8 item 4](../../../../../docs/reference/n8n/migration-backlog.md#8--bison-credentials-out-of-the-spreadsheet)
decided against building a scheduled one). A key pasted into `col_105` for a client with no `aimfox`
row used to sit in the sheet until someone re-ran the manual seed by hand.

## What triggers it

A Google Apps Script `onEdit` handler on `GHEADS | PDCA`. It fires when the edited range intersects
one of three columns and POSTs **one request per edited row**:

| Column | Index | Meaning |
|---|---|---|
| `E` | `col_5` | Bison workspace id — the only client identity in the payload |
| `F` | `col_6` | Bison API key |
| `DA` | `col_105` | Aimfox token |

All three values are sent on **every** fire, whichever cell was touched. That is what makes this a
self-healing re-sync rather than a per-cell patch, and it is why the workflow ignores
`editedColumns` entirely.

## What it does

```
POST /webhook/credential-sync ─ Collect credentials ─ [AF] Resolve workspace ─ Sync client_sequencers
```

`[AF] Resolve workspace` is `GET https://api.aimfox.com/api/v2/accounts` with the token that was just
pasted. The response carries `accounts[].workspace_id`, which is the only place that value exists —
CS PDCA has no column for it (`DA` is the token; there is nothing else). No key, or a key the API
rejects, returns 401; the node continues (`onError: continueRegularOutput`) and the statement simply
receives an empty workspace.

| Case | Matched on | Action |
|---|---|---|
| Bison row exists for that workspace | `external_workspace_id` | refresh `api_key` **only when it differs** |
| Aimfox row exists for that client | `(client_id, sequencer_id)` | refresh `api_key` **only when it differs** |
| No Aimfox row for that client | — | insert one **with** `external_workspace_id` when the token resolved |
| Aimfox row exists but has no workspace id | `(client_id, sequencer_id)` | fill it, even when the key itself is unchanged |
| No Bison row for that workspace | — | **reported in `unmatched_workspaces`, never guessed** |

**The workspace id is the only client identity in the payload**, so every write hangs off the
`emailbison` row that already carries it. That is deliberate, and it is why this workflow cannot
create a Bison row: doing so needs the client name, which the payload does not carry and which must
never be guessed. That case stays with the 6-hourly sweep, which reads the name from the sheet.

## The workspace id — why this changed on 2026-08-03

Until now an Aimfox row was written with a NULL `external_workspace_id`, on the grounds that the
value is knowable only from the token's own `GET /accounts` and that the column is nullable so
seeding would not be blocked on it ([aimfox-phase-a](../../../../../docs/reference/n8n/aimfox-phase-a.md)).

That reasoning understated the consequence. `Get Workspace Api Key` — the first Postgres node of
every inbound Aimfox workflow — matches on `external_workspace_id`. A row without one returns **zero
rows**, and because that node feeds *both* branches of
[`aimfox-premql-to-pdca`](../../../outreach/aimfox-premql-to-pdca/README.md), the run stops before
Supabase **and** before the client's Leads sheet, with the execution still reported green. Measured
2026-08-03: leads lost this way for a second ColdUnicorn workspace, an Audytel workspace with no
`aimfox` row at all, and a second Fortum workspace — plus FitMech, which has had a valid key and a
NULL workspace the whole time.

So the workflow now resolves it. Two guards, because the alternative to a wrong workspace is no
workspace, never a guessed one:

- **one workspace or none.** If the token answers for several distinct workspaces, the statement gets
  an empty value and writes nothing. Picking one would attach a client's events to the wrong client.
- **never blank a known workspace.** `coalesce(excluded.external_workspace_id, <stored>)` means an
  unresolvable token leaves an already-correct row alone.

The old on-conflict guard was `api_key is distinct from excluded.api_key`, so a row whose key was
already current could never acquire its missing workspace id — that is precisely how FitMech stayed
broken. The guard now also fires on a workspace-id difference.

### What this still cannot do

`client_sequencers` is `UNIQUE (client_id, sequencer_id)` — **one Aimfox workspace per client**. Two
of the four cases above are a client with a *second* Aimfox workspace, and no amount of syncing fixes
that: the row simply has nowhere to go. Modelling several workspaces per client is a data-model
decision ([ADR-0012](../../../../../docs/adr/0012-multi-sequencer-model.md)), not a workflow change.
Until it is made, a second workspace needs its own `clients` row or it stays invisible.

Keys never leave n8n: the webhook body feeds a Code node that emits a JSON payload straight into the
Postgres node in the same execution, and nothing is logged.

`responseMode: lastNode` is deliberate. A failed write returns a non-2xx and the Apps Script raises,
so the person editing the sheet sees the failure instead of a silent no-op.

## Proven

The statement was exercised against production in a rolled-back transaction on 2026-07-29, with a
synthetic three-row payload covering all four branches at once — an existing workspace whose client
already has an Aimfox row, an existing workspace whose client has none, and an unknown workspace:

```
rows_in=3  clients_resolved=2  bison_keys_refreshed=2
aimfox_rows_created=1  aimfox_keys_refreshed=1  unmatched_workspaces="999999"
```

Coverage was re-read after the rollback and was unchanged (44 `emailbison`, 7 `aimfox`, all keyed),
so nothing leaked out of the transaction. Three edge payloads — empty array, blank keys, blank
workspace id — each resolved without writing anything.

### First real executions — 2026-07-29, 06:34 UTC

Two real edits to CS PDCA row 9 (`editedColumns: ["DA"]` — Runmageddon, Bison workspace 11), both
`success`, both end to end through all three nodes:

```
rows_in=1  clients_resolved=1
bison_keys_refreshed=0  aimfox_rows_created=0  aimfox_keys_refreshed=0  unmatched_workspaces=null
```

**`clients_resolved=1` is the number that matters.** The workspace id from the sheet resolved to a
real `client_sequencers` row, which is the whole identity chain this workflow is built on. The four
zeros are the `IS DISTINCT FROM` guard doing its job: the sheet already held exactly what the
database held, so a re-post correctly wrote nothing. Confirmed in Postgres — no
`client_sequencers` row has a `created_at` or `updated_at` on 2026-07-29 (last writes: `aimfox`
2026-07-28, `emailbison` 2026-07-23).

**So the resolve path is proven on real data; the write branches are not.** The UPDATE and the
Aimfox INSERT have only ever run inside the rolled-back transaction above. The next genuine key
rotation is the proof — watch that execution for a non-zero counter, and do not treat these two runs
as more than "the statement parses, binds and resolves".

Ignore executions 57602/57603 (05:45 UTC): they predate the fix, when the webhook was wired to
nothing. n8n reports them `success` because the trigger fired — nothing downstream ran.

**Observation to watch:** each edit produced **two** executions ~1.3 s apart, both with the same
`sheet_row` and `editedColumns`. Harmless — the idempotency guard makes the second a no-op — but if
it repeats on every edit it is a double-fire in the Apps Script `onEdit` handler, not in this
workflow.

## Known gap — the webhook is unauthenticated

`POST /webhook/credential-sync` has no authentication, so its path is the only thing between the
internet and a write to `client_sequencers.api_key`. Anyone holding the URL can point a client's
Bison or Aimfox credential at a key they control, or simply break it. Tracked as
[security finding 10](../../../../../docs/reference/n8n/security.md); the fix is an `httpHeaderAuth`
credential on the webhook plus the same header in the Apps Script, and it is a deliberate decision
to ship without it for now, not an oversight.

`pnpm n8n:validate` raises `unauthenticated-webhook` as a **warning** on this artifact. That warning
is the reminder — do not silence it.

The payload also carries raw API keys in a request body, so every execution of this workflow stores
them in n8n's execution data. Trim retention accordingly.

## Two things the clipboard import dropped

n8n's *Import from clipboard* carries nodes and connections, not workflow settings or sticky notes.
Both are missing on the live graph as of the 2026-07-29 export, and neither can be set over the
public REST API's `PUT` without replacing the whole settings object:

1. **`settings.errorWorkflow` is unset.** It should point at
   [`automation-failure-recorder`](../automation-failure-recorder/README.md) (`Pmz0JjRRuJNdNpSE`),
   like every other managed workflow. Without it a failed execution is silent — no
   `integration_sync_runs` row. Set it in **Workflow settings → Error workflow**.
2. **The sticky note is gone**, so the graph no longer explains itself in the editor. Cosmetic; this
   README is the real documentation.

## Re-check

```sql
select s.key,
       count(*) as rows,
       count(*) filter (where coalesce(cs.api_key,'') <> '')    as keyed,
       count(*) filter (where cs.external_workspace_id is null) as no_workspace_id
from public.client_sequencers cs
join public.sequencers s on s.id = cs.sequencer_id
group by 1 order by 1;
-- baseline 2026-07-29: emailbison 44/44/0, aimfox 7/7/1
```
