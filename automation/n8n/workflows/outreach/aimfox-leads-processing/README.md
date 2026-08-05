# aimfox-leads-processing

**Logical ID:** `aimfox-leads-processing` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `4OjNRWLaG2IWK6kd` — `AimFox Leads Processing`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **A — branch S live 2026-07-22.**

**Trigger correction (2026-07-22):** this workflow is called by
[`aimfox-classification`](../aimfox-classification/README.md)'s `Call 'Test aimfox'` node — gated on
`category=='interested'` — **not** the Bison HUB, as this doc previously (wrongly) said. Verified by
grepping all 57 live n8n workflows for this workflow's own node id; the only match was
aimfox-classification. Confirmed against a real execution: the item it receives at `When Called by HUB`
is aimfox-classification's own raw webhook body, unchanged (its `Edit Fields` node does `jsonOutput:
{{$('Webhook').item.json}}`) — same `body.event.target.*` shape aimfox-classification's own branch S
already consumes.

## Business purpose

The full enrichment path for a qualified LinkedIn lead: Aimfox profile → Lusha → Snov.io → a row in
the client's Leads sheet → the client's CRM → a notification, and a forward of the reply to whoever
the client nominated.

Twenty-six nodes, four external vendors and a CRM dispatcher. It is the widest blast radius in the
Aimfox family, which is why it migrates **last**.

## Flow

```
When Called by HUB ─┬─ Execution Data ──┐
                    └───────────────────┴─▶ Merge → Get Workspace Api Key
                                              └─ [2] Find workspace in CS PDCA
                                                 └─ GET lead info Aimfox
                                                    └─ [4] Check if lead already in Leads sheet
                                                       └─ Lead already exists?
                                                          ├─ yes → [96] Update Qualification col
                                                          └─ no  → Compute derived values
                                                                   └─ Lusha → set phone
                                                                      └─ Get Table ID → Create Record
                                                                         └─ Split Out → UniTalk
```

Snov.io runs as its own chain (`token → start → Wait → result`), and
`Call '[HUB] CRMs Add/Update Lead Dispatcher'` fans the finished lead out to HubSpot, LiveSpace,
Pipedrive, Salesforce or Zoho ([ADR-0010](../../../../../docs/adr/0010-legacy-crm-integration.md)).

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | `[40] Bison: GET /leads/{taggable_id}` is **dead** — no inbound, no outbound edge | an unused call to a second vendor's API sitting in a live workflow; either it is a leftover or something that was meant to be wired and never was |
| 2 | the Snov.io result is fetched after a **fixed `Wait`**, not polled | a slow enrichment silently returns nothing, and the lead is written without it |
| 3 | duplicate protection is a sheet lookup | read-then-write race; two deliveries can both append, and the CRM dispatch inherits that decision |
| 4 | the lead has no channel marker and no stored contact identity | process invariants 2 and 3 |
| 5 | no retry, no error branch anywhere | a failure part way through leaves a partially written lead, and the CRM may already hold it |
| 6 | the derived-values code itself flags an ambiguity | when two message templates share an `original_id`, the sequence step cannot be determined; the code detects this (`isTemplateMatchAmbiguous`) and carries on |
| 7 | ~~`Create Record` hardcoded `const qualification = 'MQL'` into the sheet row~~ | **fixed 2026-08-05** — `normalizeAimfoxLead()` already derived the value from the lead's label set and nothing read it, so every Aimfox sheet row claimed `MQL` regardless of its labels while branch S wrote the label-derived value to Supabase. One run, two different facts. See [the reconciliation](../../../../../docs/reference/processes/outreach/sheets-supabase-reconciliation.md#qualification-2026-08-05) |

## Why this one was flagged to migrate last — and why branch S shipped anyway

It writes into the **clients' own CRMs**. Under
[ADR-0017 §1b](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) a branch that
calls an external write endpoint may not simply be duplicated: two branches disagreeing about whether
a lead is new would put a duplicate into a customer's Salesforce, where we cannot clean it up. This
doc originally called for an A1 shadow (log the intended lead, measure agreement, wire real writes
later) for exactly that reason.

**That risk doesn't apply to what branch S actually does.** Branch S never calls `Call '[HUB] CRMs
Add/Update Lead Dispatcher'` — that stays branch-L-exclusive, the same way
[`bison-lead-enrichment`](../bison-lead-enrichment/README.md)'s and
[`aimfox-classification`](../aimfox-classification/README.md)'s already-shipped branch S never touch
their workflows' CRM/blacklist calls either. Branch S here only writes Postgres via the RPC contract.
Confirmed with the user before building (2026-07-22) rather than silently overriding the prior caution.

