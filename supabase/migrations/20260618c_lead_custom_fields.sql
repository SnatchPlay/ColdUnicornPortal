-- Client Feedback Batch 4, Task 4F: per-client custom columns on the Leads report.
-- Mirrors client_custom_fields but scoped to a specific client_id; values key on lead_id.
--   lead_custom_fields        — per-client field definitions (admin/master_admin define)
--   lead_custom_field_values  — per-lead values (edited per field.editable_by)
--
-- Field-value visibility/scoping reuses private.can_access_client so client/manager/admin scopes
-- match the rest of the app. Definitions are readable by the client role too because the report
-- is client-facing. Set-based subquery predicates per ADR-0006.

create table if not exists public.lead_custom_fields (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  field_type  text not null check (field_type in ('text','checkbox','droplist','link','number','currency')),
  options     jsonb,  -- required when field_type = 'droplist'; jsonb array of strings
  position    int not null default 0,
  editable_by text[] not null default '{admin,master_admin}',
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  constraint lcf_droplist_has_options check (
    (field_type <> 'droplist')
    or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0)
  )
);

create index if not exists idx_lead_custom_fields_client on public.lead_custom_fields (client_id);

create table if not exists public.lead_custom_field_values (
  lead_id     uuid not null references public.leads(id) on delete cascade,
  field_id    uuid not null references public.lead_custom_fields(id) on delete cascade,
  value       text,  -- stringified: 'true'/'false' for checkbox; selected option for droplist; raw otherwise
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id),
  primary key (lead_id, field_id)
);

alter table public.lead_custom_fields       enable row level security;
alter table public.lead_custom_field_values enable row level security;

-- Definitions: readable by anyone who can access the owning client (incl. client role).
drop policy if exists "lcf_select_scoped" on public.lead_custom_fields;
create policy "lcf_select_scoped"
on public.lead_custom_fields
for select
to authenticated
using (client_id in (select id from public.clients where private.can_access_client(id)));

-- Definitions: create/update/delete by admin / master_admin / super_admin only (Batch 4 decision).
drop policy if exists "lcf_write_admin" on public.lead_custom_fields;
create policy "lcf_write_admin"
on public.lead_custom_fields
for all
to authenticated
using (private.current_app_role() = any(array['super_admin','admin','master_admin']))
with check (private.current_app_role() = any(array['super_admin','admin','master_admin']));

-- Values: readable when you can access the lead's owning client.
drop policy if exists "lcfv_select_scoped" on public.lead_custom_field_values;
create policy "lcfv_select_scoped"
on public.lead_custom_field_values
for select
to authenticated
using (
  lead_id in (
    select l.id from public.leads l
    where l.client_id in (select id from public.clients where private.can_access_client(id))
  )
);

-- Values: writable when you can access the lead's client AND your role is in field.editable_by.
drop policy if exists "lcfv_write_scoped" on public.lead_custom_field_values;
create policy "lcfv_write_scoped"
on public.lead_custom_field_values
for all
to authenticated
using (
  exists (
    select 1
    from public.lead_custom_fields f
    join public.leads l on l.id = lead_custom_field_values.lead_id
    where f.id = lead_custom_field_values.field_id
      and private.can_access_client(l.client_id)
      and private.current_app_role() = any(f.editable_by)
  )
)
with check (
  exists (
    select 1
    from public.lead_custom_fields f
    join public.leads l on l.id = lead_custom_field_values.lead_id
    where f.id = lead_custom_field_values.field_id
      and private.can_access_client(l.client_id)
      and private.current_app_role() = any(f.editable_by)
  )
);
