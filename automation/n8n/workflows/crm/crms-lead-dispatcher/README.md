# `[HUB] CRMs Add/Update Lead Dispatcher`

Remote `mfmMYQqK73Nsx6uO` · imported 2026-08-28 · **the only path a positive-reply lead takes into a
client's own CRM.**

## What it does

`[child-1]` (Bison) and `AimFox Leads Processing` call it once per positive-reply lead. It normalises
the lead, resolves the client's CRM configuration, and hands `{ lead, crm }` to one of five
per-provider children.

```
When Called ─▶ Normalize Input ─▶ Resolve CRM connection ─▶ Build { lead, crm } ─▶ Route by CRM type
                                  (Postgres, one RPC)                                     │
      ┌───────────┬────────────┬─────────────┬─────────────┬────────────────────┬─────────┘
   Hubspot    Pipedrive      Zoho      Salesforce     LiveSpace     Unroutable — record and fail
```

Four nodes from the old path — `Lookup CRM Config`, `Get row(s)`, `Merge`, `Aggregate` — are still
present on the instance but have **no incoming edge**, so they never run. They are left there on
purpose: reverting is a one-edge change, and the deploy tool deliberately cannot delete nodes.

The identity carried through the whole chain is the **Bison `workspace_id`** — the same value
`client_sequencers.external_workspace_id` holds (ADR-0012).

## What each child actually consumes

Measured from the five graphs on 2026-08-28, not from the payload the hub happens to build:

| Child | Reads |
|---|---|
| HubSpot | `crm.api_token` |
| Pipedrive | `crm.api_key` |
| Zoho | `crm.client_id`, `crm.client_secret`, `crm.refresh_token`, `crm.domain` |
| Salesforce | `crm.client_id`, `crm.client_secret`, `crm.refresh_token`, **`crm.login_url`** |
| LiveSpace | `crm.api_key`, **`crm.salt`**, **`crm.subdomain`** |

The bolded three are the ones the current sources cannot supply — see below.

## Known defects

Full write-ups: [defect-backlog §G](../../../../../docs/reference/n8n/defect-backlog.md).

1. ~~**`Route by CRM type` has no fallback output**~~ — **fixed 2026-08-28**
   ([G1](../../../../../docs/reference/n8n/defect-backlog.md#g1)). It now has a sixth output wired to
   `Unroutable — record and fail`, so an empty or unrecognised `crm.type` fails the execution with a
   message naming the workspace, the email and what the RPC returned, instead of being discarded.
2. **TouchlessFreaks (ws 77) has never dispatched** ([G2](../../../../../docs/reference/n8n/defect-backlog.md#g2)).
   It has a full Salesforce OAuth set in the data table and **no row in the sheet**. `Lookup CRM
   Config` runs first and returns zero items, so the branch ends before `Get row(s)` is reached.
3. **The hub cannot see a child fail** ([G3](../../../../../docs/reference/n8n/defect-backlog.md#g3)).
   All five `Execute child-crm-*` nodes set `waitForSubWorkflow: false`.
4. ~~**LiveSpace gets neither `salt` nor `subdomain`**~~ — **fixed 2026-08-28.** ([G4](../../../../../docs/reference/n8n/defect-backlog.md#g4)).
   The Code node reads `sheetRow['Salt']` and `sheetRow['Subdomain']`. The sheet **has no `Salt`
   column at all**, and its `Subdomain` column is empty for both LiveSpace rows — the host-looking
   values sit in a trailing column with no header, which the Code node cannot address. Both LiveSpace
   clients therefore dispatch with two of their three required fields blank. **The rewire fixes this**:
   the values are seeded under their consumed names, resolved by reading how the child uses them
   (`subdomain` is interpolated into the host, `salt` feeds `sha1(api_key + token + salt)`).

`crm.login_url` was briefly recorded as a fifth defect and is **not** one — see
[G5](../../../../../docs/reference/n8n/defect-backlog.md#g5). The Salesforce child defaults it to
`https://login.salesforce.com`, which is correct for a production org.

## Migration (ADR-0019)

**Done 2026-08-28.** The Postgres side is live — `public.client_crm_connections`, the four RPCs, and
**all nine connections seeded**: HubSpot ×2, Pipedrive ×3, Zoho ×1, LiveSpace ×2 (enabled), Salesforce
×1 (ws 77, parked at `enabled = false` / `status = 'pending'` at the owner's direction). Every enabled
one resolves through `resolve_crm_connection`; ws 77 correctly resolves to NULL.

The rewire replaced `Lookup CRM Config` + `Get row(s)` + `Merge` + `Aggregate` + the 80-line
expression inside `Build { lead, crm } payload` with **one** Postgres call:

```sql
select public.resolve_crm_connection('emailbison', $json.lead.workspace_id);
```

It returns the same object key for key, so the cutover is verified as a field-by-field diff rather
than by waiting for traffic — the hub only fires on a positive reply, which is rare enough that a
dual-read window would take months to prove anything.

`Route by CRM type` gained its fallback output in the same change — moving the data without fixing
defect 1 would only have moved the silence.

**What is proven and what is not.** The RPC's output was verified equal to the Code node's, key for
key, on a local restore and read-only across all nine live workspace ids; the deployed graph was
re-exported and checked (11 nodes reachable, 4 dead, credential bound, `active=true`, drift 0). It has
**not** yet been exercised by a real positive reply — that is the remaining proof, and it will arrive
on its own the next time a client answers.

## What is still owed

- `docs/reference/processes/crm/lead-handoff.md` — there is no process document for CRM hand-off; the
  manifest points at `11-integrations.md` in its place.
- Binding this workflow (and the five children) to `[ERR] Automation failure recorder`
  ([E1](../../../../../docs/reference/n8n/defect-backlog.md#e1)).
