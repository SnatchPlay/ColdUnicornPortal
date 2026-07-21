-- OOO / NRR model (ADR-0015): sequencer contacts and OOO follow-ups become first-class entities,
-- so a CRM lead is created ONLY after a positive reply. Until then the person is an external
-- `sequencer_contact`, never a `leads` row.
--
-- What this migration is NOT: it does not remove anything. `leads.expected_return_date`,
-- `leads.added_to_ooo_campaign`, `leads.contact_disposition` and the `OOO`/`NRR` values of
-- `lead_qualification` all keep working until n8n cuts over to the RPCs in 20260722e — the
-- DESTRUCTIVE companion is 20260722z_drop_legacy_ooo_columns.sql (deferred, see its header).
--
-- Two DIFFERENT idempotency invariants live on `ooo_followups`, and conflating them is the classic
-- bug here:
--   * uq_ooo_followups_active      — at most one ACTIVE follow-up per contact (spec §4/§17).
--     `submitted`/`confirmed` are deliberately NOT active: `submitted` closes the current OOO
--     episode, so a NEW OOO reply months later is allowed to open the next one.
--   * uq_ooo_followups_source_reply — the same OOO reply never produces a second follow-up. This is
--     what protects against a redelivered ingestion event once the previous episode is `submitted`
--     (the active index no longer covers it).
--
-- Same split on `leads`:
--   * uq_leads_origin_reply                 — one reply never creates two leads (reprocessing).
--   * uq_leads_source_sequencer_contact     — one external contact never creates two leads. A second
--     positive reply from the same person attaches to the EXISTING lead. If independent sales cycles
--     per person are ever needed, that is a new `opportunities` entity, not a duplicate lead.
--
-- Attempt history: `attempt_count` / `last_attempt_at` / `last_error` record the LAST attempt only,
-- not a full audit trail. A per-attempt table (`ooo_followup_attempts`) is intentionally out of
-- scope — §13 does not need it. Do not document these columns as "attempt history".

begin;

-- --- enums (guarded so a partial re-run is safe) ----------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'ooo_followup_status') then
    create type public.ooo_followup_status as enum
      ('pending', 'processing', 'submitted', 'confirmed', 'failed', 'skipped', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'ooo_routing_source') then
    create type public.ooo_routing_source as enum ('automatic', 'manual_override');
  end if;
end $$;

-- --- sequencer_contacts: local identity of an external contact --------------------------------
-- Business identity is SCOPED (spec §2): an external contact id is meaningless without the
-- workspace it came from, so the natural key is (client_sequencer_id, external_contact_id).
-- This table holds NO CRM state — no stage, no qualification, no outcome. Client scope is reached
-- through client_sequencers.client_id.
create table if not exists public.sequencer_contacts (
  id                   uuid primary key default gen_random_uuid(),
  client_sequencer_id  uuid not null references public.client_sequencers(id) on delete cascade,
  external_contact_id  text not null,
  email                text,
  first_name           text,
  last_name            text,
  -- Drives OOO routing. 'general' is EXPLICIT — NULL is never used as an implicit "general" (§11).
  routing_key          text not null default 'general'
                         check (routing_key in ('male', 'female', 'general')),
  first_seen_at        timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  raw_payload          jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint uq_sequencer_contacts_identity unique (client_sequencer_id, external_contact_id)
);
create index if not exists idx_sequencer_contacts_email on public.sequencer_contacts (lower(email));

