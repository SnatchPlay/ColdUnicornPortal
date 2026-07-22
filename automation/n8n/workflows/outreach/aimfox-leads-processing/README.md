# aimfox-leads-processing

**Logical ID:** `aimfox-leads-processing` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `4OjNRWLaG2IWK6kd` — `AimFox Leads Processing`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **0 — no Supabase branch.** Imported 2026-07-22, once the literal Aimfox master token moved
into the `Aimfox Master` credential ([security §7](../../../../../docs/reference/n8n/security.md)).

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

## Why this one migrates last

It writes into the **clients' own CRMs**. Under
[ADR-0017 §1b](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) a branch that
calls an external write endpoint may not simply be duplicated: two branches disagreeing about whether
a lead is new would put a duplicate into a customer's Salesforce, where we cannot clean it up.

So it gets the A1 shadow treatment — branch S builds the intended lead, logs it to
`integration_sync_runs`, and agreement is measured before anything is sent.

## What phase A adds, when its turn comes

```
upsert_sequencer_contact(client_sequencer_id, aimfox lead id, …)
  └─ upsert_reply(…)
     └─ promote_contact_to_lead(…)   → leads.sequencer_id = …0003 (aimfox)
```

`uq_leads_source_sequencer_contact` then makes defect 3 a database guarantee instead of a spreadsheet
lookup, and defect 4 disappears with it.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-leads-processing
```

**Never** `execute_workflow` against this on production: it writes to a client spreadsheet, to their
CRM, and forwards email.

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
