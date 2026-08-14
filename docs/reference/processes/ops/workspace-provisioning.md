# Process · Workspace provisioning (Aimfox and Bison)

**Domain:** ops · **Owner:** automation · **Status:** **live.** Both workflows are active and
provisioning is reachable from the portal. Three gaps remain and are recorded, not hidden: the
webhooks are unauthenticated by decision (security finding 11, review 2026-11-30); the Bison write
path has never had anything to create — no Active workspace is missing a canonical tag or a
campaign, so it will run for real the first time a new client is onboarded; and
`bison-campaign-sync` types a new OOO campaign `nurture` rather than `ooo_followup` (see *The OOO
campaign triple*).
**Governing ADRs:** [ADR-0012](../../../adr/0012-multi-sequencer-model.md) (per-client vendor
credentials live in `client_sequencers`),
[ADR-0016](../../../adr/0016-repository-as-automation-source-of-truth.md) (this document wins over
any workflow), [ADR-0008](../../../adr/0008-orm-gateway-edge-function.md) (the portal never calls a
vendor directly), [ADR-0018](../../../adr/0018-gateway-outbound-automation-trigger.md) (the gateway
may trigger the workflow, and nothing else outbound)

> **Level 1 document.** This describes what the rule *is*. Where it disagrees with a running n8n
> workflow, the workflow is wrong.

---

## Business purpose

A client cannot receive a single lead until their sending workspace is wired to us. "Wired" is not
one fact but five: the workspace is identified, an API key exists and is stored, the webhooks point
at our endpoints, the qualification labels/tags exist, and the campaigns we depend on exist. The
fifth is where the two vendors part company — on Bison the campaign is created and left as a draft
for a manager to fill in, because its content is copy we do not own.

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
| campaign | `name` | `OOO automation \| general`, `\| male`, `\| female` — type `reply_followup`, each with a schedule. The **sequence** is not part of the canonical set | see below |

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

### The OOO campaign triple: the container is ours, the copy is not

The three `OOO automation | …` campaigns are canon for 12 of the 16 Active Bison clients.
Provisioning creates the missing ones **as drafts**, since 2026-08-14, and never writes their copy.

This is a correction to the earlier reading of this section, not a reversal of the reason behind it.
The reason was always the copy, and the copy is a **separate vendor call**:

```
POST /api/campaigns                            { name, type: "reply_followup" }   ← ours
POST /api/campaigns/{id}/schedule              Mon-Fri 09:00-17:00 Europe/Warsaw  ← ours
POST /api/campaigns/v1.1/{id}/sequence-steps   the message                        ← NOT ours
```

**A campaign with no sequence is a `draft` and cannot send anything.** Treating the first two calls
as blocked by the third conflated a container with its content, and the cost of that was concrete:
provisioning left every new client three campaigns short, and OOO routing had nothing of its own to
point at — which is how FortumEnergia's routing came to point at GIC's campaigns.

**The sequence copy is still not ours to author.** All three `sequence-steps` bodies on the old
canvas are byte-identical (1931 characters each), written in feminine Polish (`Pani`, `wróciła
Pani`), and carry a hardcoded `{PANIEKAMILU}` placeholder. So the male/female split exists in the
campaign name only; the copy behind all three is the same female-gendered text. Whatever the
intended male and general variants are, they are not in the canvas and cannot be invented here — the
copy is business content and must come from the client-facing source of truth.

**So the handover is explicit.** Provisioning leaves three drafts with hours set. A **manager**
writes the three sequences in Bison and starts each campaign. Nothing in the platform starts a
Bison campaign, and provisioning must not either: starting one whose sequence nobody has written
would mean sending blank.

**The status is reported, never just the name.** `steps.campaigns.present` reads
`OOO automation | general (draft)`, because a bare name looks identical for a campaign that is
sending and one that never will be, and that difference is the manager's whole to-do list.

**A campaign that already exists is never touched**, whatever its status, and an existing schedule
is never overwritten — the hours are the client's (invariant 5). Only a campaign this run created
gets one. This is also what keeps the numbers below from becoming a duplication problem: Bent Iron
PL's `general` is `archived`, counts as present, and is not re-created.

