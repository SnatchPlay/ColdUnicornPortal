# aimfox-daily-metrics

**Logical ID:** `aimfox-daily-metrics` · **Domain:** `ingestion` · **Criticality:** medium
**Remote (production):** `sVev5d0N6rtrbcgI` — `Get Metrics from Aimfox`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **A — live (2026-07-22).** Branch S writes per-account `sequencer_daily_stats` every 2
hours; branch L still writes the PDCA sheet. See [Branch S](#branch-s--the-linkedin-capacity-row-per-account-live-2026-07-22).

> **History:** when first imported (2026-07-21) this workflow wrote **only** the sheet —
> [`20260705_sequencer_daily_stats_schedule.sql`](../../../../../supabase/migrations/20260705_sequencer_daily_stats_schedule.sql)
> was written *by reading this workflow* (its column comments quote these formulas), but the Supabase
> write itself had never been built. Branch S added it on 2026-07-22.

## Business purpose

Every 2 hours, answer "how many LinkedIn invites can this client still send today, tomorrow and the
day after?" and write the answer where the team reads it — the PDCA spreadsheet.

## Flow

```
Schedule (2h) ─ CS PDCA rows where col_7='Active'
                └─ Filter1: col_105 (Aimfox token) not empty
                   └─ Loop Over Items ─┬─ GET /campaigns ─ Split Out ─ Filter state=ACTIVE
                                       │    └─ GET /campaigns/{id}     → audience_size
                                       │       └─ GET /campaigns/{id}/metrics → sent, accepted
                                       │          └─ Code: remaining_audience = audience − sent
                                       │             └─ Summarize: Σ remaining_audience
                                       └─ GET /accounts ─ Split Out1
                                            └─ GET /accounts/{id}/limits
                                               └─ Summarize1: Σ limit.connect   (weekly cap)
                                                  └─ GET /analytics/interactions (bucket = 1 day)
                                                     └─ Code2: daily_limit, sent_today, remaining_limit
                    Merge ─ Aggregate1 ─ Update 'Remaining database'
                                          └─ Code3: the three schedule volumes
                                             └─ Update 'Invitations limit'
                                                └─ Daily stats row for today ─ Update ─ Wait ─ next client
```

## The formulas

| Output | Formula | Sheet cell |
|---|---|---|
| `remaining_audience` | Σ over ACTIVE campaigns of `audience_size − sent_connections` | Remaining database |
| `daily_limit` | `Σ accounts.limit.connect / 5` | — (intermediate) |
| `sent_today` | `buckets[1].sent_connections − buckets[0].sent_connections` | — |
| `remaining_limit` | `daily_limit − buckets[1].sent − buckets[0].sent` | Invitations limit |
| `schedule_today` | `min(daily_limit, remaining_audience + sent_today)` | Schedule volume today |
| `schedule_tomorrow` | `min(daily_limit, max(remaining_audience − daily_limit, 0))` | + 1 |
| `schedule_day_after` | `min(daily_limit, max(remaining_audience − 2·daily_limit, 0))` | + 2 |

`/5` is the agency's working-week convention, not an Aimfox concept. Aimfox reports `limit.connect`
as a **weekly** cap.

## Known defects — imported as-is, not reproduced in any future branch S

| # | Defect | Consequence |
|---|---|---|
| 1 | `remaining_limit` subtracts **both** buckets, while `sent_today` subtracts one from the other | the remaining limit is understated by `buckets[0].sent_connections`. This is the "double-subtraction quirk" [11-integrations §2](../../../../../docs/reference/functional/11-integrations.md) records; it is a bug, not a convention |
| 2 | `account_id` is set to the CS PDCA **sheet row number** | violates invariant 4 of the process doc: `profile_id` must be the Aimfox account id. Capacity cannot be attributed to a LinkedIn account |
| 3 | `Summarize` **averages** `account_id` and `workspace_id` | averaging identifiers. Correct only while every row in the batch shares one value; silently wrong otherwise |
| 4 | sheet updates match on `row_number` | positional. A row inserted, deleted or sorted between the read and the update writes one client's capacity onto another client's row |
| 5 | the Aimfox token comes from a spreadsheet cell (`col_105`) | [security finding 1](../../../../../docs/reference/n8n/security.md) |
| 6 | no retry, no error branch, no error workflow | a failed API call leaves that client's sheets half-updated and reports nothing |
| 7 | `Get row(s) in sheet1` matches the Daily stats row by `Client` = an **averaged** workspace id | inherits defect 3; a wrong average writes the wrong client's daily row |

Defects 1–3 must be **fixed in branch S, not carried over**: an imported defect is still a defect
([ADR-0016](../../../../../docs/adr/0016-repository-as-automation-source-of-truth.md) §1).

## What phase A would add

A parallel branch S ([ADR-0017 §1a](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md)):
resolve the client from `client_sequencers` (aimfox row, `external_workspace_id`), then UPSERT
`sequencer_daily_stats` on `(client_id, sequencer_id, profile_id, report_date)` — one row **per
Aimfox account**, not one rollup.

This is the safest phase-A candidate in the family: it is a pure UPSERT of derived numbers, it
touches no person, and it calls no external write endpoint — so it needs no A1 shadow step, unlike
[`ooo-enrol-followups`](../../outreach/ooo-enrol-followups/README.md).

**Blocked on a precondition, not on design:** `client_sequencers` has no seeded `aimfox` rows, so
branch S has nothing to resolve a `client_id` from. Seed them — from CS PDCA `col_105` (token) and
the Aimfox workspace id — before writing any node.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-daily-metrics
```

Safe to `execute_workflow`? **No.** It writes live PDCA cells that the team reads for capacity
planning.

## Branch S — the LinkedIn capacity row, per account (live 2026-07-22)

Branch S is **fully parallel**: it hangs off the schedule trigger, resolves its clients from
`client_sequencers` and makes its own Aimfox calls with `client_sequencers.api_key`. Branch L can be
disconnected in one move ([ADR-0017 §1a](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md)).

```
Schedule (2h) ─┬─ [L] CS PDCA → Aimfox → PDCA + Daily stats cells      (unchanged)
               └─ [S] client_sequencers (aimfox, enabled)
                     └─ loop client ─ Accounts ─ Account limits ─ Interactions
                                    ─ Campaigns ─ detail ─ metrics ─ totals
                        └─ UPSERT sequencer_daily_stats (client, sequencer, profile, date)
```

First live run (execution 50246): **4 of 5 clients, one row each**, `profile_id` = the real Aimfox
account id. FitMech wrote nothing and said why.

### Four defects fixed, not ported

[ADR-0016 §1](../../../../../docs/adr/0016-repository-as-automation-source-of-truth.md): an imported
defect is still a defect.

| # | Branch L | Branch S |
|---|---|---|
| 1 | `remaining_limit = daily − buckets[1] − buckets[0]` while `sent_today = buckets[1] − buckets[0]` — `buckets[0]` subtracted twice | `max(daily − sent, 0)`, one subtraction |
| 2 | `account_id: $('Filter1').item.json.row_number` — a **spreadsheet row number** | the Aimfox account id from `GET /accounts` |
| 3 | `Summarize` takes the **average of `account_id` and `workspace_id`** — averaging identifiers | no summarize; one row per account, which is what the unique key was built for |
| 4 | reads `buckets[1] − buckets[0]` from a single-day query | reads the **last** bucket only — see below |

**Defect 4 was found by probing, not by reading.** Asked for a single day, the interactions endpoint
returns *two* buckets, and the leading one is a boundary artefact that lies: for 2026-07-20 it
reported `sent=0` where a multi-day query gave `33`. It is currently zero for `sent_connections`,
which is why branch L's subtraction has not yet produced a visibly wrong number — the bug is real and
merely unexpressed. For `accepted_connections` the leading bucket is already non-zero (1 where the
true value was 10).

### What it refuses to write

Interactions are a **workspace-level** series. The per-account filter could not be verified: the
`account_ids` parameter returns HTTP 500, and `account_id` / `accounts` / `account_urns` all return
the workspace numbers unchanged — with every client currently owning exactly one account, a working
filter is indistinguishable from an ignored one.

So branch S writes a row **only when the client has exactly one account**, and otherwise records the
reason instead of attributing a workspace total to one of several profiles. Today that excludes only
FitMech, which has none. Before a second account appears anywhere, the filter must be re-probed.

It also writes nothing when `invites_sent` could not be measured — a missing bucket yields no row
rather than a zero ([bison-ingestion invariant 3](../../../../../docs/reference/processes/outreach/bison-ingestion.md#business-invariants)).

### Per-campaign metrics — added 2026-08-19

Branch S already called `GET /campaigns/{id}` and `GET /campaigns/{id}/metrics` for every campaign and
kept two numbers out of each response. It now stores what it was discarding.

```
[S] Campaign totals ─┬─ [S] Build row (unchanged chain, remaining database)
                     └─ [S] Campaign metrics SQL ─ [S] Upsert campaign metrics
```

A parallel branch, not a link in the chain: `[S] Build row` still reads `[S] Campaign totals`
directly, so the existing path is untouched.

| Column on `campaigns` | Source |
|---|---|
| `invites_sent` | `metrics.sent_connections` — cumulative for the campaign, not per day |
| `invites_accepted` | `metrics.accepted_connections` |
| `message_steps` | `Σ flows[].flow_message_templates.length` — 0 = invitations only |
| `metrics_synced_at` | `NOW()` |

**`UPDATE`, never `INSERT`.** The catalog belongs to
[`aimfox-campaign-sync`](../aimfox-campaign-sync/README.md); the two workflows share the row on
disjoint column sets, the same discipline campaign-sync applies to `type` / `sequencer_id`.

**Why `message_steps` and not the vendor's `outreach_type`.** Probed across all nine keyed
workspaces on 2026-08-19: `outreach_type` is `connect` on every one of the 19 campaigns and
distinguishes nothing. The message sequence lives in the `PRIMARY_CONNECT` flow's
`flow_message_templates` — zero of them means the campaign sends invites and never writes.
Corroborated independently: the only two clients that come out at zero are exactly the two whose
campaigns are named *Zaproszenia* (Polish for "invitations").

### Defect 5, fixed in the same pass: remaining database was ~20x too high

`[S] Build row` subtracted from `campaign.audience_size`. That is **a fixed ceiling the vendor
assigns at creation** — 10000 for every `type: 'list'` campaign, 2500 for a `navigator` one — not
the loaded audience. Bent Iron PL stored **19968** against a real **918**. The loaded audience is
`target_count`, which `campaigns.database_size` already carries.

The column is now correct *and* deprecated: the clients grid derives remaining database from
`campaigns` instead, so nothing reads `sequencer_daily_stats.remaining_database_size`. It keeps
being written by explicit decision — a retired column holding a right number beats one holding a
wrong one.

### Defect 6: branch S never implemented the schedule formula

The [business process](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md) specifies:

```
schedule_today     = min(daily_limit, remaining_audience + sent_today)
schedule_tomorrow  = min(daily_limit, max(remaining_audience − daily_limit, 0))
schedule_day_after = min(daily_limit, max(remaining_audience − 2·daily_limit, 0))
```

Branch S wrote `schedule_today = daily_limit − sent_today` and `schedule_tomorrow/day_after =
daily_limit` flat. Two consequences, both invisible until somebody tried to colour the band:

1. the two forward buckets were a **constant** — ~39 for every client, every day, forever;
2. today's bucket **fell as the client sent more**, so any "higher is better" rule read backwards.

Fixed 2026-08-19 to the specified formula, using the `target_count`-based remaining audience. It also
decouples `schedule_today` from `invite_limit_remaining` — the two were assigned from one variable,
which is what made the grid's `Inv left` column a duplicate of the Schedule `0` cell.

**Every schedule value is `null` when an input is unmeasured** (no weekly cap, no ACTIVE campaign, or
`sent_today` missing for today's bucket) rather than 0 — a client we could not measure is not a client
who cannot send. Note the portal cannot preserve that distinction: `loadClientsMetricsSummary`
`COALESCE`s these to 0, so an unmeasured cell renders red rather than `—`.

### Reconciling against the sheet

Sum across `profile_id` **excluding `'__workspace_total__'`** — those are the
[sheet backfill's](../../ops/sheets-aimfox-metrics-backfill/README.md) rollup rows, covering
2026-06-18…07-21. The single overlap day (2026-07-22, where a garbage `__workspace_total__` snapshot
coexisted with the real per-account rows) was **cleaned up 2026-07-22** — those 3 total rows were
deleted, so `__workspace_total__` and per-account rows no longer share any date. Excluding
`__workspace_total__` is still the rule for a clean per-account sum (the pre-07-22 history is
workspace-grain), but there is no longer a double-count on any single day.

Expect one honest disagreement: branch L's remaining limit is too low by `buckets[0]`.
