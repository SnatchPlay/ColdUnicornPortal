-- Lead CRM view (ADR-0013, Cold CRM / PDCA spec §8): four lead-owned child tables plus six new
-- lead columns. Additive only. Enums, indexes and the shared handle_updated_at() trigger follow the
-- repo conventions. RLS is added in 20260719b; boolean-sync triggers in 20260719c.
-- Status taxonomy (leads.crm_status) is a separate migration (Phase 1b) so the KPI cutover is isolated.

-- --- enums (guarded so a partial re-run is safe) ---------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname = 'meeting_type') then
    create type public.meeting_type as enum ('intro', 'summary', 'general');
  end if;
  if not exists (select 1 from pg_type where typname = 'meeting_status') then
    create type public.meeting_status as enum ('planned', 'scheduled', 'held', 'cancelled', 'no_show');
  end if;
  if not exists (select 1 from pg_type where typname = 'offer_status') then
    create type public.offer_status as enum ('planned', 'sent', 'accepted', 'rejected', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type public.task_status as enum ('planned', 'in_progress', 'completed', 'cancelled', 'skipped');
  end if;
end $$;

-- --- new leads columns (spec §8.1). contact_method is text+CHECK (no enum) per spec. ---------
alter table public.leads
  add column if not exists linkedin_invitation_sent_at timestamptz,
  add column if not exists contact_made_at              timestamptz,
  add column if not exists contact_method               text,
  add column if not exists negotiation_started_at       timestamptz,
  add column if not exists conclusion                   text,
  add column if not exists concluded_at                 timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'leads_contact_method_check') then
    alter table public.leads
      add constraint leads_contact_method_check check (contact_method in ('phone', 'email'));
  end if;
end $$;

-- --- lead_meetings (spec §8.2): intro/summary one-per-lead, general repeats -------------------
create table if not exists public.lead_meetings (
  id                                   uuid primary key default gen_random_uuid(),
  lead_id                              uuid not null references public.leads(id) on delete cascade,
  meeting_type                         public.meeting_type   not null,
  status                               public.meeting_status not null default 'planned',
  call_script                          text,
  scheduled_at                         timestamptz,
  held_at                              timestamptz,
  meeting_url                          text,
  calendar_event_id                    text,
  transcription_url                    text,
  pre_meeting_insights                 text,
  pre_meeting_insights_generated_at    timestamptz,
  process_score                        numeric(5, 2) check (process_score is null or (process_score >= 0 and process_score <= 100)),
  conversion_insights                  text,
  post_meeting_analysis_generated_at   timestamptz,
  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now()
);
create index if not exists idx_lead_meetings_lead_type on public.lead_meetings (lead_id, meeting_type);
-- One primary intro and one primary summary per lead (spec §8.2). General meetings are not unique.
create unique index if not exists uq_lead_meetings_intro   on public.lead_meetings (lead_id) where meeting_type = 'intro';
create unique index if not exists uq_lead_meetings_summary on public.lead_meetings (lead_id) where meeting_type = 'summary';

-- --- lead_offers (spec §8.3): multiple offers/revisions allowed -------------------------------
create table if not exists public.lead_offers (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.leads(id) on delete cascade,
  status                public.offer_status not null default 'planned',
  contracted_send_date  date,
  sent_at               timestamptz,
  offer_url             text,
  notes                 text,
  source_meeting_id     uuid references public.lead_meetings(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_lead_offers_lead_created on public.lead_offers (lead_id, created_at desc);

-- --- lead_tasks (spec §8.4): no task_type in MVP ---------------------------------------------
create table if not exists public.lead_tasks (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads(id) on delete cascade,
  title              text not null,
  due_at             timestamptz,
  status             public.task_status not null default 'planned',
  started_at         timestamptz,
  completed_at       timestamptz,
  source_meeting_id  uuid references public.lead_meetings(id) on delete set null,
  notes              text,
  position           smallint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_lead_tasks_lead_status_due on public.lead_tasks (lead_id, status, due_at);

-- --- lead_value_deliveries (spec §8.5): sequence 1/2 shown in the view ------------------------
create table if not exists public.lead_value_deliveries (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references public.leads(id) on delete cascade,
  sequence_number    smallint not null check (sequence_number > 0),
  planned_date       date,
  value_items        text[] not null default '{}',
  sent_at            timestamptz,
  source_meeting_id  uuid references public.lead_meetings(id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint uq_lead_value_deliveries_seq unique (lead_id, sequence_number)
);

-- --- updated_at triggers (shared repo function) ----------------------------------------------
create or replace trigger set_updated_at before update on public.lead_meetings         for each row execute function public.handle_updated_at();
create or replace trigger set_updated_at before update on public.lead_offers           for each row execute function public.handle_updated_at();
create or replace trigger set_updated_at before update on public.lead_tasks            for each row execute function public.handle_updated_at();
create or replace trigger set_updated_at before update on public.lead_value_deliveries for each row execute function public.handle_updated_at();
