# bison-campaign-sync

**Logical ID:** `bison-campaign-sync` · **Domain:** `ingestion` · **Criticality:** high
**Remote (production):** `UXpSOrgsN2TxjXUu` — `Bison campaign sync`
**Business process:** [Bison ingestion](../../../../../docs/reference/processes/outreach/bison-ingestion.md)
**Phase:** C — Supabase only. Imported 2026-07-22, in the same change that repaired it.

## Business purpose

Hourly, mirror every client's Bison campaigns into `campaigns` — the table most of the portal joins
against.

## Flow

```
Schedule (hourly) ─ Get Active Clients (client_sequencers, emailbison)
                    └─ per client: GET /campaigns (paginated)
                       └─ Transform → one INSERT … ON CONFLICT (external_id) DO UPDATE
```

## The rule that must not be "fixed"

`ON CONFLICT DO UPDATE` sets `name`, `status`, `database_size`, `positive_responses` — and
deliberately **not `type`**. Campaign classification is ours, not Bison's: adding `type` to the
UPDATE would overwrite the 52 campaigns
[`20260722g`](../../../../../supabase/migrations/20260722g_ooo_campaigns_and_routing_seed.sql)
reclassified as `ooo_followup`, putting OOO follow-up campaigns back into client-visible metrics
([ADR-0003](../../../../../docs/adr/0003-client-campaign-visibility.md)).

Verified on the 2026-07-22 run: 390 campaigns upserted, all 52 classifications intact.

## Classifying an OOO follow-up campaign

`type` is decided at INSERT, and since 2026-08-14 the OOO follow-up campaigns are decided **by
name** before `typeMap` is consulted at all.

They have to be, because the vendor's own `type` never identified them and `typeMap` could not
produce `ooo_followup` under any input — the string did not appear in this workflow. Every OOO
campaign was therefore ingested misclassified, one of two ways:

| Vendor `type` | Landed as | Consequence |
|---|---|---|
| `reply_followup` | `nurture` | invisible to the OOO routing editor, which requires `type = 'ooo_followup'` ([orm-gateway/index.ts:3325](../../../../../supabase/functions/orm-gateway/index.ts#L3325)) |
| `outbound`, or anything unmapped | **`outreach`** | the one type clients can see |

The second is not hypothetical. **25** OOO campaigns were typed `outreach`, so nine clients could
see their own OOO follow-ups and their `campaign_daily_stats` counted toward client-facing metrics
— [ooo-phase-a.md](../../../../../docs/reference/n8n/ooo-phase-a.md). `20260722g` repaired those 52
rows by hand, by `external_id`; nothing stopped the next one arriving the same way.

**The name list is measured, not guessed.** It is the 7 distinct names carrying an OOO campaign in
production on 2026-08-12, and on that data the rule is exact in both directions: 52 of 52 rows whose
name mentions OOO are `ooo_followup`, and no `ooo_followup` row has a name that does not. The
`OOO campaign automation` spelling is the older one `20260722g` could only catch by id — it is in
the list precisely so a re-ingested row is not classified worse than the migration managed.

Matching is **exact**, like `bison-workspace-setup`'s, so `OOO automation | general v2` and a
lowercase variant stay `outreach`. Only surrounding whitespace is trimmed.

**No backfill is needed and none is implied.** The change is insert-time only, and zero OOO
campaigns are currently misclassified — the migration got all of them.

This also protects what [`bison-workspace-setup`](../../ops/bison-workspace-setup/README.md) seeds:
that workflow writes the row itself, typed `ooo_followup`, at the moment it creates the campaign at
the vendor. The two agree, and the `ON CONFLICT` clause keeps either from undoing the other.

**Still open** (out of scope for that change, and listed below): the `|| 'outreach'` fallback is
still the wrong default for a *non*-OOO campaign of an unrecognised type.

## Known defects

| # | Defect | Consequence |
|---|---|---|
| 1 | the upsert SQL is **built by string concatenation** in a Code node | escaping is one hand-rolled `replace(/'/g, "''")`, applied to `name` only; `c.id` and `c.created_at` are interpolated raw. A parameterised query would remove the class of risk entirely |
| 2 | the Bison fetch continues on error | one client's failure is skipped silently; nothing records which. A revoked key yields zero campaigns, which is indistinguishable from a client that has none — the run reports success either way |
| 3 | no `integration_sync_runs` row | this workflow failed **every run for days** and nothing noticed — see the incident in the process doc |
| 4 | `typeMap[c.type] \|\| 'outreach'` — the fallback is the **client-visible** type | an unrecognised Bison campaign type is exposed to the client by default. `statusMap` falls back to `draft`, the conservative direction; this one falls the other way. OOO campaigns no longer depend on it (they match by name first), so this is now about everything else. `nurture` is the right default |
| 5 | `positive_responses` is overwritten hourly from `c.interested` | the metrics catalogue calls it a user-editable lifetime counter and the gateway accepts a patch for it ([orm-gateway/index.ts:397](../../../../../supabase/functions/orm-gateway/index.ts#L397)), so an edit made in the portal survives at most one hour |
| 6 | `Upsert Campaigns` has no `onError` and closes the loop back to `Split in Batches` | a SQL error on one client stops the remaining clients being synced in that run |
| 7 | no removal path | a campaign deleted at the vendor keeps its row and its last status forever — this is how Bent Iron PL showed six OOO campaigns where workspace 73 has three |

## History

**2026-08-14 — OOO campaigns are classified on the way in.** Until this change `ooo_followup` was
not a value this workflow could produce, so every OOO campaign arrived misclassified and stayed that
way (`type` is INSERT-only). The repair is a name list checked before `typeMap`, measured against
the 7 names in production. Proven by running the real Code node offline — 3 vendor types × 7 names
all classify, lookalikes do not — and by executing its generated SQL against Postgres twice: a
campaign that arrived as `outbound` was still stored `ooo_followup`, and a second pass moved
`status` and both counters while leaving `type` untouched.

**2026-07-22 — repaired.** `Get Active Clients` still selected `clients.external_api_key`, a column
[`20260704b`](../../../../../supabase/migrations/20260704b_drop_client_sequencer_credentials.sql)
had dropped, so all 12 of the last 12 runs failed. Repointed at `client_sequencers` with the result
column names preserved, so nothing downstream changed. Verified by execution: 16 clients, 390
campaigns.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id bison-campaign-sync
```

```sql
select count(*), max(updated_at) from public.campaigns;
```
