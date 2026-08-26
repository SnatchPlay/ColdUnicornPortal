# zoho-upsert-account-and-lead

**Logical ID:** `zoho-upsert-account-and-lead` · **Domain:** `crm` · **Criticality:** medium
**Remote (production):** `am3gYNrZSTbrkRFa` — `[CRM child] Zoho · Upsert Account + Lead`
**Boundary:** [11-integrations · CRM integration](../../../../../docs/reference/functional/11-integrations.md) ·
[ADR-0010](../../../../../docs/adr/0010-legacy-crm-integration.md)
**Imported 2026-08-26**, to repair it — it was an orphan until then, which is most of why it stayed
broken for weeks ([defect-backlog B3](../../../../../docs/reference/n8n/defect-backlog.md#b3)).

## Business purpose

One of the CRM children behind `[HUB] CRMs Add/Update Lead Dispatcher`. When a lead replies
positively and that lead's client has authorised Zoho, this workflow puts three things into the
client's own Zoho tenant: the company as an **Account**, the person as a **Lead**, and the reply
itself as an **email associated with that Lead**.

The third part is the point. An account and a lead without the reply is a contact record; with the
reply attached, the client's salesperson opens Zoho and sees what the prospect actually wrote.

## Flow

```
When Called by Dispatcher  (lead + crm{domain, client_id, client_secret, refresh_token})
  └─ Edit Fields
      └─ [35] Zoho: refresh access_token          POST accounts.zoho.<domain>/oauth/v2/token
          ├─ [101] Zoho: Upsert Account           POST /crm/v8/Accounts/upsert
          └─ [102] Zoho: Upsert Lead              POST /crm/v8/Leads/upsert
              └─ [103] Zoho: Add email to lead    POST /crm/v8/Leads/{id}/actions/associate_email
```

Note the shape: `[103]` hangs off `[102]`, not off `[35]`. That single fact is what broke it — see
below.

## The repair of 2026-08-26 — and the diagnosis it replaces

`[103]` failed on **every run of the retained window** (20 executions, 0 successes, oldest
2026-08-14). [B3](../../../../../docs/reference/n8n/defect-backlog.md#b3) recorded that as *"expired
OAuth token, no lead has reached Zoho"*. **Both halves were wrong.** Reading the execution data:

| Node | Result |
|---|---|
| `[35] Zoho: refresh access_token` | ✅ returns a token, `scope: ZohoCRM.modules.ALL` |
| `[101] Zoho: Upsert Account` | ✅ `code: SUCCESS`, record created |
| `[102] Zoho: Upsert Lead` | ✅ `code: SUCCESS`, record created |
| `[103] Zoho: Add email to lead` | ❌ `401 invalid oauth token` |

Accounts and leads **were** reaching Zoho the whole time. The OAuth credential is healthy. Only the
reply association failed, and not for an auth reason. Three independent bugs sat in that one node:

**1. The access token came from the wrong node — this is the 401.**
`[103]`'s input is `[102]`, so `$json` is the *upsert response*, which has no `access_token`. The
header was literally `Zoho-oauthtoken undefined`. Zoho's message was accurate; the audit read it as
a credential problem.

**2. Two expressions were never expressions.** Both the URL and the JSON body embedded
`$json…` / `$('…')` **inside JavaScript string literals**, so n8n sent the source text. Zoho received:

```
POST /crm/v8/Leads/$json.data[0].details.id/actions/associate_email
{"Emails":[{"from":{"user_name":"$('When Called by Dispatcher').item.json.lead.firstname …"}}]}
```

**3. Three field-level errors underneath that**, which would have surfaced one by one as each earlier
bug was fixed:

| Was | Is | Why |
|---|---|---|
| `lead.last_reply_body_html` | `lead.last_reply_html` | the dispatcher never sends `last_reply_body_html`; the field does not exist in the payload |
| `sent: True` | `sent: true` | Python capitalisation. n8n resolves the unknown identifier to `undefined`, and `JSON.stringify` **drops the key silently** — the flag was simply absent from every request |
| `date_time: "2026-08-25T14:27:35.000000Z"` | normalised through Luxon to `+00:00` | six-digit microseconds with a `Z` suffix is not a format Zoho's ISO-8601 parser accepts |

Fixed in one node, deployed 2026-08-26.

> **One semantic question left open on purpose.** `sent: true` follows the original author's intent,
> but the email being attached is the prospect's reply *to us* — `from` is the lead, `to` is our
> sender — which by Zoho's definition is a **received** message, i.e. `sent: false`. The flag has
> never actually reached Zoho (bug 3), so there is no established behaviour to preserve and no data
> to migrate either way. Confirm with whoever reads these records in Zoho, then set it deliberately.

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | not bound to `[ERR] Automation failure recorder` | 20 consecutive failures reported nowhere; found only by reading the execution list. [E1](../../../../../docs/reference/n8n/defect-backlog.md#e1) |
| 2 | no `retryOnFail`, no `onError` anywhere | one transient at `[101]` costs the lead its Zoho record entirely |
| 3 | `associate_email` is not idempotent | a replayed run attaches the same reply to the lead twice. The two upserts are safe; this call is not |
| 4 | the client's `client_secret` and `refresh_token` travel in the trigger payload | every execution's data is credential-bearing. Never paste an execution of this workflow into a doc or an issue |

## What is still owed

- **A process document.** `manifest.businessProcess` points at the functional reference because
  `docs/reference/processes/crm/lead-handoff.md` does not exist yet. The manifest should point at a
  real process doc once written.
- **The four sibling CRM children** (Salesforce, HubSpot, Pipedrive, LiveSpace) and the dispatcher
  are still orphans, parked with this one. Bug 1 and bug 2 above are almost certainly theirs too —
  the graphs were copied. Worth auditing before the next client authorises a CRM.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id zoho-upsert-account-and-lead
```

Behavioural proof needs a real positive reply for a Zoho-authorised client — the workflow writes to
the client's own tenant, so there is no safe synthetic run. After the next execution, check that
`[103]` returns `code: SUCCESS` and that the reply is visible on the Lead record in Zoho.
