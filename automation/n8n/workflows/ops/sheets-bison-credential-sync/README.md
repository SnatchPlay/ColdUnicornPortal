# sheets-bison-credential-sync

**Logical ID:** `sheets-bison-credential-sync` · **Domain:** `ops` · **Criticality:** high
**Remote (production):** `Hzar4pwdAXrDHAwn` — `[CRED] CS PDCA → client_sequencers · Bison keys`
**Trigger:** every 6 hours

> **Live since 2026-07-22.** First run created 3 rows and lifted Bison credential coverage from
> 35 to 39 of the 42 workspaces CS PDCA lists.

## Why it exists

[ADR-0012](../../../../../docs/adr/0012-multi-sequencer-model.md) has placed per-client vendor
credentials in `client_sequencers` since the sequencer model landed. The workflows never followed it:
every Bison call in the estate read its bearer token from the **CS PDCA spreadsheet, column `col_6`**
— which is [security finding 1](../../../../../docs/reference/n8n/security.md), and which meant the
whole lead pipeline would die the moment Google Sheets was disconnected.

Repointing `bison-lead-enrichment` at `client_sequencers`
([README](../../outreach/bison-lead-enrichment/README.md#the-sheets-dependency-and-how-it-was-cut-2026-07-22))
only works if the data is actually there. This keeps it there.

## What it does

```
Every 6 hours ─ Read CS PDCA ─ Collect Credentials ─ Sync client_sequencers
```

| Case | Matched on | Action |
|---|---|---|
| Row already exists | `external_workspace_id` | refresh `api_key` **only when it differs** |
| No row, client name matches exactly | `lower(btrim(clients.name))` | insert a keyed, enabled row |
| No row, no matching client | — | **reported in `unmatched`, never guessed** |

Keys never leave n8n: the sheet read feeds a Code node that emits a JSON payload straight into the
Postgres node in the same execution.

**Names are never used to match an existing row.** A workspace id is stable; a client name is edited
in a spreadsheet. Name matching is used only to create a row that does not exist yet, and only on an
exact case-insensitive match — `RedIntoGreen DAPR` in the sheet does *not* silently claim the client
called `DAPR`.

## Coverage as of 2026-07-22

CS PDCA lists **42** Bison workspaces. **35** have a keyed `client_sequencers` row. The other seven
are all `Onboarding`:

| Workspace | Sheet name | Client row in Supabase |
|---|---|---|
| 138 | OliveMedia | `oLIVEmedia` — exact match, will be created |
| 136 | OliveMedia TTS | `oLIVEmedia TTS` — exact match, will be created |
| 139 | Komandor | `Komandor` — exact match, will be created |
| 149 | RedIntoGreen DAPR | `DAPR` — **name differs**, will be reported |
| 131 | SalesBook | **none** |
| 137 | Tryumf | **none** |
| 150 | Kamiński | **none** |

So one run should produce `rows_created = 3` and leave four unmatched. **SalesBook, Tryumf and
Kamiński need a `clients` row before automation can serve them at all** — that is a business act, not
something this workflow may invent.

## Proven

The SQL was first exercised against production in a rolled-back transaction with a three-row payload
covering all three branches — an existing workspace whose key differs, a new workspace whose name
matches, and a new workspace whose name does not:

```
sheet_clients=3  keys_refreshed=1  rows_created=1  unmatched="150:Kamiński"
```

The live run (execution 50229) then produced:

```
sheet_clients=42  keys_refreshed=0  rows_created=3
unmatched="131:SalesBook, 137:Tryumf, 149:RedIntoGreen DAPR, 150:Kamiński"
```

**`keys_refreshed=0` is the useful number.** It says every one of the 35 pre-existing rows already
carried exactly the key the sheet holds — so the repoint in `bison-lead-enrichment` did not silently
change which credential any client authenticates with.

Re-check with:

```sql
select count(*) filter (where coalesce(cs.api_key,'') <> '') as keyed, count(*) as rows
from public.client_sequencers cs
join public.sequencers s on s.id = cs.sequencer_id and s.key = 'emailbison';
-- 35 / 35 before the first run; 39 / 39 after it
```

## Note on scope

This syncs **Bison** keys. The Aimfox equivalent was seeded once by hand on 2026-07-22 (5 clients,
[aimfox-phase-a](../../../../../docs/reference/n8n/aimfox-phase-a.md)) and has no sync yet.
