# aimfox-campaign-sync

**Logical ID:** `aimfox-campaign-sync` · **Domain:** `ingestion` · **Criticality:** high
**Remote (production):** `t6a53dLc85FOKFqX` — `Aimfox campaign sync`
**Business process:** [LinkedIn outreach (Aimfox)](../../../../../docs/reference/processes/outreach/linkedin-aimfox.md)
**Phase:** **C** — Supabase-only by construction (campaign records never lived in Sheets)

## Why it exists

The LinkedIn channel had **zero `campaigns` rows**. Every Bison campaign is catalogued by
[`bison-campaign-sync`](../bison-campaign-sync/README.md); nothing did the same for Aimfox. The
consequence: `promote_contact_to_lead` had no Aimfox campaign to resolve a `campaign_id` against, so
the 30 back-filled Aimfox leads all carry `campaign_id = NULL`. This workflow is the catalog — the
LinkedIn analogue of `bison-campaign-sync`, mirroring it node for node.

Created **inactive** 2026-07-22 (via `POST /workflows`, no `active` flag — the deploy-inspect-publish
path), because there is no development instance to test against
([environments.md](../../../../../docs/reference/n8n/environments.md)).

## Flow

```
Schedule (hourly :45) ─ Aimfox Clients (client_sequencers, enabled, keyed)
   └─ Split in Batches ─ per client:
        Fetch Campaigns  GET https://api.aimfox.com/api/v2/campaigns (bearer = that client's api_key)
        Transform        build one multi-row UPSERT
        Upsert Campaigns run it → back to Split in Batches
```

`:45` offsets it from `bison-campaign-sync` at `:15`. The bearer is built from
`client_sequencers.api_key` in an expression, so **no vendor credential is bound** to the HTTP node —
only the Postgres account credential, on the two Postgres nodes.

## The upsert, and the one rule that matters

```sql
INSERT INTO public.campaigns
  (client_id, external_id, sequencer_id, type, name, status, database_size, start_date)
VALUES (…)
ON CONFLICT (external_id) DO UPDATE SET
  name = EXCLUDED.name, status = EXCLUDED.status,
  database_size = EXCLUDED.database_size, updated_at = NOW();
```

- `external_id` = the Aimfox campaign **UUID** (globally unique; no collision with Bison's integer ids).
- `sequencer_id` = the **aimfox** sequencer (`…0003`) and `type` = `outreach` are set on **INSERT only**
  — they are deliberately **absent from the UPDATE clause**. This is the exact discipline
  `bison-campaign-sync` uses to protect its `ooo_followup` reclassification: a later run must never
  silently retype an Aimfox campaign to `emailbison`/`email`. Proven in a rolled-back transaction
  (`sequencer_id`/`type` preserved on conflict while `name`/`status`/`database_size` updated).
- `status` maps from the Aimfox campaign `state`: **`ACTIVE→active`, `DONE→completed`**, with
  `PAUSED`/`STOPPED→stopped`, `DRAFT→draft` added defensively and **any unrecognised state → `draft`**.
  Only `ACTIVE` and `DONE` were observed across recent live runs; because `status` *is* in the UPDATE
  clause, a state seen for the first time self-heals on the next run once mapped.
- `database_size` = the campaign's `target_count` (audience size). `positive_responses` is **not
  written** — the Aimfox campaign list carries no such field, so the column keeps its `0` default
  rather than being reset to a guess every run.
- `start_date` = `created_at` (Aimfox gives epoch **milliseconds**, converted to a date; `null` → NULL).

## ADR-0003 consequence — clients will see these

`type = 'outreach'` means client users see these campaigns in their campaign list and campaign stats
([ADR-0003](../../../../../docs/adr/0003-client-campaign-visibility.md); enforced in RLS and
`scopeCampaigns`). That is intended — LinkedIn is a real acquisition channel — and was confirmed as a
product decision. The enum has no "internal outreach" value, so the choice was `outreach` (correct
label, client-visible) or not building the catalog at all.

## Divergences from bison-campaign-sync, on purpose

| bison-campaign-sync | here | why |
|---|---|---|
| filters `clients.status = 'Active'` | no status filter | mirrors `[S] Aimfox clients`, the authoritative reader; a catalog should reflect every keyed workspace |
| paginates (`links.next`) | no pagination | Aimfox `GET /campaigns` is unpaginated — `aimfox-daily-metrics`'s `[S] Campaigns` reads it the same way. **Limitation:** a client with more campaigns than one page returns would be undercounted; revisit if that appears |
| writes `positive_responses` | omits it | no source field in the Aimfox campaign list |
| no `sequencer_id` (emailbison default) | `sequencer_id = aimfox`, INSERT-only | the default is emailbison; a LinkedIn campaign typed as email corrupts per-channel metrics |

## What this does NOT do

**It does not attribute `leads.campaign_id`.** The preMQL lead-creation event (`aimfox-premql-to-pdca`)
carries no campaign reference anywhere — only the reply/classification webhook does. Bridging the
campaign from reply to lead is a separate, unresolved design decision (task B in
[aimfox-phase-a.md](../../../../../docs/reference/n8n/aimfox-phase-a.md)). This workflow only builds the
catalog so a `campaign_id` *can* be resolved when a design for that lands.

## Verification

```bash
pnpm n8n:validate
pnpm n8n:check-drift --id aimfox-campaign-sync
```

```sql
-- aimfox campaign rows after a run
select c.external_id, c.name, c.status, c.database_size, c.start_date
from public.campaigns c
join public.sequencers s on s.id = c.sequencer_id and s.key = 'aimfox'
order by c.updated_at desc;
```

Safe to run: it only reads the Aimfox API and UPSERTs `campaigns`. First live run happens on the next
`:45` after activation — watch it for per-client coverage (the split-loop "processed 15 of 42" trap:
confirm every keyed client was looped, not just the first).
