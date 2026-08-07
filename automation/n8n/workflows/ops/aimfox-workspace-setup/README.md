# aimfox-workspace-setup

**Logical ID:** `aimfox-workspace-setup` · **Domain:** `ops` · **Criticality:** high
**Remote (production):** `ehhFUR3SYIxDahER` — **inactive**
**Business process:** [Workspace provisioning](../../../../../docs/reference/processes/ops/workspace-provisioning.md)
**Status:** read and write halves built (21 nodes). Inactive, and called by hand until ADR-0018
gives the gateway its webhook. A `dry_run` run still writes nothing, anywhere — structurally

## Business purpose

Bring one client's Aimfox workspace from "exists at the vendor" to "fully wired", by adding **only
what is missing**: the workspace key, two webhooks, two labels.

It replaces the Aimfox half of `8uRWXHe9FIfglq1u` ("My workflow 6") — a hand-run canvas with the
workspace id hardcoded, no notion of what already exists, and no error handling. Its Bison half
becomes [`bison-workspace-setup`](../bison-workspace-setup/README.md).

## Contract

```
IN   contracts/setup-input.schema.json
OUT  contracts/setup-result.schema.json
```

```
{ client_id, workspace_id?, dry_run, requested_by }
  → { client_id, sequencer: "aimfox", resolved, steps, state, candidates? }
```

`state` is one of `configured` · `partial` · `missing` · `needs_selection` · `client_not_found`.

The last one exists because the first version did not have it: a `client_id` that matched no client
with an enabled connector ended the run with `status: success` and no output at all. That is the
same failure shape that lost Audytel's leads — a silent success. `Resolve Client` now carries
`alwaysOutputData: true` so the chain reaches the end and says what happened.

`dry_run: true` performs every read and no write, and returns the same `steps` object. That is what
feeds the status shown in the portal — there is no separate "check" path to drift out of sync with
the "apply" path.

## Flow

21 nodes. Every read happens before the write that depends on it.

```
Start (executeWorkflowTrigger)
  └─ Resolve Client ─ Read Claimed ─ List Workspaces ─ Resolve Workspace ─ Resolved?
       ├─ no  → Needs Selection
       └─ yes → List Tokens ─ Need Mint? ─┬─ yes → Mint Key ─┐
                                          └─ no ─────────────┴→ Effective Key
                → List Webhooks ─ List Labels ─ Build Result ─ Has Work?
                     ├─ yes → Plan Writes ─ Create Missing ─ Collect Creates ─┐
                     └─ no ──────────────────────────────────────────────────┴→ Merge Outcomes
                          → Record → Final Result
```

`Read Claimed` is the one node whose purpose is not obvious: it reads every
`external_workspace_id` already present in `client_sequencers`, so `Resolve Workspace` can subtract
them from the candidate list.

## `dry_run` is structural, not a flag

**`Plan Writes` returns an empty array on a dry run, and n8n does not execute a node with no input
items.** So `Create Missing` never runs — not because it was asked politely not to, but because
there is nothing to write with. `Need Mint?` guards `Mint Key` the same way.

Exactly two nodes issue a POST, `Mint Key` and `Create Missing`, and both are downstream of one of
those guards. `pnpm n8n:deploy` prints the POST inventory on every deploy, so a third would be
visible before it ever ran.

`dry_run` is read as **true for anything except an explicit `false`**. A missing field has to mean
"do not touch", never "write into a client's system".

## The key has to be resolved before the listings, not after

`List Webhooks` and `List Labels` take their bearer token from `Effective Key`, which picks
`stored → already at the vendor → freshly minted`. Before iteration 2 they read it straight from
`Resolve Client`, which was fine only because a keyless workspace was reported as `skipped`. Now
that a key can be minted mid-run, reading the stored value would send `null` and every subsequent
call would 401 — silently, since they all carry `onError: continueRegularOutput`.

## What `Record` writes, and what it refuses to

One statement. `INSERT … SELECT … WHERE` creates the connector row **only** when this is not a dry
run, or when the row already exists:

- creating a connector where none existed would mark the client as connected, and a *check* must
  never do that;
- `api_key` is overwritten only with a key actually obtained — an empty value means "leave it";
- `external_workspace_id` is never overwritten, because it is what pins the client to a workspace;
- `setup_state` holds `state` / `steps` / `resolved` and **no secret** — invariant 7. The audit row
  in `integration_sync_runs` is keyed on `$execution.id`, so a re-run cannot double-count.

`recorded: false` in the result means the vendor work may well have happened while the record of it
did not. A caller must not read that as a failed provisioning.

## The canonical set

What "wired" means for Aimfox — measured across all 9 wired workspaces on 2026-08-07:

| Element | Matched on | Value |
|---|---|---|
| webhook | `url` + `events` | `[reply]` → `/webhook/aimfox-classifier` |
| webhook | `url` + `events` | `[lead_label_added]` → `/webhook/preMQL-Aimfox` |
| label | `name` | `preMQL` (yellow) |
| label | `name` | `MQL` (success) |

Campaigns are **not** created here — they are the client's, and
[`aimfox-campaign-sync`](../../ingestion/aimfox-campaign-sync/README.md) catalogues them on its own
schedule. The `campaigns` step therefore reports `skipped` with a reason and never `created`.
Handing off to the sync so a freshly-keyed client gets its catalogue immediately, rather than up to
two hours later, is worth doing and is not built yet.

`DNC` is deliberately absent. It exists in 3 of the 9 workspaces; that is a client preference, not
our contract.

