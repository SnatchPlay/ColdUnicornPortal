-- Security fix: SECURITY DEFINER functions were reachable by `anon`, and the
-- "who may touch a super_admin" rule was missing from one of the four user RPCs.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why the grants were wrong
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase ships `alter default privileges in schema public grant execute on
-- functions to anon, authenticated, service_role`. So every CREATE FUNCTION in
-- `public` hands `anon` a *direct* EXECUTE grant. `revoke all ... from public`
-- does NOT take it away — PUBLIC and `anon` are different grantees. Migrations
-- that wrote only `from public` (20260618, 20260619, 20260810, 20260903) left
-- their functions callable without signing in; the ones that wrote
-- `from public, anon, authenticated` (20260722e, 20260828b) are correct.
--
-- Impact, worst first:
--
--   * `mark_linkedin_invited(uuid[])` — SECURITY DEFINER, no caller check, and
--     it WRITES `public.leads`. Confirmed against a local copy of production:
--     with only the publishable key, `select` on leads returns `[]` (RLS holds)
--     but `POST /rest/v1/rpc/mark_linkedin_invited` returned 1 and stamped the
--     row. Migration 20260810 intended `service_role` only and said so in its
--     own comment; the grant simply did not match the intent. Knowing a lead
--     UUID is the only precondition.
--   * `admin_*` user RPCs — reachable by `anon`, but each one re-checks the
--     caller through `private.current_app_role()`, which is NULL for anon, so
--     they fail with 42501. Defence in depth, not an open door.
--   * `is_admin_user()`, `is_internal_user()` — granted to PUBLIC as well.
--     They only ever report on the caller, so anon reads `false`. Keeping the
--     `authenticated` grant is NOT optional: the live policy
--     `client_table_column_overrides.column_overrides_select` (migration
--     20260520) calls `public.is_admin_user()` and is `to authenticated`. It is
--     the only live one: `ccf_select` in the same migration was since rewritten
--     to inline `private.current_app_role()`, so read pg_policies, not the
--     migration text, before concluding anything here.
--     Beware when auditing: `pg_policies` prints it as a bare `is_admin_user()`
--     because `public` is in the search_path, so a grep for `public\.` finds
--     nothing and makes these look dead. They are not — do not `drop ... cascade`
--     them, or that policy goes with them and the table is left with no SELECT
--     policy for admins. Every other policy uses the `private.*` twin.
--
-- `public_lead_stats()` is deliberately anon-callable for the marketing site
-- (ADR-0014) and is therefore left exactly as it is.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why the avatar RPC needed a guard
-- ─────────────────────────────────────────────────────────────────────────────
-- `admin_update_user_role`, `admin_set_user_active` and `admin_set_user_name`
-- each spell out "only a super_admin may modify a super_admin" in their own
-- words; `admin_set_user_avatar` never had it, so a plain admin could replace a
-- super_admin's photo. Three phrasings of one rule is why the fourth was
-- forgotten, so the rule now lives in one place.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 — one home for "may I administer this user?"
-- ─────────────────────────────────────────────────────────────────────────────
-- Two halves, because they belong at different points in the flow. The originals
-- checked the caller's tier BEFORE looking the target row up, so a non-admin got
-- 42501 whether or not the id existed. Folding both halves into one call after the
-- lookup would have let a signed-in non-admin tell "user exists" (42501) from
-- "user does not exist" (P0002) — a behaviour change nobody asked for, so the
-- tier check stays first.
create or replace function private.assert_user_admin_tier()
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
begin
  if coalesce(private.current_app_role(), '') not in ('super_admin', 'admin', 'master_admin') then
    raise exception 'Not authorized to manage users' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_can_manage_user(p_target public.users)
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'auth'
as $$
declare
  caller_role text := private.current_app_role();
begin
  perform private.assert_user_admin_tier();

  -- Only a super_admin may modify a super_admin. Self is not special-cased: a
  -- super_admin editing their own row is a super_admin caller by construction.
  if p_target.role = 'super_admin' and caller_role <> 'super_admin' then
    raise exception 'Only a super admin can change a super admin account' using errcode = '42501';
  end if;
end;
$$;

