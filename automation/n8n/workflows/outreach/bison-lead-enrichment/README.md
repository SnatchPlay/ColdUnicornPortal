# bison-lead-enrichment

**Logical ID:** `bison-lead-enrichment` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `lBOyL8ZPA3SZSvDW` — `[child-1] TAG_ATTACHED · Interested/PreMQL · Full enrichment`
**Business process:** [OOO follow-ups (and the lead contract)](../../../../../docs/reference/processes/outreach/ooo-followups.md)
**Phase:** **A · dual-write**, branch S live since 2026-07-22
([ADR-0017](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md))

## Business purpose

A Bison contact replies positively and is tagged `Interested` or `preMQL`. This is where that becomes
a lead: enrich from Snov.io, Lusha and an LLM, write the row, dispatch to the client's CRM, notify,
and forward the reply.

Seventy-five nodes and five external vendors — the widest blast radius in the email channel.

## Flow

```
When Called by HUB ─ Merge ─ CS PDCA ─ Bison lead ─ already in the Leads sheet?
   ├─ yes → update the Qualification column
   └─ no  → replies → last reply → campaign + scheduled emails + sequence steps
            └─ derived values → Snov.io (local, then global) → 3rd-party blacklisting
               └─ OpenAI gpt-4o → phone (AI, else Lusha)
                  └─ Get Table ID → Create Record (sheet append)
                     ├─ Edit Fields1 → CRM dispatcher                     [L]
                     └─ Edit Fields1 → [S] resolve → contact → reply      [S]
                                        → campaign → promote_contact_to_lead
```

## Branch S — the lead, through the RPC contract

Five Postgres nodes, all `onError: continueRegularOutput` so a Supabase failure cannot stop the sheet
or the CRM (ADR-0017: Supabase failure is non-fatal in phase A):

```
[S] Resolve client sequencer      client_sequencers by external_workspace_id, emailbison
[S] upsert_sequencer_contact      scoped identity for the Bison lead id
[S] upsert_reply                  the positive reply, classification 'Interested'
[S] Resolve campaign              campaigns.external_id → id, scoped to the same client
[S] promote_contact_to_lead       the lead, with the enrichment payload
```

It hangs off `Edit Fields1` — the point where branch L has already appended the sheet row and
gathered every enriched field. **Sheets first, Supabase second.**

Verified before publishing: the whole chain was executed against production inside a transaction that
was rolled back, and returned `created: true` with a real `lead_id`.

## The Sheets dependency, and how it was cut (2026-07-22)

Branch S hanging off `Edit Fields1` was **not enough to survive the Sheets cutover**, and the first
version of this README was wrong to imply otherwise.

`workspace_id` does come from the webhook, so `[S] Resolve client sequencer` was already independent.
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

**All 8 Bison Authorization headers now read from Supabase.** The expression keeps a guarded sheet
fallback:

```js
const s = $('[S0] …').first().json.bison_api_key;
if (s) return 'Bearer ' + s;
try { return 'Bearer ' + $('[2] …').first().json.col_6; } catch (e) { return 'Bearer '; }
```

The `try` matters: once the CS PDCA node is deleted, a bare `$('[2] …')` reference **throws**, so an
unguarded fallback would itself become the thing that breaks at cutover.

**The fallback exists for exactly 7 clients** — CS PDCA lists 42 Bison workspaces, 35 have a keyed
`client_sequencers` row, and workspaces 131/136/137/138/139/149/150 (all `Onboarding`) have none.
Four of them match a client by name; **SalesBook, Tryumf and Kamiński have no `clients` row at all**.
Delete the fallback once those are seeded — [`sheets-bison-credential-sync`](../../ops/sheets-bison-credential-sync/README.md)
does the seeding on a schedule.

What still requires Sheets is now only what *should*: the client's Leads spreadsheet id (`col_4`), the
notification recipients (`col_101`) and the ABM list — all branch L's business, all of it disconnected
at phase C by design.

### Why branch S reuses branch L's enrichment

[ADR-0017 §1a](../../../../../docs/adr/0017-sheets-to-supabase-dual-write-transition.md) asks for two
independent branches. Here that is **deliberately narrowed, and declared in the manifest**: Snov.io,
Lusha and OpenAI cost money per lead, so a second independent enrichment chain would double the bill
and add no confidence — the enrichment is not the thing being migrated.

What branch L owns exclusively is the **sheet write, the CRM dispatch and the blacklisting**. Those
are what phase C disconnects; the enrichment nodes move to branch S rather than being deleted.

### The expected divergence

`promote_contact_to_lead` always creates the lead at qualification **`preMQL`**, because promotion to
MQL is a human decision ([ADR-0004](../../../../../docs/adr/0004-lead-state-boundaries.md)). Branch L
writes `MQL` or `preMQL` into the sheet depending on the tag.

**That is not a defect and must not be "fixed".** Reconcile on existence and identity, never on
qualification.

## The 31 orphaned Supabase nodes

This workflow already contained a **second, unfinished Supabase branch** — 31 nodes including
`Get Client Data`, `Check if lead exist in base`, `Insert rows in a table` and a full duplicate of
the enrichment chain. It is not part of branch S and was not used, because:

1. **It is not wired.** `Get Client Data` has no inbound edge; across 15 consecutive executions not
   one of its nodes ran.
2. **Its root is broken.** It selects `clients.external_workspace_id`, a column dropped by
   [`20260704b`](../../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql).
3. **It writes `leads` directly**, bypassing `promote_contact_to_lead` — forbidden by
   [ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md) §5, and it sets
   no `source_sequencer_contact_id`, so the one-lead-per-contact index could not protect it.

**Left in place deliberately** — deleting 31 nodes someone built is a decision for a human, not an
agent. But they are dead weight and one of them would violate an ADR the moment it were connected;
they should go.

`pnpm n8n:validate` reports `business/direct-table-write` on `Update rows in a table` for exactly this
reason, and the manifest **accepts it with an expiry of 2026-09-30** rather than hiding it. After that
date CI fails, which is the point: unreachable debt should not quietly become permanent.

(Only the `update` node trips the rule today. `Insert rows in a table` is the more dangerous of the
two — it would create a lead with no `source_sequencer_contact_id` — but the current rule does not
recognise its shape. That is a gap in `business-rules.mjs`, not an absolution.)

## Known defects (branch L)

| # | Defect | Consequence |
|---|---|---|
| 1 | duplicate protection is a sheet lookup | read-then-write race; two deliveries can both append, and the CRM dispatch inherits that |
| 2 | the Snov.io result is fetched after a fixed `Wait`, not polled | a slow enrichment silently yields nothing |
| 3 | no retry, no error branch on any vendor call | a partial failure leaves a half-written lead, possibly already in the customer's CRM |
| 4 | a hardcoded token in `[69] … sequence-steps` (per the node's own name) | not caught by the scanner if it is an expression; worth checking |

Branch S already fixes defect 1 on its own side: `uq_leads_source_sequencer_contact` makes
one-lead-per-contact a database fact.

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
