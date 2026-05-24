-- Master-admin-defined custom columns on the Clients mega-table.
-- Two tables:
--   client_custom_fields        — field definitions (text / checkbox / droplist)
--   client_custom_field_values  — per-client values
-- Writes to both tables are master_admin only (Phase 3.2). Other internal
-- admins see the columns and values but cannot edit.

create table if not exists public.client_custom_fields (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  field_type  text not null check (field_type in ('text','checkbox','droplist')),
  options     jsonb,  -- required when field_type = 'droplist'; jsonb array of strings
  position    int not null default 0,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now(),
  constraint ccf_droplist_has_options check (
    (field_type <> 'droplist')
    or (jsonb_typeof(options) = 'array' and jsonb_array_length(options) > 0)
  )
);

create table if not exists public.client_custom_field_values (
  client_id   uuid not null references public.clients(id) on delete cascade,
  field_id    uuid not null references public.client_custom_fields(id) on delete cascade,
  value       text,  -- stringified: 'true'/'false' for checkbox; selected option for droplist; raw text otherwise
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.users(id),
  primary key (client_id, field_id)
);

alter table public.client_custom_fields       enable row level security;
alter table public.client_custom_field_values enable row level security;

drop policy if exists "ccf_select" on public.client_custom_fields;
create policy "ccf_select"
on public.client_custom_fields
for select
to authenticated
using (public.is_admin_user());

drop policy if exists "ccf_write_master" on public.client_custom_fields;
create policy "ccf_write_master"
on public.client_custom_fields
for all
to authenticated
using (private.current_app_role() = 'master_admin')
with check (private.current_app_role() = 'master_admin');

drop policy if exists "ccfv_select_scoped" on public.client_custom_field_values;
create policy "ccfv_select_scoped"
on public.client_custom_field_values
for select
to authenticated
using (private.can_access_client(client_id));

drop policy if exists "ccfv_write_master" on public.client_custom_field_values;
create policy "ccfv_write_master"
on public.client_custom_field_values
for all
to authenticated
using (private.current_app_role() = 'master_admin')
with check (private.current_app_role() = 'master_admin');
