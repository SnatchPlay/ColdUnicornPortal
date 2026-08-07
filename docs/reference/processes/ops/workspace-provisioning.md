# Process · Workspace provisioning (Aimfox and Bison)

**Domain:** ops · **Owner:** automation · **Status:** **contract accepted; no workflow implements it yet**
**Governing ADRs:** [ADR-0012](../../../adr/0012-multi-sequencer-model.md) (per-client vendor
credentials live in `client_sequencers`),
[ADR-0016](../../../adr/0016-repository-as-automation-source-of-truth.md) (this document wins over
any workflow), [ADR-0008](../../../adr/0008-orm-gateway-edge-function.md) (the portal never calls a
vendor directly)

> **Level 1 document.** This describes what the rule *is*. Where it disagrees with a running n8n
> workflow, the workflow is wrong.

---

## Business purpose

A client cannot receive a single lead until their sending workspace is wired to us. "Wired" is not
one fact but five: the workspace is identified, an API key exists and is stored, the webhooks point
at our endpoints, the qualification labels/tags exist, and the campaigns we depend on exist.

Today this is a manual operation performed by editing a hardcoded n8n canvas
(`8uRWXHe9FIfglq1u`). It has no notion of "already done", so it can only be run once per client,
by hand, by someone who knows which URL to edit.

The cost of that is measurable. Every one of the following was found on 2026-08-06/07, and none of
them was visible from any screen:

| Client / workspace | What was wrong | Cost |
|---|---|---|
| Audytel `02e041a6…` | no `client_sequencers` row at all | 3 preMQL leads and 6 replies silently dropped |
| GIC `74cccc2b…` | Aimfox token pasted on the CS PDCA row of **Prac.Finansowa** (a different, Inactive client) | leads would have been created for the wrong client |
| Natalia Kobielska `9567c4bd…` | key and both webhooks exist in Aimfox, no client anywhere | 2 leads nowhere |
| FortumEnergia `b39609cf…` | label `preMQL` does not exist | **no preMQL lead can ever be created** |
| GIC `74cccc2b…` | label `MQL` does not exist | no MQL lead can ever be created |

The process exists so that "is this client wired?" is a question the portal can answer, and
"wire it" is an action a manager can take.

## Definitions

| Term | Meaning |
|---|---|
| **Workspace** | A vendor tenant. Aimfox: a UUID. Bison: an integer id. One workspace serves exactly one client. |
| **Master key** | An agency-level credential that can enumerate workspaces and mint per-workspace keys. Aimfox and Bison each have one. It lives only in n8n. |
| **Workspace key** | The per-client API key every ingestion workflow authenticates with. Stored in `client_sequencers.api_key`. |
| **Provisioning** | Bringing a workspace from "exists at the vendor" to "fully wired", by adding only what is missing. |
| **Canonical set** | The closed list of webhooks, labels/tags and campaigns a wired workspace must have. Anything else in the workspace is the client's business, not ours. |
| **Partially provisioned** | Some elements of the canonical set exist and others do not. This is the normal state, not an error. |

## The canonical set

Measured across all 9 wired Aimfox workspaces on 2026-08-07.

**Aimfox**

| Element | Identity | Value |
|---|---|---|
| webhook | `url` + `events` | `[reply]` → `https://n8n.coldunicorn.com/webhook/aimfox-classifier` |
| webhook | `url` + `events` | `[lead_label_added]` → `https://n8n.coldunicorn.com/webhook/preMQL-Aimfox` |
| label | `name` | `preMQL` (yellow) |
| label | `name` | `MQL` (success) |
| campaigns | — | catalogued by [`aimfox-campaign-sync`](../../../../automation/n8n/workflows/ingestion/aimfox-campaign-sync/README.md), not created by us |

