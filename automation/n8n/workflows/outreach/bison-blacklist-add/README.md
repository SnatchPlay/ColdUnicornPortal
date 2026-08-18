# `bison-blacklist-add` — `[child-4] TAG_ATTACHED · Blacklist add (email + domain)`

Remote: `bEB3aOHEq2lEpubp` (production, **active**). Imported 2026-08-15.

## Purpose

When a Bison reply is tagged `Interested`, `Not Interested`, `PreMQL` or `preMQL`, add the sender's
**email** and their **domain** to that client's Bison blacklist, then write both blacklist ids back
to the client's `Leads` sheet.

Blacklisting is irreversible for that client, which is why criticality is high: a wrong entry
silently removes a company from all future outreach.

## Inputs

Called as a sub-workflow by `[HUB] Bison Replies Dispatcher` (`xPzdtWQiY3lGtqI1`) when its
`fire_child_4` flag is true. The HUB's payload contract is reverse-engineered in
[`../ooo-detect-and-log/contracts/hub-child-input.schema.json`](../ooo-detect-and-log/contracts/hub-child-input.schema.json)
and enforced by nothing at runtime.

## Flow

```
When Called by HUB
 └─▶ [110] Find workspace in CS PDCA         (Sheets — col_4 = Leads sheet id, col_6 = Bison key)
      └─▶ [111] Bison: GET /leads/{taggable_id}
           ├─▶ [113] POST /blacklisted-emails        (y=208 — RUNS FIRST)
           │    └─▶ tag != Not Interested (email path)
           │         └─▶ [156] Find lead in Leads sheet (by email)
           │              └─▶ [157] Update Leads col "Blacklist ID"
           └─▶ [292] Check if domain is public       (y=400 — RUNS SECOND)
                └─▶ Domain NOT in exclude list?
                     └─▶ [294] POST /blacklisted-domains
                          └─▶ tag != Not Interested (domain path)
                               └─▶ [296] Find lead in Leads sheet (domain path)
                                    └─▶ [298] Update Leads col "Domain Blacklist ID"
```

The two limbs fan out from `[111]`. n8n (`executionOrder: v1`) runs them top-to-bottom by
Y-position, so the **email limb always runs first** — which is what makes defect 1 below so costly.

## Outputs

- Bison: `POST /blacklisted-emails`, `POST /blacklisted-domains`.
- Google Sheets `<client>/Leads`: `Blacklist ID`, `Domain Blacklist ID`.
- **Nothing in Supabase.** This workflow has no Postgres node at all.

## Known defects

### 1. A benign 422 aborts the run before the domain is blacklisted — **fixed 2026-08-15**

`[113] Bison: POST /blacklisted-emails` returns
`422 {"message":"The email has already been taken."}` when the address is already blacklisted. The
node carries no `onError`, so the execution dies there.

Measured over the 16 days to 2026-08-15: **211 failures in 337 runs (63%)**. In every one of them
the domain limb (`y=400`) never ran and neither blacklist id reached the sheet.

**Fixed 2026-08-15**: `onError: continueRegularOutput` on `[113]`, deployed with
`pnpm n8n:deploy --id bison-blacklist-add --node-settings "[113] Bison: POST /blacklisted-emails" --apply`.
Drift back to 0.

**And the fix moved the failure one node down — found 2026-08-18.** With `[113]` absorbing its 422,
execution now reaches `[294] Bison: POST /blacklisted-domais (sic)`, which throws the *same* benign
422 — `"The domain has already been taken."` — and had no `onError` of its own. So the domain did get
blacklisted, but the run still died before `[296]`/`[298]` wrote either id back to the sheet. Five
such executions on 2026-08-17 alone, all with the same last node.

Fixed the same way: `onError: continueRegularOutput` on `[294]`. This is the second half of the same
defect, and it is only visible because the first half was fixed — worth remembering as a shape:
absorbing an error at one node can simply relocate the abort to the next one that shares the cause.

Still worth doing: the 422 is *absorbed*, not *distinguished*, at both nodes — a genuine POST failure
reads the same as "already blacklisted". Branching on the status code would separate them. Tracked as
B2 in [defect-backlog.md](../../../../docs/reference/n8n/defect-backlog.md).

### 2. Failures are reported nowhere — **fixed 2026-08-15**

`settings.errorWorkflow` was unset. This is why a 63% failure rate ran for weeks unnoticed.

Bound to `[ERR] Automation failure recorder` (`Pmz0JjRRuJNdNpSE`) with
`pnpm n8n:deploy --id bison-blacklist-add --settings --apply`, and read back after the write.
Two things had to be built first: `--settings` was only a modifier and could not be used on its own,
and `check-drift` did not compare workflow settings at all — so this binding could have been removed
in the UI and CI would still have said `0 drifted`. Both fixed; see [E1](../../../../docs/reference/n8n/defect-backlog.md#e1).

### 3. No retries — **open, medium**

No node sets `retryOnFail`. `[110] Find workspace in CS PDCA` intermittently returns `ECONNRESET`,
and each occurrence is a lost run. Note the ordering constraint from
`business/retry-without-idempotency`: the manifest must declare an idempotency key before any write
node may retry — it does, so this is unblocked.

### 4. The name says `blacklisted-domais` — cosmetic

`[294] Bison: POST /blacklisted-domais (sic)`. The URL is correct
(`/blacklisted-domains`); only the node name is misspelled. Renaming a node is not something
`n8n:deploy` can do (`--nodes` matches by name), so it stays until someone edits it in the UI and
re-exports.

## Migration

**Phase 0 — Sheets is the only source.** All three Bison calls authenticate from CS PDCA `col_6`,
so this workflow stops working entirely the moment the spreadsheet is disconnected. That is the
whole reason it is in scope for the Supabase cutover (§5.1 of the plan).

Every dependency already has a Supabase counterpart:

| Sheet dependency | Supabase counterpart | State |
|---|---|---|
| CS PDCA `col_6` (Bison key), `col_4` (Leads sheet id) | `client_sequencers.api_key`, `.external_workspace_id` | ready — 45/45 EmailBison rows populated |
| `🤖Emails Exclude List` | `public.email_exclude_list` | exists, 161 rows — but **every row was created 2026-04-21** and nothing has updated it since. Diff against the sheet before switching. |
| `Leads` sheet blacklist columns | `leads.external_blacklist_id`, `leads.external_domain_blacklist_id` | columns exist; the first is populated on 2988 of 5356 leads (historic import), the second on **zero** — nothing has ever written it |

Writing `leads` from n8n needs a new `SECURITY DEFINER` RPC: the table is RPC-owned and a direct
write is a `business/direct-table-write` **error** (ADR-0015 §5).

## Observability

Failed executions are visible only in the n8n execution list, or via
`pnpm n8n:health --days 16`, which is how this workflow's failure rate was found.

## Manual verification

1. `pnpm n8n:health --days 7` — the failure ratio for `bEB3aOHEq2lEpubp`.
2. After the B2 fix, re-run it: the ratio should collapse, and executions that previously died at
   `[113]` should now continue through `[294]`.
3. Confirm the domain limb actually ran by checking that `Domain Blacklist ID` starts being written
   in the client's `Leads` sheet — before the fix it effectively never was.
