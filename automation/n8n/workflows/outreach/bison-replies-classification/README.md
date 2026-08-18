# `bison-replies-classification` — Bison Replies Classification · Sheets Primary, 401 Fallback

Remote: `XdTMd1KJX0cRmF9u` (production, **active**). Adopted 2026-08-17.

## Why this workflow matters more than its name suggests

Every reply Bison receives arrives here first. An LLM decides what kind of reply it is, and **only
then** is a tag attached in Bison. That tag is what `[HUB] Bison Replies Dispatcher` fans out on, so
every downstream child — OOO detection, MQL enrichment, blacklisting — runs or does not run because
of a decision made in this graph. 2242 executions in 16 days.

It is also the reason email-channel NRR does not exist: see [Known defects](#3-nrr-is-suppressed-on-purpose--not-a-defect-a-decision).

## Flow

```
Bison Reply Webhook
 └─▶ Normalize Payload            (workspace_id, lead_id, reply_id, reply text, instructions)
      └─▶ OpenAI - Classify Email (gpt-5-mini, strict json_schema)
           └─▶ Parse Classification
                └─▶ Should Process Classification?
                     └─▶ Category Is Not NRR?
                          ├─ no ─▶ Respond - Skipped            ← NRR ends here, no tag
                          └─ yes ─▶ [S] Resolve workspace config        (Supabase, since 2026-08-17)
                                     └─▶ Sheets API - config.getWorkspaceConfig  (Set — legacy name)
                                          └─▶ Bison - Get Tags List
                                                       └─▶ Resolve Bison Tag ID
                                                            └─▶ Tag ID Exists?
                                                                 ├─ yes ─▶ Bison - Attach Classification Tag
                                                                 └─ no  ─▶ Respond - Tag Not Found
```

The category enum is `OOO · Interested · NRR · Spam_Inbound · Left_Company · other`. The tag is
resolved by **name match against the workspace's own tag list**, case-insensitively — so a workspace
that has no tag with that name simply gets `Respond - Tag Not Found` and nothing happens.

## The config lookup, and why it *was* the fragile part

Until 2026-08-17 the Set normalised whichever shape arrived — Google Sheets row or Make.com fallback —
into one object, **by positional index**:

```js
bison_api_key:        r.bison_api_key || r.api_key || r['API Key'] || Object.values(r)[6]
email_recipients_csv: r.email_recipients_csv || r['Email Recipients'] || Object.values(r)[98]
```

Insert a column into CS PDCA and it silently started reading the wrong value. Nothing failed; the
wrong key was simply used, and Bison answered 403. That was the real argument for moving — stronger
than the Sheets shutdown. It now reads named columns from one Postgres row.

Six nodes read this Set, but **only two of its fields are consumed anywhere**:

| field | consumed by |
|---|---|
| `bison_api_key` | `Bison - Get Tags List`, `Attach Classification Tag`, `Get Lead Data`, `Get Thread Replies`, `Forward Reply Notification` |
| `email_recipients_csv` | `New Reply In Interested Thread?`, `Forward Reply Notification` |
| `client_spreadsheet_id` | **nothing** — computed and discarded |
| `sms_recipients_csv` | **nothing** — computed and discarded |

## Migration to Supabase — **done 2026-08-17**

`[S] Resolve workspace config` (one Postgres node) replaced **four**: the Sheets read, the "is it a
401?" branch, the Make.com scenario that branch called, and the `stopAndError` for every other Sheets
failure. Two external systems collapsed into one table read.

```
Category Is Not NRR? ──yes──▶ [S] Resolve workspace config ──▶ Sheets API - config.getWorkspaceConfig
                                (client_sequencers + clients)     (same node, same name, named columns)
```

Verified on live traffic, not asserted — real replies for two different clients within minutes of the
deploy:

```
77400  RevOpsi      cfg=ok  src=supabase  key=present  → New Reply In Interested Thread?
77402  Kaizen rent  cfg=ok  src=supabase  key=present  → New Reply In Interested Thread?
```

Same terminal node as before, so the Bison calls downstream still authenticate.

Two deliberate choices worth knowing:

- **The Set keeps its misleading name.** Six nodes address it as
  `$('Sheets API - config.getWorkspaceConfig')`, and `n8n:deploy` cannot rename a node (`--nodes`
  matches by name), so renaming means rewriting six expressions. Its `notes` field says what really
  feeds it. The positional indexing inside it is gone — it reads named columns now.
- **The four old nodes stay in the graph, orphaned.** They are the rollback: re-pointing
  `Category Is Not NRR?` back at the Sheets node is a one-flag revert.

**Recipient lists were not compared with the sheet, on purpose.** Owner decision 2026-08-17: Supabase
is the source of truth, so a client whose forwarded replies now reach a different address is the new
truth rather than a regression. Coverage was the gate; content was not.

### What it was before

**Phase 0 — Sheets was the only config source.** The workflow would have stopped working the moment
CS PDCA was disconnected, and its only fallback was a Make.com scenario — a second external system
doing the same lookup.

Both fields that matter already exist in Supabase, and coverage is complete. Measured 2026-08-17 over
the 400 most recent executions — 15 distinct workspaces, every one of them resolved:

| sheet dependency | Supabase counterpart | state |
|---|---|---|
| CS PDCA `col_6` (Bison API key) | `client_sequencers.api_key` | **15/15**, all `enabled` |
| CS PDCA `Email Recipients` | `clients.notification_emails` | **15/15** have at least one entry |
| CS PDCA `Spreadsheet ID`, `SMS Recipients` | — | not needed; nothing reads them |
| Make.com 401 fallback | — | disappears with the Sheets read |



## Known defects

### 1. A live OpenAI key sat in the graph — **removed 2026-08-17; ROTATION STILL OWED**

`OpenAI - Classify Email` authenticated with a literal `Bearer sk-proj-…` typed into a header. This
is why the workflow could not be adopted before: `pnpm n8n:export` refuses to write an artifact that
trips the secret scanner, so it could not be brought under repository control at all — and therefore
could not be bound to the failure recorder either.

Fixed by pointing the node at the **existing** `OpenAi account` credential —
`authentication: predefinedCredentialType` + `nodeCredentialType: openAiApi`, the same shape
`aimfox-classification` got in July ([security.md finding 8](../../../../docs/reference/n8n/security.md)).
No new credential and no secret were needed: `--credentials-from
"OpenAI - Classify Email=aimfox-classification:OpenAI - Classify Email"` copies a credential block off
a live node of the same type in another managed workflow. The live scan no longer reports
`secret/openai-key`.

**The key still has to be rotated in OpenAI.** Moving it out of the graph does not un-leak it —
assume it is compromised. That is an owner action. Tracked as
[E6](../../../../docs/reference/n8n/defect-backlog.md#e6) / security finding 12.

### 2. The webhook is unauthenticated — **open**

Anyone who knows the path can post a reply payload and cause a classification, an OpenAI spend and a
tag attach. Tracked as [E2](../../../../docs/reference/n8n/defect-backlog.md#e2).

### 3. NRR is suppressed on purpose — not a defect, a decision

`Category Is Not NRR?` routes an NRR classification straight to `Respond - Skipped`, so no tag is
attached, so `[child-2]` can never fire. The owner decided on 2026-08-15 not to revive the email NRR
path. Full diagnosis: [C1](../../../../docs/reference/n8n/defect-backlog.md#c1).

Note the consequence, which is not obvious from this graph: a `replies` row is only ever written by a
*child*, and a child only runs if a *tag* was attached. So for the email channel, `NRR`, `other`,
`Left_Company` and `Spam_Inbound` are classified on every reply and then discarded — EmailBison
persists only `OOO` and `Interested`. Making this workflow record its own classification, tag or no
tag, is still open.

### 4. `pinData` is committed on the instance — **open**

Production payloads pinned on the webhook node. The export sanitiser strips it, so it is not in this
artifact, but it is still on the instance.

### 5. No `errorWorkflow` — **fixed 2026-08-17**

Bound to `[ERR] Automation failure recorder` (`Pmz0JjRRuJNdNpSE`) once adoption made it possible, and
read back after the write.

## Manual verification

1. `pnpm n8n:check-drift --id bison-replies-classification` — 0 drifted.
2. Watch one live execution end to end and confirm `[S] Resolve workspace config` returns a row and
   `source` is `supabase`. Reply traffic is frequent enough that this takes a couple of minutes.
3. `pnpm n8n:health --days 7` — the failure ratio was 2/2242 before these changes; it should not move.
