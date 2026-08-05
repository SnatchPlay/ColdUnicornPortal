# Process · LinkedIn outreach (Aimfox)

**Domain:** outreach · **Owner:** automation · **Status:** **phase A on 4 of 5 workflows (2026-07-22)**
— `aimfox-daily-metrics`, `aimfox-classification`, `aimfox-premql-to-pdca` and `aimfox-leads-processing`
all write Supabase via branch S. Only `aimfox-import-to-connection` remains phase 0 (queues real
LinkedIn invites — needs the A1 shadow treatment).
**Governing ADRs:** [ADR-0012](../../../adr/0012-multi-sequencer-model.md) (multi-sequencer),
[ADR-0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md) (contact vs lead),
[ADR-0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md) (how it migrates)
**Implementation pair:** [11-integrations §2/§3](../../functional/11-integrations.md)

> **Level 1 document.** This describes what the business rule *is*. Where it disagrees with a
> running n8n workflow, the workflow is wrong ([ADR-0016](../../../adr/0016-repository-as-automation-source-of-truth.md)).

> **Read this first.** The database models this channel — `sequencers` has an `aimfox` row,
> `client_sequencers` carries the per-client Aimfox token (seeded 2026-07-22). Four of five workflows
> now write it: `sequencer_daily_stats` (`aimfox-daily-metrics`), `sequencer_contacts` + `replies`
> (`aimfox-classification`), `campaigns` (`aimfox-campaign-sync`), and `leads` (`aimfox-premql-to-pdca`,
> `aimfox-leads-processing`) — all since 2026-07-22. Only `aimfox-import-to-connection` still reads and
> writes Google Sheets exclusively.

---

## Business purpose

The agency runs a second acquisition channel alongside cold email: LinkedIn connection campaigns
through **Aimfox**. A client's Aimfox workspace holds one or more LinkedIn accounts ("profiles");
each runs campaigns that send connection invites to an audience. An accepted invite opens a
conversation; a conversation that goes well is tagged and becomes a lead.

The channel exists to answer two questions the email channel cannot:

1. **Capacity** — LinkedIn caps invites per account per week. How many invites can we still send
   today, tomorrow, the day after? That drives how much audience the team must load.
2. **Leads** — which LinkedIn conversations became qualified leads, in the same funnel as email.

## Definitions

| Term | Meaning |
|---|---|
| **Workspace** | An Aimfox tenant, one per client. Identified by `workspace.id` in webhooks; the token minted from it authorizes every call for that client. |
| **Account / profile** | One LinkedIn account inside a workspace. Invite limits are **per account**, not per workspace. |
| **Campaign** | An Aimfox campaign with an audience. `AutoConnect` is the conventional name of the standing connection campaign. |
| **Audience** | The set of profile URLs queued for invites in a campaign. Loading audience is the write side of this process. |
| **`limit.connect`** | The account's connect cap as reported by Aimfox — a **weekly** number (~195). |
| **`daily_limit`** | `limit.connect / 5` — the agency's own convention, five working days. Not an Aimfox concept. |
| **preMQL / MQL** | Tags applied in Aimfox to a conversation. `preMQL` is the signal that creates a lead. |

**`invite_limit` and `invite_limit_remaining` are different quantities.** The first is the weekly cap
snapshot; the second is what is left today. The PDCA sheet's "Invitations limit" cell holds the
*remaining* number, which is why the table splits them ([`20260705`](../../../../supabase/migrations/20260705_sequencer_daily_stats_schedule.sql)).
Collapsing them makes capacity planning read a cap as a balance.

## Triggering events

| Event | Source | Effect |
|---|---|---|
| Every 2 hours | schedule | recompute capacity + volumes per client, write the PDCA and Daily stats sheets |
| Daily 19:00 | schedule | push yesterday's leads' LinkedIn URLs into the client's `AutoConnect` audience |
| `preMQL` tag added | Aimfox webhook `preMQL-Aimfox` | enrich the contact, append a lead row to the client's Leads sheet, notify, and (since 2026-08-05) blacklist the converted contact and their company |
| Reply received | Aimfox webhook `aimfox-classifier` | classify with an LLM; blacklist the company or the contact when it is not a prospect |
| Tag added (Bison HUB) | `[HUB] Bison Replies Dispatcher` | `AimFox Leads Processing` enriches and writes the lead + dispatches to the CRMs |

## Preconditions

