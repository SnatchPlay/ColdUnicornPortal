# aimfox-premql-to-pdca

**Logical ID:** `aimfox-premql-to-pdca` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `s0GqDtCzyLAvVnm1` — `preMGL tag added (Aimfox) -> Add lead to PDCA`
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
                                            └─ [S] upsert_reply(webhook delivery id, event.timestamp, …, 'Interested', latest lead message body)
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

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-premql-to-pdca
```

Do **not** `execute_workflow` against this on production: it appends to a live client spreadsheet and
sends a notification. Real verification is the first live production execution after this change —
watch `GET /api/v1/executions?workflowId=s0GqDtCzyLAvVnm1` and confirm a new `sequencer_contacts` /
`replies` / `leads` row.

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
