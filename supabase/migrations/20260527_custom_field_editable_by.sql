-- Add editable_by column to client_custom_fields.
-- Allows master_admin to specify which roles can write values into a field.
-- Default is '{master_admin}' to preserve existing behaviour.

alter table public.client_custom_fields
  add column if not exists editable_by text[] not null default '{master_admin}';

-- Extend ccf_select so managers can read field definitions
-- (they need them to display custom columns in their Clients table).
drop policy if exists "ccf_select" on public.client_custom_fields;
create policy "ccf_select"
on public.client_custom_fields
for select
to authenticated
using (
  private.current_app_role() = any(array['super_admin', 'admin', 'master_admin', 'manager'])
);

-- Replace the master-admin-only write policy on values with a role-scoped one.
-- A user may upsert a value when:
--   1. they can access the client (owns it as manager, or is admin/master_admin/super_admin), AND
--   2. their role is listed in the field's editable_by array.
drop policy if exists "ccfv_write_master" on public.client_custom_field_values;
create policy "ccfv_write_scoped"
on public.client_custom_field_values
for all
to authenticated
using (
  private.can_access_client(client_id)
  and exists (
    select 1
    from public.client_custom_fields ccf
    where ccf.id = field_id
      and private.current_app_role() = any(ccf.editable_by)
  )
)
with check (
  private.can_access_client(client_id)
  and exists (
    select 1
    from public.client_custom_fields ccf
    where ccf.id = field_id
      and private.current_app_role() = any(ccf.editable_by)
  )
);