- The client is `Active` in CS PDCA (`col_7`).
- The client has an Aimfox token in CS PDCA `col_105`, and a client Leads spreadsheet in `col_4`.
- The client has an enabled `client_sequencers` row for `sequencers.key = 'aimfox'` carrying
  `api_key` and `external_workspace_id`. **Seeded 2026-07-22** for the five clients that have an
  Aimfox token: Bent Iron PL, ColdUnicorn PL, EvidencePrime, FitMech, Runmageddon. FitMech has no
  `external_workspace_id` because its workspace has no LinkedIn account connected, so it can
  authenticate API calls but cannot yet resolve an inbound webhook.

## Main flow — capacity

```
every 2h  ─ CS PDCA (Active, token present)
            └─ per client:
                GET /campaigns            → keep state = ACTIVE
                  GET /campaigns/{id}      → audience_size
                  GET /campaigns/{id}/metrics → sent_connections, accepted_connections
                    remaining_audience = audience_size − sent_connections   (Σ over campaigns)
                GET /accounts             → per account
                  GET /accounts/{id}/limits → Σ limit.connect  = weekly cap
                GET /analytics/interactions?bucket=1 day → sent today
                └─ daily_limit = Σ limit.connect / 5
                   schedule_today     = min(daily_limit, remaining_audience + sent_today)
                   schedule_tomorrow  = min(daily_limit, max(remaining_audience − daily_limit, 0))
                   schedule_day_after = min(daily_limit, max(remaining_audience − 2·daily_limit, 0))
```

## Main flow — lead creation

```
preMQL tag  ─ mint workspace token ─ resolve client via CS PDCA
              └─ GET /leads/{id}                → LinkedIn profile
                 already in the client's Leads sheet?
                   yes → update the existing row
                   no  → Lusha enrich → fetch the conversation → append a lead row → notify
```

## Business invariants

1. **A LinkedIn contact is not a lead.** Being invited, accepting, or replying creates *outreach*
   state. A `leads` row exists only after a qualifying signal — `preMQL` here, the exact analogue of
   ADR-0015's "a lead is created only by a positive reply". At most one lead per contact.
2. **Contact identity is scoped, never global.** The natural key is
   `(client_sequencer_id, external_contact_id)` where `external_contact_id` is the Aimfox lead id.
   The same LinkedIn person reached for two clients is two contacts.
3. **A lead carries its channel.** `leads.sequencer_id` must be the Aimfox sequencer
   (`00000000-0000-4000-a000-000000000003`), not the EmailBison default
   ([11-integrations §3](../../functional/11-integrations.md)). A LinkedIn lead silently typed as
   email corrupts every per-channel metric.
4. **Capacity is a per-profile fact.** `sequencer_daily_stats.profile_id` is the **Aimfox account
   id**. `''` means a client-level rollup, and is a deliberate loss of resolution — never a
   convenient substitute for an id the workflow did not bother to carry.
5. **Invite counters never mix channels.** LinkedIn invites and email sends are different acts with
   different caps. They may sit in the same dashboard, never in the same number
   ([04-metrics-catalog](../../functional/04-metrics-catalog.md)).
6. **A snapshot is overwritten, an event is appended.** `invite_limit_remaining` and the three
   `schedule_*` volumes are snapshots of "now" and are overwritten by each 2-hourly run;
   `invites_sent` / `invites_accepted` are per-day facts, keyed on `report_date`.
7. **Blacklisting is irreversible in effect.** Adding a company or contact to a workspace blacklist
   permanently removes it from that client's reach. It must be driven by an explicit classification,
   never by an enrichment failure or a missing field.
   Two workflows blacklist today, and both are classification-driven: `aimfox-classification` when a
   reply says "not a prospect", and — since 2026-08-05 — `aimfox-premql-to-pdca` once a `preMQL`/`MQL`
   tag has produced a lead (a converted contact should not keep receiving outreach). Where the
   contact's current company is ambiguous, an LLM picks it, but only from a closed `enum` of that
   lead's own current-experience companies, and "no company named" means **do nothing** — an empty
   answer must never widen into a blanket blacklist.
8. **Audience loading is a write to a live sending system.** Adding a profile URL to a campaign
   audience causes LinkedIn invites to be sent. It is subject to the same rule as OOO re-enrolment
   ([ADR-0017 §1b](../../../adr/0017-sheets-to-supabase-dual-write-transition.md)): a second branch
   may not duplicate it until agreement has been measured.

## Data ownership

| Fact | Owner today | Owner at phase C |
|---|---|---|
| Per-client Aimfox token | CS PDCA `col_105` | `client_sequencers.api_key` |
| Aimfox workspace id | webhook payload only | `client_sequencers.external_workspace_id` |
| Capacity + volumes | PDCA sheet cells | `sequencer_daily_stats` |
| LinkedIn contact identity | `sequencer_contacts` — written by `aimfox-classification` branch S since 2026-07-22 (was: none) | `sequencer_contacts` |
| LinkedIn lead | the client's own Leads spreadsheet | `leads` (`sequencer_id` = aimfox) |
| Conversation / reply text | `replies` — written by `aimfox-classification` branch S since 2026-07-22 (was: never stored) | `replies` |
| Campaign catalog | `campaigns` (`sequencer_id` = aimfox) — written by `aimfox-campaign-sync` since 2026-07-22 | `campaigns` |

