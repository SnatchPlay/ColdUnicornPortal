# bison-workspace-setup

**Logical ID:** `bison-workspace-setup` · **Domain:** `ops` · **Criticality:** high
**Remote (production):** not created yet
**Business process:** [Workspace provisioning](../../../../../docs/reference/processes/ops/workspace-provisioning.md)
**Status:** contract and manifest written; the graph does not exist yet
**Sibling:** [`aimfox-workspace-setup`](../aimfox-workspace-setup/README.md) — same contract, same
shape, different vendor

## Business purpose

Bring one client's Bison workspace from "exists at the vendor" to "fully wired", by adding **only
what is missing**: the workspace key, two webhooks, two tags.

It replaces the Bison half of `8uRWXHe9FIfglq1u` ("My workflow 6") — a hand-run canvas with
workspace `13` hardcoded into every URL, no notion of what already exists, and no error handling.

## Contract

```
IN   contracts/setup-input.schema.json
OUT  contracts/setup-result.schema.json
```

Deliberately the same shape as the Aimfox result, so the portal renders one component for both
sequencers. Two differences matter to a caller:

- **`workspace_id` is a numeric string** (`"73"`, `"125"`), not a UUID. Anything that handles both
  sequencers must not assume one id format.
- the third step is called **`tags`**, where Aimfox says `labels`.

## The canonical set

Measured across all **16 Active Bison workspaces** on 2026-08-07, read-only, with each workspace's
own key:

| Element | Matched on | Value | Found in |
|---|---|---|---|
| webhook | `url` + `events` | `[lead_replied]` → `/webhook/replies-classification` | 16/16 |
| webhook | `url` + `events` | `[tag_attached, tag_removed]` → `/webhook/bison-replies-hub` | 16/16 |
| tag | `name` | `preMQL` | 16/16 |
| tag | `name` | `OOO` | 16/16 |

### `MQL` is not in it — and that is the headline

The plan said the Bison tag set was `{preMQL, MQL, OOO}`. It is not. `MQL` is present in **7 of
16** workspaces, and its absence in the other nine is not a gap: on Bison an MQL is produced by the
**`Interested`** tag, a Bison built-in present in all 16.
[`bison-lead-enrichment`](../../outreach/bison-lead-enrichment/workflow.json) reads
`names.includes('interested') || names.includes('mql')`, so a literal `MQL` tag is an accepted
alias and nothing else — no workflow branches on it.

Creating it in the other nine would add clutter to a client's system and a second, less-wired route
to the same qualification.

This is the exact opposite of Aimfox, where `MQL` **is** a label we create and GIC's missing one is
a real defect. Two vendors, two canonical sets. Copying one to the other is how you get nine
pointless tags or one missing label.

Ten more tags sit at 16/16 — `Automated Reply`, `Barracuda`, `Custom Mail Server`, `Google`,
`Interested`, `Meeting Booked`, `Mimecast`, `Outlook`, `Proofpoint`, `Zoho`. Those are Bison's own
ESP-detection and classification tags. `NRR` is at 3/16. None of them are ours to create.

## Why webhooks are matched on url + events, never on name

UniTalk's `lead_replied` webhook is named **`Reply Classification`**. Every other workspace calls it
`Reply classification`. Same URL, same event, one capital letter apart.

A name comparison would call UniTalk's missing and create a seventeenth webhook on `lead_replied` —
two deliveries per reply, two leads. The url + events rule is invariant 4 of the process document,
and this is the second vendor to independently prove it necessary (on Aimfox it was GIC's
`Manual Tag`).

## Resolving the workspace

Four steps, first hit wins — identical to Aimfox except for the endpoint:

1. **explicit** — a `workspace_id` in the input.
2. **stored** — `client_sequencers.external_workspace_id` for this client. All 43 Bison connectors
   already have one, so for an existing client this is the answer.
3. **name** — an exact match against `GET /api/workspaces/v1.1` (the **`Bison Master`**
   credential). The response carries `personal_team`, `main` and `parent_id`, which is what lets an
   operator distinguish two same-named rows.
4. otherwise → `state: needs_selection` plus a candidate list, filtered to exclude every workspace
   id already present in `client_sequencers`.

An inexact match is never assumed. Assigning the wrong workspace is invisible downstream: the leads
simply appear for someone else.

## The key step reads first, too

`POST /api/workspaces/v1.1/{id}/api-tokens` mints a token; it is not an upsert. So:

1. `client_sequencers.api_key` present → `ok`, nothing happens.
2. otherwise mint, and **store it** in the connector row.

Step 2's second half is the fix for a defect in the old canvas: it consumed the fresh token inline
as `$('Create API key Bison').item.json.data.plain_text_token` and never wrote it anywhere. A token
that exists only inside one execution is a token nobody can use tomorrow — the same shape as
Natalia Kobielska's orphaned Aimfox key.

Unlike Aimfox there is no `GET .../api-tokens` to fall back on, so a workspace whose key was minted
and lost cannot be recovered by reading; it gets a second token. That asymmetry is worth knowing
before the write nodes are built.

## Campaigns are reported, never created

The three `OOO automation | general / male / female` campaigns are genuine canon — 15 of 16 Active
clients have all three. This workflow still will not create them, for two independent reasons:

**It has already gone wrong once.** Bent Iron PL has **six**: ids 629/630/631 from 2026-04-21 and
937/938/939 from 2026-06-30, four of them still `active` at the vendor. `client_ooo_routing` points
at the June set; the April three are orphans sitting in the client's workspace. That is what a
non-idempotent create looks like in production.

**The copy is not ours to write.** All three `sequence-steps` bodies on the old canvas are
byte-identical (1931 characters each), in feminine Polish (`Pani`, `wróciła Pani`), with a
hardcoded `{PANIEKAMILU}` placeholder. The male/female split exists in the campaign name only. The
real variants are business content and have to come from the client-facing source of truth, not
from an agent.

So step `campaigns` reports `ok` or `missing` and never `created`.

## What it must never do

- Create anything outside the canonical set — no `MQL`, no `NRR`, no campaigns.
- Delete anything, ever.
- Return `api_key` to its caller.
- Run against a workspace resolved by a fuzzy name match.

## Idempotency

Every step reads before it writes. Running twice must produce an identical result the second time,
with every step reporting `ok`. See `idempotency` in [`manifest.yaml`](manifest.yaml).

## Verification

Acceptance criteria live in the
[process document](../../../../../docs/reference/processes/ops/workspace-provisioning.md#acceptance-criteria).

| Target | Expected |
|---|---|
| any Active client | both webhooks and both tags `ok`; campaigns `ok` |
| UniTalk (`36`) | webhook step `ok` despite the differing name — the url + events proof |
| a client without `MQL` (9 of 16) | still `configured`; `MQL` is not in the canonical set |
| Bent Iron PL (`73`) | campaigns `ok`; the duplicate set is reported, never "fixed" by creating more |
| any target, run twice | second run creates nothing |

## History

- **2026-08-07** — canonical set measured across all 16 Active workspaces; manifest and contracts
  written. Two corrections to the plan of record came out of the measurement: `MQL` is not a Bison
  tag we create, and the OOO campaign triple cannot be created until its copy exists.