-- No grant to `authenticated`: it has no USAGE on schema `private` (verified —
-- `has_schema_privilege('authenticated','private','USAGE')` is false), and these are
-- only ever called from inside a SECURITY DEFINER function, where permissions are
-- checked against the definer. A grant here would suggest a reachability that does
-- not exist.
revoke all on function private.assert_user_admin_tier() from public, anon, authenticated;
revoke all on function private.assert_can_manage_user(public.users) from public, anon, authenticated;

comment on function private.assert_can_manage_user(public.users) is
  'Shared guard for the admin_* user RPCs: internal-admin tier only, and only a super_admin may modify a super_admin. Call private.assert_user_admin_tier() before the row lookup and this after it. Per-RPC rules (self-demotion, last-admin) stay in their own function.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 — the four user RPCs now share that guard
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
  perform private.assert_user_admin_tier();

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  perform private.assert_can_manage_user(target);

  -- Never let a user change their own role (prevents accidental self-demotion).
  if target_user_id = caller_id then
    raise exception 'You cannot change your own role' using errcode = '42501';
  end if;

  -- Granting super_admin is a super_admin-only act; the shared guard covers the
  -- other direction (modifying an existing super_admin).
  if new_role = 'super_admin' and caller_role <> 'super_admin' then
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

create or replace function public.admin_set_user_active(target_user_id uuid, active boolean)
returns public.users
language plpgsql
security definer
set search_path to 'public', 'private', 'auth'
as $$
declare
  caller_id   uuid := auth.uid();
  target      public.users;
  remaining_admins int;
begin
  perform private.assert_user_admin_tier();

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  perform private.assert_can_manage_user(target);

  if target_user_id = caller_id and active = false then
    raise exception 'You cannot deactivate your own account' using errcode = '42501';
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

-- The behaviour change: an admin can no longer replace a super_admin's photo.
create or replace function public.admin_set_user_avatar(target_user_id uuid, new_avatar_path text)
returns public.users
language plpgsql
security definer
set search_path to 'public', 'private', 'auth'
as $$
declare
  target public.users;
begin
  perform private.assert_user_admin_tier();

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  perform private.assert_can_manage_user(target);

  update public.users
    set avatar_path = new_avatar_path,
        avatar_updated_at = now(),
        updated_at = now()
    where id = target_user_id
    returning * into target;

  return target;
end;
$$;

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
  target      public.users;
  first_clean text := nullif(btrim(coalesce(new_first_name, '')), '');
  last_clean  text := nullif(btrim(coalesce(new_last_name, '')), '');
begin
  perform private.assert_user_admin_tier();

  if first_clean is null and last_clean is null then
    raise exception 'A user needs at least a first or a last name' using errcode = '22023';
  end if;

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  perform private.assert_can_manage_user(target);

  update public.users
    set first_name = coalesce(first_clean, ''),
        last_name  = coalesce(last_clean, ''),
        updated_at = now()
    where id = target_user_id
    returning * into target;

  return target;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 — grants: `from public` alone never removed the default `anon` grant
-- ─────────────────────────────────────────────────────────────────────────────

-- n8n only (migration 20260810 said so; the grant did not match).
revoke all on function public.mark_linkedin_invited(uuid[]) from public, anon, authenticated;
grant execute on function public.mark_linkedin_invited(uuid[]) to service_role;

revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;

revoke all on function public.admin_update_user_role(uuid, public.user_role) from public, anon;
grant execute on function public.admin_update_user_role(uuid, public.user_role) to authenticated;

revoke all on function public.admin_set_user_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_user_active(uuid, boolean) to authenticated;

revoke all on function public.admin_set_user_avatar(uuid, text) from public, anon;
grant execute on function public.admin_set_user_avatar(uuid, text) to authenticated;

revoke all on function public.admin_set_user_name(uuid, text, text) from public, anon;
grant execute on function public.admin_set_user_name(uuid, text, text) to authenticated;

revoke all on function public.current_account_active() from public, anon;
grant execute on function public.current_account_active() to authenticated;

-- `column_overrides_select` (to authenticated) calls public.is_admin_user() — the grant must stay.
revoke all on function public.is_admin_user() from public, anon;
grant execute on function public.is_admin_user() to authenticated;

revoke all on function public.is_internal_user() from public, anon;
grant execute on function public.is_internal_user() to authenticated;

-- public.public_lead_stats() is intentionally anon-callable (ADR-0014) — untouched.

commit;