## Database entities

All exist and are now written: `sequencer_daily_stats` (capacity), `sequencer_contacts` + `replies`
(classification branch S), `campaigns` (the catalog), and `leads` (both lead flows' branch S, since
2026-07-22). Only `aimfox-import-to-connection` still writes Sheets exclusively.

| Entity | Defined in | Notes |
|---|---|---|
| `sequencers` (`key='aimfox'`) | [`20260704_sequencers_catalog.sql`](../../../../supabase/migrations/20260704_sequencers_catalog.sql) | fixed id `…0003` |
| `client_sequencers` | same | `api_key`, `external_workspace_id` (**text**) |
| `sequencer_daily_stats` | same + [`20260705`](../../../../supabase/migrations/20260705_sequencer_daily_stats_schedule.sql) | unique `(client_id, sequencer_id, profile_id, report_date)`; ingestion-only, no write policy — a writer must be `service_role` |
| `sequencer_contacts` | [`20260722_ooo_model_tables.sql`](../../../../supabase/migrations/20260722_ooo_model_tables.sql) | channel-agnostic by design (ADR-0015) |
| `leads.sequencer_id` | ADR-0012 | defaults to EmailBison — Aimfox flows must set it explicitly |

## RPC / API contracts

There is **no** Aimfox-specific RPC. Contact and lead writes reuse the ADR-0015 contract
(`upsert_sequencer_contact`, `upsert_reply`, `promote_contact_to_lead`) because the rule is the same
rule; only the sequencer differs. `sequencer_daily_stats` has no RPC and is an UPSERT on its unique
key — acceptable because it carries no cross-row invariant, unlike `leads` or `ooo_followups`.

**Do not invent a parallel set of LinkedIn RPCs.** Check
[reuse-catalog.md](../../../reuse-catalog.md) first (CLAUDE.md §5a).

## Portal surfaces

None today. `sequencer_daily_stats` is not read by any gateway action — it is phase-2 UI
([11-integrations §2](../../functional/11-integrations.md)). Building the surface before the table
has rows would be building against an empty set.

## Dashboard metrics

The capacity numbers are consumed today by the **PDCA spreadsheet dashboards**, outside this
repository. That is the reason phase C cannot be scheduled by this repo alone: the sheet has readers
we do not control ([migration-backlog cross-cutting §2](../../n8n/migration-backlog.md)).

## Related n8n workflows

| Logical id | Remote | Role | Repository state |
|---|---|---|---|
| [`aimfox-daily-metrics`](../../../../automation/n8n/workflows/ingestion/aimfox-daily-metrics/README.md) | `sVev5d0N6rtrbcgI` | capacity, every 2h | **imported** |
| [`aimfox-campaign-sync`](../../../../automation/n8n/workflows/ingestion/aimfox-campaign-sync/README.md) | `t6a53dLc85FOKFqX` | campaign catalog, hourly | **created 2026-07-22** — the LinkedIn `campaigns` rows |
| [`aimfox-import-to-connection`](../../../../automation/n8n/workflows/outreach/aimfox-import-to-connection/README.md) | `nG6Q4KEGeXk7tBHm` | audience loading, daily 19:00 | **imported** |
| [`aimfox-classification`](../../../../automation/n8n/workflows/outreach/aimfox-classification/README.md) | `JnvRBXtRNar7ejeM` | LLM reply classification + blacklisting | **imported** |
| [`aimfox-leads-processing`](../../../../automation/n8n/workflows/outreach/aimfox-leads-processing/README.md) | `4OjNRWLaG2IWK6kd` | enrich + create lead + CRM dispatch | **branch S live 2026-07-22** — called by `aimfox-classification`, not the Bison HUB (corrected) |
| [`aimfox-premql-to-pdca`](../../../../automation/n8n/workflows/outreach/aimfox-premql-to-pdca/README.md) | `s0GqDtCzyLAvVnm1` | preMQL → lead row + notification + blacklist | **branch S live 2026-07-22**; blacklist chain exported 2026-08-05 |

All five entered the repository on 2026-07-22. The last three had been unreachable: `pnpm n8n:export`
refuses a file the scanner rejects ([security.md](../../n8n/security.md) layer 4), and each carried a
literal credential. Those moved into the `Aimfox Master` and `OpenAi account` n8n credentials first.

## Divergence from the live implementation

