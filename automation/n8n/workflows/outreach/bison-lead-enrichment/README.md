# bison-lead-enrichment

**Logical ID:** `bison-lead-enrichment` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `lBOyL8ZPA3SZSvDW` — `[child-1] TAG_ATTACHED · Interested/PreMQL · Full enrichment`
**Business process:** [OOO follow-ups (and the lead contract)](../../../../../docs/reference/processes/outreach/ooo-followups.md)
**Phase:** **A · dual-write**, branch S live since 2026-07-22, independent since 2026-07-22
([ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md))

## Business purpose

A Bison contact replies positively and is tagged `Interested` or `preMQL`. This is where that becomes
a lead: enrich from Snov.io, Lusha and an LLM, write the row, dispatch to the client's CRM, notify,
and forward the reply.

Sixty-six nodes and five external vendors — the widest blast radius in the email channel. Every vendor
except Google Sheets is called **twice**, once per branch, on two independent credentials — see
[ADR-0017 §1a, no fallback in either direction](#the-two-branches-share-nothing-2026-07-22) below.

## Flow

```
When Called by HUB ─ Merge ─ [S0] resolve client_sequencers ─┬─ CS PDCA ─ Bison lead ─ already in the Leads sheet?   [L]
                                                               │    ├─ yes → update the Qualification column
                                                               │    └─ no  → replies → last reply → campaign + …
                                                               │             └─ Snov.io → OpenAI → phone (AI, else Lusha)
                                                               │                └─ Get Table ID → Create Record (sheet)
                                                               │                   ├─ Edit Fields1 → CRM dispatcher
                                                               │                   └─ Edit Fields1 → forward reply, blacklist
                                                               │
                                                               └─ [S] Bison lead ─ [S] replies ─ [S] last reply ─┬─ campaign + …  [S]
                                                                    (own credential,                             │  └─ Snov.io → OpenAI → phone
                                                                     no sheet fallback)                          │     └─ [S] Edit Fields
                                                                                                                  │        → [S] resolve client sequencer
                                                                                                                  │        → upsert_sequencer_contact → upsert_reply
                                                                                                                  │        → resolve campaign → promote_contact_to_lead
```

## Branch S — the lead, through the RPC contract

Five Postgres nodes:

```
[S] Resolve client sequencer      client_sequencers by external_workspace_id, emailbison
[S] upsert_sequencer_contact      scoped identity for the Bison lead id
[S] upsert_reply                  the positive reply, classification 'Interested'
[S] Resolve campaign              campaigns.external_id → id, scoped to the same client
[S] promote_contact_to_lead       the lead, with the enrichment payload
```

It hangs off `[S] Edit Fields` — branch S's own field assembly, built from branch S's own enrichment
chain below.

> **Two claims that used to stand here were wrong, and 2026-08-26 proved it.** They said the five
> Postgres nodes all carry `onError: continueRegularOutput` so a Supabase failure cannot stop the
> sheet or the CRM, and that *"Sheets and Supabase run in parallel; neither reads from the other."*
> Measured against the live graph:
>
> - `[S] upsert_sequencer_contact`, `[S] upsert_reply` and `[S] promote_contact_to_lead` carry **no**
>   `onError` at all. Only `[S] Resolve client sequencer` and `[S] Resolve campaign` do.
> - The branches are **sequential, not parallel**. `[S] promote_contact_to_lead → Filter` is the
>   spine, and everything branch L does hangs below that `Filter`: `[4] Check if lead already in
>   Leads sheet`, `[189-192] Forward email to recipients`, and
>   `Call '[HUB] CRMs Add/Update Lead Dispatcher'`.
> - They are not independent either: `Edit Fields1` (branch L) reads
>   `$('[S] Set phone from Lusha')` and `$('[S] Parse AI output + set phone')` — branch S nodes.
>
> So a failed Supabase promotion does not cost the Supabase lead. **It costs the lead everywhere:**
> no `leads` row, no sheet row, no forwarded email, no CRM sync.

### Incident 2026-08-26 — one phone number, four lost destinations

Execution 85420. `[S] promote_contact_to_lead` returned
`value too long for type character varying(50)`. The value was the phone:

```
+380 44 507 29 94*303 / +380 67 311 44 55 / +380 50 394 31 13     (61 chars)
```

`[S] OpenAI: gpt-4o analyze email` is asked for `phone_number`, singular, and this signature listed
three; it returned all of them in one string. `leads.phone_number` is `varchar(50)`, so the RPC
refused the row — and because the node is fatal and the whole L chain sits below it, this lead
reached **none** of its four destinations. `sequencer_contacts` and `replies` had already been
written, so the state left behind is a contact and a reply with no lead.

**Fixed by normalising at the source, not at the boundary.** `[S] Parse AI output + set phone` now
keeps the first number: `String(ai.phone_number || "").split(/[\/,;|\n]/)[0].trim()`. That node is
the single shared source — `[S] Edit Fields` (branch S) and `Edit Fields1` (branch L) both read it —
so the sheet and Supabase keep the same value rather than diverging. The dead `[286]`/`[287]` copies
are referenced by nobody and were left alone.

Two deliberate non-choices, both the owner's:

- **No truncation.** A single number longer than 50 characters should fail at the RPC, loudly, rather
  than be silently cut into a wrong number that somebody then dials.
- **The node stays fatal.** `continueRegularOutput` would let the chain finish, but a Supabase write
  failure would then be invisible — the execution would be recorded as a success and no Slack alert
  would fire. Losing the alert was judged worse than losing the run. The cost is the one this
  incident shows, and it is accepted knowingly: **if this node fails again, the lead is lost in all
  four places, and the fix is to retry the execution.**

**Recovery is a retry, not a repair.** Execution 85420's lead (`info@oriongr.com`, sequencer contact
`9e60cafb…`, reply `45ddd5c0…`) has no `leads` row. Retrying the execution from the start replays the
RPCs — `upsert_sequencer_contact` and `upsert_reply` are idempotent by key, and
`promote_contact_to_lead` is at most one lead per contact (ADR-0015) — and then runs the branch L
chain that never got to run.

