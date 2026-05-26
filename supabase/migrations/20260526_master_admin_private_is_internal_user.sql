-- Adds master_admin to private.is_internal_user (parity with public.is_internal_user).
--
-- Why: 20260520_master_admin_rls.sql added master_admin to private.is_admin_user,
-- public.is_admin_user, public.is_internal_user, and private.can_access_client,
-- but missed private.is_internal_user. RLS policies
--   - public.users.users_select_internal
--   - public.email_exclude_list.email_exclude_list_select_internal
-- call private.is_internal_user(), so master_admin was denied access to other
-- users and to the email exclude list. On the Statistics page this surfaced as
-- "Unknown manager" rows because the snapshot's users[] array did not contain
-- the manager users.
--
-- Keeps SECURITY DEFINER for the same reason documented in the prior migration:
-- the private schema does not grant USAGE to authenticated.

create or replace function private.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
  select coalesce(private.current_app_role() in ('super_admin', 'admin', 'manager', 'master_admin'), false)
$$;
