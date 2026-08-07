# aimfox-workspace-setup

**Logical ID:** `aimfox-workspace-setup` · **Domain:** `ops` · **Criticality:** high
**Remote (production):** `ehhFUR3SYIxDahER` — **inactive**
**Business process:** [Workspace provisioning](../../../../../docs/reference/processes/ops/workspace-provisioning.md)
**Status:** read half built and proven against production; **no write node exists yet**, so a run
observes and reports and changes nothing, anywhere

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

Built today — 11 nodes, every one of them a read:

```
Start (executeWorkflowTrigger)
  └─ Resolve Client ─ Read Claimed ─ List Workspaces ─ Resolve Workspace ─ Resolved?
                                                                            ├─ no  → Needs Selection
                                                                            └─ yes → List Tokens
                                                                                     ─ List Webhooks
                                                                                     ─ List Labels
                                                                                     ─ Build Result
```

`Read Claimed` is the one node whose purpose is not obvious: it reads every
`external_workspace_id` already present in `client_sequencers`, so `Resolve Workspace` can subtract
them from the candidate list.

Still to come, in this order — writes (iteration 2), then the webhook entry point (ADR-0018):

```
… Resolved? ─ yes ─ Ensure Key ─ Ensure Webhooks ─ Ensure Labels ─ Sync Campaigns ─ Record Run
```

## The canonical set

What "wired" means for Aimfox — measured across all 9 wired workspaces on 2026-08-07:

| Element | Matched on | Value |
|---|---|---|
| webhook | `url` + `events` | `[reply]` → `/webhook/aimfox-classifier` |
| webhook | `url` + `events` | `[lead_label_added]` → `/webhook/preMQL-Aimfox` |
| label | `name` | `preMQL` (yellow) |
| label | `name` | `MQL` (success) |

Campaigns are **not** created here — they are the client's, and
[`aimfox-campaign-sync`](../../ingestion/aimfox-campaign-sync/README.md) catalogues them. Step 6
hands off to it so a freshly-keyed client gets a campaign catalogue immediately rather than up to
two hours later.

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

## The key step reads first, too

`POST /api/v2/workspaces/{id}/tokens` **mints an additional token every time it is called** — it is
not an upsert. So step 3 checks two places before it writes:

1. `client_sequencers.api_key` — present → `ok`, nothing happens.
2. `GET /api/v2/workspaces/{id}/tokens` (master) — the vendor already holds one → reuse it.
3. Neither → mint, and store it.

Step 2 is what stops Natalia Kobielska's workspace from ending up with two tokens: the old canvas
already minted her one and never stored it.

**The token list returns the secret itself** — confirmed 2026-08-07 in execution `70395`, where
`tokens[].token` held the live key alongside `id`, `name`, `read`, `write`. Reuse is therefore
always possible and minting a second token is never necessary.

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

Not yet proven: the write path (it does not exist), and `state: client_not_found`.

## History

- **2026-08-07** — process document, manifest, contracts and fixtures written; read-only graph
  created as `ehhFUR3SYIxDahER`, inactive. First runs exposed two defects, both fixed the same day:
  the resolver ignored the stored workspace id, and a client that did not resolve ended the run
  silently with `status: success`.