## What phase A adds — branch S, live 2026-07-22

```
Get Workspace Api Key ─┬─ [2] Find workspace in CS PDCA → … (branch L, unchanged)
                        └─ [S] GET lead info Aimfox (own call, never branch L's)
                             └─ [S] upsert_sequencer_contact(client_sequencer_id, target.id, target.email, target.first_name, target.last_name)
                                  └─ [S] upsert_reply(webhook delivery id, event.timestamp, …, 'Interested', event.message)
                                       └─ [S] Resolve campaign(event.campaign.id)
                                            └─ [S] promote_contact_to_lead(…)   → leads.sequencer_id = …0003 (aimfox)
```

`uq_leads_source_sequencer_contact` then makes defect 3 a database guarantee instead of a spreadsheet
lookup, and defect 4 disappears with it. Unlike `aimfox-premql-to-pdca`, the message text
(`event.message`) and campaign id (`event.campaign.id`) are both already inline in the webhook body —
no extra conversation-fetch calls needed for those two fields.

**Deliberately NOT duplicated:** Lusha and Snov.io. Branch L's elaborate enrichment chain (Lusha →
Snov.io Local → Snov.io Global fallback) exists to fill phone/company/job-title when Aimfox's own
profile is thin. Branch S calls only its own `GET lead info Aimfox` (free) for job_title/company_name
and leaves `phone_number` NULL — not measured, rather than doubling per-lookup vendor spend to prove a
lead exists.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-leads-processing
```

**Never** `execute_workflow` against this on production: it writes to a client spreadsheet, to their
CRM, and forwards email. Real verification is the first live production execution after this change —
watch `GET /api/v1/executions?workflowId=4OjNRWLaG2IWK6kd` and confirm a new `sequencer_contacts` /
`replies` / `leads` row.

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

## History · 2026-07-22 — branch S added; the trigger claim was wrong

Before wiring branch S, its inputs had to be grounded rather than assumed — this workflow's internal
code already showed signs of confusion (a dead `[40] Bison: GET /leads/{taggable_id}` node reading
`data.taggable_id`, a disabled `Edit Fields1` reading `event.workspace_id`/`data.tag_name`, and the live
`Get Workspace Api Key`/`GET lead info Aimfox` nodes reading a completely different `body.event.target.*`
shape). Rather than guess which shape is real, the actual caller was found by grepping all 57 live n8n
workflows for this workflow's own node id (`4OjNRWLaG2IWK6kd`): the only match is
`aimfox-classification`'s `Call 'Test aimfox'` node, **not** `[HUB] Bison Replies Dispatcher` as this
doc and the manifest previously said. A real execution (50083) confirmed the payload: aimfox-classification
forwards its own raw webhook body unchanged, so `body.event.target.*` is the trustworthy shape and the
`data.tag_name`/`data.taggable_id` code paths are dead weight from an earlier design.

This also resolved the standing "A1 shadow" question: the caution existed to prevent branch S from
duplicating a CRM write, but branch S was designed to never touch the CRM dispatcher at all (same
pattern as `bison-lead-enrichment`'s and `aimfox-classification`'s branch S) — so real RPC writes went
in immediately, confirmed with the user first rather than silently reversing a documented decision.

Same credential-preservation care as `aimfox-premql-to-pdca`'s branch S build applied here too: the raw
REST `PUT` payload was built from a **live `GET`** (which, for this particular workflow, already
returned every node's `credentials` object faithfully — unlike `aimfox-premql-to-pdca`, where a plain
`GET` returned none at all). Verified post-write that all 8 pre-existing credentialed nodes plus the 4
new Postgres RPC nodes carried the correct credential before calling this done.
