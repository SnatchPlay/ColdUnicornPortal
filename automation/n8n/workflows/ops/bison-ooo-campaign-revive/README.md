# bison-ooo-campaign-revive

**Logical ID:** `bison-ooo-campaign-revive` · **Domain:** `ops` · **Criticality:** high
**Remote (production):** not created yet
**Business process:** [OOO follow-ups](../../../../../docs/reference/processes/outreach/ooo-followups.md)
**Status:** built, never run. Needs one supervised execution — see *Before the first run*.

Every morning: find the OOO campaigns a client's routing actually points at, ask Bison what state
each is really in, and switch the paused ones back on.

## Why this exists

An OOO campaign is the thing that emails someone back after *"I'm away until the 15th"*. When one
stops sending, nothing breaks loudly — replies keep arriving, contacts keep being filed into the
campaign, and the campaign quietly does not send. Measured 2026-08-20: **22 of the 42 active routing
rules pointed at a campaign that was not sending**, across 13 clients.

The contacts are not lost while that lasts. Bison **accepts** leads into a paused campaign — 355
episodes were sitting inside dead campaigns that day, of which only one had ever been rejected. They
queue. So the cost of a dead campaign is *delay*, and delay only becomes loss when nobody notices for
long enough that the follow-up stops making sense.

Hence: notice it daily, and fix the half that can be fixed automatically.

## What it can fix, and what it cannot

Bison publishes no API reference this repository can cite, so the surface was probed directly
(GET/OPTIONS only) on 2026-08-20:

| endpoint | methods | |
|---|---|---|
| `/api/campaigns/{id}` | `GET, HEAD, DELETE` | **no PATCH** — status cannot be set here |
| `/api/campaigns/{id}/resume` | `PATCH` | ✅ what this workflow uses |
| `/api/campaigns/{id}/pause` | `PATCH` | |
| `/api/campaigns/{id}/archive` | `PATCH` | |
| `/api/campaigns/{id}/duplicate` | `POST` | |
| `/api/campaigns/{id}/unarchive` | **404** | |
| `/api/campaigns/{id}/restore` | **404** | |

**Archiving has no inverse.** That is the hard limit, and it is not a corner case: of the 22 dead
routed campaigns, **19 were `archived` and only 3 were `paused`**. This workflow fixes the 3. The 19
need a human to re-create them in Bison, and the portal's `OOO` column is what says so — once this
runs daily, a cell that is still not green means *the automation tried and could not*.

Worth knowing about those 19: sixteen held **zero leads**. They were not campaigns that ran dry —
they were archived while empty. Whatever archives them is upstream of this workflow and is not yet
identified.

## The one rule that matters

**Trust the vendor's status, never ours.** `public.campaign_status` has five values and Bison's
`paused` and `archived` both collapse into it — `paused → stopped`, `archived → completed`. That
collapse erases exactly the distinction this workflow turns on. So the local status is used only as a
cheap filter to pick candidates, and every candidate is then re-read from Bison.

Also: **only `auto_ooo_enabled` clients**. A client with OOO switched off routes nothing, so reviving
their campaigns achieves nothing — and would be the automation overruling a deliberate human choice.
That guard is why GIC's three dead campaigns are left alone.

## Before the first run

Resuming is not a small write. It releases **everyone who piled up inside the campaign, at once** —
150 contacts in UniTalk's `male` campaign, 76 in `female` on the day this was written.

That is the intended behaviour: those people asked to be contacted again and the date has passed. The
queue was measured fresh — oldest 18 days, and only 35 of 355 past the 14-day staleness rule that
`ooo-enrol-followups` enforces. A burst of timely follow-ups, not of absurd ones.

But it should be *observed*, not assumed. The first run should be a manual execution with
`Resume Campaign` disabled, to confirm the classification (3 `paused`, 19 `archived`) matches what
this README claims, and only then enabled.

If a burst ever needs pacing, the lever is the campaign's own `max_new_leads_per_day` — not this
workflow.

## What it will fight with

Nothing stops a manager pausing an OOO campaign deliberately; the next morning this workflow turns it
back on. The sanctioned way to stop a client's OOO is `clients.auto_ooo_enabled`, which this workflow
respects. If pausing-as-a-switch turns out to be real practice, that is a reason to revisit the
design, not to add a special case.
