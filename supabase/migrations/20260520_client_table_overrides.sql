-- Per-column label and visibility overrides for the Clients mega-table.
-- Editable only by master_admin (Phase 3.1 of the master_admin scope).
-- Other internal admins see the overrides applied but cannot edit.

create table if not exists public.client_table_column_overrides (
  column_key   text primary key,
  label_override text,
  hidden       boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.users(id)
);

alter table public.client_table_column_overrides enable row level security;

drop policy if exists "column_overrides_select" on public.client_table_column_overrides;
create policy "column_overrides_select"
on public.client_table_column_overrides
for select
to authenticated
using (public.is_admin_user());

drop policy if exists "column_overrides_write_master" on public.client_table_column_overrides;
create policy "column_overrides_write_master"
on public.client_table_column_overrides
for all
to authenticated
using (private.current_app_role() = 'master_admin')
with check (private.current_app_role() = 'master_admin');