**Bison** — measured across all 16 Active Bison workspaces on 2026-08-07 (read-only `GET
/api/webhook-url` + `GET /api/tags` with each workspace's own key).

| Element | Identity | Value | Found in |
|---|---|---|---|
| webhook | `url` + `events` | `[lead_replied]` → `/webhook/replies-classification` | **16/16** |
| webhook | `url` + `events` | `[tag_attached, tag_removed]` → `/webhook/bison-replies-hub` | **16/16** |
| tag | `name` | `preMQL` | **16/16** |
| tag | `name` | `OOO` | **16/16** |
| campaign | `name` | `OOO automation \| general`, `\| male`, `\| female` — type `reply_followup`, each with a schedule and a sequence | see below |

### `MQL` is not a Bison tag we create

The plan of record said the Bison tag set was `{preMQL, MQL, OOO}`. Measurement says otherwise:
`MQL` exists in only **7 of 16** workspaces, while `preMQL` and `OOO` are in all 16.

It is not a nine-workspace gap. On Bison an MQL is produced by the **`Interested`** tag, which is a
Bison built-in present in 16/16 — [`bison-lead-enrichment`](../../../../automation/n8n/workflows/outreach/bison-lead-enrichment/workflow.json)
reads `names.includes('interested') || names.includes('mql')`, so `MQL` is an accepted alias and
nothing more. Nothing in the platform branches on a literal Bison `MQL` tag.

So creating `MQL` in the other nine workspaces would add clutter to a client's system and a second,
less-wired route to the same qualification. **The Bison tag canon is `preMQL` + `OOO`.** This is
the opposite of Aimfox, where `MQL` is a label we do create and GIC's absence of it is a real
defect — the two vendors genuinely differ, and one canonical set cannot serve both.

Ten further tags sit at 16/16 (`Automated Reply`, `Barracuda`, `Custom Mail Server`, `Google`,
`Interested`, `Meeting Booked`, `Mimecast`, `Outlook`, `Proofpoint`, `Zoho`). These are Bison's own
ESP-detection and classification tags, not ours. `NRR` is at 3/16 and is likewise not created here.

### The OOO campaign triple is the part that is not safe to automate yet

The three `OOO automation | …` campaigns are real canon — 15 of the 16 Active clients have all
three catalogued in `public.campaigns`. But two things block creating them:

**They have already been created twice for one client.** Bent Iron PL has **six**: external ids
629/630/631 from 2026-04-21 and 937/938/939 from 2026-06-30. Four are still `active` at the vendor.
`client_ooo_routing` points at the June set, so the April three are orphaned and live in the
client's workspace doing nothing. That is defect 6 — no idempotency — with a named victim, and it
is the single strongest argument for read-before-write.

**The sequence copy is not ours to author.** All three `sequence-steps` bodies on the old canvas
are byte-identical (1931 characters each), written in feminine Polish (`Pani`, `wróciła Pani`), and
carry a hardcoded `{PANIEKAMILU}` placeholder. So the male/female split exists in the campaign name
only; the copy behind all three is the same female-gendered text. Whatever the intended male and
general variants are, they are not in the canvas and cannot be invented here — the copy is business
content and must come from the client-facing source of truth.

Consequence: `bison-workspace-setup` **reports** which of the three campaigns are missing and does
not create them. Step 6 stays `missing` with a reason until the three real copy variants exist.

### `DNC` is not in the canonical set either

It exists in 3 of 9 Aimfox workspaces; that is a client preference, not our contract, and
provisioning must not create it.

### Bison webhook names vary too

UniTalk's `lead_replied` webhook is named **`Reply Classification`**; everywhere else it is
`Reply classification`. Same URL, same event, different string. The url + events identity rule
(invariant 4) is therefore not an Aimfox-specific precaution — it is load-bearing on both vendors,
and a name comparison would have created a seventeenth webhook here.

## Triggering events

| Event | Source | Effect |
|---|---|---|
| A client is created in the portal | `createClient` | provisioning runs for both sequencers, applying immediately |
| A manager presses **Налаштувати** on a client | portal | provisioning runs for the named sequencer |
| A manager presses **Перевірити** | portal | provisioning runs in `dry_run` — reports, writes nothing |

There is **no scheduled drift check**. A workspace's state is only re-read when someone asks. This
is a deliberate scope decision: it means a label deleted at the vendor stays invisible until the
next run, and that is accepted.

## Preconditions

- The client exists in `public.clients`.
- The relevant master key is configured as an n8n credential (`Aimfox Master`, `Bison Master`).
- For a workspace to be resolvable by name, the vendor workspace name must equal the client name.
  When it does not — which is common — the workspace must be chosen explicitly from a list.

## Main flow

Seven steps, per sequencer. **Every step reads before it writes.** A step that finds what it needs
already present reports `ok` and does nothing.

```
1. resolve client        clients.name
2. resolve workspace     explicit id → the one already stored for this client →
                         exact name match → candidates
3. key                   client_sequencers.api_key present?  → ok
                         else the vendor already has a usable token? → reuse it
                         else mint one; either way upsert the connector row
4. webhooks              vendor list → compare on url + events → create only what is missing
5. labels / tags         vendor list → compare on name → create only what is missing
6. campaigns             Aimfox: hand off to aimfox-campaign-sync
                         Bison:  vendor list → compare on name → REPORT what is missing
                                 (creating them is blocked on real copy — see the canonical set)
7. record                setup_state on client_sequencers + a row in integration_sync_runs
```

The outcome is one of five states:

| State | Meaning |
|---|---|
| `configured` | every element of the canonical set is present |
| `partial` | some are present, some were missing (and were created, unless `dry_run`) |
| `missing` | the workspace resolved but nothing was wired |
| `needs_selection` | the workspace could not be resolved unambiguously — a human must choose |
| `client_not_found` | the `client_id` matched no client with an enabled connector |

`client_not_found` is not defensive padding. Without it, a `client_id` that resolved to nothing
ended the run with `status: success` and no output at all — a silent success, the same failure
shape that lost Audytel's leads. Every terminal path has to say something.

## Alternative flows

**Name matching is the weak link, and is only for new clients.** Measured 2026-08-07: the client
name equals the workspace name for just **4 of 9** wired clients — `Bent Iron PL` vs `Bent Iron`,
`FortumEnergia` vs `Fortum`, `ColdUnicorn PL` vs `Łukasz Kot`, `EvidencePrime` vs `Evidence Prime`,
`FitMech` vs `Pivotal Kamil`. That is why resolution consults the stored workspace id first: for an
already-wired client the answer is in the database and no search is needed. Name matching only ever
runs for a client that has never been wired, and for those, landing in `needs_selection` is the
expected outcome rather than a failure.

**Name does not resolve.** Zero matches, or more than one, terminates in `needs_selection` and
returns the candidate list. The list is filtered: a workspace whose id already sits in
`client_sequencers` for any client is **never offered**. The manager picks; provisioning is
re-invoked with an explicit workspace id.

**Client has no workspace at the vendor yet.** Legitimate at creation time — a workspace is often
created days later. The state is `needs_selection` with an empty candidate list, and the manager
re-runs provisioning later. This is why provisioning must be re-runnable, not a one-shot at
creation.

**A key exists at the vendor but we never stored it.** Exactly the Natalia Kobielska shape — the old
canvas minted her a token and left. Step 3 reads the vendor's token list first and reuses what is
there rather than minting a second, subject to the open question above.

## Cancellation and terminal states

Provisioning has no long-running state and nothing to cancel. It is a single synchronous pass that
either reports a state or fails. There is no "half-applied" record: each step records its own
outcome, so a failure at step 5 still leaves steps 1–4 recorded as done.

## Business invariants

1. **A workspace belongs to exactly one client.** Enforced in the database by
   `client_sequencers_workspace_uk` — `UNIQUE (sequencer_id, external_workspace_id)` where the
   workspace id is not null. The constraint prevents a *duplicate*; it cannot prevent a *wrong*
   assignment, which is how GIC's workspace came to sit on Prac.Finansowa. Only invariant 2
   prevents that.
2. **A workspace is never assigned on a guess.** An inexact or ambiguous name match must terminate
   in `needs_selection`. Assigning the wrong workspace routes a client's leads to another client and
   is not detectable downstream.
3. **Provisioning is idempotent.** Running it twice must create nothing the second time. This is not
   a nicety: a duplicated webhook produces two deliveries per event, which produces two leads.
4. **A webhook is identified by `url` + `events`, never by its name.** GIC's `lead_label_added`
   webhook is called `Manual Tag`; matching on name would create a second webhook on the same event.
5. **The canonical set is closed.** Provisioning creates exactly what this document lists. It never
   deletes anything and never creates anything else — a workspace is the client's, and we are a
   guest in it.
6. **Creating a webhook or a campaign is irreversible in effect.** Not because the vendor forbids
   deletion, but because a duplicate immediately produces duplicate business records. Treat step 4
   and step 6 as write-once.
7. **Master keys never leave n8n.** They are not stored in Postgres, never returned to the browser,
   and never written into a workflow parameter ([security §8](../../n8n/security.md)).
8. **The portal never calls a vendor.** It asks n8n to do it ([ADR-0008](../../../adr/0008-orm-gateway-edge-function.md),
   [CLAUDE.md §7](../../../../CLAUDE.md)).

## Data ownership

| Fact | Owner |
|---|---|
| workspace id, workspace key | `client_sequencers` (`external_workspace_id`, `api_key`) |
| what is wired, and when we last looked | `client_sequencers.setup_state`, `setup_checked_at` |
| who ran provisioning and what happened | `integration_sync_runs` (`sync_type = 'workspace_setup'`) |
| webhooks, labels/tags, campaigns | the vendor — we hold no mirror of them beyond `setup_state` |

`setup_state` is a **cache of the last look**, not a source of truth. It is only as fresh as the
last run. Nothing may make a business decision from it; it exists to render a status.

## Database entities

- [`client_sequencers`](../../functional/11-integrations.md) — the row this process creates or completes.
  `setup_state jsonb not null default '{}'` and `setup_checked_at timestamptz` were added by
  [`20260807_workspace_setup_state.sql`](../../../../supabase/migrations/20260807_workspace_setup_state.sql).
  A `check (jsonb_typeof(setup_state) = 'object')` rejects a wrong-shaped write at the source
  rather than letting the portal render nonsense.
- `integration_sync_runs` — the audit trail, shared with `automation-failure-recorder`.
  `sync_type = 'workspace_setup'`, `provider = 'aimfox' | 'bison'`. Both columns are free text and
  the table already carries a UNIQUE on `n8n_execution_id`, so no schema change was needed.

No new table. A queue table was considered and rejected: the portal triggers n8n synchronously.

**RLS is inherited, not extended.** `client_sequencers` is gated at table level on
`private.can_manage_client(client_id)`, so the two new columns are scoped exactly as `api_key`
already is. Verified 2026-08-07 on the local stack with `EXPLAIN (ANALYZE, BUFFERS)` as the
`authenticated` role, per role, before and after: admin 48 rows, manager 3, **client 0**. Numbers
and method are in the migration comment.

Three states have nowhere to be stored, and that is deliberate:

| Situation | Where it lives |
|---|---|
| never checked | the row exists, `setup_state = '{}'`, `setup_checked_at is null` |
| no connector at all | **no row** — the portal renders this as `missing`, never as `unknown` |
| `needs_selection` before any row exists | not persisted; it is the synchronous answer to the operator, who then re-runs with an explicit `workspace_id` |

## RPC / API contracts

Every step has a read endpoint, which is what makes invariant 3 achievable without a local mirror.

| Vendor | Read | Write |
|---|---|---|
| Aimfox | `GET /api/v2/workspaces` (master) | — |
| Aimfox | `GET /api/v2/workspaces/{id}/tokens` (master) | `POST /api/v2/workspaces/{id}/tokens` (master) |
| Aimfox | `GET /api/v2/webhooks` | `POST /api/v2/webhooks` |
| Aimfox | `GET /api/v2/labels` | `POST /api/v2/labels` |
| Bison | `GET /api/workspaces/v1.1` (master) | `POST /api/workspaces/v1.1/{id}/api-tokens` (master) |
| Bison | `GET /api/webhook-url` | `POST /api/webhook-url` |
| Bison | `GET /api/tags` | `POST /api/tags` |
| Bison | `GET /api/campaigns` | `POST /api/campaigns` + `/schedule` + `/sequence-steps` |

Both `GET /api/v2/workspaces` and `GET /api/v2/workspaces/{id}/tokens` answer 500 to a
workspace-scoped key — the routes exist and require the master.

**The token list returns the secret itself**, not just metadata — measured 2026-08-07 in execution
`70395`: `tokens[].token` holds the live key, alongside `id`, `name`, `read`, `write`. So step 3 can
always reuse an existing key and never has to mint a second one. This is what keeps Natalia
Kobielska's workspace — where the old canvas minted a token and never stored it — from accumulating
one token per provisioning attempt.

## Portal surfaces

- Clients page — a provisioning status column, read from `setup_state`.
- Client drawer — a per-sequencer section showing the five facts, with **Перевірити** (`dry_run`)
  and **Налаштувати**. Internal roles only; a `client` never sees it.
- Client creation — provisioning is requested automatically for both sequencers.

## Dashboard metrics

None. Provisioning is an operational process, not a measured one.

## Related n8n workflows

[`aimfox-workspace-setup`](../../../../automation/n8n/workflows/ops/aimfox-workspace-setup/README.md)
(`ehhFUR3SYIxDahER`, inactive) implements **steps 1, 2, 4 and 5 as reads only** — it reports what is
present and creates nothing. Verified against production 2026-08-07, executions `70399`–`70406`:
Kaizen rent, Bent Iron PL and Audytel returned `configured`; FortumEnergia returned `partial` with
`preMQL` missing and GIC `partial` with `MQL` missing — the two drifts previously found only by
hand. The write half, and `bison-workspace-setup`, do not exist yet.

`8uRWXHe9FIfglq1u` ("My workflow 6", orphan, inactive) is the current reality and **contradicts this
document** on invariants 3, 4 and 5: every node is an unconditional POST, no vendor state is read,
and it creates a `DNC` label. It also carries three defects of its own — two of the three
`sequence-steps` calls write to the `general` campaign instead of their own, and one node reference
is broken so the female branch cannot complete. It must not be run again as-is.

## Failure handling

- Each vendor call continues on error and records its own step outcome, so one 4xx produces
  `partial` rather than an unexplained stop midway.
- `settings.errorWorkflow` points at
  [`automation-failure-recorder`](../../../../automation/n8n/workflows/ops/automation-failure-recorder/README.md),
  so a failed run also becomes an `integration_sync_runs` row.
- A failed run leaves the workspace partially provisioned. That is safe **because** of invariant 3:
  re-running completes it.

## Security considerations

- Master keys are the highest privilege we hold in either vendor: they can enumerate every client's
  workspace and mint keys in any of them. They live only as n8n credentials.
- The provisioning webhooks must require authentication. The existing Aimfox ingestion webhooks do
  not ([security §3](../../n8n/security.md)) — that defect must not be copied here.
- `client_sequencers` holds live vendor keys. No gateway action may return `api_key` to the browser;
  status is derived server-side into booleans.

## Acceptance criteria

1. Running provisioning against an already-wired workspace creates nothing, and the vendor's
   webhook/label lists are byte-identical before and after.
2. Running it twice in a row produces an identical result the second time.
3. `dry_run` against FortumEnergia reports the missing `preMQL` label; against GIC, the missing `MQL`.
4. A client whose name does not match any workspace terminates in `needs_selection`, and the
   candidate list excludes every workspace already claimed in `client_sequencers`.
5. Natalia Kobielska's workspace — key and webhooks present, no client — provisions to `configured`
   without creating a second webhook.
6. No `api_key` value appears in any gateway response.

## Related ADRs

- [ADR-0008](../../../adr/0008-orm-gateway-edge-function.md) — the portal talks to Postgres through
  the gateway and never to a vendor.
- [ADR-0012](../../../adr/0012-multi-sequencer-model.md) — per-client vendor credentials belong to
  `client_sequencers`.
- [ADR-0016](../../../adr/0016-repository-as-automation-source-of-truth.md) — this document beats the
  workflow.
- ADR-0018 (to be written) — the one class of outbound call the gateway is permitted to make.