Verified before publishing: the whole RPC chain was executed against production inside a transaction
that was rolled back, and returned `created: true` with a real `lead_id`.

### Incident 2026-07-23 — branch S wrote nothing for four days, silently

Branch S went live on 2026-07-22 and worked. The next day
[`20260723_promote_contact_qualification_sync`](../../../../../supabase/migrations/20260723_promote_contact_qualification_sync.sql)
replaced the INSERT's literal `'preMQL'` with `coalesce(v_qualification, 'preMQL')`. The literal was
an untyped constant Postgres coerced into `public.lead_qualification`; the coalesce resolves to
`text`, and under `set search_path = ''` there is no implicit assignment cast. **Every insert
raised.** The two idempotency branches assign the *literal* `'MQL'` and kept working, so
re-promotions still succeeded — which is why the failure looked partial on the first day and total
afterwards.

Nothing surfaced it. All five branch-S Postgres nodes run `onError: continueRegularOutput`, which
[ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) requires so a
Supabase failure cannot stop the sheet or the CRM. Non-fatal became invisible: n8n reported success,
the sheet filled normally, and **50 `Interested` replies across 20 clients were left with
`lead_id is null`** between 2026-07-23 and 2026-07-27. It was found by comparing the portal against
CS PDCA, not by any alarm.

Repaired by [`20260727_promote_contact_lead_cast_and_date`](../../../../../supabase/migrations/20260727_promote_contact_lead_cast_and_date.sql)
(explicit cast, plus `created_at` from `replies.received_at` so a backfill cannot pile a week of
leads onto one day) and backfilled by
[`20260727b`](../../../../../supabase/migrations/20260727b_backfill_orphaned_interested_replies.sql).

**The lesson is not the cast.** A migration changed an RPC that only n8n calls, and no caller was
exercised against it — the local-stack gate in [CLAUDE.md §2](../../../../../CLAUDE.md) exists for
exactly this.

The standing assertion now lives in the database as `positive_reply_without_lead`, one of
[`public.data_invariants()`](../../../../../supabase/migrations/20260727c_data_invariants.sql), and
is read by `pnpm db:invariants`. It asserts the **outcome** rather than the absence of an exception,
which is the only thing that works here: an Error Trigger fires when an execution *fails*, and
`continueRegularOutput` is exactly the setting that stops it failing. Binding this workflow to
[automation-failure-recorder](../../ops/automation-failure-recorder/README.md) — it already is —
could never have caught this.

## The Sheets dependency, and how it was cut (2026-07-22)

`workspace_id` does come from the webhook, so `[S] Resolve client sequencer` was always independent.
But every Bison call in the workflow — `[40]`, `[43]`, `[49]`, `[52]`, `[69]`, `[284]`, `[306]` and
the reply forward — took its bearer token from **`[2] Find workspace in CS PDCA`, column `col_6`**.
Disconnect Google Sheets and the run dies at `[40]`, long before branch S is reached. Branch S was
parallel in the graph and serial in its dependencies.

Fixed by **`[S0] Resolve Bison credentials`**, inserted between `Merge` and the CS PDCA lookup:

```sql
select cs.api_key, cs.client_id, cs.id
from public.client_sequencers cs
join public.sequencers s on s.id = cs.sequencer_id and s.key = 'emailbison'
where cs.external_workspace_id = $1 and cs.enabled and coalesce(cs.api_key,'') <> '';
```

