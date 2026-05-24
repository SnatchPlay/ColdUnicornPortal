-- Adds master_admin to the set of roles treated as internal admins by RLS helpers.
--
-- IMPORTANT: every helper must be SECURITY DEFINER. The `private` schema does
-- not grant USAGE to the `authenticated` role, so without SECURITY DEFINER an
-- RLS policy that calls one of these helpers would fail with
--   ERROR 42501: permission denied for schema private
-- causing every read against tables guarded by these policies to error out.
--
-- The original definition in prod had SECURITY DEFINER; this migration must
-- preserve it.

create or replace function private.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
  select coalesce(private.current_app_role() in ('super_admin', 'admin', 'master_admin'), false)
$$;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
  select coalesce(private.current_app_role() in ('super_admin', 'admin', 'master_admin'), false)
$$;

create or replace function public.is_internal_user()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
  select coalesce(private.current_app_role() in ('super_admin', 'admin', 'manager', 'master_admin'), false)
$$;

-- Also include master_admin in the can_access_client helper. Without this,
-- master_admin sees zero clients (and zero of everything keyed off client_id).
create or replace function private.can_access_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
  select case
    when auth.uid() is null then false
    when private.current_app_role() in ('super_admin', 'admin', 'master_admin') then true
    when private.current_app_role() = 'manager' then exists (
      select 1
      from public.clients
      where id = target_client_id
        and manager_id = auth.uid()
    )
    when private.current_app_role() = 'client' then exists (
      select 1
      from public.client_users cu
      where cu.client_id = target_client_id
        and cu.user_id = auth.uid()
    )
    else false
  end;
$$;
