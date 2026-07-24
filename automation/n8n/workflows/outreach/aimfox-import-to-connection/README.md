# aimfox-import-to-connection

**Logical ID:** `aimfox-import-to-connection` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `nG6Q4KEGeXk7tBHm` — `Import leads to Aimfox connection`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **0 — Sheets only.** Imported unchanged 2026-07-21; nothing on the instance was modified.

> Eight nodes, and one of them queues LinkedIn connection requests to real people. Everything below
> follows from that.

## Business purpose

Daily at 19:00, take the leads that arrived yesterday in each active client's Leads sheet and load
their LinkedIn profiles into that client's standing `AutoConnect` campaign, so the campaign keeps
sending invites.

## Flow

```
Schedule (19:00) ─ CS PDCA rows where col_7='Active'
                   └─ Filter: col_4 and col_105 present
                      └─ GET /campaigns                       (client's Aimfox token)
                         └─ Filter1: campaigns[0] is ACTIVE and named exactly "AutoConnect"
                            └─ client's Leads sheet where LEAD RECEIVED = yesterday (M/d/yyyy)
                               └─ Filter2: 'LinkedIn URL' present
                                  └─ POST /campaigns/{campaigns[0].id}/audience  {profile_url}
```

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | the campaign is `campaigns[0]` — the **first** element of an unordered API response | if `AutoConnect` is not first, `Filter1` rejects the client and it is silently skipped for that day. If a *different* campaign is first and happens to be ACTIVE + named `AutoConnect`, invites go to the wrong campaign. Never paginated, never searched by name |
| 2 | `Filter` uses the `exists` operator on `col_4` / `col_105` | `exists` is true for an empty string (the sibling [`aimfox-daily-metrics`](../../../ingestion/aimfox-daily-metrics/README.md) correctly uses `notEmpty`). An empty token produces `Authorization: Bearer ` and a 401 that nothing catches |
| 3 | yesterday's leads are matched by the **string** `M/d/yyyy` against a sheet cell | locale- and format-dependent. A cell stored as a date, or in another format, matches nothing and the day's leads are never imported |
| 4 | a missed or failed run drops that day's cohort permanently | the filter is an exact equality on *yesterday*, so nothing catches up. The same defect as branch L of [`ooo-enrol-followups`](../ooo-enrol-followups/README.md) |
| 5 | no local dedup; the POST's duplicate behaviour is **unverified** | a manual re-run re-POSTs the batch. If Aimfox does not ignore a profile already in the audience, that is a duplicate invite to a real person |
| 6 | no retry, no error branch | a failed import is lost; the lead simply never receives a connection request, and nothing records it |
| 7 | the Aimfox token comes from a spreadsheet cell (`col_105`) | [security finding 1](../../../../../docs/reference/n8n/security.md) |

Defect 5 is the one to resolve first — it is the assumption the whole safety argument rests on, and
it is the exact question [ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md) §4
had to settle for Bison's `attach-leads` before that path could be trusted.

## Why this is not an early phase-A candidate

It writes to a **live sending system**. Under
[ADR-0017 §1b](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) a branch
that calls an external write endpoint may not simply be duplicated: two branches resolving different
campaigns would send a second set of invites to the same person. When its turn comes it gets the A1
shadow treatment — build the exact request, log it to `integration_sync_runs`, measure agreement,
and only then send.

Do the capacity flow ([`aimfox-daily-metrics`](../../../ingestion/aimfox-daily-metrics/README.md))
first: it is derived numbers, no person, no write endpoint.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-import-to-connection
```

**Never** `execute_workflow` against this on production: it sends LinkedIn connection requests.