This is not a new contract — it is [ADR-0012](../../../../../docs/adr/0012-multi-sequencer-model.md),
which has said since the sequencer model landed that per-client vendor credentials live in
`client_sequencers` and never on a spreadsheet. It also closes
[security finding 1](../../../../../docs/reference/n8n/security.md) for this workflow, and removes the
literal token that gave `[69]` its name.

**The first version of this fix (2026-07-22, same day) pointed all 8 shared Bison Authorization headers
at `[S0]` first, sheet `col_6` only as fallback — including branch L's own calls.** That closed branch
S's real dependency but opened one in the other direction: branch L's correctness now depended on
`client_sequencers` holding the right key, not just Sheets. Two branches that must each be
independently disconnectable cannot share one Bison call with one resolution order either way.

### The two branches share nothing (2026-07-22)

Branch L's 8 Bison/forward-email calls (`[40]`, `[43]`, `[49]`, `[52]`, `[69]`, `[284]`, `[306]`,
`[189-192]`) went back to reading only `[2] Find workspace in CS PDCA` → `col_6` — no `[S0]` reference
anywhere in branch L.

Branch S got **its own** copy of the data-fetch chain, reading only `[S0]`'s `bison_api_key` — no sheet
fallback:

```
[S] Bison: GET /leads/{taggable_id} → [S] Bison: GET /leads/{taggable_id}/replies
   → [S] Set last_reply → [S] Bison: GET /campaigns/{id} → [S] Bison: GET /leads/{lead_id}/scheduled-emails
      → [S] Bison: GET /campaigns/v1.1/{id}/sequence-steps → [S] Compute derived values
         → [S] Snov.io (local, then global) → [S] OpenAI gpt-4o → [S] phone (AI, else [S] Lusha)
            → [S] Edit Fields → [S] Resolve client sequencer → … → promote_contact_to_lead
```