## Why webhooks are matched on url + events, never on name

GIC's `lead_label_added` webhook is named **`Manual Tag`**, not `preMQL`. It points at the right
URL and fires on the right event, so it is correct — but a name-based comparison would call it
missing and create a second webhook on the same event. Two webhooks on `lead_label_added` means two
deliveries per tag, which means two leads.

This is invariant 4 of the process document and the single most important rule in this workflow.

## Resolving the workspace

Four steps, first hit wins:

1. **explicit** — a `workspace_id` in the input. No search happens; this is how an operator answers
   a `needs_selection`.
2. **stored** — `client_sequencers.external_workspace_id` for this client. For an already-wired
   client the answer is in the database.
3. **name** — an *exact* match against `GET /api/v2/workspaces` (the **`Aimfox Master`** credential;
   it answers `500` to a workspace-scoped key, so the master is not an optimisation but the only way).
4. otherwise → `state: needs_selection` plus a candidate list.

**Step 2 is doing most of the work, and step 3 far less than it looks.** Measured 2026-08-07: the
client name equals the workspace name for only **4 of 9** wired clients — `Bent Iron PL` vs
`Bent Iron`, `FortumEnergia` vs `Fortum`, `ColdUnicorn PL` vs `Łukasz Kot`, `EvidencePrime` vs
`Evidence Prime`, `FitMech` vs `Pivotal Kamil`. Before step 2 existed, Bent Iron PL fell to
`needs_selection` despite its workspace being recorded in the database (execution `70393`).

The candidate list **excludes every workspace already present in `client_sequencers`**, for any
client and any sequencer. Without that filter the operator is offered workspaces that belong to
other clients — which is exactly how GIC's workspace came to sit on Prac.Finansowa, an Inactive
client, and would have created GIC's leads under the wrong name.

An inexact match is never assumed. Assigning the wrong workspace is invisible downstream: the leads
simply appear for someone else.

## Reusing a key instead of minting a second

`POST /api/v2/workspaces/{id}/tokens` **mints an additional token every time it is called** — it is
not an upsert. So `Effective Key` checks two places before `Mint Key` is ever reached:

1. `client_sequencers.api_key` — present → `ok`, nothing happens.
2. `GET /api/v2/workspaces/{id}/tokens` (master) — the vendor already holds one → reuse it, and
   `Record` stores it so the next run finds it in step 1.
3. Neither, and `dry_run: false` → `Need Mint?` opens and `Mint Key` runs.

Step 2 is what stops Natalia Kobielska's workspace from ending up with two tokens: the old canvas
already minted her one and never stored it.

**The token list returns the secret itself** — confirmed 2026-08-07 in execution `70395`, where
`tokens[].token` held the live key alongside `id`, `name`, `read`, `write`. Reuse is therefore
always possible, and on a dry run against a keyless workspace nothing is minted at all: the run
reports `key: missing` and says why.

## What it must never do

- Create anything outside the canonical set. A workspace belongs to the client; we are a guest.
- Delete anything, ever.
- Return `api_key` to its caller. The gateway derives booleans; the key stays server-side.
- Run against a workspace resolved by a fuzzy name match.

## Idempotency

Every step reads before it writes. Running the workflow twice must produce an identical result the
second time, with every step reporting `ok`. See `idempotency` in
[`manifest.yaml`](manifest.yaml).

## Verification

Acceptance criteria live in the
[process document](../../../../../docs/reference/processes/ops/workspace-provisioning.md#acceptance-criteria).
In short:

| Target | Expected |
|---|---|
| Kaizen Rent (fully wired) | every step `ok`; vendor webhook + label lists identical before and after |
| FortumEnergia | reports the missing `preMQL` label |
| GIC | reports the missing `MQL` label |
| Natalia Kobielska `9567c4bd…` | key and webhooks already exist, no client row — provisions without creating a second webhook |
| any target, run twice | second run creates nothing |

## Verified

**2026-08-07, executions `70399`–`70406`** — read path proven against production, five real clients,
`dry_run` only, nothing written anywhere:

| Client | State | Resolved by | Finding |
|---|---|---|---|
| Kaizen rent | `configured` | stored | — |
| Bent Iron PL | `configured` | stored | — |
| Audytel | `configured` | stored | — |
| **FortumEnergia** | `partial` | stored | label **`preMQL` missing** — no preMQL lead can be created there |
| **GIC** | `partial` | stored | label **`MQL` missing** |

The last two are the drifts that had only ever been found by hand. Candidate filtering was proven
separately in execution `70393`: 12 workspaces minus 9 claimed left exactly the three unclaimed ones.

**The write path is built but not yet exercised.** Nothing in the table above involved a write, and
no run with `dry_run: false` has happened yet. `state: client_not_found` and `needs_selection` are
likewise unproven against a real run.

## History

- **2026-08-07** — process document, manifest, contracts and fixtures written; read-only graph
  created as `ehhFUR3SYIxDahER`, inactive. First runs exposed two defects, both fixed the same day:
  the resolver ignored the stored workspace id, and a client that did not resolve ended the run
  silently with `status: success`.
- **2026-08-07, later** — iteration 2: the write half, 11 nodes → 21. Deployed from the committed
  artifact with `pnpm n8n:deploy`, which grew `--rewire` and `--credentials-from` for the purpose —
  the graph had to gain two edges and two credential-bearing nodes, and neither was expressible
  before. Still inactive; still never run with `dry_run: false`.