-- --- ooo_followups: the operational record ----------------------------------------------------
create table if not exists public.ooo_followups (
  id                   uuid primary key default gen_random_uuid(),
  sequencer_contact_id uuid not null references public.sequencer_contacts(id) on delete cascade,
  source_reply_id      uuid references public.replies(id) on delete set null,

  -- TWO DISTINCT DATES (spec §3). `expected_return_date` is the date actually determined from the
  -- OOO reply and stays NULL when it could not be determined — a fallback date must NEVER be
  -- written here as if it were a real return date. `scheduled_for` is when the contact should be
  -- re-enrolled, and MAY be computed by a fallback rule.
  expected_return_date date,
  scheduled_for        date not null,
  date_source          text not null check (date_source in ('reply_parsed', 'fallback', 'manual')),

  status               public.ooo_followup_status not null default 'pending',

  -- Routing SNAPSHOT of this episode. Client routing config and the contact's routing_key can both
  -- change later; a finished follow-up must keep showing the campaign it actually went to.
  routing_key          text not null check (routing_key in ('male', 'female', 'general')),
  target_campaign_id   uuid references public.campaigns(id) on delete set null,
  routing_source       public.ooo_routing_source not null default 'automatic',

  attempt_count        integer not null default 0 check (attempt_count >= 0),
  next_attempt_at      timestamptz,
  last_attempt_at      timestamptz,
  submitted_at         timestamptz,
  confirmed_at         timestamptz,
  cancelled_at         timestamptz,
  cancellation_reason  text check (cancellation_reason in
                         ('ooo_removed', 'positive_reply_received', 'manual_cancel',
                          'classification_corrected', 'superseded')),
  skip_reason          text check (skip_reason in
                         ('routing_missing', 'campaign_missing', 'automation_disabled',
                          'contact_ineligible')),
  last_error           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Terminal states must carry their evidence. Implications are one-way on purpose: a reopened
  -- record KEEPS its previous cancelled_at / cancellation_reason as audit history.
  constraint ooo_followups_cancelled_check
    check (status <> 'cancelled' or (cancelled_at is not null and cancellation_reason is not null)),
  constraint ooo_followups_skipped_check
    check (status <> 'skipped' or skip_reason is not null),
  constraint ooo_followups_submitted_check
    check (status not in ('submitted', 'confirmed') or submitted_at is not null),
  constraint ooo_followups_confirmed_check
    check (status <> 'confirmed' or confirmed_at is not null)
);

-- At most one ACTIVE follow-up per contact (§17). submitted/confirmed excluded — see header.
create unique index if not exists uq_ooo_followups_active
  on public.ooo_followups (sequencer_contact_id)
  where status in ('pending', 'processing', 'failed');

-- The same OOO reply never opens a second episode — the redelivery guard that survives `submitted`.
create unique index if not exists uq_ooo_followups_source_reply
  on public.ooo_followups (source_reply_id)
  where source_reply_id is not null;

create index if not exists idx_ooo_followups_due      on public.ooo_followups (status, scheduled_for);
create index if not exists idx_ooo_followups_contact  on public.ooo_followups (sequencer_contact_id);
-- NOTE: no index on `updated_at`. The operational list's window is
-- `status IN (active) OR updated_at >= now() - 180d`, and that predicate is NOT selective enough for
-- one: measured on 20,777 episodes it passes ~21% of rows, so the planner correctly prefers a seq
-- scan, and at steady state the ratio does not improve (a 180-day window over a few years of history
-- keeps a similar share). An index was added, measured, found unused, and removed rather than left
-- in to cost write amplification on every follow-up update.
--   EXPLAIN (ANALYZE, BUFFERS) as `authenticated`, local prod-dump copy + 20,777 synthetic episodes:
--   Limit → Sort (top-N heapsort, 568kB) → Hash Join → Seq Scan on ooo_followups (4397 of 20777).
--   Planning 0.881 ms, Execution 25.0 ms. RLS resolves as a hashed semi-join; private.can_* runs
--   only over `clients` (53 rows), never per follow-up row (ADR-0006).

-- --- replies: a reply can exist without a CRM lead (spec §10, AC-4) ---------------------------
-- `lead_id` was already nullable; this adds the contact anchor so a reply received BEFORE any lead
-- exists is still attributable. `replies.external_id` stays globally UNIQUE (ingestion idempotency).
alter table public.replies
  add column if not exists sequencer_contact_id uuid references public.sequencer_contacts(id) on delete set null;
create index if not exists idx_replies_sequencer_contact on public.replies (sequencer_contact_id);

-- --- leads: provenance of a promoted contact --------------------------------------------------
alter table public.leads
  add column if not exists source_sequencer_contact_id uuid references public.sequencer_contacts(id) on delete set null,
  add column if not exists origin_reply_id             uuid references public.replies(id) on delete set null;