**Four of sixteen Active clients do not have the triple**, and the gaps are not what the catalogue
says:

| Client | ws | `public.campaigns` | At the vendor |
|---|---|---|---|
| Bent Iron UA | 110 | 0 | not checked |
| ColdUnicorn PL | 2 | 0 | not checked |
| FortumEnergia | 125 | 0 | **0** — confirmed, execution `70465`: 4 campaigns, none OOO |
| Bent Iron PL | 73 | **6** | **3** — confirmed, execution `70464`: 32 campaigns, one of each |

Consequence: `bison-workspace-setup` creates the missing campaigns as drafts and reports the vendor
status of every one it found. What stays outstanding for these four is the **copy**, which is a
manager's task and not a provisioning state.

`state` does not include the campaign step, and did not change when the step started creating. The
old reason was that **Set up** could not fix a missing campaign; the new one is its mirror — a draft
is not a sending campaign, so counting it would let `configured` mean "ready to send" when nothing
can send yet. `configured` is exactly the word that stops someone checking.

### Provisioning also catalogues what it created

A campaign created at the vendor is not yet a campaign the portal can route to, and the gap is not
cosmetic. `bison-campaign-sync` maps the vendor's `reply_followup` to `campaign_type = 'nurture'`,
while [ADR-0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md) and
[`20260722g`](../../../../supabase/migrations/20260722g_ooo_campaigns_and_routing_seed.sql) say an
OOO campaign is `ooo_followup`. `type` is **not** in the sync's `ON CONFLICT` update list, so a row
keeps whatever type it was born with, forever. A `nurture` row is invisible to
`updateClientOooRouting`, which requires `type = 'ooo_followup'`
([orm-gateway/index.ts:3146](../../../../supabase/functions/orm-gateway/index.ts#L3146)) — so a
freshly provisioned client would have three campaigns and an empty routing dropdown.

So `Record` writes them itself, in the same statement as the connector row and the audit row, typed
`ooo_followup` and `draft`. The ownership split is explicit and the two writers never touch the same
column:

| Column | Owner |
|---|---|
| `type` | **provisioning**, once, at creation. The sync never updates it |
| `name`, `status`, `database_size`, `positive_responses` | `bison-campaign-sync`, hourly |
| the row's existence | whichever gets there first — `ON CONFLICT (external_id)` on both sides |

The write is bounded to the external ids **this run created**. It never reclassifies a campaign
provisioning did not make.

The general defect is closed too, in the sync rather than here:
[`bison-campaign-sync`](../../../../automation/n8n/workflows/ingestion/bison-campaign-sync/README.md)
now classifies an OOO campaign **by name** at insert time, so one created by hand in Bison also
arrives `ooo_followup`. Its name list includes the older `OOO campaign automation …` spelling that
`20260722g` could only catch by `external_id`. That fix stays insert-time: `type` must not move into
the sync's `ON CONFLICT` list, or the sync would start overwriting a classification it does not own.

The two changes agree by construction and cannot undo each other — provisioning writes the type when
it creates the campaign, the sync writes the same type if it gets there first, and neither updates
`type` on an existing row.

### Bent Iron PL's six campaigns are a stale catalogue, not six campaigns

This corrects an earlier reading of the same data. Bison workspace 73 holds **exactly one of each**
— `937` female `active`, `938` male `active`, `939` general `archived` — out of 32 campaigns across
three pages. External ids `629`/`630`/`631` from 2026-04-21 do not exist there at all.

They do exist in `public.campaigns`, marked `active`. The reason is
[`bison-campaign-sync`](../../../../automation/n8n/workflows/ingestion/bison-campaign-sync/workflow.json):
its statement is `INSERT … ON CONFLICT (external_id) DO UPDATE` and nothing else. **There is no
removal path.** A campaign deleted at the vendor keeps its row, and keeps whatever status it last
had, forever.

So the duplication is in our catalogue, not in the client's workspace — which is the more useful
finding, because a stale `active` campaign is something the portal will happily show and something
OOO routing can be pointed at. Which is exactly what happened next.

### FortumEnergia's OOO routing points at GIC's campaigns

`client_ooo_routing` has exactly three rows whose campaign belongs to a different client than the
routing itself, and all three are FortumEnergia → GIC (`950` general, `951` male, `952` female).

It follows directly from the row above: Fortum has no OOO campaigns of its own, so whoever wired
the routing picked from a list that was not scoped to the client. Eleven `pending` follow-ups for
Fortum currently carry `routing_key = 'general'`.

Nothing has been sent. The branch that actually enrols people in
[`ooo-enrol-followups`](../../../../automation/n8n/workflows/outreach/ooo-enrol-followups/workflow.json)
reads its campaign from the ARM sheet keyed by Bison workspace id, not from `client_ooo_routing`;
the Supabase branch is shadow-only in phase A and submits nothing
([ADR-0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md)). So this is a loaded
gun, not a fired one — it becomes live the moment phase B makes Supabase authoritative.

This is the same defect family as the Aimfox token that sat on Prac.Finansowa's row: a
client-scoped identifier chosen from an unscoped list. It is out of scope for provisioning to fix,
and it is in scope for provisioning to have found.

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
| A manager presses **Set up** on a client | portal | provisioning runs for the named sequencer, writing what is missing |
| A manager presses **Check** | portal | provisioning runs in `dry_run` — reports, writes nothing |
| A webhook is POSTed to the workflow | n8n | same two modes, driven by the payload's `dry_run` |

Creating a client does **not** trigger provisioning. It was planned to and does not: `createClient`
never calls `requestWorkspaceSetup` (the only caller is the drawer section). A new client's
workspace usually does not exist at the vendor yet at the moment the portal row is created, so an
automatic run would report `needs_selection` and teach operators to ignore the verdict. Someone
presses the button once the workspace exists.

What the **New client** form does instead is let the manager pick the workspace, and provision it on
save. No API keys and no ids are typed: `bison-workspace-setup` mints a token and stores it,
`aimfox-workspace-setup` re-reads the vendor's or mints one, and both resolve the workspace. The one
thing a human holds that the workflows cannot derive is *which* workspace is this client, and only
when the names differ — an exact-name match held for 4 of 9 clients when measured.

So each sequencer gets a **dropdown** — the same select the Manager and Status fields use. Opening
it calls provisioning in **listing mode** (`client_id: null`), which returns the vendor's workspaces
minus every one already claimed by another client. The list loads on first open, not with the form:
it is a live vendor round trip, and most sessions need neither vendor.

One workspace per vendor, never several. `client_sequencers` carries
`UNIQUE (client_id, sequencer_id)`, so a second choice has nowhere to be stored, and
`UNIQUE (sequencer_id, external_workspace_id)` means the database refuses a workspace another client
already holds even if the list were stale. On **Create client** the connector
row is written with the chosen id and provisioning runs for real (`dry_run: false`) against it,
sequentially per sequencer — each run is up to eight vendor calls inside one 45s gateway budget, and
two at once collects a pair of `unknown`s instead of one answer. A failure there is reported as
itself: the client exists, provisioning did not finish, run **Set up** from its card.

A client created with no workspace chosen is a supported starting state — `Resolve Client`
left-joins the connector in both workflows, verified by a live dry run against Fab.Marketingu (no
aimfox row) on 2026-08-09, which resolved the client and returned `needs_selection` rather than
`client_not_found`.

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
6. campaigns             Aimfox: create AutoConnect if absent, then activate it
                         Bison:  vendor list → compare on name → create what is missing as a
                                 DRAFT + schedule. The sequence is never written and the campaign
                                 is never started — a manager does both (see the canonical set)
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

In the portal each candidate is a **button** in the card, not a name to read and retype: pressing
one re-runs as a check with that `workspace_id`. The card then **holds that pick** for as long as it
is open, and every later run from it — including **Set up** — carries the same id. That is not a
convenience. For a client that already has a connector row, `Record` persists the id on the check
itself, because its `ON CONFLICT` branch coalesces a null `external_workspace_id` and `dry_run`
protects the vendor rather than our database. For a **new** client there is no row, and `Record`'s
`INSERT … SELECT … WHERE` correctly refuses to create one on a check — so nothing stores the pick,
and a Set up sent without it would resolve from scratch and land back in `needs_selection`.

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
   and step 6 as write-once. A campaign found by name is present whatever its status — `draft`,
   `archived` or `active` — and is never re-created, never re-scheduled and never started.
7. **Master keys never leave n8n.** They are not stored in Postgres, never returned to the browser,
   and never written into a workflow parameter ([security §8](../../n8n/security.md)).
8. **The portal never calls a vendor.** It asks n8n to do it ([ADR-0008](../../../adr/0008-orm-gateway-edge-function.md),
   [CLAUDE.md §7](../../../../CLAUDE.md)).
9. **Provisioning creates containers, never content.** Added 2026-08-14 with the Bison campaign
   drafts, and appended rather than slotted next to invariant 5 because 1–8 are cited by number
   from both contracts, both READMEs and `view-contracts.ts`. It may create a campaign and set its
   hours; it must never write a sequence, a subject or a body, and must never start a campaign that
   has no sequence. Copy is business content and comes from the client-facing source of truth —
   this is the rule the old canvas broke by shipping the same feminine-Polish body into all three
   campaigns.

## Data ownership

| Fact | Owner |
|---|---|
| workspace id, workspace key | `client_sequencers` (`external_workspace_id`, `api_key`) |
| what is wired, and when we last looked | `client_sequencers.setup_state`, `setup_checked_at` |
| who ran provisioning and what happened | `integration_sync_runs` (`sync_type = 'workspace_setup'`) |
| webhooks and labels/tags | the vendor — we hold no mirror of them beyond `setup_state` |
| a created campaign's `campaigns.type` | **provisioning**, written once so OOO routing can see it |
| that campaign's `name`, `status`, counters | `bison-campaign-sync`, hourly |

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
| `needs_selection` before any row exists | not persisted — nothing to write to. It is the synchronous answer to the operator, whose pick the card holds and replays on the next run (see *Name does not resolve*) |


### The Aimfox `AutoConnect` campaign

Provisioning creates it, since 2026-08-09. It is what
[`aimfox-import-to-connection`](../../../../automation/n8n/workflows/outreach/aimfox-import-to-connection/README.md)
feeds, and that workflow was measured importing leads for **0 of 9** clients because no workspace has
a campaign by that name — the gap this closes.

Three vendor facts shape it, all from live calls rather than documentation:

- `POST /campaigns` wants **`account_ids`**; `owners` is only the read shape and a body copied from
  it returns `422`.
- A created campaign is born **`INIT`** and the import filter requires `ACTIVE`, so activation is a
  second call on its own branch after `Merge Outcomes` — not a `Plan Writes` item, because a
  campaign that exists but is paused needs no `POST`, and planning it there would leave `Plan Writes`
  with zero items and strand the run short of `Record`.
- The **schedule cannot be set through the API**: `POST` and `PATCH` both answer `200` and ignore it.
  An auto-created campaign therefore runs 9–17 **seven days a week** against a 22-of-22 house
  convention of Mon–Fri 9–17 / Sat 9–14 / no Sunday. Accepted by the owner on 2026-08-09 pending a
  conversation with the client; correcting it means opening Aimfox by hand.

The owner is the workspace's single logged-in seat from `GET /accounts`. Zero or two seats is
reported, never guessed.
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
| Bison | `GET /api/campaigns` | `POST /api/campaigns` + `POST /api/campaigns/{id}/schedule`. **`POST /api/campaigns/v1.1/{id}/sequence-steps` is never called** — that is the manager's, and it is what turns a draft into something that can send |

Both `GET /api/v2/workspaces` and `GET /api/v2/workspaces/{id}/tokens` answer 500 to a
workspace-scoped key — the routes exist and require the master.

**The token list returns the secret itself**, not just metadata — measured 2026-08-07 in execution
`70395`: `tokens[].token` holds the live key, alongside `id`, `name`, `read`, `write`. So step 3 can
always reuse an existing key and never has to mint a second one. This is what keeps Natalia
Kobielska's workspace — where the old canvas minted a token and never stored it — from accumulating
one token per provisioning attempt.

## Portal surfaces

- Clients page — the **Workspaces** column: two marks per row, EmailBison and Aimfox, read from
  `setup_state`. Deliberately quiet: an absent connector is muted, not red, because 43 of 56 clients
  are EmailBison-only and a column that is mostly red stops being read. Red is reserved for a state
  a run actually reported as broken.
- Client drawer — the **Credentials & IDs** section, first in the drawer. Credentials and the
  provisioning verdict are one section on purpose: a key being present says nothing about whether
  the workspace is wired, so the two facts have to be read together. One card per sequencer, and
  the card is collapsed to the answer — verdict, one plain sentence, and how long ago it was
  observed (with a `stale` marker past 30 days). Keys, per-step outcomes and the buttons sit behind
  a **Details** disclosure: a CS manager needs to know EmailBison is configured, not what the key
  is, and **Set up** writes into a client's vendor account, which should not be one stray click
  away in a summary. After a run the card **adopts that run's verdict** and reads "Checked just
  now" — the page payload was loaded before the run, and leaving the header on its old value put
  "Never checked" directly above "Just now: configured". The one exception is `unknown`: no answer
  means the last recorded verdict is still the best thing known, so the card keeps it and says why
  underneath. `recorded: false` is not an exception — the workspace *was* observed; only the
  write-back failed, and the card says a reload will bring the previous verdict back. A card with an unsaved credential edit cannot be collapsed — it shows
  `unsaved` and drops the toggle, so the drawer's Save bar is never armed by a hidden field.
  Two buttons: **Check** (`dry_run: true`) and **Set up** (`dry_run: false`, confirmed first).
  Internal roles only; a `client` never sees the clients page at all.
- Client drawer — the **workspace id** inside each card, which can be given either way: **From
  list** is the same `WorkspacePicker` the New client sheet uses (`requestWorkspaceSetup` with
  `clientId: null`, lazy, unclaimed workspaces only), and **Type it** is the plain input. Two modes
  rather than one because the listing is not complete here the way it is for a new client: it
  filters out workspaces another client already claimed, and it is a live vendor round trip that
  can fail — so an id that cannot be picked still has to be typeable. A client with no id yet opens
  on the list, one that already has an id opens on the input showing it. Either way the value lands
  in the same draft field and is saved by `upsertClientSequencer` on the drawer's Save; picking
  claims nothing on its own — **Check** and **Set up** remain the only calls to the vendor.
  A run carries that field's id **whether or not it has been saved**: the payload's `workspace_id`
  is the click's own pick, else a candidate chip picked earlier in this card's life, else the field.
  Without the last fallback, choosing a workspace and pressing Check before Save sent no id, so the
  workflow resolved by name from scratch and answered `needs_selection` again — ignoring the answer
  the operator had just given it. An empty field still sends `null` and resolution runs as before.

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
   webhook/label/campaign lists are byte-identical before and after.
2. Running it twice in a row produces an identical result the second time.
3. `dry_run` against FortumEnergia reports the missing `preMQL` label; against GIC, the missing `MQL`.
4. A client whose name does not match any workspace terminates in `needs_selection`, and the
   candidate list excludes every workspace already claimed in `client_sequencers`.
5. Natalia Kobielska's workspace — key and webhooks present, no client — provisions to `configured`
   without creating a second webhook.
6. No `api_key` value appears in any gateway response.
7. A Bison workspace missing all three OOO campaigns ends the run with three campaigns at the
   vendor, each `draft`, each with hours and **none with a sequence** — and `state` is decided by
   the key, webhook and tag steps alone, exactly as it was before.
8. A campaign that already exists is not re-created and its schedule is not rewritten, whatever its
   status. Bent Iron PL's `archived` general is the test case.

## Related ADRs

- [ADR-0008](../../../adr/0008-orm-gateway-edge-function.md) — the portal talks to Postgres through
  the gateway and never to a vendor.
- [ADR-0012](../../../adr/0012-multi-sequencer-model.md) — per-client vendor credentials belong to
  `client_sequencers`.
- [ADR-0016](../../../adr/0016-repository-as-automation-source-of-truth.md) — this document beats the
  workflow.
- ADR-0018 (to be written) — the one class of outbound call the gateway is permitted to make.
