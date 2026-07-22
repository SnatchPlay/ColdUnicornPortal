# aimfox-premql-to-pdca

**Logical ID:** `aimfox-premql-to-pdca` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `s0GqDtCzyLAvVnm1` — `preMGL tag added (Aimfox) -> Add lead to PDCA`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **0 — no Supabase branch.** Imported 2026-07-22, once the literal Aimfox master token
moved into the `Aimfox Master` credential ([security §7](../../../../../docs/reference/n8n/security.md)).

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

## What phase A adds

Branch S resolves the client from `client_sequencers` on the Aimfox `external_workspace_id` — seeded
2026-07-22, so this precondition is now met — then:

```
upsert_sequencer_contact(client_sequencer_id, aimfox lead id, …)
  └─ upsert_reply(the preMQL conversation message, classification 'Interested')
     └─ promote_contact_to_lead(…)        → leads.sequencer_id = …0003 (aimfox)
```

That closes defects 2, 3 and 4 at once: `uq_leads_source_sequencer_contact` makes "at most one lead
per contact" a database fact rather than a spreadsheet lookup, and the lead carries its channel.

**Order matters.** This workflow comes *after*
[`aimfox-classification`](../aimfox-classification/README.md) in phase A: a lead must hang off a
stored contact and a stored reply, and today neither exists for LinkedIn.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-premql-to-pdca
```

Do **not** `execute_workflow` against this on production: it appends to a live client spreadsheet and
sends a notification.

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

**Behaviour change to know about:** a webhook for a workspace with no `client_sequencers` row now
resolves to **zero rows** and the run stops silently, where before it errored. Five clients are
seeded; FitMech has no `external_workspace_id` yet, so its events will not resolve.