-- One reply never creates two leads (reprocessing the same positive reply).
create unique index if not exists uq_leads_origin_reply
  on public.leads (origin_reply_id)
  where origin_reply_id is not null;

-- NOTE: uq_leads_source_sequencer_contact is created in 20260722f_ooo_backfill.sql, AFTER the
-- backfill has resolved duplicate (client_sequencer, external_id) leads. Creating it here would
-- make the backfill unrunnable on a database that already contains such duplicates.

-- --- client_ooo_routing: explicit routing_key, no NULL-as-general (spec §11) -------------------
alter table public.client_ooo_routing
  add column if not exists routing_key text,
  add column if not exists updated_at  timestamptz not null default now();

update public.client_ooo_routing
   set routing_key = coalesce(gender::text, 'general')
 where routing_key is null;

-- At most one ACTIVE config per (client, routing_key). Deactivate older duplicates rather than
-- deleting them — configuration history is evidence for why a past follow-up routed where it did.
update public.client_ooo_routing r
   set is_active = false
 where coalesce(r.is_active, true)
   and exists (
     select 1
     from public.client_ooo_routing newer
     where newer.client_id   = r.client_id
       and newer.routing_key = r.routing_key
       and coalesce(newer.is_active, true)
       and (newer.created_at, newer.id) > (r.created_at, r.id)
   );

alter table public.client_ooo_routing
  alter column routing_key set not null,
  alter column is_active   set default true;
update public.client_ooo_routing set is_active = true where is_active is null;
alter table public.client_ooo_routing
  alter column is_active set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'client_ooo_routing_routing_key_check') then
    alter table public.client_ooo_routing
      add constraint client_ooo_routing_routing_key_check
      check (routing_key in ('male', 'female', 'general'));
  end if;
end $$;

create unique index if not exists uq_client_ooo_routing_active
  on public.client_ooo_routing (client_id, routing_key)
  where is_active;

-- --- RLS ON at creation time (policies land in 20260722d) -------------------------------------
-- Deliberately NOT deferred to the policy migration. Migrations are applied and recorded one file
-- at a time, so if any file between this one and `d` fails (20260722c aborts by design when
-- production holds duplicate replies.external_id), these tables would sit in the schema with RLS
-- OFF and be readable by every `authenticated` caller through PostgREST. Enabling it here makes the
-- unsafe intermediate state impossible: with RLS on and no policy yet, the tables deny all access
-- to `authenticated` and remain reachable only by service_role — the correct default either way.
alter table public.sequencer_contacts enable row level security;
alter table public.ooo_followups      enable row level security;

-- --- updated_at triggers (shared repo function) -----------------------------------------------
create or replace trigger set_updated_at before update on public.sequencer_contacts  for each row execute function public.handle_updated_at();
create or replace trigger set_updated_at before update on public.ooo_followups       for each row execute function public.handle_updated_at();
create or replace trigger set_updated_at before update on public.client_ooo_routing  for each row execute function public.handle_updated_at();

-- --- comments (the read-model contract these tables promise) -----------------------------------
comment on table public.sequencer_contacts is
  'ADR-0015. External sequencer contact with SCOPED identity (client_sequencer_id + external_contact_id). Holds no CRM state — a CRM lead exists only after a positive reply.';
comment on table public.ooo_followups is
  'ADR-0015. Operational OOO follow-up episode. Never hard-deleted: cancel sets status/cancelled_at/cancellation_reason so the history of what was detected, scheduled and attempted survives.';
comment on column public.ooo_followups.expected_return_date is
  'The return date actually determined from the OOO reply. NULL when it could not be determined — never a fallback date.';
comment on column public.ooo_followups.scheduled_for is
  'When the contact should be re-enrolled. May be derived by a fallback rule when expected_return_date is NULL.';
comment on column public.ooo_followups.attempt_count is
  'Number of processing attempts. Together with last_attempt_at/last_error this records the LAST attempt only — not a per-attempt audit trail.';
comment on column public.ooo_followups.routing_source is
  'automatic = target_campaign_id resolved from client_ooo_routing; manual_override = an operator pinned the campaign.';

commit;
