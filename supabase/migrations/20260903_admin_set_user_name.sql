-- Admin-editable first/last name for a portal user.
--
-- Team users (2C) could change a role, a status and a photo, but not the name —
-- names arrived from the invite (typed by the inviter, or derived from the email
-- local part) and there was no way to correct a typo. This adds the missing
-- sibling RPC next to admin_update_user_role / admin_set_user_active /
-- admin_set_user_avatar, with the same guards:
--   * internal-admin tier only;
--   * only a super_admin may edit a super_admin.
-- Self-service name edits keep using the gateway `updateProfileName` action.

begin;

create or replace function public.admin_set_user_name(
  target_user_id uuid,
  new_first_name text,
  new_last_name text
)
returns public.users
language plpgsql
security definer
set search_path to 'public', 'private', 'auth'
as $$
declare
  caller_role text := private.current_app_role();
  target      public.users;
  first_clean text := nullif(btrim(coalesce(new_first_name, '')), '');
  last_clean  text := nullif(btrim(coalesce(new_last_name, '')), '');
begin
  if coalesce(caller_role, '') not in ('super_admin', 'admin', 'master_admin') then
    raise exception 'Not authorized to manage users' using errcode = '42501';
  end if;

  if first_clean is null and last_clean is null then
    raise exception 'A user needs at least a first or a last name' using errcode = '22023';
  end if;

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  -- Only a super_admin may edit a super_admin — same guard as admin_set_user_active.
  -- (No self-exception needed: a super_admin editing their own row has caller_role
  -- 'super_admin' by construction, so this never fires on self.)
  if target.role = 'super_admin' and caller_role <> 'super_admin' then
    raise exception 'Only a super admin can change a super admin account' using errcode = '42501';
  end if;

  update public.users
    set first_name = coalesce(first_clean, ''),
        last_name  = coalesce(last_clean, ''),
        updated_at = now()
    where id = target_user_id
    returning * into target;

  return target;
end;
$$;

revoke all on function public.admin_set_user_name(uuid, text, text) from public;
grant execute on function public.admin_set_user_name(uuid, text, text) to authenticated;

commit;