This isn't new code — it's [18 nodes the workflow already contained](#where-branch-ss-chain-came-from),
unwired and partly broken, repaired and connected to `[S0]` instead of being built from scratch.

**What branch L still owns exclusively**: the sheet write, the CRM dispatch, blacklisting
(`[284]`/`[306]`) and the reply forward. Branch S has no reason to blacklist a second time on a second
credential, so those stay singular. What still requires Sheets is now only what *should*: the client's
Leads spreadsheet id (`col_4`), the notification recipients (`col_101`) and the ABM list — all
disconnected at phase C by design.

**The sheet-fallback guard on branch L's 8 headers exists for exactly 7 clients** — CS PDCA lists 42
Bison workspaces, 35 have a keyed `client_sequencers` row, and workspaces 131/136/137/138/139/149/150
(all `Onboarding`) have none. Four of them match a client by name; **SalesBook, Tryumf and Kamiński
have no `clients` row at all**. Delete the fallback once those are seeded —
[`sheets-bison-credential-sync`](../../ops/sheets-bison-credential-sync/README.md) does the seeding on
a schedule. (Branch S's own headers have no such fallback — if `[S0]` finds no key for a client, that
client's branch-S calls 401 and `promote_contact_to_lead` is never reached for that execution; branch L
is unaffected.)

### Double cost, deliberate

[ADR-0017 §1a](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) asks for two
independent branches. The 2026-07-22 version of this README declared a narrowing — reuse branch L's
enrichment to avoid doubling the Snov.io/Lusha/OpenAI bill — and that narrowing is **reversed** as of
the same-day fix above: **each vendor is now called once per branch**, at double cost per lead, in
exchange for the literal reading of §1a — either branch can be disconnected without the other's
correctness depending on what's in the other branch's data source.

### The expected divergence

`promote_contact_to_lead` always creates the lead at qualification **`preMQL`**, because promotion to
MQL is a human decision ([ADR-0004](../../../../../docs/adr/0004-lead-state-boundaries.md)). Branch L
writes `MQL` or `preMQL` into the sheet depending on the tag.

**That is not a defect and must not be "fixed".** Reconcile on existence and identity, never on
qualification.

## Where branch S's chain came from

This workflow already contained a **second, unfinished Supabase branch** — 31 nodes including
`Get Client Data`, `Check if lead exist in base`, `Insert rows in a table` and a full duplicate of the
enrichment chain, unwired and partly broken:

1. **It was not wired.** `Get Client Data` had no inbound edge; across 15 consecutive executions not
   one of its nodes ran.
2. **Its root was broken.** It selected `clients.external_workspace_id`, a column dropped by
   [`20260704b`](../../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql).
3. **It wrote `leads` directly**, bypassing `promote_contact_to_lead` — forbidden by
   [ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md) §5, and it set no
   `source_sequencer_contact_id`, so the one-lead-per-contact index could not protect it.

**2026-07-22: repaired and split.** 18 of the 31 — the Bison data-fetch + Snov.io/Lusha/OpenAI
enrichment nodes — are exactly what branch S needed for real independence (see
[above](#the-two-branches-share-nothing-2026-07-22)): renamed to the `[S] …` convention, pointed at
`[S0]` instead of `Get Client Data`, given `onError: continueRegularOutput`, and wired into a new
`[S] Edit Fields` that feeds the existing (already-live) RPC chain.

The other **11 had no role left** and were deleted rather than repaired:

| Deleted node | Why |
|---|---|
| `Get Client Data` | broken root (dropped column); superseded by `[S0]` |
| `Check if lead exist in base`, `Lead already exists?1` | a second dedup key (email+client_id) with weaker semantics than the RPC's own `uq_leads_source_sequencer_contact` — the RPC is the one source of truth for "does this lead exist" |
| `Update rows in a table`, `Insert rows in a table` | the direct `leads` writes ADR-0015 §5 forbids |
| `Get Campaign Id` | superseded by `[S] Resolve campaign` |
| `[283] Lead email == Reply email?2`, `[284] Bison: blacklist 3rd-party email2`, `Get Blacklist Domain from base`, `[306-filter]…2`, `[306]…2` | blacklisting stays branch-L-exclusive; branch S never blacklists |

`pnpm n8n:validate` used to report `business/direct-table-write` on `Update rows in a table` for
exactly this reason; the manifest accepted it with an expiry of 2026-09-30. That's now moot — the node
is gone, and `knownViolations` is empty.

## Known defects (branch L)

| # | Defect | Consequence |
|---|---|---|
| 1 | duplicate protection is a sheet lookup | read-then-write race; two deliveries can both append, and the CRM dispatch inherits that |
| 2 | the Snov.io result is fetched after a fixed `Wait`, not polled | a slow enrichment silently yields nothing |
| 3 | no retry, no error branch on any vendor call | a partial failure leaves a half-written lead, possibly already in the customer's CRM |
| 4 | a hardcoded token in `[69] … sequence-steps` (per the node's own name) | not caught by the scanner if it is an expression; worth checking |
| 5 | ~~qualification was read from `data.tag_name`, the event that fired~~ | **fixed 2026-08-05** — both `[96] Update Qualification col` and `[S] promote_contact_to_lead` now derive it from the lead's whole `tags` set. See below |

Branch S already fixes defect 1 on its own side: `uq_leads_source_sequencer_contact` makes
one-lead-per-contact a database fact.

### Qualification comes from the tag set, not the event — 2026-08-05

Both writers used to compute `tag_name === 'interested' ? 'MQL' : 'preMQL'` from the single
`TAG_ATTACHED` event that woke the run. The same expression on both sides, so they never disagreed
*within* a run — and disagreed permanently *across* runs. The sheet rewrites `QUALIFICATION` on
every event, in both directions; `promote_contact_to_lead` was upgrade-only and ignored a demotion.
A lead tagged `Interested` and later re-tagged `preMQL` therefore read `preMQL` in the sheet and
`MQL` in Supabase, forever. Measured 2026-08-05: **102 leads across 15 clients**, always that way
round.

The tag set settles which side was right. Execution `62560` (Bent Iron PL, Damian Gorniak) carried
`tags = [Custom Mail Server, preMQL]` — no `Interested` tag at all — so the lead really was `preMQL`
and the sheet was correct. `data.tag_name` is only what changed just now; `[40] Bison: GET
/leads/{taggable_id}` already returns the whole set, and now both writers read it.

The fallback to the old expression is deliberate: a lead carrying no qualifying tag at all keeps the
previous behaviour rather than resolving to an empty string.

**This ships with [20260805_promote_contact_lead_two_way_qualification](../../../../../supabase/migrations/20260805_promote_contact_lead_two_way_qualification.sql), and the order matters** — the
migration makes the RPC sync qualification both ways, which is only safe once the caller sends the
tag-set value. Applied first, one `preMQL` event would demote a lead that still holds `Interested`.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id bison-lead-enrichment
```

```sql
-- branch S output for the last day
select l.id, l.qualification, l.created_at, sc.external_contact_id, r.classification
from public.leads l
join public.sequencer_contacts sc on sc.id = l.source_sequencer_contact_id
left join public.replies r on r.id = l.origin_reply_id
where l.created_at > now() - interval '1 day'
order by l.created_at desc;
```

**Never** `execute_workflow` against this on production: it appends to a client spreadsheet, writes
to their CRM, blacklists senders and forwards email.
