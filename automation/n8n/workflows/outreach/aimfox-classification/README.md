# aimfox-classification

**Logical ID:** `aimfox-classification` · **Domain:** `outreach` · **Criticality:** high
**Remote (production):** `JnvRBXtRNar7ejeM` — `AimFox Classification`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **0 — no Supabase branch.** Imported 2026-07-22, after its two literal secrets moved into
n8n credentials ([security §7](../../../../../docs/reference/n8n/security.md), §8).

## Business purpose

A LinkedIn contact replies. An LLM decides what kind of reply it is, and — when the reply says the
person is not a prospect — the contact or their company is removed from that client's reach.

This is the LinkedIn counterpart of Bison reply classification, and it produces the **same category
vocabulary** the portal already treats as a contract
([11-integrations §6](../../../../../docs/reference/functional/11-integrations.md)).

## Flow

```
Webhook /aimfox-classifier
  └─ Normalize Payload (reply body + the classification prompt)
     └─ OpenAI · classify → {category, confidence, short_reason, language_detected}
        └─ Parse Classification ─┬─ Get Workspace Api Key → Aimfox blacklist contact
                                 │     └─ Get contact → If ─┬─ blacklist company
                                 │                          └─ OpenAI · which company did they name?
                                 │                             └─ blacklist that company
                                 └─ Filter1: category = interested → sub-workflow 'Test aimfox'
```

## What the model is asked

`json_schema` with `strict: true`, so the category is **enum-constrained** to
`OOO | Interested | NRR | Spam_Inbound | Left_Company | other`. The prompt is written for Polish
replies first, English second, and explicitly tells the model to ignore signatures, footers and
quoted campaign text and to classify only the newest human reply.

The second call is more interesting: it builds its enum **dynamically** from the companies on the
lead's current LinkedIn experience, so the model can only name a company that actually exists on that
profile — or `null`. That is a structural guarantee, not a prompt instruction.

> Both calls now authenticate through the `OpenAi account` credential
> (`predefinedCredentialType`). The request bodies are unchanged, byte for byte — only the literal
> `sk-…` header is gone. Converting them to the `@n8n/n8n-nodes-langchain.openAi` node would **lose**
> both structured-output guarantees above; that node supports `json_object` only.

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | the webhook has **no authentication** | its path is a bearer secret; anyone holding it can drive blacklisting and OpenAI spend ([security §3](../../../../../docs/reference/n8n/security.md)) |
| 2 | no idempotency | a redelivered webhook re-classifies and re-blacklists, and pays for the LLM calls twice |
| 3 | nothing is stored | the classification exists only inside an execution. No reply row, no contact, no metric — the decision that drove an irreversible blacklist leaves no record |
| 4 | no retry, no error branch | a failed OpenAI call ends the run silently and the reply is never classified |
| 5 | `Add company to blacklist` (the `If` true branch) is a **terminal** node with an empty output | intentional today, but it means the "company was named in the reply" path and the "current company" path never converge for logging |

Defect 3 is the one phase A closes, and it is the reason this workflow comes before the lead flows:
`upsert_reply` gives the classification a home, and its UNIQUE on `external_id`
([`20260722c`](../../../../../supabase/migrations/20260722c_replies_external_id_unique.sql)) makes
defect 2 disappear as a side effect.

## What phase A adds

A parallel branch S: resolve the client from `client_sequencers` on the Aimfox
`external_workspace_id` (seeded 2026-07-22), `upsert_sequencer_contact` for the Aimfox lead id, then
`upsert_reply` with the classification. **No blacklist call in branch S** — that is a vendor-side
side effect and belongs to branch L alone until phase C.

An `OOO` classification here should eventually reach `record_ooo_followup` exactly as the Bison path
does ([ADR-0015](../../../../../docs/adr/0015-sequencer-contacts-and-ooo-followups.md)) — the model is
channel-agnostic by design. That is a later step, not part of the first branch S.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-classification
```

Do **not** `execute_workflow` against this on production: it blacklists real contacts.
