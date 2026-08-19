# 03 · Data Model

Authoritative source: [`supabase/drizzle/schema.ts`](../../../supabase/drizzle/schema.ts), regenerated with `pnpm db:introspect` against the live project. RLS is applied via `pgPolicy(...)` declarations and supplemented by SQL in [`supabase/migrations/*`](../../../supabase/migrations) and [`docs/reference/supabase-production-rls.sql`](../supabase-production-rls.sql).

> **The same `schema.ts` is imported by the `orm-gateway` edge function** (`import * as schema from "../../drizzle/schema.ts"`, [index.ts:5](../../../supabase/functions/orm-gateway/index.ts#L5)). A stale introspection therefore breaks the server, not just the types. Three customization tables are *not* in `schema.ts` and are handled with raw SQL — see [§2.8](#28-customization-tables--not-in-schemats).

## Contents

1. [Enums](#1-enums)
2. [Tables by domain](#2-tables-by-domain)
3. [Views](#3-views)
4. [Private helper functions (RLS predicates)](#4-private-helper-functions-rls-predicates)
4a. [Public functions (anon-callable)](#4a-public-functions-anon-callable)
5. [Migrations of note](#5-migrations-of-note)
6. [Integrity rules](#6-integrity-rules-observed)

---

## 1. Enums

All `CREATE TYPE ... AS ENUM` definitions, [schema.ts:4-12](../../../supabase/drizzle/schema.ts#L4-L12):

| Enum | Values |
|------|--------|
| `campaign_status` | `draft`, `launching`, `active`, `stopped`, `completed` |
| `campaign_type` | `outreach`, `ooo`, `nurture`, `ooo_followup` |
| `client_status` | `Active`, `Subscription`, `On hold`, `Offboarding`, `Inactive`, `Onboarding` (enum label order; **display** order is the `CLIENT_STATUSES` tuple: Onboarding, Active, On hold, Offboarding, Inactive, Subscription) |
| `crm_pipeline_stage` | `new`, `contacted`, `qualified`, `proposal`, `negotiation`, `won`, `lost` |
| `domain_status` | `active`, `warmup`, `blocked`, `retired` |
| `lead_gender` | `male`, `female` |
| `lead_qualification` | `preMQL`, `MQL`, `meeting_scheduled`, `meeting_held`, `offer_sent`, `won`, `rejected`, `OOO`, `NRR` — `OOO`/`NRR` are LEGACY and removed by the deferred `20260722z` (ADR-0015) |
| `reply_classification` | `OOO`, `Interested`, `NRR`, `Left_Company`, `Spam_Inbound`, `other`, `negative`, `neutral` (last two added by `20260722b`) |
| `user_role` | `super_admin`, `admin`, **`master_admin`**, `manager`, `client` |
| `meeting_type` | `intro`, `summary`, `general` — Lead CRM (ADR-0013) |
| `meeting_status` | `planned`, `scheduled`, `held`, `cancelled`, `no_show` — Lead CRM |
| `offer_status` | `planned`, `sent`, `accepted`, `rejected`, `cancelled` — Lead CRM |
| `task_status` | `planned`, `in_progress`, `completed`, `cancelled`, `skipped` — Lead CRM |
| `ooo_followup_status` | `pending`, `processing`, `submitted`, `confirmed`, `failed`, `skipped`, `cancelled` — ADR-0015. `submitted`/`confirmed` are **not** "active" |
| `ooo_routing_source` | `automatic`, `manual_override` — ADR-0015 |

Notes:

- **`master_admin` is a real enum value** — added by [`20260520_master_admin_role.sql`](../../../supabase/migrations/20260520_master_admin_role.sql) (ADR-0005) and present in [schema.ts:12](../../../supabase/drizzle/schema.ts#L12). It is admin-tier in `private.is_admin_user()` / `is_internal_user()` / `can_access_client()` / `can_manage_client()` (migrations `20260520_master_admin_rls.sql`, `20260526_master_admin_private_is_internal_user.sql`, `20260528_fix_insert_policies_master_admin.sql`, `20260616b_can_manage_client_master_admin.sql`). Accounts are seeded manually; there is no UI to mint one.
- `lead_qualification.won` and `leads.won` (boolean column) are separate signals; `getLeadStage()` prefers the boolean ([selectors.ts:70-77](../../../src/app/lib/selectors.ts#L70-L77)). In practice, when a lead becomes `won`, the boolean is set and `qualification` may remain at its last value.
- `client_status` has capitalised literals (`"On hold"`, `"Offboarding"`, `"Subscription"`) — strings pass through to UI verbatim. `Abo`→`Subscription` and `Sales`→`Onboarding` were `ALTER TYPE ... RENAME VALUE` (`20260717_client_satisfaction_and_status_rename.sql`); the label sort order was left as-is (Postgres can't reorder it in place, and nothing sorts by this enum in SQL).
- `crm_pipeline_stage` is used only by `agency_crm_deals` (the agency's own sales funnel), not by lead records.

---

## 2. Tables by domain

### 2.1 Auth & users

#### `users` — [schema.ts:106-125](../../../supabase/drizzle/schema.ts#L106-L125)

Agency-facing user profile. Created on invite acceptance by the `send-invite` edge function.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK, default random | Must equal `auth.users.id` for RLS helpers to work. |
| `created_at` | timestamptz, default `now()` | |
| `email` | text **UNIQUE** not null | |
| `first_name` | text not null | |
| `last_name` | text not null | |
| `updated_at` | timestamptz, default `now()` | |
| `role` | `user_role` not null | |
| `is_active` | boolean not null default true | Soft-deactivate flag (migration `20260618`). `false` → `private.current_app_role()` returns NULL → no role-gated RLS access. |
| `deactivated_at` | timestamptz nullable | Set when deactivated, cleared on reactivate. |
| `deactivated_by` | uuid FK > `users.id` nullable | Audit: who deactivated the account. |
| `avatar_path` | text nullable | Storage object path in the `user-avatars` bucket (migration `20260619`). Convention `avatars/{user_id}/{uuid}.{ext}`. **Stores the path only — never a URL.** The public URL is derived at render via `getAvatarPublicUrl` ([avatar-storage.ts](../../../src/app/lib/avatar-storage.ts)). NULL → UI shows initials. |
| `avatar_updated_at` | timestamptz nullable | Audit: bumped on every avatar change. No cache-busting needed — each upload uses a fresh UUID filename, so the URL always changes. |

RLS:

- `users_select_self` — `auth.uid() = id` (everyone reads their own row).
- `users_select_internal` — visible to internal users (admin/manager) for dropdowns and attribution. The policy body is `to ["authenticated"]` without an explicit `using` in the Drizzle declaration; actual predicate lives in the SQL migration at `docs/reference/supabase-production-rls.sql`.
- `users_update_self` — `auth.uid() = id` for both `using` and `with check`; supports profile-name **and self avatar** updates through `orm-gateway`.

No INSERT/DELETE policies — row creation remains invite/auth-owned. Self-service updates go through `users_update_self`; **admin role changes, deactivation, and avatar edits on other users go through SECURITY DEFINER RPCs** (`admin_update_user_role`, `admin_set_user_active`, `admin_set_user_avatar`) that enforce their own permission checks and bypass the self-only UPDATE policy. See [09-mutations-rls.md](09-mutations-rls.md).

#### `user-avatars` storage bucket — migration [`20260619_user_avatars.sql`](../../../supabase/migrations/20260619_user_avatars.sql)

**Public** Supabase Storage bucket (5 MB limit, `image/jpeg|png|webp`). Holds user profile photos at `avatars/{user_id}/{uuid}.{ext}`. `storage.objects` RLS:

- **read** — any `authenticated` user (also served over the public CDN).
- **insert / update / delete** — only inside the caller's own folder (`(storage.foldername(name))[2] = auth.uid()::text`) **or** `private.is_admin_user()`. No anonymous writes; the app never lists the bucket.

**Why public (not private + signed):** avatars are low-sensitivity face photos with unguessable UUID object names; public read removes per-render signing latency and list-batching complexity. The DB still stores only the path. See the decision-log entry in [BUSINESS_LOGIC.md](../../BUSINESS_LOGIC.md).

#### `client_users` — mapping user > client(s) — [schema.ts:370-397](../../../supabase/drizzle/schema.ts#L370-L397)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `created_at` | timestamptz | |
| `client_id` | uuid FK > `clients.id` ON DELETE CASCADE | |
| `user_id` | uuid FK > `users.id` ON DELETE CASCADE | |

Indexes on both FK columns. Unique on (`client_id`, `user_id`) and on `user_id` alone — each user maps to at most one client (enforces the "client role sees exactly one workspace" invariant from ADR-0001).

RLS:

- `client_users_select_scoped` — admin OR `user_id = auth.uid()` OR (manager AND the user is mapped to a client whose `manager_id = auth.uid()`).
- `client_users_insert_admin` / `update_admin` / `delete_admin` — admin only.

### 2.2 Clients & ops config

#### `clients` — [schema.ts:178-214](../../../supabase/drizzle/schema.ts#L178-L214)

The business entity whose outreach we run.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `created_at` | timestamptz | |
| `name` | text not null | Displayed everywhere a client is named. |
| `manager_id` | uuid FK > `users.id` **nullable** (`20260715_clients_manager_id_nullable.sql`) | Determines manager scoping (`scopeClients`). `null` = Unassigned; may reference an admin, not only a `manager`-role user. |
| `kpi_leads` | smallint | Contract target leads/month (shown in sidebar mini-card & dashboards). |
| `kpi_meetings` | smallint | Contract target meetings/month. |
| `contracted_amount` | numeric | For billing context; not displayed in main UI. |
| `contract_due_date` | date | |
| `status` | `client_status` not null | Drives filters and dashboard "non-active clients" surface (formerly "at-risk"). |
| `min_daily_sent` | smallint default 0 | Shown in `ClientsPage` Overview column "Schedule". |
| `inboxes_count` | smallint default 0 | |
| `crm_config` | jsonb default `{}` | Reserved for per-client CRM integration settings. |
| `sms_phone_numbers` | text[] | Notification targets. |
| `notification_emails` | text[] | Notification targets. |
| `auto_ooo_enabled` | boolean default false | Whether OOO auto-routing is on. |
| `prospects_signed` | integer default 0 | Contracted prospect cap. |
| `prospects_added` | integer default 0 | Actual loaded; fallback source for `getClientKpis.prospects` when `campaigns.database_size` sums to zero. |
| `setup_info` | text | Free-form setup notes. |
| `bi_setup_done` | boolean default false | |
| `lost_reason` | text | |
| `notes` | text | |
| `satisfaction` | smallint `CHECK 1..3`, nullable (`20260717_client_satisfaction_and_status_rename.sql`) | Manual CS rating ("hearts"). NULL = not rated. Replaced the automatic condition-engine health rollup on the Clients grid. |
| `updated_at` | timestamptz | |

> Sequencer credentials (formerly `external_workspace_id` integer UNIQUE, `external_api_key`, `linkedin_api_key`) moved to [`client_sequencers`](#22a-sequencers-adr-0008) on 2026-07-04 (ADR-0008); the columns are dropped by `20260704b_drop_client_sequencer_credentials.sql`.

RLS:

- `clients_select_scoped` — `private.can_access_client(id)`.
- `clients_update_scoped` — **verified live:** `using`/`with check` = `private.can_manage_client(id)` (manager of the client + admin tier).
- `clients_insert_internal` — role ∈ `{super_admin, admin, manager, master_admin}` (set-based subselect on `users`), migration `20260517_entity_insert_policies.sql`.

### 2.2a Sequencers (ADR-0012)

Migrations [`20260704_sequencers_catalog.sql`](../../../supabase/migrations/20260704_sequencers_catalog.sql) + [`20260705_sequencer_daily_stats_schedule.sql`](../../../supabase/migrations/20260705_sequencer_daily_stats_schedule.sql). Fixed catalog UUIDs are load-bearing (column defaults on `campaigns`/`leads` + n8n constants): emailbison `…-a000-000000000002`, aimfox `…-0003`.

#### `sequencers` — global catalog

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK (fixed, seeded) | |
| `key` | text UNIQUE, `^[a-z0-9_]+$` | `emailbison` / `aimfox`. |
| `name` | text not null | Display name. |
| `channel` | text, check `email`/`linkedin` | |
| `enabled` | boolean default true | |
| `created_at` | timestamptz | |

RLS: `sequencers_select_authenticated` (`using true` — 3 rows, no secrets); `sequencers_write_master` (`for all`, master_admin only).

#### `client_sequencers` — per-client connection settings

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `client_id` | uuid FK > `clients.id` on delete cascade, not null | |
| `sequencer_id` | uuid FK > `sequencers.id` on delete restrict, not null | UNIQUE (`client_id`, `sequencer_id`). |
| `api_key` | text | Secret — never visible to the client role. |
| `external_workspace_id` | text | Text on purpose (platform-agnostic). Partial-unique per sequencer. |
| `settings` | jsonb default `{}` | Future per-sequencer options. |
| `enabled` | boolean default true | |
| `setup_state` | jsonb not null default `{}`, check `jsonb_typeof = 'object'` | Last provisioning verdict — `setup-result.schema.json` minus `candidates`. **Never a secret**; the gateway derives booleans from it. `{}` = never checked. |
| `setup_checked_at` | timestamptz | When setup last ran. NULL = never. No scheduled drift check exists, so this value is meant to age. |
| `created_at` / `updated_at` | timestamptz | |

RLS: all four commands gated `private.can_manage_client(client_id)` (manager-own / admin; **client role sees zero rows**). Written by the portal via `upsertClientSequencer`; read by n8n (service role).

**The absence of a row is itself a state.** A client with no `client_sequencers` row is not connected to that sequencer, and the portal must render that as *missing* rather than *unknown* — Audytel sat in exactly that gap while three leads were dropped. `setup_state` / `setup_checked_at` were added by [`20260807_workspace_setup_state.sql`](../../../supabase/migrations/20260807_workspace_setup_state.sql) and are written **only** by the workspace-setup workflows ([process](../processes/ops/workspace-provisioning.md)), never by the portal.

#### `sequencer_daily_stats` — ingestion-only LinkedIn/Aimfox PDCA counters

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `client_id` | uuid FK not null, cascade | |
| `sequencer_id` | uuid FK not null, restrict | |
| `profile_id` | text not null default `''` | Aimfox LinkedIn profile/seat id; `''` = account-level rollup. |
| `report_date` | date not null | UNIQUE (`client_id`, `sequencer_id`, `profile_id`, `report_date`). |
| `invites_sent` / `invites_accepted` | integer default 0 | Daily counters (n8n derives from `/analytics/interactions` buckets). |
| `remaining_database_size` | integer | Snapshot: Σ over active campaigns of `audience_size − sent_connections`. |
| `invite_limit` | integer | **Weekly** connect-cap snapshot: Σ of the client's Aimfox accounts' `limit.connect` (≈195/account). |
| `invite_limit_remaining` | integer | Invites still available today (`invite_limit/5 −` today's sent buckets). Snapshot per 2-hourly run. |
| `schedule_today` / `schedule_tomorrow` / `schedule_day_after` | integer default 0 | Aimfox planned invite volumes (`min(daily_limit, …)` formulas; `daily_limit = invite_limit/5`). Mirrors the sheet's "(Aimfox)" schedule columns. |
| `created_at` | timestamptz | |

RLS: SELECT-only, set-based per ADR-0006 (`client_id IN (SELECT id FROM clients WHERE private.can_access_client(id))`); no write policies — n8n service role UPSERTs on the unique key. Index on `report_date DESC`.

#### `condition_rules` — [schema.ts:292-339](../../../supabase/drizzle/schema.ts#L292-L339)

Dynamic condition rules used to evaluate client operational-health states across Clients surfaces.

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `key` | text UNIQUE not null | Stable rule identifier (seeded from CS PDCA). |
| `name` | text not null | Human-readable label. |
| `description` | text nullable | |
| `target_entity` | text not null, default `client` | Current implementation focuses on client entities. |
| `surface` | text not null | `clients_overview`, `clients_dod`, `clients_3dod`, `clients_wow`, `clients_mom`, `clients_setup`. |
| `metric_key` | text not null | Primary context key used by the rule. |
| `source_sheet` / `source_range` | text nullable | Traceability back to the legacy sheet. |
| `scope_type` | text not null, default `global` | `global`, `manager`, or `client`. |
| `client_id` | uuid FK nullable | Scoped override for one client. |
| `manager_id` | uuid FK nullable | Scoped override for one manager. |
| `apply_to` | text not null, default `cell` | `row`, `cell`, `badge`, `section`. |
| `column_key` | text nullable | Column/cell target for UI rendering. |
| `branches` | jsonb not null | Ordered branch list (first-match semantics). |
| `base_filter` | jsonb nullable | Optional precondition before branch evaluation. |
| `priority` | integer not null, default 100 | Lower = stronger within same severity. |
| `enabled` | boolean not null, default true | Rule on/off switch. |
| `notes` | text nullable | Migration/runtime caveats and legacy quirks. |
| `created_by` | uuid FK nullable | User who authored/seeded the rule. |
| `created_at` / `updated_at` | timestamptz | |

Indexes:

- `idx_condition_rules_lookup` on `(target_entity, surface, enabled, priority)`
- `idx_condition_rules_client_scope` partial index (`scope_type='client'`)
- `idx_condition_rules_manager_scope` partial index (`scope_type='manager'`)

RLS:

- `condition_rules_select_scoped`:
  - manager can read global rules, manager-scoped rules assigned to them, and client-scoped rules for their assigned clients
  - admin/super_admin can read all
  - client cannot read
- `condition_rules_admin_insert` / `condition_rules_admin_update` / `condition_rules_admin_delete`: admin + super_admin only

See [14 · Condition rules](./14-condition-rules.md) for DSL and runtime evaluation behavior.
#### `client_ooo_routing` — [schema.ts:215-238](../../../supabase/drizzle/schema.ts#L215-L238)

Maps an OOO episode to a follow-up campaign, per explicit routing key (ADR-0015, spec §11).

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK > `clients.id` not null |
| `routing_key` | text not null, CHECK `male \| female \| general` |
| `gender` | `lead_gender` nullable — **LEGACY**, superseded by `routing_key`, dropped by the deferred `20260722z` |
| `campaign_id` | uuid FK > `campaigns.id` not null |
| `is_active` | boolean not null default true |
| `updated_at` | timestamptz not null default now() (trigger) |

`uq_client_ooo_routing_active` — partial UNIQUE on `(client_id, routing_key) WHERE is_active`: at most **one active** rule per client and key. Superseded rules are deactivated, never deleted, so a past follow-up stays explainable by the configuration that produced it.

Resolution (`public.resolve_ooo_routing`): specific key → `general` → **NULL**. NULL means *no routing*, surfaced as `skipped / routing_missing`; it is never treated as an implicit `general`. Since [`20260813`](../../../supabase/migrations/20260813_entity_archival.sql) the function also joins `campaigns` and requires `archived_at IS NULL`: **an archived target campaign resolves to NULL**, so archiving an `ooo_followup` campaign in the portal cannot leave n8n enrolling returning contacts into it. The gateway additionally deactivates the routing rules that pointed at it, so the editor stops claiming the key is routed; restoring the campaign does **not** re-arm them.

RLS: all four policies scoped by `private.can_manage_client(client_id)`. Managed in the client drawer (`OooRoutingEditor`); saving also runs `public.recover_skipped_ooo_followups`.

#### `sequencer_contacts` — ADR-0015, [`20260722_ooo_model_tables.sql`](../../../supabase/migrations/20260722_ooo_model_tables.sql)

Local identity of an EXTERNAL contact. Holds **no CRM state** — a CRM lead exists only after a positive reply.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_sequencer_id` | uuid FK > `client_sequencers.id` on delete cascade, not null |
| `external_contact_id` | text not null |
| `email`, `first_name`, `last_name` | text nullable |
| `routing_key` | text not null default `'general'`, CHECK `male \| female \| general` |
| `first_seen_at`, `last_seen_at` | timestamptz not null default now() |
| `raw_payload` | jsonb not null default `{}` |

`uq_sequencer_contacts_identity` — UNIQUE `(client_sequencer_id, external_contact_id)`. The identity is **scoped**: an external contact id is meaningless without the workspace it came from.

RLS: SELECT only, set-based through `client_sequencers → clients` via `private.can_manage_client`. Internal roles only — the `client` role must not see contacts that are not leads (spec §17). Rows are written exclusively by the `service_role` RPCs.

#### `ooo_followups` — ADR-0015, [`20260722_ooo_model_tables.sql`](../../../supabase/migrations/20260722_ooo_model_tables.sql)

One out-of-office **episode**. Never hard-deleted: cancelling is a status change, so the detection, dates, attempts and reason survive (spec §6).

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `sequencer_contact_id` | uuid FK > `sequencer_contacts.id` on delete cascade, not null |
| `source_reply_id` | uuid FK > `replies.id` on delete set null |
| `expected_return_date` | date nullable — the date actually parsed from the reply; **NULL when undetermined, never a fallback** |
| `scheduled_for` | date not null — when to re-enrol; may come from the fallback rule |
| `date_source` | text not null, CHECK `reply_parsed \| fallback \| manual` |
| `status` | `ooo_followup_status` not null default `pending` |
| `routing_key` | text not null — snapshot of the episode |
| `target_campaign_id` | uuid FK > `campaigns.id` on delete set null — snapshot |
| `routing_source` | `ooo_routing_source` not null default `automatic` |
| `attempt_count` | int not null default 0 — **last attempt only**, not an audit trail |
| `next_attempt_at`, `last_attempt_at`, `submitted_at`, `confirmed_at`, `cancelled_at` | timestamptz nullable |
| `cancellation_reason` | text, CHECK `ooo_removed \| positive_reply_received \| manual_cancel \| classification_corrected \| superseded` |
| `skip_reason` | text, CHECK `routing_missing \| campaign_missing \| automation_disabled \| contact_ineligible` |
| `last_error` | text |

**Two distinct unique invariants — conflating them is the bug this model exists to avoid:**

| Index | Guarantees |
|---|---|
| `uq_ooo_followups_active` on `(sequencer_contact_id) WHERE status IN ('pending','processing','failed')` | at most one **active** episode per contact. `submitted`/`confirmed` are excluded: `submitted` closes the episode, so a new OOO reply may open the next one |
| `uq_ooo_followups_source_reply` on `(source_reply_id) WHERE source_reply_id IS NOT NULL` | the same OOO reply never opens a second episode — the redelivery guard that survives `submitted` |

CHECKs: `cancelled ⇒ cancelled_at + cancellation_reason`; `skipped ⇒ skip_reason`; `submitted|confirmed ⇒ submitted_at`; `confirmed ⇒ confirmed_at`. (One-way implications: a **reopened** row keeps its old `cancelled_at`/`cancellation_reason` as history — the UI must gate those columns on the current status.)

RLS: SELECT + UPDATE, set-based via `private.can_manage_client`; UPDATE carries both `using` and `with check`. No INSERT/DELETE policy — rows come from the RPCs, and cancel is a status change.

### 2.3 Campaigns

#### `campaigns` — [schema.ts:126-149](../../../supabase/drizzle/schema.ts#L126-L149)

| Column | Type | Meaning |
|--------|------|---------|
| `id` | uuid PK | |
| `client_id` | uuid FK not null | |
| `external_id` | text UNIQUE not null | ID in the ingestion tool (displayed in drawer). |
| `type` | `campaign_type` not null | `outreach` is client-visible; others are internal (ADR-0003). |
| `name` | text not null | |
| `status` | `campaign_status` not null | |
| `database_size` | integer | Prospect base uploaded for the campaign; summed to compute "Prospects" KPI for clients. |
| `positive_responses` | integer default 0 | Editable in drawer for managers/admins. |
| `start_date` | date | |
| `gender_target` | varchar(10) | |
| `sequencer_id` | uuid FK > `sequencers.id` not null, default EmailBison | ADR-0008 attribution. Set at creation (gateway `mapCampaignInsert`); immutable via portal. |
| `created_at` / `updated_at` | timestamptz | |

RLS:

- `campaigns_select_scoped` — **set-based** (since `20260601b`): `client_id IN (SELECT id FROM clients WHERE private.can_access_client(id)) AND (current_app_role() <> 'client' OR type = 'outreach')`. Preserves ADR-0003 (client role sees only outreach campaigns).
- `campaigns_update_scoped` — `using/withCheck: private.can_manage_client(client_id)`. Manager or admin.

#### `campaign_daily_stats` — [schema.ts:239-263](../../../supabase/drizzle/schema.ts#L239-L263)

Per-campaign per-day send/reply counters. **This is the most frequently queried table** — ingestion writes one row per campaign per day.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `campaign_id` | uuid FK not null (indexed) |
| `report_date` | date not null (indexed DESC) |
| `sent_count` | smallint default 0 |
| `reply_count` | smallint default 0 |
| `bounce_count` | smallint default 0 |
| `unique_open_count` | smallint default 0 |
| `inboxes_active` | smallint not null |
| `positive_replies_count` | smallint default 0 not null |
| `created_at` | timestamptz |

UNIQUE (`campaign_id`, `report_date`). Indexes on `campaign_id` and on `report_date DESC`.

RLS — the critical set-based predicate (ADR-0003 enforced here):

```sql
campaign_id IN (
  SELECT c.id
  FROM campaigns c
  WHERE private.can_access_client(c.client_id)
    AND (private.current_app_role() <> 'client' OR c.type = 'outreach')
)
```

The set-based form was the subject of `supabase/migrations/20260421_fix_rls_performance.sql` (see §5).

### 2.4 Leads & replies

#### `leads` — [schema.ts:15-69](../../../supabase/drizzle/schema.ts#L15-L69)

The central row. Holds enrichment (company, title, industry, country), qualification state, and reply denormalisation.

Columns of note:

| Column | Type | Role |
|--------|------|-----|
| `client_id` / `campaign_id` | uuid FKs | Scope. `campaign_id` is nullable. |
| `email` | text (indexed) | Matching key. |
| `first_name`, `last_name`, `job_title`, `company_name`, `linkedin_url` | text | Enrichment. |
| `gender` | `lead_gender` | Used for OOO routing. |
| `qualification` | `lead_qualification` (indexed) | Editable by internal roles. |
| ~~`expected_return_date`~~ | — | **DROPPED** by `20260722z` (2026-07-22). OOO lives in `ooo_followups` (ADR-0015); the gateway no longer reads or writes it. |
| `message_title` | varchar(500) | Subject of the step the lead replied to. |
| `message_number` | smallint | Sequence step at which the last reply landed (denormalised from `replies`). |
| `response_time_hours` / `response_time_label` | numeric / varchar | Time-to-reply metric from ingestion. |
| `meeting_booked`, `meeting_held`, `offer_sent`, `won` | booleans default false | **Editable by internal roles; drive `getLeadStage`**. |
| ~~`added_to_ooo_campaign`~~ | — | **DROPPED** by `20260722z` (2026-07-22). Superseded by `ooo_followups.status` (ADR-0015). |
| `source_sequencer_contact_id` | uuid FK > `sequencer_contacts.id` | ADR-0015 provenance. Partial UNIQUE — **one contact yields at most one CRM lead**; a later positive reply attaches to the existing lead. |
| `origin_reply_id` | uuid FK > `replies.id` | ADR-0015 provenance. Partial UNIQUE — one reply never creates two leads (reprocessing guard). |
| `external_blacklist_id`, `external_domain_blacklist_id` | integer | Back-refs to ingestion tool tables. |
| `source` | varchar(30) default `'cold_email'` | Channel provenance (free text; gateway reply-path fallback `"cold_email"`). **Not** the sequencer link — see `sequencer_id`. |
| `sequencer_id` | uuid FK > `sequencers.id` not null, default EmailBison | ADR-0008 attribution. n8n/ingestion-owned; NOT in the portal lead-patch whitelist (ADR-0004). Index `idx_leads_client_sequencer (client_id, sequencer_id)`. |
| `reply_text` | text | Denormalised copy of **the reply that created the lead**, for the leads-table column `Mail from lead` and the export. Written by `promote_contact_to_lead` from `origin_reply_id` inside the creating transaction (`20260815b`); never rewritten afterwards, so a later reply does not change it — same semantics as the sheet's column. Not "the latest reply": the authoritative, always-current thread is `replies`, which the drawer renders. Rows imported from the Sheets era carry the sheet's value. |
| `client_note` | text | Client-facing report note (renamed from `comments` in Batch 4, `20260618b`). Editable by manager/admin; visible to the client. |
| `coldunicorn_note` | text | Internal report note (Batch 4). Editable by manager/admin; **nulled for the client role** in `loadLeadsList`. |
| `highlight` | text `green\|yellow\|red` | Manual report row colour (Batch 4, Task 4E). `null` = none. |
| `created_at` / `updated_at` | timestamptz | |

RLS:

- `leads_select_scoped` — **set-based** (since `20260601b`): `client_id IN (SELECT id FROM clients WHERE private.can_access_client(id))`. The earlier per-row form called `can_access_client` 3972 times per query (once per lead row), costing ~400ms of RLS overhead measured 2026-06-01. The subquery reduces this to 48 calls (once per unique client).
- `leads_update_scoped` — **verified live:** `using`/`with check` = `private.can_manage_client(client_id)`. **Clients are write-blocked in Postgres** (ADR-0004); the drawer additionally gates editability by `identity.role !== "client"`, and the gateway's `mapLeadPatch` whitelist bounds which columns any role may touch.

#### `replies` — [schema.ts:150-177](../../../supabase/drizzle/schema.ts#L150-L177)

Append-only history. Populated by ingestion; the portal never writes.

| Column | Type | Role |
|--------|------|------|
| `lead_id` | uuid FK nullable (indexed) | Links to lead when matched. Stays NULL for replies received before any lead exists (ADR-0015 — a reply needs no lead). |
| `sequencer_contact_id` | uuid FK > `sequencer_contacts.id` nullable (indexed) | ADR-0015 — the contact anchor, so a reply is attributable without a lead. |
| `external_id` | text UNIQUE not null | Ingestion dedupe key. The UNIQUE was **added by [`20260722c`](../../../supabase/migrations/20260722c_replies_external_id_unique.sql)** — this doc claimed it existed, but no such constraint was present until then. `public.upsert_reply` cannot be planned without it. |
| `sequence_step` | smallint | |
| `message_subject`, `message_text` | text | |
| `received_at` | timestamptz not null (indexed) | |
| `client_id` | uuid (indexed, nullable) | Denormalised from `leads.client_id`; `NULL` when reply is orphan / pending classification. |
| `from_email_address` | varchar(255) | |
| `is_automated_reply` | boolean default false | |
| `classification` | `reply_classification` (indexed) | Auto-filled, shown as badge. `NULL` = unclassified. |
| `short_reason` | text | Human-readable rationale. |
| `language_detected` | varchar(10) | ISO code. |
| `is_forwarded` | boolean default false | |

RLS:

- `replies_select_scoped` — **set-based** (since `20260601b`): `client_id IS NOT NULL AND client_id IN (SELECT id FROM clients WHERE private.can_access_client(id))`. The earlier per-row form used `private.can_access_reply(client_id, lead_id)` which also handled orphan replies (null client_id, non-null lead_id). The new form requires `client_id IS NOT NULL`; n8n always sets `client_id` on ingestion so this is safe in practice.

No write policies from the portal.

#### `lead_custom_fields` / `lead_custom_field_values` — migration [`20260618c_lead_custom_fields.sql`](../../../supabase/migrations/20260618c_lead_custom_fields.sql)

Per-client custom columns on the Leads report (Batch 4, Task 4F; [ADR-0007](../../adr/0007-per-client-lead-custom-fields.md)). Mirrors the client custom-field shape but scopes definitions to a `client_id` and keys values on `lead_id`.

`lead_custom_fields`: `id`, `client_id` (→ clients, cascade), `name`, `field_type` (`text|checkbox|droplist|link|number|currency`), `options` (jsonb, required for droplist), `position`, `editable_by` text[] (default `{admin,master_admin}`), `created_by`, `created_at`.
`lead_custom_field_values`: PK `(lead_id, field_id)`, both FKs cascade-delete; `value` text (raw; numeric parse/sort is frontend-only), `updated_at`, `updated_by`.

RLS (all set-based, ADR-0006):
- `lcf_select_scoped` — definitions readable when `client_id IN (SELECT id FROM clients WHERE private.can_access_client(id))` (client role included — report is client-facing).
- `lcf_write_admin` — definitions writable only by `super_admin/admin/master_admin`.
- `lcfv_select_scoped` — values readable when the lead's `client_id` is accessible.
- `lcfv_write_scoped` — values writable when the actor can access the lead's client **and** `private.current_app_role()` ∈ the field's `editable_by`.

### 2.4b Lead CRM child tables (ADR-0013)

Four lead-owned child tables added by [`20260719_lead_crm_tables.sql`](../../../supabase/migrations/20260719_lead_crm_tables.sql) for the CRM view. All are `lead_id`-scoped `ON DELETE CASCADE` and carry `handle_updated_at()` triggers. Stages in the CRM view are **visual groups only** — there is no stage table or stored `current_stage`.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `lead_meetings` | intro / summary / general meetings | `meeting_type`, `status`, `call_script`, `scheduled_at`, `held_at`, `transcription_url`, `pre_meeting_insights`, `process_score` (0–100), `conversion_insights`. Partial unique index → one intro + one summary per lead; general repeats. |
| `lead_offers` | offers/revisions (multiple per lead) | `status`, `contracted_send_date`, `sent_at`, `offer_url`, `source_meeting_id` |
| `lead_tasks` | next-step tasks (no `task_type` in MVP) | `title`, `due_at`, `status`, `position`, `source_meeting_id` |
| `lead_value_deliveries` | additional-value deliveries | `sequence_number` (unique per lead), `planned_date`, `value_items text[]`, `sent_at` |

**New `leads` columns** (spec §8.1): `linkedin_invitation_sent_at`, `contact_made_at`, `contact_method` (text CHECK `phone`|`email`), `negotiation_started_at`, `conclusion`, `concluded_at`. Also re-synced the previously-missing `sequencer_id` into `schema.ts`.

**Status model (Phase 1b, ADR-0013 split model — [`20260719d`](../../../supabase/migrations/20260719d_lead_final_outcome.sql)):** the taxonomy is SPLIT, not a single stored column.
- `crm_stage` (`preMQL`/`MQL`/`SQL`) is **DERIVED on read** (`src/app/lib/crm/lead-status.ts` — `deriveCrmStage`); no column, no backfill. The former `contact_disposition` dimension (`ooo`/`nrr`) and its `deriveContactDisposition` resolver were **removed** 2026-07-22: OOO/NRR are outreach states of a `sequencer_contacts` row (ADR-0015), not a lead dimension, and `20260722z` dropped the underlying column and the `OOO`/`NRR` enum values.
- `leads.final_outcome` (enum `final_outcome` = `won`/`lost`/`lost_premql`, nullable) is the **only stored** part — the explicit terminal decision, guarded by `leads_final_outcome_concluded_check` (`final_outcome ⇒ concluded_at`), set atomically with `conclusion`/`concluded_at` by the Phase-5 conclusion action.
- `resolveCrmStatus` = `final_outcome ?? won-boolean ?? rejected→lost ?? deriveCrmStage`. **KPI dashboards are unchanged** (booleans/`qualification`).

**RLS** ([`20260719b`](../../../supabase/migrations/20260719b_lead_crm_rls.sql)) — set-based per ADR-0006, verified via EXPLAIN as `authenticated` (hashed SubPlan on the child scan, no per-row `private.*`):
- `<table>_select_scoped` — readable when the parent lead's `client_id` is accessible (`private.can_access_client`); clients get **read-only** CRM data.
- `<table>_write_scoped` (`for all`) — writable when the caller `can_manage_client` the parent lead's client; **client role write-blocked in Postgres**.

**Legacy-boolean recompute** ([`20260719c`](../../../supabase/migrations/20260719c_lead_crm_boolean_sync.sql)) — `AFTER INSERT/UPDATE/DELETE` triggers (`private.recompute_lead_meeting_flags` / `recompute_lead_offer_flags`, SECURITY DEFINER) keep `leads.meeting_booked`/`meeting_held`/`offer_sent` in sync by **recomputing from child rows** (cancelling a meeting un-counts it). n8n writes the child tables directly, so the sync must be a DB trigger, not gateway code. `won` is not trigger-managed. See [09-mutations-rls §2.18](09-mutations-rls.md#218-lead-crm-child-tables-adr-0013).

### 2.5 Daily stats (client-level rollup)

#### `daily_stats` — [schema.ts:70-105](../../../supabase/drizzle/schema.ts#L70-L105)

Pre-aggregated per-client per-day snapshot. Populated by ingestion. **Drives DoD / 3-DoD / WoW / MoM metrics** (`client-metrics.ts`).

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK not null (indexed) ON DELETE restrict |
| `report_date` | date not null (indexed) |
| `emails_sent` | integer default 0 not null |
| `prospects_in_base` | integer default 0 not null |
| `mql_count` | integer default 0 not null |
| `me_count` | integer default 0 not null |
| `response_count` | integer default 0 not null |
| `bounce_count` | integer default 0 not null |
| `won_count` | integer default 0 not null |
| `negative_count` | integer default 0 not null |
| `ooo_count` | integer default 0 not null |
| `human_replies_count` | integer default 0 not null |
| `inboxes_count` | integer default 0 not null |
| `prospects_count` | integer default 0 not null |
| `schedule_today`, `schedule_tomorrow`, `schedule_day_after` | integer nullable |
| `week_number`, `month_number`, `year` | smallint nullable |
| `created_at` | timestamptz |

UNIQUE (`client_id`, `report_date`). Index on `report_date`.

RLS `daily_stats_select_scoped`:

```sql
client_id IN (SELECT id FROM clients WHERE private.can_access_client(id))
```

**Read path.** No page reads this table wholesale any more. The gateway windows it to **180 days** (`DAILY_STATS_WINDOW_DAYS`, [index.ts:20](../../../supabase/functions/orm-gateway/index.ts#L20)) and ships only the columns a given action needs: `loadClientsStats` / `loadClientsMetricsSummary` (Clients page metric tabs), `loadAnalyticsOverview` (Statistics), `loadClientDashboard` (single client). The `AnalyticsDailyStatInput` / `ClientsLeadInput` projections in [`view-contracts.ts`](../../../src/app/types/view-contracts.ts) define exactly which columns cross the wire; `createClientMetrics` then computes DoD/3-DoD/WoW/MoM in the browser.

### 2.6 Domains, invoices, blacklist

#### `domains` — [schema.ts:398-422](../../../supabase/drizzle/schema.ts#L398-L422)

Outreach sending domains.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK not null |
| `domain_name`, `setup_email` | text not null |
| `purchase_date` | date not null |
| `status` | `domain_status` — **local, portal-editable** lifecycle status |
| `winnr_status` | text — Winnr provider status (ingestion-only, read-only), separate from `status` |
| `created_at`, `updated_at` | timestamptz |

**Winnr sync columns (`20260720f`, ingestion-only — n8n writes via service_role, not declared in `schema.ts`):** `winnr_domain_id` (text, partial-unique), `dns_provider` (text), `winnr_tags` (text[]), `winnr_email_user_count` (int), `winnr_created_at` / `winnr_updated_at` / `last_seen_at` / `last_synced_at` / `missing_since` (timestamptz), `raw_payload` (jsonb). A case-insensitive unique index `domains_domain_name_ci_uq` on `lower(trim(domain_name))` backs the sync match key.

> **Dropped `20260720f`:** `reputation`, `exchange_date`, `exchange_cost`, `campaign_verified_at`, `warmup_verified_at`. Current warming is per-mailbox in `email_accounts`; history in `email_account_warming_daily`; a "warming done" signal is derived from `warming_status` / `warming_progress`. `campaign_verified_at` was not a Winnr signal and had no remaining consumer; `exchange_*` were agency bookkeeping whose UI was removed.

RLS (verified live): `domains_select_scoped` = `private.can_access_client(client_id)` (client role can read its own domains); `domains_insert_scoped` / `_update_scoped` / `_delete_scoped` = `private.can_manage_client(client_id)` (assigned manager + admin tier). `domains_insert_internal` (`20260517`) is the additional permissive INSERT policy used by the "New domain" sheet.

#### `email_accounts` — [schema.ts](../../../supabase/drizzle/schema.ts) (`20260720e`)

Individual Winnr mailboxes and their **current** warming snapshot. Warming is a mailbox-level concept, not a domain-level one: one domain has many mailboxes with independent health scores. **Ingestion-only** — n8n populates this from Winnr (`/v1/email-users` + `/v1/warming`) as `service_role`; the portal never writes it. Warming statuses are free `text` (the taxonomy is owned by the external API).

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `domain_id` | uuid FK → `domains(id)` on delete cascade |
| `winnr_email_user_id` | text unique (idempotent upsert key) |
| `email_address` | text not null (unique on `lower(email_address)`) |
| `username`, `display_name`, `status` | text |
| `warming_status` | text |
| `warming_health_score`, `warming_inbox_rate`, `warming_spam_rate`, `warming_progress` | numeric |
| `warming_daily_volume` | integer |
| `winnr_created_at`, `last_seen_at`, `last_synced_at`, `missing_since` | timestamptz |
| `raw_payload` | jsonb |
| `created_at`, `updated_at` | timestamptz |

RLS: `email_accounts_select_scoped` — set-based (ADR-0006), scoped through the parent domain: `domain_id IN (SELECT d.id FROM domains d WHERE d.client_id IN (SELECT id FROM clients WHERE private.can_access_client(id)))`. No `authenticated` write policy (writes are `service_role`/n8n), mirroring `replies` / `campaign_daily_stats`.

#### `email_account_warming_daily` — [schema.ts](../../../supabase/drizzle/schema.ts) (`20260720e`)

Per-mailbox daily warming history (from Winnr `/v1/warming/{id}/metrics`). Ingestion-only. PK `(email_account_id, metric_date)`. Columns: `warming_status` text, `emails_sent`/`daily_volume` integer, `health_score`/`inbox_rate`/`spam_rate`/`warmup_progress` numeric, `raw_payload` jsonb, `synced_at` timestamptz. RLS: `email_account_warming_daily_select_scoped` — set-based, scoped through `email_account → domain → client`.

#### `domain_warming_summary` (view) — [schema.ts](../../../supabase/drizzle/schema.ts) (`20260720e`)

`security_invoker` aggregation over `email_accounts`, one row per domain: `email_accounts_count`, `active_warming_accounts_count`, `average_health_score`, `lowest_inbox_rate`, `highest_spam_rate`. Runs with the caller's privileges so `email_accounts` RLS still scopes the rows. Provides the domain-level rollup without duplicating warming columns onto `domains`. **Not yet read by a page** — it exists for the planned aggregate column on the Domains list; the per-domain mailbox panel derives its numbers client-side from the mailbox list already in the payload. `active_warming_accounts_count` assumes Winnr's status literal is `'active'` — reconcile once the n8n→Winnr mapping is confirmed.

#### `invoices` — [schema.ts:264-283](../../../supabase/drizzle/schema.ts#L264-L283)

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `client_id` | uuid FK not null |
| `issue_date` | date not null |
| `amount` | numeric not null |
| `status` | text |

RLS:

- `invoices_select_scoped` — `private.can_access_client(client_id)` (client, manager, admin).
- `invoices_insert_admin` / `update_admin` / `delete_admin` — **`private.is_admin_user()`, verified live**. Managers can read invoices but **cannot write them**; the Invoices drawer does not yet reflect that ([09 §4](09-mutations-rls.md#4-mutation-ownership-matrix)).

#### `email_exclude_list` — [schema.ts:284-293](../../../supabase/drizzle/schema.ts#L284-L293)

Agency-wide domain blacklist.

| Column | Type |
|--------|------|
| `domain` | text PK |
| `created_at` | timestamptz |

RLS:

- `email_exclude_list_select_internal` — `private.is_internal_user()` (manager + admin).
- Insert/update/delete — admin only (body in production SQL).

### 2.7 Agency CRM (internal pipeline)

#### `agency_crm_deals` — [schema.ts:343-369](../../../supabase/drizzle/schema.ts#L343-L369)

Not surfaced in the current UI, but present in the schema. Tracks the agency's own sales pipeline for prospective clients.

| Column | Type |
|--------|------|
| `id` | uuid PK |
| `company_name`, `contact_name`, `email`, `phone`, `source` | text |
| `salesperson_id` | uuid FK > `users.id` not null |
| `stage` | text (free-form; `crm_pipeline_stage` enum is reserved but not typed here) |
| `stage_updated_at` | timestamptz |
| `estimated_value` | numeric |
| `win_chance` | smallint |
| `lesson_learned` | text |
| `updated_at` | date |

RLS `agency_crm_deals_select_scoped`:

```sql
private.is_admin_user() OR (private.current_app_role() = 'manager' AND salesperson_id = auth.uid())
```

### 2.8 Customization tables — **not in `schema.ts`**

Three tables exist in migrations only; the introspected Drizzle schema does not include them, so the gateway reads/writes them with raw SQL through `safeRawSelect`, which returns `[]` when the table is absent ([index.ts:671-686](../../../supabase/functions/orm-gateway/index.ts#L671-L686)) — a portal running against an un-migrated database degrades instead of 500-ing.

| Table | Migration | Shape | RLS |
|---|---|---|---|
| `client_table_column_overrides` | [`20260520_client_table_overrides.sql`](../../../supabase/migrations/20260520_client_table_overrides.sql), `20260524_column_override_position.sql` | `column_key` PK, `label_override`, `hidden`, `position`, `updated_at/by` | select: `public.is_admin_user()`; write: `current_app_role() = 'master_admin'` |
| `client_custom_fields` | [`20260520_client_custom_fields.sql`](../../../supabase/migrations/20260520_client_custom_fields.sql) (+ `20260527_custom_field_editable_by.sql`, `20260616_custom_field_link_type.sql`, `20260618`) | `name`, `field_type` (`text\|checkbox\|droplist\|link\|number\|currency`), `options` jsonb, `position`, `editable_by` text[] default `{master_admin}` | `ccf_select` — internal roles incl. manager; `ccf_write_master` — `master_admin` only |
| `client_custom_field_values` | same | PK (`client_id`, `field_id`), `value` text (raw; parsing is frontend-only) | `ccfv_select_scoped` — `can_access_client(client_id)`; `ccfv_write_scoped` — accessible client **and** role ∈ field `editable_by` |
| `user_table_preferences` | [`20260714b_user_table_preferences.sql`](../../../supabase/migrations/20260714b_user_table_preferences.sql) | PK (`user_id`, `table_key`), `preferences` jsonb (`{ widths, filters, sort }`, ≤64 KB CHECK), `updated_at` | own rows only, all verbs: `user_id = auth.uid()` |

The lead-level equivalents (`lead_custom_fields` / `lead_custom_field_values`, §2.4) follow the same pattern but scope definitions per client.

**`client_table_column_overrides` vs `user_table_preferences`** — easy to confuse, opposite scopes.
The overrides table is the **global** layout a master_admin publishes to the whole team (labels,
order, hidden columns). `user_table_preferences` is **personal**: column widths, filters and sort,
keyed on `auth.uid()`, so one CS manager dragging a column edge cannot rebuild the grid for
everyone else. Note that impersonation is client-side only — the JWT reaching the gateway still
belongs to the real actor, so `auth.uid()` is the person actually doing the dragging.

---

## 3. Views

### `admin_dashboard_daily` — [schema.ts:423-431](../../../supabase/drizzle/schema.ts#L423-L431) · migration [`20260421b_admin_dashboard_view.sql`](../../../supabase/migrations/20260421b_admin_dashboard_view.sql)

```sql
CREATE VIEW public.admin_dashboard_daily
WITH (security_invoker = on) AS
SELECT cds.report_date,
       c.client_id,
       SUM(cds.sent_count)::integer              AS sent_count,
       SUM(cds.reply_count)::integer             AS reply_count,
       SUM(cds.bounce_count)::integer            AS bounce_count,
       SUM(cds.unique_open_count)::integer       AS unique_open_count,
       SUM(cds.positive_replies_count)::integer  AS positive_replies_count,
       SUM(cds.inboxes_active)::integer          AS inboxes_active
FROM campaign_daily_stats cds
JOIN campaigns c ON c.id = cds.campaign_id
WHERE cds.report_date >= (CURRENT_DATE - INTERVAL '21 days')
GROUP BY cds.report_date, c.client_id;
```

- `security_invoker = on` — caller's RLS applies, so the view respects the same per-role visibility as `campaign_daily_stats`.
- Hard-coded **21-day** window, matching the Admin Dashboard momentum charts.
- **Not queried by anything today.** The `orm-gateway` computes the admin/manager dashboard rollups with its own raw SQL over `campaign_daily_stats` (`loadAdminDashboardOverview`, [index.ts:946](../../../supabase/functions/orm-gateway/index.ts#L946); `loadManagerDashboardOverview`, [index.ts:1047](../../../supabase/functions/orm-gateway/index.ts#L1047)) because those handlers need client/campaign/lead facts in the same round-trip. The view is retained for BI tools.

---

## 4. Private helper functions (RLS predicates)

All policies reference `private.*` helpers defined in `docs/reference/supabase-production-rls.sql`. Inferred behaviour:

| Helper | Signature | Predicate |
|--------|-----------|-----------|
| `private.current_app_role()` | `returns text` | `SELECT role FROM users WHERE id = auth.uid() AND coalesce(is_active, true)`. Returns text so callers can compare to literals. Since migration `20260618` a **deactivated** user yields NULL → all role-gated RLS denies them (true server-side lockout). |
| `private.is_admin_user()` | `returns boolean` | `current_app_role() IN ('super_admin', 'admin', 'master_admin')`. |
| `private.is_internal_user()` | `returns boolean` | `current_app_role() IN ('super_admin', 'admin', 'manager', 'master_admin')` — anyone with internal staff access. Source of truth for `users_select_internal` and `email_exclude_list_select_internal` policies; `private.is_internal_user` and `public.is_internal_user` must stay in lockstep (see migration `20260526_master_admin_private_is_internal_user.sql`). |
| `private.can_access_client(client_id uuid)` | `returns boolean` | Admin/super_admin/master_admin > TRUE; manager > client is assigned (`manager_id = auth.uid()`); client > user is mapped via `client_users`. |
| `private.can_manage_client(client_id uuid)` | `returns boolean` | Admin/super_admin/master_admin > TRUE; manager > client is assigned; client > FALSE. |
| `private.can_access_reply(client_id uuid, lead_id uuid)` | `returns boolean` | Checks `can_access_client(client_id)` OR — when `client_id IS NULL` — looks up the owning client via `lead_id` and applies `can_access_client`. Admin short-circuits. |

Pattern: wherever possible the new policies use **set-based subqueries** rather than per-row function calls, because Postgres would otherwise fail to hoist the check past an index. See [§5](#5-migrations-of-note).

---

## 4b. OOO ingestion & operator functions (ADR-0015)

Defined in [`20260722e_ooo_rpcs.sql`](../../../supabase/migrations/20260722e_ooo_rpcs.sql). All use
`SECURITY DEFINER` with **`set search_path = ''`** and fully qualified names — an empty search_path is
the only configuration where a definer body cannot be redirected by objects in a schema the caller
controls. Three privilege tiers:

| Tier | Functions | Granted to |
|---|---|---|
| Whole episode lifecycle | `upsert_sequencer_contact`, `upsert_reply`, `record_ooo_followup`, `claim_ooo_followup`, `mark_ooo_submitted`, `mark_ooo_confirmed`, `mark_ooo_failed`, `skip_ooo_followup`, `cancel_ooo_followup`, `cancel_active_ooo_followup`, `retry_ooo_followup`, `reopen_ooo_followup`, `promote_contact_to_lead` | **`service_role` only** |
| Plain (no DEFINER) | `resolve_ooo_routing`, `recover_skipped_ooo_followups` | `authenticated`, `service_role` |

The portal has **no** path into the episode lifecycle — there is no operational view
([OoS-16](13-out-of-scope.md)), so nothing needs an `authenticated` grant. n8n is the only caller.

The two plain functions are deliberately not `SECURITY DEFINER`: called as `authenticated` from the
client-drawer routing editor they are scoped by the `client_ooo_routing` / `ooo_followups` policies,
and called as `service_role` (or the table owner) they see everything — each caller gets exactly what
it needs, with no hand-written permission check to get wrong. This is also why `ooo_followups` keeps
an UPDATE policy despite having no portal editor: `recover_skipped_ooo_followups` updates episodes on
the caller's behalf.

Invariants are covered by [`supabase/tests/ooo-invariants.sql`](../../../supabase/tests/ooo-invariants.sql).

---

## 4a. Public functions (anon-callable)

The **only** database object any unauthenticated caller can reach. Everything else in this file is
gated behind `authenticated` policies, and `anon` reads zero rows from every table (verified
2026-07-21 against the local stack: `GET /rest/v1/{leads,clients,campaigns,replies,users,daily_stats}`
as `anon` all return `[]`).

| Function | Signature | Behaviour |
|----------|-----------|-----------|
| `public.public_lead_stats()` | `returns json`, `stable`, `security definer`, `set search_path to 'public'` | Aggregate lead counters for the agency marketing site (ADR-0014). Migration [`20260721_public_lead_stats_rpc.sql`](../../../supabase/migrations/20260721_public_lead_stats_rpc.sql). Takes **no arguments**; returns `{yesterday, last_7_days, last_30_days, last_90_days, all_time, generated_at}` and nothing else. `revoke all ... from public` + `grant execute to anon, authenticated`. |

`SECURITY DEFINER` is required because `anon` has no SELECT policy on `leads` and must never get
one - the privilege lives in the function, not in the role. The function is safe to expose only
because it is argument-less and emits aggregates with **no per-client or per-campaign dimension**.
Adding a parameter, or a sliced counter, requires a new ADR
([ADR-0014](../../adr/0014-public-marketing-stats-rpc.md) "The boundary"). Formula and windows:
[04-metrics-catalog §16](04-metrics-catalog.md#16-public-marketing-counters).

---

## 5. Migrations of note

### `supabase/migrations/20260421_fix_rls_performance.sql`

Rewrites `campaign_daily_stats_select_scoped` and `daily_stats_select_scoped` from per-row helper calls to **set-based** predicates:

```sql
-- old (slow)
USING ( private.can_access_campaign(campaign_id) )

-- new (fast; Postgres hoists the IN across a bitmap scan)
USING (
  campaign_id IN (
    SELECT c.id FROM campaigns c
    WHERE private.can_access_client(c.client_id)
      AND (private.current_app_role() <> 'client' OR c.type = 'outreach')
  )
)
```

Measured impact: **~10.48 s > 0.30 s** on a table of ~24k rows during seed testing.

### `supabase/migrations/20260601_leads_perf_indexes.sql`

Adds missing indexes identified via EXPLAIN ANALYZE during Phase 4B latency investigation:

| Index | Reason |
|---|---|
| `leads(campaign_id)` | Campaign filter was seq-scanning 3972 rows |
| `campaigns(client_id)` | Missing; needed for client-scoped campaign lookups |
| `replies(lead_id)` | Missing; `loadLeadDetail` will seq scan when replies have data |
| DROP `leads_updated_at_idx1` | Duplicate of `leads_updated_at_idx` |

### `supabase/migrations/20260601b_leads_campaigns_replies_rls_set_based.sql`

Extends the set-based predicate pattern from `20260421_fix_rls_performance.sql` to the three remaining hot tables.

Root cause: `leads`, `campaigns`, and `replies` SELECT policies were calling `private.can_access_client(client_id)` per-row. With 3972 leads and 48 clients, each leads query called the function 4020 times at ~0.1ms each = ~400ms overhead per query. Measured impact:

- loadLeadsList handler (two queries): **1340ms → 200ms** (~6.7×)
- loadLeadsFilterOptions handler (two queries): **1297ms → 125ms** (~10×)
- Total observed browser fetch: **~2600ms → ~860ms** (~3×)

**Why:** `private.can_access_client(client_id)` is STABLE but takes a `client_id` argument, so PostgreSQL calls it once per unique `client_id` in a nested-loop join rather than hoisting it above the scan. Wrapping in a subquery forces a single set evaluation against the 48-row `clients` table.

### `supabase/migrations/20260421b_admin_dashboard_view.sql`

Creates the `admin_dashboard_daily` view (§3) with `security_invoker=on`.

### `supabase/migrations/20260428_condition_rules_engine.sql`

Adds `public.condition_rules`, indexes, RLS, and CS PDCA seed data for dynamic client-health conditions.

Notable behavior encoded in seed:

- Rules are normalized JSON DSL (`branches` + optional `base_filter`), no executable formulas.
- Directly mapped rules are enabled; ambiguous or missing-field rules are seeded disabled with `notes`.
- Legacy low-rate green behavior for WoW response/human/OOO is preserved in notes for parity.
Earlier Drizzle migrations live in `supabase/drizzle/migrations/0000_stiff_fixer.sql` — the baseline ddl.

### `supabase/migrations/20260618_user_management_and_custom_field_types.sql`

- **2C user management:** adds `users.is_active` / `deactivated_at` / `deactivated_by`; makes `private.current_app_role()` is_active-aware; adds SECURITY DEFINER RPCs `admin_list_users`, `admin_update_user_role`, `admin_set_user_active`, `current_account_active` (all `grant execute to authenticated`, with internal-admin + self/super-admin/last-admin guards). See [09-mutations-rls.md §3.6](09-mutations-rls.md).
- **3G custom field types:** relaxes the `client_custom_fields_field_type_check` CHECK to allow `'number'` and `'currency'` in addition to `text/checkbox/droplist/link`. No data migration — values stay raw text in `client_custom_field_values`; parsing/sorting is frontend-only.

### `supabase/migrations/20260618b_leads_report_columns.sql`

Client Feedback Batch 4 (Leads report). Renames `leads.comments` → `client_note` (data preserved), adds `coldunicorn_note` and `highlight` (`green|yellow|red` CHECK). No status-semantics change — the legacy micro-CRM booleans and `qualification` are untouched.

### `supabase/migrations/20260618c_lead_custom_fields.sql`

Batch 4 Task 4F: adds `lead_custom_fields` + `lead_custom_field_values` with set-based RLS (see §2.4 and [ADR-0007](../../adr/0007-per-client-lead-custom-fields.md)).

### Master-admin series (ADR-0005)

| Migration | Effect |
|---|---|
| `20260520_master_admin_role.sql` | `alter type public.user_role add value 'master_admin'`. |
| `20260520_master_admin_rls.sql` | Admin-tier helpers accept `master_admin`. |
| `20260526_master_admin_private_is_internal_user.sql` | Keeps `private.is_internal_user` and `public.is_internal_user` in lockstep. |
| `20260528_fix_insert_policies_master_admin.sql` | Adds `master_admin` to the `*_insert_internal` policies. |
| `20260616b_can_manage_client_master_admin.sql` | Adds `master_admin` to `private.can_manage_client`. |

### `supabase/migrations/20260517_entity_insert_policies.sql`

Adds `clients_insert_internal`, `campaigns_insert_internal`, `leads_insert_internal`, `domains_insert_internal` — admin-tier for any client, manager scoped to `clients.manager_id = auth.uid()`. These back the "New …" sheets ([09 §2](09-mutations-rls.md#2-orm-gateway-mutations)).

### `supabase/migrations/20260428_users_update_self_policy.sql`

`users_update_self` (`auth.uid() = id`, using + with check) — the policy behind `updateProfileName` / `updateProfileAvatar` through the gateway.

### `supabase/migrations/20260813_entity_archival.sql`

Adds **`archived_at timestamptz` + `archived_by uuid → users(id)`** to `clients`, `campaigns`, `leads`,
`domains`, `invoices` and `email_accounts` — the portal's soft delete. A non-null `archived_at` means the
row is excluded from every list, picker, dashboard and aggregate in the gateway, while the row and all its
children stay. Hard delete is impossible on these tables by design (§6 below) and would be undone by
re-ingestion, so archiving is the only delete the portal offers; the exception list of what is *not*
filtered is in [09 §2.19](09-mutations-rls.md#219-setentityarchivedentity-id-archived--the-portals-delete-migration-20260813_entity_archival).

- Partial indexes `idx_leads_client_active` / `idx_campaigns_client_active` on `(client_id) WHERE archived_at IS NULL` — the two hot tables; the other four are small enough to filter on the existing scan.
- Written **only** by the gateway's `setEntityArchived` action; the `map*Patch` whitelists do not accept `archived_at`.
- **New policy `email_accounts_update_scoped`** — set-based through `domains` → `clients` via `private.can_manage_client`, unlinked domains admin-only. The other five tables need no policy change: archiving is an UPDATE and inherits `clients_update_scoped` / `campaigns_update_scoped` / `leads_update_scoped` / `domains_update_scoped` / `invoices_update_admin`.
- **Measured** on the local stack as the `authenticated` role (61 clients / 5 286 leads / 2 092 mailboxes), `EXPLAIN (ANALYZE, BUFFERS)`, same query with and without the predicate: leads stage counts 12.6→10.6 ms (Seq Scan → Bitmap Index Scan on the new partial index), clients overview 2.21→2.04 ms, mailbox list 30.6→27.5 ms; identical row counts. Nine permission cases (manager / client-role / admin × lead, client, mailbox, invoice) were probed inside BEGIN/ROLLBACK and all matched the table above. Evidence is inline in the migration header.

---

## 6. Integrity rules observed

- `client_users.user_id` is **UNIQUE**, enforcing "one client per client-role user" at the database level (matches ADR-0001's single-workspace invariant for clients).
- `campaigns_external_id_key` and `replies_external_id_key` ensure idempotent ingestion upserts.
- `daily_stats` and `campaign_daily_stats` both have unique composite keys over (`*_id`, `report_date`) — no duplicate rows per day.
- `condition_rules.key` is unique, allowing idempotent seed upserts without duplicate rule identities.
- FK cascades: only `client_users.*` cascade on delete. Everywhere else (`campaigns.client_id`, `leads.client_id`, `daily_stats.client_id` RESTRICT, `domains.client_id`, …) deletes are intentionally blocked; cleanup must happen in ingestion. This is why the portal's delete is `archived_at`, not `DELETE` (`20260813_entity_archival`, [09 §2.19](09-mutations-rls.md#219-setentityarchivedentity-id-archived--the-portals-delete-migration-20260813_entity_archival)).
- `inboxes_active` on `campaign_daily_stats` is **not null** without a default — ingestion MUST supply it.
- Several `varchar(length)` columns (`phone_number 50`, `message_title 500`, `country 100`) are the only places lengths are enforced at the column level; text columns are unbounded.

Next: [04 · Metrics catalog](./04-metrics-catalog.md).





