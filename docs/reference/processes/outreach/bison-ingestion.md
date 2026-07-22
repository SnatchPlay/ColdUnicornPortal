# Process · Bison ingestion (campaigns and counters)

**Domain:** outreach · **Owner:** automation · **Status:** live, Supabase-only
**Governing ADRs:** [ADR-0012](../../../adr/0012-multi-sequencer-model.md) (where credentials live),
[ADR-0001](../../../adr/0001-live-supabase-source-of-truth.md) (the portal reads only Supabase)
**Implementation pair:** [11-integrations §2](../../functional/11-integrations.md)

> **Level 1 document.** This describes what the business rule *is*. Where it disagrees with a
> running n8n workflow, the workflow is wrong ([ADR-0016](../../../adr/0016-repository-as-automation-source-of-truth.md)).

---

## Business purpose

Everything the portal shows about *volume* — sends, replies, bounces, opens, inboxes, campaign
health — comes from Bison and is written here. The portal never calls Bison
([13-out-of-scope](../../functional/13-out-of-scope.md)); if this path stops, every dashboard silently
freezes at its last good day.

**This is not part of the Sheets transition.** These counters have always lived in Supabase, so the
process is at phase C by construction ([ADR-0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md)).
The dual-write question is answered explicitly rather than skipped.

## The four workflows

```
hourly :15 ─ bison-campaign-sync           → campaigns              (UPSERT on external_id)
daily 21:30 ─ bison-campaign-daily-stats   → campaign_daily_stats   (UPSERT on campaign_id + date)
every 2h :26 ─ bison-daily-stats-population ─ per client ─▶ bison-daily-stats-process
                                                             → daily_stats (UPSERT on client_id + date)
             + GET /webhook/backfill-daily-stats?targetDate=YYYY-MM-DD
```

## Credentials — the rule that broke this

Per-client Bison credentials live in **`client_sequencers`**, joined through
`sequencers.key = 'emailbison'`, and **never** on `clients`
([ADR-0012](../../../adr/0012-multi-sequencer-model.md)):

```sql
select c.id, c.name, cs.external_workspace_id, cs.api_key as external_api_key
from public.clients c
join public.client_sequencers cs on cs.client_id = c.id and cs.enabled
join public.sequencers        s  on s.id = cs.sequencer_id and s.key = 'emailbison'
where c.status = 'Active' and coalesce(cs.api_key, '') <> ''
order by c.name;
```

