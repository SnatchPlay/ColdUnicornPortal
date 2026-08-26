# n8n defect backlog

Live defects found by the instance-wide audit of **2026-08-15**. Distinct from
[migration-backlog.md](migration-backlog.md), which tracks *migration phase* per process — this file
tracks *things that are broken right now*.

**Method.** Inventory and graphs via `pnpm n8n:inventory` / `n8n:check-drift` / `n8n:validate`;
execution history via the n8n public REST API (`/api/v1/executions`, full pagination); lead field
coverage via `SUPABASE_DB_URL` against production. Every claim below is measured, not inferred.

**Execution window.** The instance retains ~16 days of history — 10 024 executions, oldest
`2026-07-30T11:11Z`. All failure ratios are over that window unless stated.

**Scale.** 71 workflows (51 live + 20 archived), **33 active**.

---

## 0 · Priority order

| # | Fix | Severity | Cost | Blocks |
|---|---|---|---|---|
| ~~[B1](#b1)~~ | ~~`[child-3]` OOO — sheet error aborts the Supabase branch~~ | — | **deployed 2026-08-15** | date bug still open |
| ~~[B2](#b2)~~ | ~~`[child-4]` blacklist — 63% of runs abort before the domain branch~~ | — | **deployed 2026-08-15** | still unbound from the recorder |
| ~~[B4](#b4)~~ | ~~`[child-1]` Lusha 402 kills the run~~ | — | **deployed 2026-08-15** | credits still exhausted |
| ~~[D1](#d1)~~ | ~~Branch S drops 4 enrichment fields the RPC already accepts~~ | — | **deployed 2026-08-15** | watch the next real MQL lead |
| ~~[D2](#d2)~~ | ~~RPC allow-list has no reply-context fields~~ | — | **deployed 2026-08-15** | migration, then caller |
| ~~[D6](#d6)~~ | ~~branch S read branch L's Snov.io node~~ | — | **fixed 2026-08-15** | found while doing D2 |
| [E1](#e1) | 15 of 33 active workflows report failures nowhere | high | 15 settings | all observability |
| [C1](#c1) | `[child-2]` NRR — zero executions, still declared phase A | medium | investigation | honest migration state |
| ~~[D5](#d5)~~ | ~~336 leads written before the fixes stay empty~~ | — | **won't fix 2026-08-18** | blanks are permanent and expected |
| ~~[B3](#b3)~~ | ~~Zoho OAuth token expired — 100% failure, silent~~ | — | **fixed 2026-08-26** | diagnosis was wrong: the token was healthy, `[103]` was broken three ways |
| ~~[B8](#b8)~~ | ~~FortumEnergia's OOO routing points at GIC's campaigns~~ | — | **fixed 2026-08-15** | rows deleted, 95 episodes parked, composite FK applied |
| ~~[B10](#b10)~~ | ~~Bison switched to cursor pagination — daily stats dead, campaign inboxes zeroed~~ | — | **fixed 2026-08-26** | one unrepairable day; `ooo_count` NOT NULL asymmetry still open |
| ~~[B11](#b11)~~ | ~~one phone number too long cost a lead all four of its destinations~~ | — | **fixed 2026-08-26** | execution 85420 still needs a retry; the fatal-node cost is accepted |
| [B5](#b5)–[B7](#b7) | credential/quota/transient failures | medium | varies | data completeness |
| ~~[E5](#e5)~~ | ~~Sheets-first branch ordering makes Sheets failures fatal~~ | — | **fixed 2026-08-18** | 4 workflows reordered, terminals guarded |
| [E2](#e2)–[E4](#e4) | systemic hardening | medium | varies | reliability |
| [A1](#a1)–[A4](#a4) | tooling and documentation drift | medium | docs | future audits |

---

## A · Tooling and governance

### A1 · Both claude.ai MCP connections point at the wrong tenant {#a1}

The `claude.ai n8n` MCP server returns **140 workflows** belonging to Hyra UK (Xero, Airtable, hire
forms), in project `Hyra DEV <automation@hyrauk.com>`. The repository's scripts, via `N8N_MCP_URL`,
see **51 live workflows** on `n8n.coldunicorn.com`. Intersection of workflow IDs: **zero**.

`claude.ai Supabase` has the same problem — `list_projects` returns only `Hyra Master` and
`Hyra Main DB (Deprecated)`; the portal's project `bnetnuzxynmdftiadwef` is not accessible.

An agent that reaches for either MCP server answers confidently about a different company. Neither
[mcp-setup.md](mcp-setup.md) nor [agent-tooling.md](../agent-tooling.md) warns about this.

**Fix.** Document the split explicitly: n8n work goes through `pnpm n8n:*` (or the instance MCP at
`N8N_MCP_URL`), never the `claude.ai n8n` server; Supabase work goes through `SUPABASE_DB_URL` /
the project-scoped `supabase` server in [.mcp.json](../../../.mcp.json), never `claude.ai Supabase`.

### A2 · `n8n:inventory` cannot see archived workflows {#a2}

`search_workflows` (the MCP tool `listWorkflows` calls) omits archived workflows. The REST API
returns 71; the inventory reports 51. Twenty archived workflows are invisible to every repository
tool, including the drift check.

**Fix.** Either switch [scripts/n8n/lib/mcp.mjs](../../../scripts/n8n/lib/mcp.mjs) `listWorkflows`
to the REST endpoint, or add an `--include-archived` pass so the count is honest.

### A3 · No execution-health tooling exists {#a3}

The instance MCP is an older build with no `search_executions` tool, and the repository has no
script that looks at execution history at all. Every failure in section B had been running for days
with nothing surfacing it. This audit needed throwaway scripts.

**Fix.** Add `pnpm n8n:health` — per-workflow failure ratio, last run, last failure, and
active-with-zero-executions, over the REST `/api/v1/executions` endpoint.

### A4 · `migration-backlog.md` §0 is stale {#a4}

Header claims "37 workflows, 29 active, 18 managed, 19 orphan" (2026-07-22). Actual: **51 live, 33
active, 24 managed, 27 orphan**. Section 5 calls Aimfox metrics "live" with no mention of its 13
failures; §1 treats the NRR path as live when it has not fired once.

**Fix.** Rewrite §0 counts and cross-link this file.

### A5 · Artifact drift — resolved 2026-08-15

`bison-lead-enrichment` was edited in the n8n UI on 2026-08-14 (mid-run duplicate re-check on branch
L; `Filter` on `result.created` and a `clients` select on branch S, feeding the notification switch)
and never exported. Re-exported this session; `pnpm n8n:check-drift` now reports **24 checked, 0
drifted**.

---

## B · Live failures

### B1 · `[child-3]` OOO — a Google Sheets error destroys the Supabase episode {#b1}

`O4DqMEu1Z9LcxikE` — **33 failures / 1545 runs.**

`[327] Add OOO Leads row` throws `cannot convert to Luxon DateTime` and carries **no `onError`**.
Branch L sits at `y=208`, branch S at `y=480`, and n8n runs fan-out branches top-to-bottom by
Y-position — so the abort happens before branch S starts. Verified on execution `75982`: the
executed-node list ends at `[327]`, and `[S] Resolve client sequencer` → `upsert_sequencer_contact`
→ `upsert_reply` → `record_ooo_followup` never ran.

Every one of those 33 events lost its `ooo_followups` row — the authoritative episode record under
[ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md).

This inverts [ADR-0017](../../adr/0017-sheets-to-supabase-dual-write-transition.md): the rule is
"Sheets first, Supabase second, **Supabase failure non-fatal in phase A**". Here a Sheets failure is
fatal to Supabase.

**Fix.** `onError: continueRegularOutput` on `[327]`, then fix the date conversion itself. The node
setting is the urgent half — it stops the bleeding regardless of the date bug.

> **Deployed 2026-08-15.** `pnpm n8n:deploy --id ooo-detect-and-log --node-settings "[327] Add OOO
> Leads row" --apply`; drift back to 0, `availableInMCP` and `errorWorkflow` preserved, workflow
> still active. **The Luxon date bug itself is still open** — `[327]` will keep failing, it just no
> longer takes branch S down with it. Watch `ooo_followups` row growth on those same executions to
> confirm episodes now land.

#### 2026-08-19 — the date bug closed, and it was never really a Luxon bug

The entry above names the wrong defect. `cannot convert to Luxon DateTime` is a symptom; the cause is
that **nobody tells the model what today is.** An auto-reply saying "back on 15 August" is ambiguous
without a reference date, so `gpt-5-mini` invents the year.

Measured on production over 974 episodes with `date_source = 'reply_parsed'`:

| | count | range |
|---|---|---|
| plausible (0–60 days out) | 938 | |
| **already in the past** | **35** | 2023-08-04 … 2026-08-14 |
| more than 6 months out | 1 | 2027-07-24 |

The shape is a dropped year, not random noise: created 2026-08-06, "returns" 2025-08-15 — day and
month right, year wrong. **23 of the 36 were later expired as `stale` by the Wave 1 worker**:
contacts who wrote "I am back on ⟨date⟩" and were never followed up at all. Six more were submitted
on a hallucinated schedule.

Two more findings from the same measurement:

- **The output key drifts.** `[317]`'s instruction said "Return only the structured JSON" without
  naming a key, so the model returned `return_date`, `returnDate` *and* `return_to_office` across
  executions. Branch L reads only `return_date`, so the other two silently became a +14-day fallback.
  Branch S never had this problem, because its prompt always named the key — the difference is
  entirely in the prompt.
- **The branches disagree with each other.** Two independent LLM calls on the same reply: S said
  08-18 where L said 08-19; S said null where L said "2027". A dual-write whose two stores are each
  asking a model the same question separately cannot reconcile by construction.

**Fixed in three layers, 2026-08-19.**

1. **Database backstop** — `20260818_ooo_reject_implausible_return_date.sql`. `record_ooo_followup`
   discards a parsed date outside `[current_date - 7, current_date + 180]`, schedules on the default
   cadence and records `date_source = 'parse_rejected'`. Not an exception: raising would abort the
   episode, which is worse than today. Not `fallback` either — that would hide it among the 1056
   replies that genuinely carried no date, and the whole point is to be able to measure how often the
   extractor is wrong. The −7 bound is measured, not chosen: the deltas run
   `-1 -1 -1 -2 -2 -2 -3 -3 -5` (legitimate late processing) then an empty band, then `-13 -18 -21
   -38 …`. The cut sits in the gap and separates all 9 real ones from all 27 impossible ones.
2. **Prompts — the actual root.** Both extractors now receive the reply's `date_received` and are
   told to resolve partial dates against it and never return an earlier one. `[317]` additionally
   names its key and format, as branch S always did.
3. **`[327]`** — reads all three observed key spellings and checks `isValid` instead of assuming ISO.

**A rule went quiet while this was being fixed, and that is worth recording.** Rewriting `[327]`'s
mapping as an IIFE put `?? {}` in front of `$now.plus`, and `business/fallback-date-as-fact` matched
with `[^}]*` — so it stopped reporting, with no behaviour change whatsoever. Nothing caught it except
`manifest/stale-known-violation`, which noticed that this workflow's still-valid acceptance had
nothing left to accept. The regexes now match the JSON string body properly. A rule a reformat can
silence is not a rule.

### B2 · `[child-4]` blacklist — 63% of runs abort before blocking the domain {#b2}

`bEB3aOHEq2lEpubp` — **211 failures / 337 runs.**

`[113] Bison: POST /blacklisted-emails` returns
`422 {"message":"The email has already been taken."}`. The error is benign — the address is already
blacklisted — but the node has no `onError`, so the execution dies.

`[111]` fans out to `[292] Check if domain is public` (`y=400`) and `[113]` (`y=208`). The email
branch runs first, so when it 422s the **domain blacklist branch never runs**, and neither do
`[157] Update Leads col Email Blacklist ID` / `[298] Update Leads col Domain Blacklist ID`.

Secondary: intermittent `ECONNRESET` on `[110] Find workspace in CS PDCA`.

**Fix.** `onError: continueRegularOutput` on `[113]`. Optionally branch on the 422 so a genuine
failure is still distinguishable from "already blacklisted".

> **Deployed 2026-08-15**, after importing the workflow as
> [`outreach/bison-blacklist-add`](../../../automation/n8n/workflows/outreach/bison-blacklist-add/README.md)
> — `n8n:deploy` cannot target an unmanaged workflow. Drift 0, still active.
>
> Two things this did **not** fix. The 422 is now absorbed rather than distinguished, so a genuine
> POST failure looks the same as "already blacklisted" — the optional branch above is still worth
> building. And this workflow has **no `errorWorkflow` bound** ([E1](#e1)), so its failure ratio
> collapsing is not evidence that nothing is wrong; it is the same silence as before, now quieter.

> **Measured again 2026-08-18, and the fix worked exactly as far as it reached.** Failures by day and
> by node, over the seven days to 2026-08-18:
>
> | Day | `[113]` 422 | `[294]` 422 | Sheets transient |
> |---|---|---|---|
> | 08-11 | 16 | 6 | — |
> | 08-12 | 12 | 2 | 1 |
> | 08-13 | 20 | 3 | — |
> | 08-14 | 16 | 1 | 1 |
> | 08-15 | — | 7 | — |
> | 08-17 | — | 21 | — |
> | 08-18 | — | — | 1 |
>
> `[113]` stops dead on 08-15 and `[294]` stops dead on 08-18 — each on the day its `onError`
> landed. That is the cleanest evidence in this document that a deploy did what it claimed.
>
> It also makes the shape unmistakable: **the abort does not disappear, it walks down the limb.**
> Three nodes in, the cause is no longer even the same (Bison 422 → Google Sheets 503), but the
> consequence is identical — the domain limb at `y=400` never runs, because the email limb at
> `y=208` died somewhere. Every node between a fan-out point and the end of the first limb is a
> single point of failure for every later limb. Guarding one is not a fix; guarding the limb is.
> Hence [E3b](#e3b).

### B3 · Zoho CRM child — ~~expired OAuth token~~ a three-way broken node — fixed 2026-08-26 {#b3}

`am3gYNrZSTbrkRFa` — **20 failures / 20 runs**, oldest retained 2026-08-14. The failure count was
right. **The diagnosis was wrong, and it was wrong in the direction that costs the most: it read a
vendor error message instead of the execution data.**

This entry originally said *"`[103] Zoho: Add email to lead` returns `401 invalid oauth token` on
every execution, so the token has been dead for at least 16 days … No lead has reached Zoho in that
time."* Reading a failing execution node by node (84919, 2026-08-25):

| Node | Result |
|---|---|
| `[35] Zoho: refresh access_token` | ✅ returns a token, `scope: ZohoCRM.modules.ALL` |
| `[101] Zoho: Upsert Account` | ✅ `code: SUCCESS`, record created |
| `[102] Zoho: Upsert Lead` | ✅ `code: SUCCESS`, record created |
| `[103] Zoho: Add email to lead` | ❌ `401 invalid oauth token` |

The credential was never expired. Leads **were** reaching Zoho throughout; what never arrived was the
reply attached to them. Three independent bugs, all in `[103]`:

1. **The token came from the wrong node.** `[103]`'s input is `[102]`, so `$json` is the upsert
   response, which has no `access_token`. The header was literally `Zoho-oauthtoken undefined` —
   Zoho's "invalid oauth token" was precisely accurate, and reading it as a credential problem is
   what parked this for eleven days.
2. **Two expressions were never expressions.** URL and JSON body embedded `$json…` / `$('…')` inside
   JavaScript string literals, so n8n sent the source text:
   `POST /crm/v8/Leads/$json.data[0].details.id/actions/associate_email`.
3. **Three field errors underneath** — `lead.last_reply_body_html` does not exist in the dispatcher
   payload (it is `last_reply_html`); `sent: True` is Python capitalisation, which n8n resolves to
   `undefined` and `JSON.stringify` then **drops silently**, so the flag never once reached Zoho; and
   `date_time` was passed as `2026-08-25T14:27:35.000000Z`, six-digit microseconds that Zoho's
   ISO-8601 parser rejects.

**Fixed 2026-08-26.** One node re-deployed, drift 0. The workflow was also **imported under
repository control** in the same change — `crm/zoho-upsert-account-and-lead`, the first artifact in
the `crm` domain. It being an orphan is most of why a three-line bug survived eleven days.

**Behavioural proof still owed.** It writes to the client's own Zoho tenant, so there is no safe
synthetic run: the next real positive reply for a Zoho-authorised client is the test. Check that
`[103]` returns `code: SUCCESS` and that the reply is visible on the Lead.

**Two things this leaves open.**

- **`sent: true` is unconfirmed semantics.** `from` is the lead and `to` is our sender, so by Zoho's
  definition the message is *received*, not sent. The flag has never reached Zoho, so there is no
  behaviour to preserve and nothing to migrate — but somebody who reads these records should decide
  it rather than inherit the original author's `True`.
- **The four sibling CRM children and the dispatcher are still orphans.** The graphs were copied, so
  bugs 1–3 are plausibly theirs too. Audit before the next client authorises a CRM.

**The lesson worth keeping.** A vendor's error string is a hypothesis, not a diagnosis. Two nodes on
the same credential succeeding in the same execution falsifies "the credential is dead" in one glance
at the run data.

### B4 · `[child-1]` — Lusha credit limit exhausted {#b4}

`lBOyL8ZPA3SZSvDW` — **12 failures / 340 runs.** `[181] Lusha: POST /v2/person (fallback phone)`
returns `402 — You've reached your credit limit. Upgrade your account for more credits`. Phone
enrichment silently degrades to whatever the AI extraction found.

**Fix.** Top up Lusha, or set `onError` on the node so a missing phone is a null rather than a dead
execution.

> **Deployed 2026-08-15** — the `onError` half. **The credit limit itself is untouched**: phones
> still are not enriched, the run simply no longer dies. Topping up Lusha is an owner action.
>
> **2026-08-18 — the burn rate is halved on the Bison flow and stopped on both Aimfox flows.** Every
> Lusha call in the estate was traced to its consumer first, and all three fed the SHEET only:
>
> | workflow | node | its only consumer | reached Supabase? |
> |---|---|---|---|
> | `bison-lead-enrichment` | `[181]` | `[287] Set phone from Lusha` → sheet | no — branch S has its own `[S] Lusha` |
> | `aimfox-premql-to-pdca` | `Lusha Enrichment` | `Edit Fields` (country) → sheet | no |
> | `aimfox-leads-processing` | `Lusha Enrichment` | `[287]` + `Create Record` → sheet | no |
>
> All three are now `disabled`. The Bison one is a pure saving — branch S still enriches and the phone
> still reaches `leads` through the RPC.
>
> **The two Aimfox ones were not**, and were handled differently the same day:
>
> - **`aimfox-leads-processing` — Lusha moved into branch S.** Its call was the only phone source for
>   the LinkedIn channel, so switching it off would have ended phone enrichment everywhere rather than
>   just in the sheet. `[S] Lusha Enrichment` now runs between `[S] Resolve campaign` and the RPC, and
>   `phone_number` / `phone_source` go through `promote_contact_to_lead`. Still exactly one Lusha call
>   per lead — it just lands somewhere that survives the Sheets shutdown. It reveals only `phones`
>   (branch L also asked for emails, which branch S takes from Aimfox, and Lusha bills per revealed
>   datapoint) and carries `onError` so a 402 costs the phone and never the lead. Proven in a
>   rolled-back transaction: `phone_number='+48 123 456 789'`, `phone_source='Lusha'`.
> - **`aimfox-premql-to-pdca` — same treatment, on request.** `[S] Lusha Enrichment` added, phone
>   through the RPC, verified the same way (`phone_number='+48 987 654 321'`, `phone_source='Lusha'`).
>
>   Found while wiring it: **branch L's Lusha call there never worked.** It left `fullResponse` off
>   while its only consumer read `$json.body.results[0].location.country` — a path that exists only
>   when fullResponse is on. So `lushaCountry` was always undefined, `country` always came from the
>   Aimfox fallback, and every credit that node spent bought nothing. The branch-S node sets
>   fullResponse, so its phone actually resolves. Country stays derived from the Aimfox location,
>   because that is what branch L effectively produced anyway.
>
> Deploying this needed `disabled` to become a movable node-level key — it is not a parameter, so no
> allowlist could carry it and a node could only be switched off by hand in the UI.

### B5 · `Add OOO Leads` — API key does not match the workspace {#b5}

`zaPkpSAuvjibUUDU` — **5 failures / 10 runs**, criticality high (the only OOO workflow that calls a
Bison *write* endpoint). `Attach leads to campaign1` returns
`403 — This action is unauthorized. The api key does not match the workspace the record is on.`
One client's key is being used against another client's campaign.

**Re-measured 2026-08-15, and it is neither resolved nor small.** The audit's "no recurrence after
2026-08-09" was wrong: it recurred on **2026-08-15T06:00** (execution 76265), the most recent run.
Reading that execution's data changes the severity twice over.

`Build attach requests1` emitted **4 items** — one per client, 24 lead ids in total. The node has no
`onError`, so the **first** item's 403 ended the execution and the other **three clients were never
attached at all**. The 403 is one client's stale CS PDCA key; the loss is everyone in that run.

Worse, `Schedule Trigger` fans out to `Get OOO leads1` (y=256) and `[S] SHADOW · record intended
enrolment` (y=560). Under `executionOrder: v1` the lower Y runs first, so the abort also killed the
shadow — **on half the recent runs the phase-A evidence for [Wave 1](../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md)
was never recorded either.** That is [E5](#e5) doing real damage on the one workflow whose migration
matters most, not a theoretical ordering concern.

Two more things that execution shows, worth carrying into the Wave 1 worker:

- **`leadIds` contains duplicates within a single request** — `557756` three times, `573330` three
  times, `573476` three times. Whatever the Bison endpoint does with that, the payload is wrong at
  the source.
- **Each item carries a raw Bison API key in its JSON**, read from CS PDCA. Execution data is
  therefore credential-bearing; never paste it into a doc or an issue.

**Fixed 2026-08-15 (partially):** `onError: continueRegularOutput` on `Attach leads to campaign1`,
deployed with
`pnpm n8n:deploy --id ooo-enrol-followups --node-settings "Attach leads to campaign1" --apply`.
One client's bad key can no longer cost the other clients their enrolment, and the branch-S shadow
now runs regardless. Drift back to 0.

**Still open — the 403 itself.** The right fix is not a better sheet lookup: it is the Wave 1 worker
resolving the key per client from `client_sequencers.api_key`, which is exactly the failure mode that
design removes. Until then a mismatched key silently skips that client instead of the whole run,
which is better but still a lost enrolment. Find which client it is by re-reading the node's error
output after the next scheduled run.

### B8 · One client's OOO routing points at another client's campaigns {#b8}

Found 2026-08-15 by the **first controlled run of the Wave 1 worker** — the run that was supposed to
prove five enrolments, not to find a client-isolation hole. Severity high; nothing has leaked yet.

All three `client_ooo_routing` rows for **FortumEnergia** (male, female, general) point at
**GIC's** campaigns `951` / `952` / `950`. The campaigns on both sides are named identically —
`OOO automation | male` and so on for every client in the estate — so in any campaign picker that is
not scoped to one client, the wrong row is indistinguishable from the right one. **FortumEnergia has
no `OOO automation` campaigns of its own at all**, so there was no correct row to pick: 95 pending
episodes were routed into another client's follow-up sequences.

**What stopped it was luck of the right kind.** The worker authenticates with the *contact's*
workspace key, and Bison refused: `403 — the api key does not match the workspace the record is on`.
Had the two clients shared a workspace, FortumEnergia's contacts would have been enrolled in GIC's
campaign and mailed from GIC's senders. This is also the root cause of the 403 in [B5](#b5), which
until now read as "somebody's API key is stale".

Branch L had exactly the same exposure and could never have shown it: it died at the first request
and wrote nothing down. Phase B surfaced it in SQL on day one, in `ooo_followups.last_error`.

**The structural hole.** `client_ooo_routing` has independent foreign keys to `clients` and to
`campaigns`, and **nothing ties `campaigns.client_id` to `client_ooo_routing.client_id`**. The
combination is unconstrained, so the same mistake can be made again from the portal, from n8n, or
from a psql session.

**Contained the same day, not fixed.** `[S] Select due episodes` now carries
`camp.client_id = cs.client_id`, so the worker cannot be the vector whatever the routing table says.
Due episodes drop from 832 to 746; the difference is FortumEnergia's, deliberately withheld. The
routing rows are still wrong and the constraint is still missing.

#### Resolved 2026-08-15 (owner chose: delete the rows)

1. **95 live episodes parked first**, through `skip_ooo_followup(..., 'routing_missing')` — never raw
   DML, and deliberately not deleted. `routing_missing` is the one skip reason
   `recover_skipped_ooo_followups` resurrects, so the moment FortumEnergia has real routing those
   episodes come back on their own. 95 parked, 0 failures.
2. **Then the three routing rows were deleted.** Cross-client routing rows: 0. Cross-client live
   episodes: 0.
3. **Then the constraint**, in that order because it could not be added while the bad rows existed —
   [`20260815d_ooo_routing_same_client_fk.sql`](../../../supabase/migrations/20260815d_ooo_routing_same_client_fk.sql):
   `UNIQUE (id, client_id)` on `campaigns` (redundant as uniqueness — `id` is already the primary key
   — and present only to be the target), then
   `client_ooo_routing (campaign_id, client_id) REFERENCES campaigns (id, client_id)`. Declarative,
   no trigger, enforced on every write path at once — portal, n8n and psql alike.

   Verified in a rolled-back transaction against production: the constraint applies to the live data,
   a cross-client insert is `rejected by client_ooo_routing_campaign_same_client_fkey`, a same-client
   insert still succeeds. The first attempt at that test proved nothing — both inserts bounced off
   the partial unique `uq_client_ooo_routing_active (client_id, routing_key) WHERE is_active` before
   ever reaching the foreign key, so the test was redone with `is_active = false`.

**~~Still worth doing~~ — checked 2026-08-19, the picker was never the trap.** The routing editor's
campaign list comes from `loadClientOooRouting`, whose query is
`campaigns WHERE client_id = <client> AND type = 'ooo_followup' AND archived_at IS NULL`
([orm-gateway/index.ts:3325](../../../supabase/functions/orm-gateway/index.ts#L3325)), and the write
path re-checks the same three predicates at the contract boundary. Whatever produced the three rows,
it was not this editor. Re-measured the same day: 0 cross-client rows.

**Still true:** FortumEnergia has no OOO campaigns of its own. Its episodes stay parked until someone
creates them in Bison and configures routing — and since 2026-08-19 provisioning creates the triple
*and* fills the empty routing rules in one run, so that is now one button rather than two jobs. It
will not fill a rule from a campaign that is `completed` or `stopped`, so a client in Gbbc's shape
(three dead campaigns, no rules) stays honestly unrouted rather than gaining three rules that cannot
send.

### B9 · A hand-written `If` with no `conditions.options` kills the run — fixed 2026-08-21 {#b9}

`bison-ooo-campaign-revive` (`1NNq86xVXbWkEnnF`) failed on its **first ever fire**, 2026-08-21
06:40 UTC, execution 81115:

```
Needs Resume?  —  Cannot read properties of undefined (reading 'caseSensitive')
```

Not a logic bug and not a Bison problem. The `If` node's `parameters.conditions` carried
`combinator` and `conditions` but **no `options`** — the sibling block that holds `caseSensitive`,
`typeValidation` and the filter `version`. `IfV2` reads `options.caseSensitive` unguarded, so it
throws on the *first item*, before any condition is evaluated. The n8n UI always writes that block;
a workflow authored as JSON by an agent does not, and the artifact looks perfectly valid on disk —
`pnpm n8n:validate` passed it, and so did every review.

Nothing ran and nothing was written: `Resume Campaign` was never reached, `Record Run` was never
reached, and `integration_sync_runs where sync_type = 'ooo_campaign_revive'` is empty. The
classification upstream was correct — 21 campaigns read, 18 `archived` → `cannot`, and UniTalk's
`606` / `607` / `608` `paused` → `resume`, 368 contacts queued, the number the manifest predicted.

The same defect was live in **two** other artifacts, found by auditing every `if`/`filter`/`switch`
in the repository:

| Workflow | Node | Blast radius |
|---|---|---|
| `bison-blacklist-add` (`bEB3aOHEq2lEpubp`, active) | `tag != Not Interested (domain path)` | the domain limb aborted on **every** run, so `Domain Blacklist ID` was never written back to Sheets. Compounds [B2](#b2) — the same limb, a second reason to die |
| `bison-workspace-setup` (`c82kKnHaREUMvPBR`) | `Needs Schedules?` | not yet in service |

> **Deployed 2026-08-21** to both active workflows via `pnpm n8n:deploy --nodes`, one node each.
> Drift 0 on both. `bison-workspace-setup` fixed in the artifact only.
>
> **Guarded.** [`scripts/n8n/validate.mjs`](../../../scripts/n8n/validate.mjs) now raises
> `structure/filter-options` (error) for any `if`/`filter`/`switch` whose `conditions` lacks
> `options.caseSensitive`, `switch` rule groups included. It runs in CI, so this class cannot be
> deployed again.
>
> **Still owed:** the revive workflow has *still* never completed a run. The 2026-08-22 06:40 UTC
> fire is the first real verification — watch `integration_sync_runs`.

### B10 · Bison made cursor pagination the default — `meta.total` vanished — fixed 2026-08-26 {#b10}

Not a defect we wrote: a **vendor contract change**, at roughly `2026-08-25T21:00Z`. Bison flipped
`/replies`, `/leads`, `/sender-emails` and `campaigns/{id}/sender-emails` from Laravel length-aware
pagination to cursor pagination by default. `meta.total` disappeared. Length-aware mode — and with it
`total` — survives behind an explicit `page` parameter.

Two workflows read `meta.total`, and they failed in opposite ways.

**`Daily Stats Process` (`BQbFKHUaIcEKPc01`) — loud.** All nine HTTP calls kept returning 200 with
`executionStatus: success`; six counters silently became `null`. `ooo_count` is the only `NOT NULL`
column among them, so the INSERT died:
`null value in column "ooo_count" of relation "daily_stats" violates not-null constraint`.
**102 failures**, first `2026-08-25T21:26Z`, 100% of runs after that, **0 rows for 2026-08-26** across
all 17 clients.

**`Bison campaign daily stats` (`AEgpCGoSpiZ7PA90`) — silent.** `onError: continueRegularOutput`
([B-README defect 1](../../../automation/n8n/workflows/ingestion/bison-campaign-daily-stats/README.md))
absorbed the missing field, so the 21:30 run reported success and wrote `inboxes_active = 0` on
**501 rows of 501** (baseline ~198 real zeros). No alert fired. This is the more dangerous half.

**Fix, deployed 2026-08-26.** `&page=1` on five nodes — `HTTP Automated Replies1`,
`HTTP Human Replies1`, `HTTP Leads1`, `HTTP Sender Emails1`, `HTTP Campaign Inboxes`. Restored totals
match the last good row byte-for-byte (UniTalk: 3820 / 2401 / 4891 / 125). Drift 0 on both.

**Still open, and deliberately not bundled into this fix:**

1. **`ooo_count` stays `NOT NULL` — decided 2026-08-26, by the owner.** The obvious reading is that
   the asymmetry is the defect: align the nullability and a degraded fetch degrades the row instead
   of killing the run. The owner rejected that, and correctly. **That constraint was the only alarm
   in the system.** Relax it and the identical vendor change writes six `null` counters into every
   client's row, every two hours, with a green execution list — exactly what
   `bison-campaign-daily-stats` did on the same day and nobody noticed for a day.
   The constraint is not a good alarm; it is an accidental one, and it fires as a total outage. The
   fix is therefore **additive, not subtractive**: assert the response shape at the source (an
   `integration_sync_runs` row and a check that `meta.total` is a number) so the failure is loud
   *and* scoped. Until that exists, `NOT NULL` stays.
2. **The 2026-08-25 campaign zeros are unrepairable.** No backfill input on that workflow, and
   `sender-emails` reports current state, not history. Reconstructing them would be invented data
   ([ADR-0017](../../adr/0017-sheets-to-supabase-dual-write-transition.md) discipline). They dip
   `admin_dashboard_daily` until ~2026-09-15.
3. **`page=1` is a reprieve, not a contract.** Bison chose cursor as its default; the compatibility
   parameter can go next. The durable fix is to stop deriving per-day counters from undated lifetime
   totals — [`bison-daily-stats-process` defect 4](../../../automation/n8n/workflows/ingestion/bison-daily-stats-process/README.md).
4. **Nothing watches the vendor contract.** Both workflows would have caught this on the first run
   with an `integration_sync_runs` row and a shape assertion; neither has one ([E4](#e4)).

Verified unaffected: `workspaces/v1.1/line-area-chart-stats` and `workspaces/v1.1/stats` (not
paginated), `campaigns/sending-schedules` (still length-aware by default, and no client exceeds
6 scheduled campaigns against a page size of 15), `/campaigns` (moved to cursor, but
`bison-campaign-sync` and `bison-workspace-setup` walk `links.next`, which cursor mode still emits —
47 Bison campaigns, 47 rows refreshed in 24h).

### B11 · `[child-1]` — a 61-character phone number cost a lead all four destinations — fixed 2026-08-26 {#b11}

`lBOyL8ZPA3SZSvDW`, execution 85420. `[S] promote_contact_to_lead` returned `value too long for type
character varying(50)`. The offending value was a phone:

```
+380 44 507 29 94*303 / +380 67 311 44 55 / +380 50 394 31 13     (61 chars)
```

The AI extraction is asked for `phone_number`, singular; the signature listed three and it returned
all three in one string. `leads.phone_number` is `varchar(50)`.

**The interesting part is not the overflow — it is what the overflow cost.** The node is fatal
(no `onError`), and under `executionOrder: v1` the entire branch-L chain hangs *below* it:
`[S] promote_contact_to_lead → Filter →` `[4] Check if lead already in Leads sheet`,
`[189-192] Forward email to recipients`, `Call '[HUB] CRMs Add/Update Lead Dispatcher'`. So one
oversized string cost this lead **four** destinations: the `leads` row, the Leads sheet row, the
forwarded email, and the CRM sync. `sequencer_contacts` and `replies` were already written, leaving a
contact and a reply with no lead.

This also falsified two claims that the artifact README had been making since July — that all five
branch-S Postgres nodes carry `onError: continueRegularOutput`, and that *"Sheets and Supabase run in
parallel; neither reads from the other."* Neither is true of the live graph: three of the five have no
`onError`, the branches are sequential, and branch L's `Edit Fields1` reads two branch-S nodes. Both
claims are corrected in the artifact README.

**Fixed 2026-08-26** in `[S] Parse AI output + set phone` — the single shared source that both
branches read, so the sheet and Supabase keep the same value:

```js
const phoneFromAi = String(ai.phone_number || "").split(/[\/,;|\n]/)[0].trim();
```

**Two owner decisions, recorded so they are not quietly reversed:**

1. **First number in the string**, not "first mobile". Simple and predictable; it matches signature
   order. In this case it yields the office number with its extension.
2. **The node stays fatal, and no truncation.** `continueRegularOutput` would have let the chain
   finish, but the Supabase failure would then be silent — a green execution and no Slack alert.
   Truncating to 50 would store a wrong, dialable-looking number. Both were rejected in favour of
   failing loudly. **The cost is accepted knowingly:** if this node fails again, the lead is lost in
   all four places and the recovery is a retry.

**Still open — execution 85420 needs retrying.** `info@oriongr.com` has a `sequencer_contacts` row
(`9e60cafb…`) and a `replies` row (`45ddd5c0…`) but no `leads` row. A retry from the start is safe:
both RPCs are idempotent by key and `promote_contact_to_lead` is at most one lead per contact
([ADR-0015](../../adr/0015-sequencer-contacts-and-ooo-followups.md)).

**Also found, and separately worth acting on.** The artifact was **stale**: re-exporting to make this
change pulled in six nodes that had been added in the UI and never exported (`[S] Lead exists?`,
`[S] Lead already promoted?`, `[S] Qualification from tag set`, `[S] Sync qualification`,
`Enriched this run?`, a sticky note) and corrected the failure posture of five more. A UI edit that
never becomes an artifact is the same class of problem as [A1](#a1) — the repository stopped being
the record of what runs, which is exactly how a README keeps asserting guards that are not there.

### B6 · `aimfox-premql-to-pdca` — 500 on blacklist — fixed 2026-08-19 {#b6}

`s0GqDtCzyLAvVnm1` — **12 failures / 116 runs.** `Add company to blacklist` returns
`500 — An internal server error occurred`.

The 500 comes from Aimfox and is not ours to fix. What *was* ours is what the abort costs. Execution
77896 settles it: every `[S]` RPC node — `upsert_sequencer_contact`, `upsert_reply`,
`promote_contact_to_lead` — had already run, and `Add company to blacklist` was the last node
executed. So Supabase is intact, and the visible cost is one missing blacklist entry.

The invisible cost is the fan-out. `If1` sends its true output to `Add company to blacklist`
(`y=1008`) and its false output to `OpenAI - Search for the company name` → `Filter2` →
`Add company to blacklist1` (`y=1200`). An abort on the upper limb ends the execution before the
lower one runs. **This is the fourth workflow in this document with that exact shape** — after
`[113]`, `[294]` and `[156]` in [B2](#b2). It is not a coincidence; it is what `executionOrder: v1`
does to any graph whose limbs are not individually guarded.

Both `Add company to blacklist` nodes already carried `retryOnFail` — so the 500 had already been
retried three times before it killed the run. Retry was never the missing piece here.

> **Deployed 2026-08-19.** `onError: continueRegularOutput` on `Add company to blacklist`,
> `Add company to blacklist1` and `Add Lead to Blacklist`. Drift 0.

### B7 · `Get Metrics from Aimfox` — unretried transients — fixed 2026-08-18/19 {#b7}

`sVev5d0N6rtrbcgI` — **13 failures / 113 runs.** Google Sheets `503` and `ECONNRESET`, Aimfox
`500`. All twelve HTTP nodes have `retryOnFail` unset, so every transient becomes a lost run
([E3](#e3)).

**Mostly closed as a side effect of [E3b](#e3b).** This workflow is the managed artifact
`ingestion/aimfox-daily-metrics`, and 8 of its 9 failures in the week to 2026-08-18 were the Google
Sheets transients that the estate-wide retry pass covered — the five Sheets nodes here were in that
batch. Re-measured by node:

| Failures | Node | Code |
|---|---|---|
| 2 | `Update row in sheet` | ECONNRESET |
| 2 | `Update row in sheet1` | ECONNRESET |
| 2 | `Update row in sheet2` | ECONNRESET |
| 1 | `Get row(s) in sheet` | 503 |
| 1 | `Get row(s) in sheet1` | ECONNRESET |
| 2 | `Get Campaign` | 500 (Aimfox) |

> **`Get Campaign` deployed 2026-08-19** with `retryOnFail` only — **deliberately no `onError`.** It
> feeds `Get Campaign Metrics`, and `continueRegularOutput` would pass an empty item into the metrics
> chain, turning a failed run into a silently wrong number. A lost run is the better failure here,
> and it is the one case in this pass where absorbing the error would have been the wrong move.

---

## C · Active but never firing

### C1 · `[child-2]` NRR daily stats — zero executions {#c1}

`1hHbU2hYYcsktLUP` — **0 runs in 16 days**, while its sibling `fire_child_3` (OOO) fired 1545 times.
The HUB gate is
`fire_child_2 = event.type === "TAG_ATTACHED" && data.tag_name === "NRR"` — an exact string match. No
Bison tag by that literal name is being attached.

The workflow's manifest nonetheless declares dual-write phase A, and
[migration-backlog.md §1](migration-backlog.md) lists the NRR row as live.

**Fix.** Determine whether the tag was renamed in Bison or the NRR classification stopped producing
it. Then either repair the gate or mark the path dead and drop its phase-A claim.

#### Diagnosed 2026-08-15 — neither. The tag is deliberately never attached.

The gate is correct and the classifier is alive. What sits between them is an explicit off-switch.

**1. No NRR tag reaches the HUB.** Tallying the webhook payload of the **900 most recent** HUB
executions (≈7 days) gives exactly five tag names, and NRR is not among them:

| event | tag | count |
|---|---|---|
| TAG_ATTACHED | `OOO` | 631 |
| TAG_ATTACHED | `Interested` | 146 |
| TAG_REMOVED | `OOO` | 55 |
| TAG_ATTACHED | `preMQL` | 41 |
| TAG_REMOVED | `Interested` | 22 |
| TAG_REMOVED | `preMQL` | 4 |
| TAG_REMOVED | `Outlook` | 1 |

**2. The classification itself is alive** — `replies.classification = 'NRR'` has **103 rows, the
newest today**. So nothing stopped producing NRR.

**3. The suppression is a node.** `Bison Replies Classification` (`XdTMd1KJX0cRmF9u`) contains an IF
named **`Category Is Not NRR?`** — `{{ $json.category === 'NRR' ? 'no' : 'yes' }}` equals `'yes'`.
Its false branch goes straight to `Respond - Skipped`, so an NRR reply never reaches
`Bison - Get Tags List` → `Resolve Bison Tag ID` → `Bison - Attach Classification Tag`. No tag is
attached, therefore no `TAG_ATTACHED` webhook can ever exist, therefore `[child-2]` **cannot** fire.
It is not a broken gate and not a renamed tag: somebody switched the path off upstream, on purpose,
and the register downstream was never told.

**4. And the 103 NRR replies are not email at all.** Joined through
`sequencer_contacts → client_sequencers → sequencers`, every one is **Aimfox**. Zero are EmailBison.
The full picture, by channel:

| channel | classifications that reach Supabase |
|---|---|
| Aimfox | Interested 163 · NRR 103 · other 56 · Left_Company 4 · OOO 3 · Spam_Inbound 2 |
| EmailBison | OOO 1848 · Interested 519 — **and nothing else, ever** |

That is the finding worth keeping. The Bison classifier decides between six categories, but a
`replies` row is only written by a *child*, and a child only runs if a *tag* was attached. So for the
email channel `NRR`, `other`, `Left_Company` and `Spam_Inbound` are computed on every reply and then
thrown away — invisible in Supabase, in the sheet, and in the portal. Aimfox records all six because
its classifier writes the row itself instead of routing through a tag.

#### Decided 2026-08-15 (owner): do not revive email NRR. **C1 is closed as won't-fix.**

The `Category Is Not NRR?` suppression stays. `[child-2]` is therefore unreachable permanently, and
is marked `status: deprecated` in both its manifest and `registry.yaml` — kept rather than deleted,
because it is the only written record of what the NRR contract was, and reviving it later is a
one-node change in the classifier.

What that decision means, checked rather than assumed:

- **For email, NRR exists in no store.** Not Supabase, not the sheet. This is not missing data
  awaiting a backfill — it was never captured, and by decision will not be.
- **No portal surface breaks.** Grepped 2026-08-15: there is no `nrr_count` anywhere in `src/`, the
  gateway or the migrations, so nothing silently reads zero. The only NRR-aware UI is
  `ReplyClassificationBadge` ([portal-ui.tsx:430](../../../src/app/components/portal-ui.tsx#L430)),
  which renders whatever `replies.classification` holds — it will keep showing NRR for Aimfox and
  never for email, which is now the correct behaviour rather than a gap.
- **LinkedIn is untouched.** `aimfox-classification` writes its own reply rows and does not route
  through the Bison HUB.
- **`nrr-daily-stats` no longer claims dual-write phase A** — corrected in its manifest
  (`phaseState: unreachable`) and in [migration-backlog §0](migration-backlog.md), where the single
  "OOO / NRR — A, live" row has been split so OOO keeps its evidence and NRR carries the truth.

**Still open, and independent of this decision:** the Bison classifier writes a `replies` row only
when a tag is attached, so `other`, `Left_Company` and `Spam_Inbound` are computed and discarded for
email too. Recording the classification regardless of tagging changes nothing a client can see, and
is a precondition for the Sheets cutover — the email channel currently persists exactly two of six
categories.

**One production action is still pending and needs an explicit decision:** `1hHbU2hYYcsktLUP` is
still `active` on the instance. It is harmless — it cannot be triggered — but an active workflow that
by decision will never run is noise in every inventory and health report. Deactivating it is
`pnpm n8n:deploy --id nrr-daily-stats --deactivate --apply`, and activation state is never changed as
a side effect of anything else.

### C2 · Other silent workflows {#c2}

| Workflow | Runs in 16 days | Note |
|---|---|---|
| `[child-5]` TAG_REMOVED · Not Interested · Unblacklist | 0 | **Explained 2026-08-15**: the same 900-execution sample used for [C1](#c1) contains no `Not Interested` tag in either direction. The tag is never *attached*, so it can never be *removed* — child-5 has nothing to react to, by construction rather than by fault. Note the corollary: the `tag != Not Interested` branches inside `[child-4]` are dead code too. |
| `[CRM child] Salesforce` | 0 | plausibly no client on Salesforce — unverified |
| `[CRM child] LiveSpace` | 0 | plausibly no client on LiveSpace — unverified |
| `[CRED] CS PDCA edit → client_sequencers` | 3, last 2026-08-07 | the Apps Script `onEdit` path that was meant to replace the 6-hourly sweep barely fires |
| `Winnr Sync - Error Handler` | 0 | correct — it only runs on Winnr failure |

---

## D · The Supabase cutover blocker: branch S enriches less than branch L

`[child-1]` (`lBOyL8ZPA3SZSvDW`) is the Bison MQL lead flow. Its **data collection is identical**
across branches — `[S] Compute derived values` is byte-for-byte the same function as
`[79+72+51+8+57]`, and both branches make the same Bison, Snov.io (local + global), OpenAI `gpt-4o`
and Lusha calls. The divergence is entirely in **what gets written**.

The Google Sheet row gets 19 populated columns. `[S] Edit Fields` → `promote_contact_to_lead` passes
**9**.

Measured on production, EmailBison leads with `source_sequencer_contact_id`, by week:

```
week         leads  industry  headcount  linkedin  country  msg_title  resp_label
2026-06-15     109       109        109       109      109        109         109
2026-07-06      87        87         87        87       87         87          87
2026-07-13     120       120        120       120      120        120         120
2026-07-20      71        13         13        13       13         13          13
2026-07-27      64         0          0         0        0          0           0
2026-08-03     100         0          0         0        0          0           0
2026-08-10     114         0          0         0        0          0           0
```

A cliff, not a decay. The two cohorts separate cleanly: the 483 "full" leads have
`origin_reply_id = 0` and `updated_at` from `2026-07-21T17:56` — Sheets-era rows that had
`source_sequencer_contact_id` attached retroactively. The **336 leads created 2026-07-21 → 2026-08-14
all have `origin_reply_id`**, so they are genuine branch-S writes, and all seven fields are empty in
every one of them.

These fields are read by [lead-report-columns.tsx](../../../src/app/lib/lead-report-columns.tsx),
[client-leads-page.tsx](../../../src/app/pages/client-leads-page.tsx) and
[crm/lead-health.ts](../../../src/app/lib/crm/lead-health.ts) — so 336 leads render to the client
with empty INDUSTRY / HEADCOUNT / LinkedIn / Country / MESSAGE TITLE / MESSAGE # / RESPONSE TIME,
while the same lead's spreadsheet row is complete.

### D1 · Four fields the RPC already accepts, not passed {#d1}

`promote_contact_to_lead` allows 14 keys ([20260805](../../../supabase/migrations/20260805_promote_contact_lead_two_way_qualification.sql),
unchanged since 20260723). `[S] Edit Fields` supplies 7 of them, the query adds `phone_source` and
`qualification` — 9 total. Missing, with columns that already exist in `leads`:

| Key | Source already available on branch S |
|---|---|
| `linkedin_url` | `snovio_body.data[0].social[type=linkedinProfile].link` ‖ `ai.person_linkedin` |
| `industry` | `snovio_body.data[0].industry` ‖ `ai.company_industry` |
| `headcount_range` | `snovio_body.data[0].currentJob[0].size` ‖ `ai.company_size` |
| `country` | `snovio_body.data[0].country` |
| `gender` | computed by neither branch |

**Fix.** Add the four assignments to `[S] Edit Fields` and four `jsonb_build_object` entries to
`[S] promote_contact_to_lead`. No migration needed. Cheapest, highest-value item in this document.

> **Deployed 2026-08-15.** `--nodes "[S] Edit Fields,[S] promote_contact_to_lead"`; the seven
> existing fields and the twelve existing parameters are byte-identical, four of each were added.
> Precedence mirrors branch L's `pick(...)` cascades in `Create Record`.
>
> Contract proven against production before the write, in a rolled-back transaction: the RPC
> accepted all four keys, and an unknown key still raised
> `promote_contact_to_lead rejects unknown lead fields: {not_a_column}` — so the allow-list is
> genuinely enforced and this was not a silent no-op.
>
> **`gender` is still null** — neither branch computes it. And this fixes the *forward* path only;
> the 336 already-written leads stay empty until [D5](#d5).
>
> One divergence deliberately left alone: `website` resolves AI-first on branch S and
> email-domain-first on branch L. Changing it would alter existing data, which is outside this fix.

### D2 · Four fields the RPC allow-list rejects {#d2}

`message_title`, `message_number`, `response_time_hours`, `response_time_label` are columns on
`leads` and are read by the portal, but the RPC's `v_allowed` array has never contained them — it
raises `promote_contact_to_lead rejects unknown lead fields` if passed. `[S] Compute derived values`
computes `subject`, `sequence_step_order`, `response_time_hours` and `response_time_bucket` on every
run and discards all four.

**Fix.** One migration extending `v_allowed` and the `insert` column list, then pass them from
`[S] promote_contact_to_lead`. Follow [rls-migration](../../../.claude/skills/rls-migration) — dry-run
in a rolled-back transaction first.

> **Deployed 2026-08-15** —
> [`20260815_promote_contact_lead_reply_context.sql`](../../../supabase/migrations/20260815_promote_contact_lead_reply_context.sql),
> then the caller. Migration first, caller second: a new allowed key is backward-compatible, the
> reverse loses leads.
>
> The migration body was generated from `pg_get_functiondef` of the **live** function (byte-identical
> to `20260805` apart from a leading newline), so nothing else could drift into it.
>
> Proven in a rolled-back transaction against production, on a real unpromoted `Interested` contact:
> `created=true`, and the row came back
> `{"message_title":"Re: cutting your cost per meeting","message_number":3,"response_time_hours":"4.75","response_time_label":"less than 12 hours"}`
> — `smallint` and `numeric` casts both correct. Empty strings land as `null` rather than a cast
> error, and `reply_text` is still rejected, so the allow-list remains a real gate.
>
> First attempt failed usefully: the seed reply was classified `OOO` and the RPC refused it —
> *"only a positive reply creates a CRM lead"* (ADR-0015). Worth knowing before anyone tries to
> backfill.

### D3 · `reply_text` — decide where the body lives {#d3}

Branch S writes the reply body to `public.replies` via `upsert_reply`, which is the correct
normalization under ADR-0015. But `LeadRecord.reply_text` is projected by the gateway and rendered
by the portal, and it is null for the RPC-written rows. Either the portal reads from `replies`, or
the RPC denormalizes a copy. This is a design decision, not a bug fix.

**Measured 2026-08-15 — the defect is much smaller than this entry claimed, and it is portal-side
only.** Of the 478 leads carrying an `origin_reply_id`:

| | rows |
|---|---|
| the origin reply row exists | 478 / 478 |
| that reply carries a `message_text` body | 476 |
| `replies.lead_id` points back at the lead | 478 — **no orphans** |
| `leads.reply_text` populated | 5 |
| recoverable from `replies` with no new write | 471 |

So nothing is lost and there is nothing for n8n to backfill: the body is in Supabase, linked in both
directions, and the gateway **already** left-joins `replies` for `reply_count` / `last_reply_at` in
all three lead queries ([orm-gateway/index.ts:2387](../../../supabase/functions/orm-gateway/index.ts#L2387)
and the two siblings). The portal already prefers `replies` and falls back to `reply_text` in every
consumer — [client-view-models.ts:195](../../../src/app/lib/client-view-models.ts#L195),
[leads-page.tsx:493](../../../src/app/pages/leads-page.tsx#L493),
[client-leads-page.tsx:48](../../../src/app/pages/client-leads-page.tsx#L48) — and `LeadConversation`
renders the real `replies` array, so the **drawer is already correct**.

The single hole is the leads-table column `Mail from lead`
([lead-report-columns.tsx:167](../../../src/app/lib/lead-report-columns.tsx#L167)), which reads
`row.reply_text` and nothing else. It is on-screen for every role and it is what the export writes,
so those 471 leads show an empty body in the table while the client's sheet row has one.

**Resolved 2026-08-15 — the RPC denormalizes; the portal was not touched.**
[`20260815b_promote_contact_lead_reply_text.sql`](../../../supabase/migrations/20260815b_promote_contact_lead_reply_text.sql).

Two designs were on the table. I first proposed projecting the joined body through the gateway
(`last_reply_text` → `lastReplyText` on `LeadRecord` → column fallback). The user asked whether the
database could carry it instead, so that the backfill needed no portal change — and that is the
better answer, for a reason the first proposal missed: **the function already SELECTs the reply row**
two statements before the insert, for the contact check, the classification gate and `received_at`.
The body is in hand. So it costs one more column on an existing single-row read, and:

- no frontend change — three gateway queries, a type and a column stay as they are;
- no caller change — `v_allowed` untouched, n8n sends nothing new (and *must not*: the key would raise);
- the copy cannot disagree with `replies`, because it is written from it in the same transaction that
  creates the lead.

The staleness objection against denormalizing dissolves on inspection: the sheet freezes the body
too — branch L writes it on the append and afterwards only ever rewrites `QUALIFICATION`. So
`reply_text` means *the reply that created the lead*, the two stores agree, and the always-current
view stays in the drawer, which reads `replies`. Neither idempotency path rewrites it.

Verified in a rolled-back transaction on production, then re-checked after applying:

```
rpc_leads_with_body     476   (was 5)
rpc_leads_still_empty     2   — the two replies that carry no message_text at all
disagreeing               0   — no lead's reply_text differs from its origin reply
control_untouched      true   — a Sheets-imported body was not overwritten
```

The backfill copies from `origin_reply_id` — the same reply the forward path uses — and only where
`reply_text IS NULL`, so no imported value is lost and a re-run is a no-op. All 471 candidates had an
`origin_reply_id`; **zero** would have needed a "latest linked reply" guess, which is what made the
update unambiguous enough to run.

This also shrinks [D5](#d5): reply bodies are no longer part of the backfill, only enrichment fields.

### D4 · 34 of 336 leads have a null `campaign_id` — WON'T FIX (owner, 2026-08-18) {#d4}

`[S] Resolve campaign` does not always resolve. Campaign attribution is the spine every campaign
metric hangs off.

**Closed as won't-fix on 2026-08-18 (owner).** Recorded rather than deleted, because the consequence
outlives the decision: those 34 leads are invisible to every per-campaign metric and will stay that
way. If a campaign total ever looks short, this is the first thing to check. The forward path is
unchanged — new leads can still land without a campaign, so the count grows.

### D6 · Branch S paid for a Snov.io lookup and then used branch L's {#d6}

Found 2026-08-15 while wiring D2, not by the original audit.

`[S] Pick Snovio output body` read
`$("[11] Snov.io: POST /v1/get-profile-by-email (Global)")` — **branch L's node**. Branch S has its
own `[S] Snov.io: POST /v1/get-profile-by-email (Global)`, correctly wired
(`[S] Snov.io Local empty?` → `[S] Get Snov.io Access Token (Global)` → the call → this node), whose
output was therefore fetched, paid for, and discarded.

Three consequences, in order of how long they would have taken to notice:

1. Every enrichment field branch S writes — including the four added by [D1](#d1) — came from branch
   L's global lookup, not its own.
2. It contradicts the "the two branches share nothing" claim in
   [migration-backlog §2](migration-backlog.md) and in the workflow's own README. The coupling was
   never fully removed; it just moved into a Code node where no reviewer looked.
3. `try/catch` around the read means that once branch L is disconnected — the Sheets cutover, or the
   [E5](#e5) reorder — branch S would silently fall back to the **local** list and quietly lose
   global enrichment. No error, no failed execution, just thinner leads.

**Fixed 2026-08-15**: one node name in the Code node, deployed alongside D2, with a comment
recording what it used to say and why the silence mattered.

### D5 · Backlog of 336 under-filled leads — WON'T FIX (owner, 2026-08-18) {#d5}

**Closed as won't-fix on 2026-08-18 (owner).** The forward path was fixed on 2026-08-15
([D1](#d1), [D2](#d2)), so the gap stops growing; the historical rows simply keep their blanks.

Scope had already narrowed on 2026-08-15: reply **bodies** are no longer part of this — [D3](#d3)
backfilled 471 of them from `replies`. What remained was the enrichment fields, which are not in
Supabase at all — and now will not be. Clients looking at leads created between 2026-07-21 and
2026-08-15 will see empty industry / headcount / linkedin / country / message-context columns, while
the same lead's spreadsheet row is complete. That is now expected, not a defect to re-report.

The values are recoverable from Bison and Snov.io after the fact. Unlike the OOO backfill question
([migration-backlog §1 item 7](migration-backlog.md)), there is no provenance problem here — the
leads are real and RPC-written, the fields simply were not populated. Still a separate decision from
fixing the forward path; fix [D1](#d1)/[D2](#d2) first so the backlog stops growing.

---

## E · Systemic hardening

### E1 · 15 of 33 active workflows report failures nowhere {#e1}

Not bound to `[ERR] Automation failure recorder` (`Pmz0JjRRuJNdNpSE`):

`[HUB] Bison Replies Dispatcher` · `[HUB] CRMs Add/Update Lead Dispatcher` · `[child-4]` · `[child-5]` ·
`[child-6]` · CRM children Salesforce / HubSpot / Pipedrive / ~~Zoho~~ / LiveSpace ·
`Bison Replies Classification` · `[CRED] CS PDCA edit` · `Winnr Sync - Error Handler` ·
`[ERR] Automation failure recorder` itself · `Winnr Daily Sync` (bound to the Winnr handler instead).

This set contains the two worst defects in section B ([B2](#b2), [B3](#b3)) — which is precisely why
they ran for weeks unnoticed.

**Fix.** `setNodeSettings` / `setWorkflowSettings` binding `errorWorkflow: Pmz0JjRRuJNdNpSE` on each.

#### 2026-08-15 — partially fixed, and the register was wrong about who was unbound

Measured against the live instance rather than the audit's snapshot: **33 active, 19 bound, 14
unbound.** Seven of the "unbound" in the list above were in fact bound on the instance — the
*repository* was the one that did not know, which is its own defect and is the first thing that had
to be fixed:

> **`check-drift` never compared workflow-level `settings` at all.** `describeDrift` walked name,
> nodes, node failure posture and connections, and stopped. So `errorWorkflow`, `timezone`,
> `executionOrder`, `callerPolicy` and `availableInMCP` could be changed in the UI — or lost by a
> PUT — and CI reported `0 drifted`. Seven of 25 managed artifacts were already stale this way. This
> is the same blind spot as the node-level one fixed earlier the same day, one level up: binding the
> recorder is worthless if the repository cannot see it being unbound again.
>
> Fixed in [`check-drift.mjs`](../../../scripts/n8n/check-drift.mjs) with a closed `WATCHED_SETTINGS`
> list (`""` and "absent" normalized to the same thing, since the UI treats them alike). It
> immediately reported the 7, all in the "remote is right" direction; re-exported and committed.

Then the two **managed** workflows that were genuinely unbound were bound and verified:

| workflow | id | note |
|---|---|---|
| `bison-blacklist-add` | `bEB3aOHEq2lEpubp` | the 63 %-failure workflow from [B2](#b2) — nobody was hearing it |
| `sheets-credential-sync-on-edit` | `ATPnIVnO0sAB9GQx` | keeps `client_sequencers` keys in step with CS PDCA |

Two tooling gaps surfaced while doing it, both fixed in
[`deploy.mjs`](../../../scripts/n8n/deploy.mjs):

- `--settings` was only a *modifier*; the script demanded a node operation alongside it, so an
  observability-only change could not be shipped without inventing a fake node edit. It is now an
  operation in its own right.
- nothing verified a settings write. `errorWorkflow` is invisible on the canvas, so a PUT that
  dropped it would have looked like success. The post-write block now reads each written settings key
  back, exactly as it already did for nodes.

Also disclosed, because a PUT replaces `settings` wholesale: the public API rejects `binaryMode`,
`callerPolicy` and `timeSavedMode`. The first two default back to the values this instance already
uses, so they are a no-op; `timeSavedMode: "fixed"` on `sheets-credential-sync-on-edit` was **reset**
by this write. It is a UI "time saved" annotation with no runtime effect, and restoring it is a UI
action.

**Update 2026-08-17: 11 left.** `Bison Replies Classification` (`XdTMd1KJX0cRmF9u`) is now adopted as
`outreach/bison-replies-classification` and bound — it was the one blocked by [E6](#e6), and the
blocker turned out to be softer than recorded: attaching an *existing* credential needs no credential
API, only `--credentials-from` pointed at a donor node of the same type in another managed workflow.

**Update 2026-08-18: still 11, and now we know what they have in common.** Re-measured against the
instance, cross-referenced with `registry.yaml`: **every single unbound workflow is unmanaged**, and
every managed one is bound. E1 is therefore no longer an observability task with a settings write at
the end of it — it is entirely blocked on adoption, because `n8n:deploy --settings` cannot target a
workflow that has no artifact.

Of the 11, only **three** are actually worth adopting:

| workflow | id | why |
|---|---|---|
| `[HUB] Bison Replies Dispatcher` | `xPzdtWQiY3lGtqI1` | **851 runs/week** — the entry point of the whole email funnel, and nothing hears it fail |
| `[child-5]` unblacklist | `FZSFz5bcgigUneQZ` | in scope for [Wave 5.2](#f) |
| `[child-6]` MQL removal | `wJZbg0cRsdF58ylE` | in scope for [Wave 5.3](#f) |

The other eight are correctly excluded, not overlooked: six are the CRM dispatcher family
(**parked by decision**, see [B3](#b3)), `Winnr Sync - Error Handler` *is* an error handler, and
`Winnr Daily Sync` is bound already — to the Winnr handler rather than to ours, which is a
deliberate per-owner routing, not a gap.

**Still unbound: 11, none of them managed.** Every remaining one is an orphan, and `n8n:deploy`
cannot target a workflow that has no committed artifact — each needs importing first
([workflow-lifecycle.md](workflow-lifecycle.md) Option A), which is a manifest and a README apiece,
not a flag:

- **In estate, should be adopted and bound** — `[HUB] Bison Replies Dispatcher` (`xPzdtWQiY3lGtqI1`,
  0/2055 failures but it is the root of the entire Bison reply fan-out), `[child-5]`
  (`FZSFz5bcgigUneQZ`), `[child-6]` (`wJZbg0cRsdF58ylE`), `Bison Replies Classification 401 fallback`
  (`XdTMd1KJX0cRmF9u`). The last three are already Wave 5 targets, so their manifests are owed anyway.
- **~~Parked with Zoho by decision~~** — the CRMs dispatcher and four of the five CRM children.
  **Zoho was bound 2026-08-26** when [B3](#b3) was reopened and fixed: 20 consecutive failures
  reporting nowhere is most of why a three-line bug survived eleven days. The other four children
  and the dispatcher remain unbound, and are now the strongest candidates in this list — the
  graphs were copied from each other, so B3's bugs are plausibly theirs too.
- **Deliberately unbound** — `[ERR] Automation failure recorder` itself (binding it to itself is a
  loop; if the recorder breaks, nothing catches it, which is worth knowing but is not fixed by a
  self-reference) and `Winnr Sync - Error Handler`, which is another estate's error handler.

### E2 · Nine unauthenticated webhooks on active workflows {#e2}

`[HUB] Bison Replies Dispatcher` (the entry point for all reply processing) · `Bison Replies
Classification` · `Bison daily stats population` · `[CRED] CS PDCA edit` · `AimFox Classification` ·
`aimfox-premql-to-pdca` · `[SETUP] Aimfox workspace` · `[SETUP] Bison workspace` ·
`[SHADOW] Aimfox AutoConnect import`.

Tracked in [security.md §3](security.md) and §10/§11; listed here for completeness of the fix set.
Owner action — instance configuration, not a workflow edit.

### E3 · No HTTP node anywhere sets `retryOnFail` {#e3}

26/26 in `[child-1]`, 12/12 in `Get Metrics from Aimfox` and LiveSpace, 11/11 in
`AimFox Leads Processing`, and so on across all 33 active workflows. Every transient `503` /
`ECONNRESET` therefore becomes a lost run rather than a retried one.

**Fix.** Enable `retryOnFail` with a small backoff on idempotent GETs first.

### E3b · Google Sheets transients are the largest remaining failure class {#e3b}

Measured 2026-08-18 over the seven days to that date — every failed execution on the instance,
classified by the node type and HTTP code that killed it:

| Failures | Node type | Code | What it is |
|---|---|---|---|
| 104 | httpRequest | 422 | `[113]`/`[294]` "already blacklisted" — **fixed**, see [B2](#b2) |
| 18 | httpRequest | 402 | Lusha credit limit — **fixed**, see [B4](#b4) |
| **11** | **googleSheets** | **ECONNRESET** | transient |
| **4** | **googleSheets** | **503** | transient |
| 4 | httpRequest | 500 | Aimfox, [B6](#b6) |
| 3 | httpRequest | 401 | credential |

With the two fixed classes removed, **Google Sheets transients are the biggest thing still breaking
runs — roughly 15 a week, every one of them recoverable.** n8n's own error text says so:
*"try again later or consider setting this node to retry automatically (in the node settings)"*.

Of **42 active Google Sheets nodes** across the estate, exactly **one** carried `retryOnFail`:
`[325] Find workspace in CS PDCA`. Nobody chose that; it is the residue of somebody once hitting the
problem on that one node.

**Fix, applied 2026-08-18** — `retryOnFail: true, maxTries: 3, waitBetweenTries: 5000` on **25**
Sheets nodes across seven live workflows: `bison-blacklist-add` (6), `bison-lead-enrichment` (5),
`aimfox-leads-processing` (3), `aimfox-premql-to-pdca` (3), `aimfox-daily-metrics` (5),
`ooo-detect-and-log` (1 — explicit tries on the node that already retried), `ooo-remove-on-tag-removed` (2).

**What was deliberately left alone, and why.** `business/retry-without-idempotency` is an *error*
only for write nodes, because retrying a lookup is free. That is the whole selection rule here:

- **reads** — retried; a repeated lookup returns the same rows.
- **updates by matched row** — retried; the second write sets the same cell to the same value.
- **appends** — NOT retried. `[327] Add OOO Leads row` and `[63] Insert new Daily Stats row` append.
  An `ECONNRESET` on an append is precisely the case where the row may already exist and the
  response was lost, so a retry duplicates it. `bison-lead-enrichment`'s manifest already records
  that branch L is not idempotent, and this is why.
- **`[329] Delete row from OOO Leads`** — NOT retried. Sheets deletes are by row *number*, and row
  numbers shift under the delete itself.
- **orphaned and deprecated limbs** — `ooo-enrol-followups` branch L (disconnected from its trigger
  in Wave 1), `nrr-daily-stats` (deprecated, [C1](#c1)), the classifier's old Sheets config node
  (superseded). No point hardening a path that no longer runs.
- **`sheets-*` backfill utilities** — hand-run one-shots; a human is watching.

Retry does not make Sheets reliable, it makes a transient cost 15 seconds instead of a run. The
residual case — three failures in a row — still aborts, and for `bison-blacklist-add` that still
costs the domain limb ([B2](#b2)). The structural answer is [Wave 5.1](#f): the workspace lookup
moves to `client_sequencers` and stops being a Sheets call at all.

### E4 · 28 of 70 nodes in `[child-1]` swallow their own errors {#e4}

`onError: continueRegularOutput` is set on 28 nodes. The failure recorder fires on *workflow*
failure, so these fail invisibly — the workflow reports success while a step did nothing. Same
pattern at 11/37 in Aimfox metrics, 10/13 in `Daily Stats Process`, 8/17 in `[child-3]`.

**Fix.** Not "remove them" — they are load-bearing for dual-write. Route the error output somewhere
countable instead.

### E5 · Sheets-first branch ordering makes Sheets failures fatal {#e5}

The general form of [B1](#b1). In six workflows the Sheets branch has the lower Y-position and so
runs first; if it throws without `onError`, the Supabase branch never executes. This contradicts the
ADR-0017 ordering guarantee wherever it occurs.

**Fix.** Either give every branch-L terminal node `onError: continueRegularOutput`, or move branch S
above branch L so Supabase is written first.

#### Fixed 2026-08-18 — both halves, on all four remaining workflows

Scope re-measured against the artifacts rather than taken from the plan: `nrr-daily-stats` is
deprecated and unreachable ([C1](#c1)) and `ooo-enrol-followups` was resolved by the Wave 1 cutover,
so four were left. Each had one fan-out where the Sheets limb held the lower Y and therefore ran
first:

| workflow | fan-out | was | now |
|---|---|---|---|
| `ooo-detect-and-log` | `When Called by HUB` | sheets 208 / pg 480 | **pg 208** / sheets 480 |
| `ooo-remove-on-tag-removed` | `When Called by HUB` | sheets 304 / pg 560 | **pg 304** / sheets 560 |
| `aimfox-leads-processing` | `Get Workspace Api Key` | sheets −16 / pg 500 | **pg −328** / sheets −16 |
| `aimfox-daily-metrics` | `Schedule Trigger` | sheets 64 / pg 900 | **pg −592** / sheets 64 |

Whole limbs were moved, not just the entry nodes. Only the entry decides execution order, but Y is
the signal every reader uses to tell the branches apart, and leaving the limbs crossed would have
made the canvas lie about what runs first.

Branch-L terminals also got `onError: continueRegularOutput`, as the plan specified — `[329] Delete
row from OOO Leads`, `Update row in sheet` ×3, `[96] Update Qualification col`, `HTTP Request`.
`[327] Add OOO Leads row` already had it from [B1](#b1). Note what this second half is now *for*:
with Supabase first, a Sheets failure can no longer cost a Supabase write, so the guard no longer
protects data — it stops the run being *marked failed* for a store that is being retired.

**This needed a new deploy capability.** Node `position` is not a parameter, and `--nodes` copies only
`parameters`/`typeVersion` — everything else, position included, is taken verbatim from live. So a
reorder was not expressible through the sanctioned write path at all; it could only be done by hand in
the UI, which is how graphs stop matching their artifacts. `pnpm n8n:deploy --positions "Node A,…"`
now moves named nodes and nothing else, gated behind `--allow-active` because moving a node changes
which branch runs first — it looks cosmetic and is not — and verified after the write to have moved
without touching parameters.

Verified: all four report `Supabase first` when the fan-out targets are re-read from the live graphs,
and `check-drift` is clean on each.

### E6 · A live OpenAI key is stored in plaintext in workflow JSON — key removed 2026-08-17, rotation still owed {#e6}

Found 2026-08-15 while diagnosing [C1](#c1). `Bison Replies Classification`
(`XdTMd1KJX0cRmF9u`, ACTIVE, 2242 executions in 16 days) authenticates its two OpenAI calls with an
`Authorization: Bearer sk-proj-…` **header parameter typed directly into the node**, not an n8n
credential. Running the repository's own scanner against the live graph:

```
ERROR  secret/openai-key      ×2
ERROR  pin-data
ERROR  credential-reference
WARNING unauthenticated-webhook
```

This breaks the second hard rule in [CLAUDE.md §5a](../../../CLAUDE.md) — *never write a credential
into workflow JSON* — on a production workflow, and it has three practical consequences:

1. **The key is readable by anyone with UI access**, and it appears in full in the workflow export,
   in n8n's version history, and in any support bundle.
2. **It cannot be rotated centrally.** A credential is changed in one place; this must be found and
   edited in each node.
3. **It blocks adoption.** `pnpm n8n:export` refuses to write an artifact that trips the scanner, by
   design — so this workflow cannot be brought under repository control (and therefore cannot be
   bound to the failure recorder in [E1](#e1)) until the key moves into a credential.

`pinData` is also committed on the live workflow, which is the same class of problem for personal
data rather than secrets.

**Fixed in the graph 2026-08-17.** No new credential was needed: `--credentials-from
"OpenAI - Classify Email=aimfox-classification:OpenAI - Classify Email"` copied the existing
`OpenAi account` credential off the Aimfox classifier, which is the same node type. The literal key is
gone, the live scan no longer reports `secret/openai-key`, and the workflow is now adopted as
`outreach/bison-replies-classification` and bound to the failure recorder.

**Still owed, and it is the half that matters: rotate the key in OpenAI.** It remains in n8n's version
history and stays billable until rotated. Owner action. `pinData` is also still on the instance.

Do not paste this workflow's node parameters or execution data into a doc, an issue or a chat.

---

## F · Still Sheets-primary

Classified by execution order (n8n runs fan-out branches top-to-bottom by Y-position).

**Sheets-only — no Postgres node at all (5):**

| Workflow | Sheets usage |
|---|---|
| `[child-4]` Blacklist add | 4 read / 2 write — CS PDCA + `Leads` |
| `[child-6]` MQL delete + unblacklist | 2 read / 1 write |
| `[child-5]` Not Interested unblacklist | 1 read |
| `[HUB] CRMs Add/Update Lead Dispatcher` | 1 read — resolves the client from CS PDCA |
| `Bison Replies Classification` | 1 read — "Sheets Primary" is in its name |

### F1 · Both OOO workflows had their Sheets branch unplugged, and the repository did not know {#f1}

Found 2026-08-26 by `pnpm n8n:check-drift`, which reported `connections changed` on
`ooo-detect-and-log` (`O4DqMEu1Z9LcxikE`) and `ooo-remove-on-tag-removed` (`ZZ0ughB302WdDJOf`). The
diff is one edge each, and it is the same edge:

```
When Called by HUB → [325] Find workspace in CS PDCA     (ooo-detect-and-log)
When Called by HUB → [86]  Find workspace in CS PDCA     (ooo-remove-on-tag-removed)
```

Both exist in the committed artifact and in neither live graph. Branch L — the whole Google Sheets
limb — is therefore unreachable in both. **Exported and committed 2026-08-26**, so the repository
now records what runs; drift 0.

**For `ooo-detect-and-log` this is consistent.** Its six branch-L nodes are already `disabled: true`
by the owner's 2026-08-19 decision, declared in the manifest, and phase C is recorded with go-live
evidence. Pulling the trigger edge on top of that changes nothing about what executes. The one thing
it does change is the rollback: re-enabling the six nodes is no longer enough, the edge has to come
back too. That is now written into `transition.ordering`.

**For `ooo-remove-on-tag-removed` it is not consistent, and this is the part that needs a decision.**
Its four branch-L nodes are **not** disabled — they are simply orphaned — and its manifest still
declares `phase: A` with `authoritativeSource: sheets`. Nothing writes or deletes the `OOO Leads`
sheet. The manifest describes a dual-write that does not exist.

Two readings, and only the owner can choose:

1. **Deliberate** — the coherent follow-through of 2026-08-19. If `ooo-detect-and-log` no longer
   appends rows to `OOO Leads`, deleting from it is pointless. Then the phase moves to C and
   [ADR-0017 §5](../../adr/0017-sheets-to-supabase-dual-write-transition.md) wants the go-live
   evidence recorded, as its sibling did.
2. **Accidental** — an edge dragged loose in the UI. Then it belongs back, and the fact that nobody
   noticed for at least three days is the more interesting finding.

Until then the contradiction is registered in the manifest's `transition.ordering` and the README,
not silently corrected. **It is deliberately NOT a `knownViolations` entry** — that list suppresses
validator findings and `validate.mjs` rejects an entry no rule reports.

**The date is unrecoverable from here**, and that is its own small finding. Not one of the 40 most
recent executions of either workflow (2026-08-23 → 2026-08-26) reached the CS PDCA node; the
instance's execution retention is shorter than the change, and the n8n public REST API exposes no
workflow version history. A UI edit that never becomes an artifact leaves no trace anyone can date
later — the same class of problem as [A1](#a1) and as the stale `bison-lead-enrichment` artifact in
[B11](#b11). Three instances in one day is a pattern, not an accident: nothing on this instance makes
a UI edit end in an export.

**Sheets-first — Postgres present, branch L runs first (6):**

| Workflow | Sheets Y | Postgres Y | Branch-S RPCs |
|---|---|---|---|
| `[child-2]` NRR daily stats | 208 | 640 | `upsert_sequencer_contact`, `upsert_reply` |
| ~~`[child-3]` OOO detect~~ | — | 480 | + `record_ooo_followup` — **branch L off since 2026-08-19**, and unplugged from the trigger too ([F1](#f1)) |
| ~~`[child-7]` OOO remove~~ | — | 560 | `cancel_active_ooo_followup` — **branch L unplugged**, date unknown ([F1](#f1)) |
| `Add OOO Leads` | 256 | below | — |
| `AimFox Leads Processing` | above | below | 5 nodes |
| `Get Metrics from Aimfox` | above | below | 2 nodes |

**Supabase-first (3):** `[child-1]` · `[CRED] CS PDCA → client_sequencers` · `aimfox-premql-to-pdca`.

**Supabase-only (19):** the Bison and Aimfox ingestion family, the five CRM children, the HUB
dispatcher, SETUP/SHADOW, Winnr.

---

## Rules that apply to every fix here

1. Production is the only instance — no workflow change without explicit approval
   ([environments.md](environments.md), [CLAUDE.md §5a](../../../CLAUDE.md)).
2. Any remote change ends in `pnpm n8n:export` + a committed artifact, or it is drift.
3. Database invariants stay in RPCs, never in n8n.
4. Update [traceability.md](../traceability.md) and check portal impact.
