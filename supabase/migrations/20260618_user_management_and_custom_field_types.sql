-- Task batch 2B / 2C / 3G.
--
-- 2C — User management: soft-deactivate + role change.
--   * Adds users.is_active / deactivated_at / deactivated_by (soft-deactivate;
--     hard delete would break FKs from clients.manager_id, *_updated_by, etc.).
--   * SECURITY DEFINER admin RPCs (admin_list_users / admin_update_user_role /
--     admin_set_user_active) enforce all role/deactivation invariants server-side.
--     They are called via supabase.rpc() from the repository (the orm-gateway edge
--     function is not redeployed in this change), so RLS on public.users stays
--     untouched (still users_select_self / users_select_internal / users_update_self).
--   * private.current_app_role() now returns NULL for a deactivated user, which
--     strips ALL role-gated RLS access — true server-side lockout, no edge deploy.
--   * public.current_account_active() lets the auth provider sign a deactivated
--     user out cleanly instead of leaving them in a data-less shell.
--
-- 3G — Custom field types: relax the field_type CHECK to allow 'number' and
--   'currency' (sorting/parsing is implemented entirely on the frontend; values
--   stay in client_custom_field_values as raw text).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2C.1 — soft-deactivate columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists is_active boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivated_by uuid references public.users(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2C.2 — current_app_role respects is_active (deactivated → NULL role → no RLS access)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function private.current_app_role()
returns text
language sql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
  select role::text
  from public.users
  where id = auth.uid()
    and coalesce(is_active, true)
  limit 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2C.3 — auth gate: is the *calling* user still active?
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.current_account_active()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select coalesce(
    (select is_active from public.users where id = auth.uid() limit 1),
    true
  );
$$;

revoke all on function public.current_account_active() from public;
grant execute on function public.current_account_active() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2C.4 — admin_list_users: all portal users + status (internal admins only)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_users()
returns setof public.users
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
begin
  if coalesce(private.current_app_role(), '') not in ('super_admin', 'admin', 'master_admin') then
    raise exception 'Not authorized to list users' using errcode = '42501';
  end if;
  return query
    select * from public.users
    order by is_active desc, created_at desc;
end;
$$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2C.5 — admin_update_user_role: change a user's role with safety invariants
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_update_user_role(target_user_id uuid, new_role public.user_role)
returns public.users
language plpgsql
security definer
set search_path to 'public', 'private', 'auth'
as $$
declare
  caller_role text := private.current_app_role();
  caller_id   uuid := auth.uid();
  target      public.users;
  remaining_admins int;
begin
  if coalesce(caller_role, '') not in ('super_admin', 'admin', 'master_admin') then
    raise exception 'Not authorized to manage users' using errcode = '42501';
  end if;

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  -- Never let a user change their own role (prevents accidental self-demotion).
  if target_user_id = caller_id then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  -- Only a super_admin may grant the super_admin role or modify a super_admin.
  if (new_role = 'super_admin' or target.role = 'super_admin') and caller_role <> 'super_admin' then
    raise exception 'Only a super admin can assign or modify the super admin role' using errcode = '42501';
  end if;

  -- Last-admin guard: demoting an admin-tier user out of the admin tier must
  -- leave at least one other active admin-tier user.
  if target.role in ('super_admin', 'admin', 'master_admin')
     and new_role not in ('super_admin', 'admin', 'master_admin') then
    select count(*) into remaining_admins
      from public.users
      where role in ('super_admin', 'admin', 'master_admin')
        and coalesce(is_active, true)
        and id <> target_user_id;
    if remaining_admins = 0 then
      raise exception 'Cannot remove the last remaining admin' using errcode = '42501';
    end if;
  end if;

  update public.users
    set role = new_role, updated_at = now()
    where id = target_user_id
    returning * into target;

  return target;
end;
$$;

revoke all on function public.admin_update_user_role(uuid, public.user_role) from public;
grant execute on function public.admin_update_user_role(uuid, public.user_role) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2C.6 — admin_set_user_active: deactivate / reactivate a user
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_user_active(target_user_id uuid, active boolean)
returns public.users
language plpgsql
security definer
set search_path to 'public', 'private', 'auth'
as $$
declare
  caller_role text := private.current_app_role();
  caller_id   uuid := auth.uid();
  target      public.users;
  remaining_admins int;
begin
  if coalesce(caller_role, '') not in ('super_admin', 'admin', 'master_admin') then
    raise exception 'Not authorized to manage users' using errcode = '42501';
  end if;

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  if target_user_id = caller_id and active = false then
    raise exception 'You cannot deactivate your own account' using errcode = '42501';
  end if;

  -- Only a super_admin may deactivate / reactivate a super_admin.
  if target.role = 'super_admin' and caller_role <> 'super_admin' then
    raise exception 'Only a super admin can change a super admin account' using errcode = '42501';
  end if;

  -- Last-admin guard on deactivation.
  if active = false and target.role in ('super_admin', 'admin', 'master_admin') then
    select count(*) into remaining_admins
      from public.users
      where role in ('super_admin', 'admin', 'master_admin')
        and coalesce(is_active, true)
        and id <> target_user_id;
    if remaining_admins = 0 then
      raise exception 'Cannot deactivate the last remaining admin' using errcode = '42501';
    end if;
  end if;

  update public.users set
    is_active = active,
    deactivated_at = case when active then null else now() end,
    deactivated_by = case when active then null else caller_id end,
    updated_at = now()
  where id = target_user_id
  returning * into target;

  return target;
end;
$$;

revoke all on function public.admin_set_user_active(uuid, boolean) from public;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3G.1 — allow 'number' and 'currency' custom field types
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.client_custom_fields
  drop constraint if exists client_custom_fields_field_type_check;
alter table public.client_custom_fields
  add constraint client_custom_fields_field_type_check
  check (field_type = any (array['text', 'checkbox', 'droplist', 'link', 'number', 'currency']));

commit;