`clients.external_api_key` and `clients.external_workspace_id` were dropped by
[`20260704b`](../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql). The
migration was applied; **the workflows were never updated**. All three top-level workflows failed on
their first SQL node from that moment — see [Incident](#incident-2026-07-22) below.

## Business invariants

1. **A counter row is keyed by (subject, day).** `daily_stats` on `(client_id, report_date)`,
   `campaign_daily_stats` on `(campaign_id, report_date)`. Re-running a day overwrites; it never
   appends. That is what makes backfill safe.
2. **A missing day is not a zero day.** `daily_stats` is derived partly from *yesterday's* row
   (month-to-date deltas), so a gap propagates forward instead of staying a hole. Backfill gaps in
   order, oldest first.
3. **A silent zero is a lie.** Both Bison fetches in `bison-campaign-daily-stats` continue on error
   and yield `0`, which is stored indistinguishably from a real zero. Any change here must record
   the failure instead ([`integration_sync_runs`](../../functional/11-integrations.md)).
4. **`campaigns.type` is set on INSERT only.** Campaign classification is a *business* decision made
   in the portal and in migrations, not something Bison knows about. The sync's `ON CONFLICT DO
   UPDATE` deliberately omits `type` — adding it would overwrite the `ooo_followup` classification
   [`20260722g`](../../../../supabase/migrations/20260722g_ooo_campaigns_and_routing_seed.sql) applies,
   and put OOO follow-up campaigns back into client-visible metrics
   ([ADR-0003](../../../adr/0003-client-campaign-visibility.md)).
5. **A client with no `client_sequencers` row is invisible, not broken.** It simply produces no rows.
   That must be *visible* — today it is not.

## Database entities

| Entity | Written by | Read by |
|---|---|---|
| `campaigns` | `bison-campaign-sync` | most portal pages; scoped by [ADR-0003](../../../adr/0003-client-campaign-visibility.md) |
| `campaign_daily_stats` | `bison-campaign-daily-stats` | campaign charts, 90-day window |
| `daily_stats` | `bison-daily-stats-process` | manager + client dashboards, 180-day window |

All three are **ingestion-only**: the portal never writes them (CLAUDE.md §1).

## Incident 2026-07-22

Found while investigating a single failed execution.

| Workflow | Last 12 runs | Failing node |
|---|---|---|
| `bison-daily-stats-population` | **12 / 12 error** | `Get Active Clients1` — `column "external_workspace_id" does not exist` |
| `bison-campaign-sync` | **12 / 12 error** | `Get Active Clients` — `column "external_api_key" does not exist` |
| `bison-campaign-daily-stats` | 2 / 12 error | `Get Active Campaigns` — `column c.external_api_key does not exist` |

Effect: `daily_stats` last had data for **2026-07-20**, `campaign_daily_stats` for **2026-07-19**.
Both dashboards had been showing stale numbers for days with nothing surfacing it.

Cause: [`20260704b`](../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql)
dropped the legacy credential columns; the ADR-0012 cutover was never carried into these workflows.
[migration-backlog §3](../../n8n/migration-backlog.md) had flagged exactly this as unverified.

Fix: one SQL node per workflow, repointed at `client_sequencers`, **preserving the result column
names** (`external_api_key`, `external_workspace_id`) so no downstream node or sub-workflow changed.
Verified by execution: 16 clients, 390 campaigns, `daily_stats` written for 2026-07-22.

**Closed the same day:**

- **`daily_stats` is continuous again.** 2026-07-21 was backfilled and every day since 2026-07-18 now
  has 17 clients. The backfill webhook was not broken — it is a **GET**, and a POST returns 404,
  which is what made it look dead.
- **EvidencePrime is back.** It was `Active` with no `client_sequencers` row at all, so it resolved
  to nothing where the legacy column used to carry it (17 clients → 16). Seeded from CS PDCA
  `col_5`/`col_6`; Bison workspace **130** — one of the two deferred as "ignore 75 and 130" — is now
  mapped, and 17 clients resolve again.
- **Failures are no longer silent.** [`automation-failure-recorder`](../../../../automation/n8n/workflows/ops/automation-failure-recorder/README.md)
  is bound as `settings.errorWorkflow` on all 13 managed workflows and writes one
  `integration_sync_runs` row per failed execution. Proved end to end with a deliberate failure.

**Still open:**

- **`campaign_daily_stats` has a two-day hole: 2026-07-20 and 2026-07-21.** Unlike its sibling this
  workflow has **no date override and no backfill trigger** — it always writes today — so a day
  missed while it was broken cannot be recovered by re-running it. Recovering those two days needs a
  date parameter added first. 2026-07-22 is filled (428 campaigns).
- **`ooo_count` does not contain OOO data.** `Transform Metrics1` computes it as
  `automatedRepliesTotal − prevOooTotal`, and the workflow has no OOO fetch at all — so the column is
  a copy of `automated_replies_count` (identical on every row inspected). Measured 2026-07-22; see
  [Sheets ↔ Supabase reconciliation](sheets-supabase-reconciliation.md#problem-2--ooo_count-is-a-mislabelled-copy).
- **Five `daily_stats` columns have no writer at all** — `mql_count`, `me_count`, `won_count`,
  `negative_count`, `prospects_in_base`. Not a broken sync: the sheet is empty too. Same document.
- **The silent-zero defect still stands.** Both Bison fetches continue on error and store `0`, which
  invariant 3 calls a lie. The failure recorder does **not** catch this: it fires on workflow
  failure, and a node with `onError: continueRegularOutput` never fails the workflow.

## Failure handling

Every managed workflow now points `settings.errorWorkflow` at
[`automation-failure-recorder`](../../../../automation/n8n/workflows/ops/automation-failure-recorder/README.md),
so a failed run becomes an `integration_sync_runs` row instead of silence. The pre-existing
`Winnr Sync - Error Handler` (`oF6fP3ea2zglhAop`) stays where it is — it hardcodes
`provider='winnr'`, so it could not be reused as a general handler.

That is a floor, not a ceiling: it fires on **workflow** failure, and every HTTP node in this process
uses `onError: continueRegularOutput`, so the silent-zero defect is still invisible to it.

## Related n8n workflows

| Logical id | Remote | Role |
|---|---|---|
| [`bison-campaign-sync`](../../../../automation/n8n/workflows/ingestion/bison-campaign-sync/README.md) | `UXpSOrgsN2TxjXUu` | campaigns |
| [`bison-campaign-daily-stats`](../../../../automation/n8n/workflows/ingestion/bison-campaign-daily-stats/README.md) | `AEgpCGoSpiZ7PA90` | per-campaign counters |
| [`bison-daily-stats-population`](../../../../automation/n8n/workflows/ingestion/bison-daily-stats-population/README.md) | `amJdB2eGXxUNyCPY` | fan-out per client |
| [`bison-daily-stats-process`](../../../../automation/n8n/workflows/ingestion/bison-daily-stats-process/README.md) | `BQbFKHUaIcEKPc01` | the per-client worker |

## Related ADRs

[0001](../../../adr/0001-live-supabase-source-of-truth.md) · [0003](../../../adr/0003-client-campaign-visibility.md) ·
[0012](../../../adr/0012-multi-sequencer-model.md) · [0016](../../../adr/0016-repository-as-automation-source-of-truth.md) ·
[0017](../../../adr/0017-sheets-to-supabase-dual-write-transition.md)
