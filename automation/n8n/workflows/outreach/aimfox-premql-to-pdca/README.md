# aimfox-premql-to-pdca

**Logical ID:** `aimfox-premql-to-pdca` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `s0GqDtCzyLAvVnm1` — `preMQL tag added (Aimfox) -> Add lead to PDCA`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **A — branch S live 2026-07-22.**

## Business purpose

The moment a LinkedIn conversation is tagged `preMQL`, this is what turns it into a lead: enrich the
contact, write a row into the client's own Leads spreadsheet, and notify.

It is the LinkedIn entry point into the funnel — the analogue of a positive Bison reply
([ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md)).

## Flow

```
Webhook /preMQL-Aimfox
  └─ Filter1 → Get Workspace Api Key → [2] Find workspace in CS PDCA (client sheet id, col_4)
     └─ GET lead info Aimfox → [4] Check if lead already in Leads sheet
        └─ If ─┬─ exists  → Filter → Update row in sheet
               └─ new     → Lusha Enrichment
                            └─ Search Conversations → Get Conversation → Edit Fields
                               └─ Get Table ID → Create Record (sheets batchUpdate)
                                  └─ Edit Fields1 → Split Out → UniTalk notification

… and, since 2026-08-05, hanging off branch S's last node:

[S] promote_contact_to_lead
  └─ Add Lead to Blacklist (POST /v2/blacklist/{lead.urn})
     └─ If1 (current_experience.length == 1)
        ├─ true  → Add company to blacklist        (current_experience[0].company.universal_name)
        └─ false → OpenAI — Search for the company name (gpt-5-mini, strict json_schema)
                    └─ Filter2 (a company was named) → Add company to blacklist1
```

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | the webhook has **no authentication** | its path is a bearer secret; anyone holding it can create leads and spend Lusha credits ([security §3](../../../../../docs/reference/n8n/security.md)) |
| 2 | duplicate protection is a **sheet lookup**, not a constraint | read-then-write: two deliveries for the same lead can both see "not found" and both append |
| 3 | the lead has no channel marker | it is a spreadsheet row, so nothing records that this lead came from LinkedIn rather than email — process invariant 3 |
| 4 | no contact identity is stored | the Aimfox lead id lives only inside the execution; a repeat contact cannot be recognised — process invariant 2 |
| 5 | no retry, no error branch | a failure between enrichment and the sheet write leaves the lead half-created and the notification unsent |
| 6 | client resolution goes through CS PDCA `col_4` | the client's *spreadsheet id* is the join key, so a client with no sheet cannot receive a lead at all |
| 7 | ~~branch S dated the reply from `body.event.timestamp` while branch L dated it from the conversation~~ | **fixed 2026-08-03** — the two branches wrote two different facts, so a lead could sit days from where the sheet put it; every DoD/WoW/MoM bucket inherited it. See the history entry below |
| 8 | the blacklist chain has **no error output**, and `Add Lead to Blacklist` alone has no `retryOnFail` | one Aimfox 4xx marks the whole execution failed. It runs last, so nothing upstream is lost — but the failure is indistinguishable from a lead-creation failure in the execution list |
| 9 | branch S stored far less about the lead than the run already held | **partly fixed 2026-08-05** — `linkedin_url`, `country`, the reply's step and the contact's real email now go to the DB. What is still dropped, and why, is in [what branch S still throws away](#what-branch-s-still-throws-away) |

## What phase A adds — branch S, live 2026-07-22

Branch S is its **own** call chain, independent of branch L in both directions (ADR-0017 §1a): it makes
its own `GET lead info Aimfox` / `Search Conversations` / `Get Conversation` calls (never reuses branch
L's), sharing only the already-Supabase-only `Get Workspace Api Key` node — the same shared-infra
pattern `aimfox-classification` uses.

```
Get Workspace Api Key ─┬─ [2] Find workspace in CS PDCA → … (branch L, unchanged)
                        └─ [S] GET lead info Aimfox
                             └─ [S] Search Conversations
                                  └─ [S] Get Conversation
                                       └─ [S] upsert_sequencer_contact(client_sequencer_id, lead.id, lead.email, lead.first_name, lead.last_name)
                                            └─ [S] upsert_reply(webhook delivery id, latest lead message created_at, …, 'Interested', latest lead message body)
                                                 └─ [S] Resolve campaign(lead.origins[0].id)
                                                      └─ [S] promote_contact_to_lead(…) → leads.sequencer_id = …0003 (aimfox)
```

That closes defects 2, 3 and 4 at once: `uq_leads_source_sequencer_contact` makes "at most one lead
per contact" a database fact rather than a spreadsheet lookup, and the lead carries its channel.

**Campaign attribution (task B) turned out to be resolvable for this workflow.** The open question in
[aimfox-phase-a.md](../../../../../docs/reference/n8n/aimfox-phase-a.md) was whether a preMQL lead could
carry a real `campaign_id` — the raw webhook body has no campaign reference. But `GET lead info Aimfox`'s
response does: `lead.origins[0].id` is the same Aimfox campaign UUID
[`aimfox-campaign-sync`](../../../ingestion/aimfox-campaign-sync/README.md) catalogs — verified by
cross-referencing a real lead profile response against a real campaign-sync execution (same id, same
name, "Lipiec | K"). So `[S] Resolve campaign` joins on it and `promote_contact_to_lead` gets a non-NULL
`campaign_id` whenever the campaign is already in the catalog.

**Deliberately NOT duplicated:** Lusha. Branch L calls Lusha for phone/work-email enrichment; branch S
does not — phone_number stays NULL (not measured) rather than doubling a per-lookup vendor cost for a
field this migration doesn't need in order to prove a lead exists. Email/name/company/job-title come
from Aimfox's own lead profile, which is free.

**Order no longer matters procedurally** — branch S here shares no data with `aimfox-classification`'s
branch S, it only shares the general design principle (own calls, own credentials resolution). Both
were built the same day.

## 2026-08-05 — the converted contact and their company are blacklisted

Six nodes were added on the instance and pulled in with `pnpm n8n:export`. Once a `preMQL`/`MQL` tag
has produced a lead, the contact is removed from the client's Aimfox reach, and so is their company:

- `Add Lead to Blacklist` — unconditional, `POST /v2/blacklist/{lead.urn}`.
- `If1` — `current_experience.length == 1`? Then the company is unambiguous and
  `Add company to blacklist` posts its `universal_name`.
- Otherwise `OpenAI - Search for the company name` (gpt-5-mini, `/v1/responses`, strict
  `json_schema` whose `enum` is **closed over the lead's own current-experience companies plus
  `null`**) picks which of them the reply actually names; `Filter2` drops the `null`/empty answer and
  `Add company to blacklist1` posts the rest.

This is the same pattern `aimfox-classification` already runs — identical node names, identical
endpoints, identical prompt — so it is reuse, not a second mechanism
([reuse-catalog](../../../../../docs/reuse-catalog.md)). Its OpenAI node uses
`predefinedCredentialType: openAiApi`, i.e. the fix from [security §8](../../../../../docs/reference/n8n/security.md)
was carried over rather than re-introducing a literal key.

**Against invariant 7** ([process doc](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)):
blacklisting is irreversible and must follow an explicit classification, never a missing field. The
contact call satisfies that — the tag *is* the classification. The company call is weaker: on the
`If1` false branch an LLM decides an irreversible act. Two things keep it inside the invariant — the
schema `enum` cannot invent a company outside the lead's own experience list, and `Filter2` treats
"no answer" as "do nothing". `current_experience.length == 0` also lands on the false branch, which
spends a model call whose only possible answer is `null`.

Not yet exercised by a production webhook run: the last full `mode: webhook` execution is `62795`
(2026-08-04 06:34), before the change; `65086`–`65098` (2026-08-05) are `mode: manual` partial runs
from the editor. They did call the live blacklist endpoints for real contacts.

## 2026-08-05 — branch S now sends what it already fetched

The run holds the whole Aimfox profile and the whole conversation; branch S was passing seven of the
fourteen fields `promote_contact_to_lead` accepts. Measured before the change, over the 60 leads
branch S had created: `linkedin_url` 0/60, `country` 0/60, `email` 4/60 — against `linkedin_url`
30/30 for the Aimfox leads that came in from Sheets.

Three nodes changed, no migration, no new vendor call:

| Node | Change |
|---|---|
| `[S] upsert_sequencer_contact` | identity now comes from the **profile** (`lead.email ?? lead.contact_info.email`, then the webhook), not from the webhook body where `email` is always `null` |
| `[S] upsert_reply` | passes `message_subject` and `sequence_step`, both derived from the conversation branch L already reads |
| `[S] promote_contact_to_lead` | passes `linkedin_url` (`https://www.linkedin.com/in/{public_identifier}`) and `country` (branch L's own non-Lusha rule), and the same email expression as the contact node |

**The two email expressions must stay identical.** `promote_contact_to_lead` check (7) raises when the
payload email differs from the contact's — a divergence between these two nodes is an exception, not a
silent mismatch.

Proved, not asserted:

- **Parity harness** — all three expressions read out of the committed `workflow.json` and evaluated
  over 8 real executions (`62795`, `62793`, `62792`, `61813`, `61202`, `58811`, `58884`, `61198`),
  compared against branch L's own `Edit Fields` output in the same run: **0 differences** on
  `subject`, `step`, `linkedin_url`, `country`.
- **SQL exercised** against production inside `begin … rollback`: the lead came back with
  `linkedin_url`, `country=Poland`, `sequencer_id=…0003`, `created_at` = the reply's date, and the
  reply with `sequence_step=0`; 0 rows left behind after the rollback.

Two honest caveats. `message_subject` is empty for every LinkedIn conversation seen so far — DMs carry
no subject — so it is parity with branch L rather than a real gain. And `country` inherits branch L's
rule verbatim, which returns the whole string when `location.name` has no comma: real rows read
`"Warsaw Metropolitan Area"`. That is exactly what the client sheet holds, so it is parity; it is not
a clean country code.

**Existing rows are not repaired by the workflow.** `promote_contact_to_lead` sets these columns on
INSERT only, and `upsert_reply`'s `on conflict` never touches `sequence_step` — a replay does not fix
history. [`pnpm aimfox:backfill-profile-fields`](../../../../../scripts/aimfox/backfill-lead-profile-fields.mjs)
does: it re-reads `GET /leads/{external_id}` per lead with the client's own token and fills only the
NULL columns, by the same two rules the workflow uses. Applied 2026-08-05 — **60 of 60** leads, 0
skipped, 0 Aimfox lookups failed; Aimfox leads now stand at `linkedin_url` 90/90. `sequence_step` was
deliberately left out of the backfill: it needs the conversation, not the profile.

Follow-up worth a decision: 12 of those 60 got a `country` like `"Warsaw Metropolitan Area"`, because
`location.name` has no comma and branch L's rule returns the whole string. That is what the client
sheet holds, so it is parity — but it is not a country. Tightening it means changing branch L, branch
S and the backfill together, not one of them.

## What branch S still throws away

| Field | Where it already is in the run | Status |
|---|---|---|
| `job_title` / `company_name` | branch S takes `current_experience[0]` only; branch L joins **all** current experiences and falls back to `lead.occupation` | still divergent — deferred 2026-08-05 |
| `sequencer_contacts.raw_payload` | `{}`. The profile carries `about`, `occupation`, `location`, `connections`, `followers`, `work_experience`, `education`, `skills`, `languages`, `interests`, `labels`, `urn`, `picture_url`, `origins` | free; the column exists for this — deferred 2026-08-05 |
| `website`, `industry`, `headcount_range`, `phone_number` | Lusha only — branch S deliberately does not call Lusha (see above) | needs a cost decision, not a bug |
| `leads.message_title`, `message_number`, `response_time_hours/label`, `reply_text` | branch L computes all four for the sheet | **blocked**: not in `promote_contact_to_lead`'s whitelist — extending it is a migration, and `replies` is arguably the right home for the first three |

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-premql-to-pdca
```

Do **not** `execute_workflow` against this on production: it appends to a live client spreadsheet and
sends a notification. Real verification is the first live production execution after this change —
watch `GET /api/v1/executions?workflowId=s0GqDtCzyLAvVnm1` and confirm a new `sequencer_contacts` /
`replies` / `leads` row.

## History · 2026-08-03 — the two branches now date a lead from the same fact

Branch L has always written `LEAD RECEIVED` from the prospect's own conversation message
(`Edit Fields.leadReceived` — newest message whose sender is not the account). Branch S passed
`body.event.timestamp` to `upsert_reply`, which is when Aimfox **delivered the webhook**, i.e. when
the label was applied. Since [20260727](../../../../../supabase/migrations/20260727_promote_contact_lead_cast_and_date.sql)
`leads.created_at = replies.received_at`, so every DoD / WoW / MoM bucket was cut on the wrong day.

It is not a rounding difference. Label events arrive in batches, and the batch minute is what got
stored — five different contacts share `received_at = 2026-07-28 08:01`, three share `07-28 07:54`.
Measured on Bent Iron PL: 7 of 12 Aimfox leads sat 1–7 days from where the sheet put them
(OLEOFARM and SOPEM: sheet 20.07, Supabase 27.07).

`[S] upsert_reply` now derives the timestamp from `[S] Get Conversation` with branch L's predicate,
at full precision, and falls back to `body.event.timestamp` only when the conversation carries no
lead message (branch L writes an empty cell in that case; a NULL `received_at` is not an option).
Parity was proved against the committed artifact — both expressions read out of `workflow.json` and
run over the same payloads, including the batch shape and the no-message fallback.

Rows written before this keep the old value: `upsert_reply`'s `on conflict` deliberately does not
touch `received_at`, so a replay does not repair them. That is what
[`sheets:backfill-aimfox-dates`](../../../../../scripts/sheets/backfill-aimfox-lead-dates.mjs) is
for — it re-dates from the client workbook, dry-run by default.

## History

2026-07-22 — first change made through this repository. The literal Aimfox token was replaced by the
`Aimfox Master` credential. Doing that through `update_workflow` **silently dropped the credentials
of four other nodes** (`Create Record`, `Get Table ID`, `Lusha Enrichment`, the UniTalk call), because
the SDK path does not re-attach credentials to `httpRequest` nodes. Repaired within the same session
by a targeted REST `PUT`; every credential-declaring node on the instance was then audited and found
clean. The rule this produced is in
[workflow-lifecycle · the SDK authoring contract](../../../../../docs/reference/n8n/workflow-lifecycle.md).

## History · 2026-07-22 — the token now comes from Supabase

Every Aimfox webhook workflow had been failing on `Get Workspace Api Key`, with *"The service was not
able to process your request"*. The cause is not the credential: **`GET /workspaces/{id}/tokens`
returns 500**, confirmed by calling it directly with a known-good workspace token.

Minting a token is no longer necessary. The per-client tokens were seeded into
`client_sequencers.api_key` on 2026-07-22, so the node became a Postgres lookup:

```sql
select jsonb_build_array(jsonb_build_object('token', cs.api_key)) as tokens, ...
from public.client_sequencers cs
join public.sequencers s on s.id = cs.sequencer_id and s.key = 'aimfox'
where cs.external_workspace_id = $1 and cs.enabled and coalesce(cs.api_key,'') <> ''
```

**The node keeps its name and its output shape**, so not one downstream expression changed — all of
them read `$('Get Workspace Api Key').item.json.tokens[0].token`. That the `jsonb` really arrives as
a JS array was proved, not assumed: a throwaway workflow executed the same query and evaluated the
same expression (`resolves: true`, `token_length: 36`, `tokens_type: object`).

Consequences: the Aimfox master token is no longer used by this workflow at all, and the flow is
Supabase-dependent for credentials — the first real link from this channel to the database.

## History · 2026-07-22 — branch S added; the credential-drop trap hit again

A raw REST `PUT` (no n8n MCP this session) that resends the full `nodes` array **strips every native
node's `credentials` object** unless it is explicitly re-attached — `GET` never returns it, so a
naive GET→edit→PUT round trip silently produces a live, uncredentialed workflow. It happened here: the
first `PUT` adding branch S returned `HTTP 400` ("8 nodes have configuration issues") but had **already
written the graph** — `[2] Find workspace in CS PDCA`, `[4] Check if lead already in Leads sheet`,
`Update row in sheet` and `Get Workspace Api Key` were live with no credential bound. Fixed by a second
`PUT`, immediately after, re-attaching `googleSheetsOAuth2Api` (`k9XUOJXc1vb4PgSx`) and `postgres`
(`ZTq9rOxLMPN5YT2d`) to every node that needed one — including `Get Table ID`, `Create Record`, `Lusha
Enrichment` and the UniTalk `HTTP Request` node, which the 400 didn't flag but would have broken
silently at runtime on the same trap this workflow already hit once (see the entry above). No
production execution fell in the gap between the two `PUT`s (checked via `GET /executions`).

Also: `pnpm n8n:export` failed with *"Workflow is not available in MCP"* — this workflow's
`settings.availableInMCP` was still `false` (an "imported" default), unlike its already-migrated
siblings. Flipped to `true` in a settings-only `PUT` before export succeeded.

**Behaviour change to know about:** a webhook for a workspace with no `client_sequencers` row now
resolves to **zero rows** and the run stops silently, where before it errored. Five clients are
seeded; FitMech has no `external_workspace_id` yet, so its events will not resolve.