Recorded per [processes/README.md](../README.md) — "a process document that describes an intended
state as though it were live is worse than none".

| # | Rule | Reality |
|---|---|---|
| 1 | capacity lands in `sequencer_daily_stats` | it lands in two spreadsheet tabs; the table has never been written. [11-integrations §2](../../functional/11-integrations.md) described this row as live — corrected 2026-07-21 |
| 2 | `profile_id` is the Aimfox account id (invariant 4) | the metrics workflow sets `account_id` to the **CS PDCA sheet row number** |
| 3 | contact identity is stored (invariant 2) | no LinkedIn contact is stored anywhere; the Aimfox lead id lives only inside an execution |
| 4 | a lead carries its channel (invariant 3) | leads are appended to a spreadsheet, so `sequencer_id` does not exist to be set |
| 5 | tokens come from `client_sequencers` | branch L still reads CS PDCA `col_105` — [security finding 1](../../n8n/security.md). The table itself is now seeded (2026-07-22, five clients), so branch S no longer depends on the sheet |
| 6 | invite capacity is per account | `Summarize` **averages** `account_id` across a batch; the numbers are a client rollup wearing an account id |
| 7 | the Supabase lead carries what the run knows about the person | it carries seven fields. `linkedin_url`, `country`, the reply's subject and step, and the whole Aimfox profile are fetched by branch S and dropped — measured 2026-08-05: `linkedin_url` 0 of 60 branch-S leads, against 30 of 30 for the Aimfox leads that came in from Sheets. Gap table in [`aimfox-premql-to-pdca` README](../../../../automation/n8n/workflows/outreach/aimfox-premql-to-pdca/README.md#what-branch-s-still-throws-away) |

## Failure handling

There is none. No Aimfox workflow has an error branch, a retry policy or an error-workflow binding.
A failed run leaves the sheet partially updated and reports nothing; the only trace is the n8n
execution list ([migration-backlog cross-cutting §3](../../n8n/migration-backlog.md)).

## Security considerations

- Two **unauthenticated webhooks** (`aimfox-classifier`, `preMQL-Aimfox`). Their paths are effectively
  bearer secrets; anyone holding one can drive lead creation and blacklisting.
- ~~An **Aimfox organisation token written literally** into three workflow graphs~~ — moved to the
  `Aimfox Master` credential 2026-07-22 ([security §7](../../n8n/security.md)).
- ~~An **OpenAI API key written literally** into the classification workflow~~ — moved to the
  `OpenAi account` credential the same day ([security §8](../../n8n/security.md)).
- Per-client tokens still sit in the shared spreadsheet for branch L. They now also live in
  `client_sequencers.api_key`, which is what branch S will read.

The two webhooks remain the open finding: [security.md](../../n8n/security.md) §1, §3.

## Acceptance criteria for phase A

Phase A for this channel means the **capacity** flow first — it is a pure UPSERT of derived numbers,
it touches no person, and it is therefore the only part of this channel where a second branch is
risk-free ([ADR-0017 §1b](../../../adr/0017-sheets-to-supabase-dual-write-transition.md)).

1. ~~`client_sequencers` carries an enabled `aimfox` row per active client~~ — **done 2026-07-22**,
   five rows. This was the precondition: branch S cannot resolve a client without it.
2. The metrics workflow gains a parallel branch S that resolves the client from
   `client_sequencers` and UPSERTs `sequencer_daily_stats` on its unique key. Sheets first, Supabase
   second, Supabase failure non-fatal.
3. `profile_id` carries the real Aimfox account id (invariant 4). Branch S must **not** reproduce
   divergence 2 — an imported defect is still a defect (ADR-0016 §1).
4. Reconciliation: for each `report_date`, the sheet's cells and the table's row agree per client.
   Record the number in the manifest's `transition.parityEvidence`.
5. ~~Lead creation stays single-branch until the capacity flow has parity~~ — **done 2026-07-22.**
   `aimfox-premql-to-pdca` and `aimfox-leads-processing` both got real branch S writes (not a shadow
   log): neither calls an external write endpoint from branch S (no CRM dispatch, no sheet write), so
   the A1-shadow risk this line was written for doesn't apply to them. **Audience loading
   (`aimfox-import-to-connection`) is the one true A1-shadow case left** — it queues real LinkedIn
   invites, a live external send that cannot be un-duplicated.

## Related ADRs

[0012](../../../adr/0012-multi-sequencer-model.md) · [0015](../../../adr/0015-sequencer-contacts-and-ooo-followups.md) ·
[0016](../../../adr/0016-repository-as-automation-source-of-truth.md) · [0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md) ·
[0004](../../../adr/0004-lead-state-boundaries.md)
