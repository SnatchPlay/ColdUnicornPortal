-- Task batch 10D — user avatars / faces instead of initials.
--
--   * Adds users.avatar_path (stored storage object path; never a URL) and
--     users.avatar_updated_at (audit: when the photo was last changed). No
--     cache-busting needed — every upload uses a fresh UUID filename.
--   * Creates the PUBLIC storage bucket `user-avatars`. We deliberately use a
--     public bucket (not private + signed URLs): avatars are low-sensitivity face
--     photos with unguessable UUID object names, public read removes per-render
--     signing latency and list-batching complexity, and we still store only the
--     object PATH in the DB (the public URL is derived at render via getPublicUrl).
--   * Storage RLS: any authenticated user may READ; a user may WRITE only inside
--     their own folder `avatars/{user_id}/…`, and admin-tier users may write any
--     avatar (for User Management). No anonymous writes; the app never lists the
--     bucket.
--   * admin_set_user_avatar() — SECURITY DEFINER, admin-tier only, sets a target
--     user's avatar_path (the self path goes through the orm-gateway
--     updateProfileAvatar action under users_update_self RLS, like updateProfileName).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10D.1 — avatar columns
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.users
  add column if not exists avatar_path text,
  add column if not exists avatar_updated_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10D.2 — public storage bucket (idempotent), with server-side type/size limits
-- ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-avatars',
  'user-avatars',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10D.3 — storage.objects RLS for the user-avatars bucket
--   path convention: avatars/{user_id}/{uuid}.{ext}
--   → (storage.foldername(name))[1] = 'avatars', [2] = owner user id
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists "user_avatars_read" on storage.objects;
create policy "user_avatars_read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'user-avatars');

drop policy if exists "user_avatars_insert" on storage.objects;
create policy "user_avatars_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or private.is_admin_user()
    )
  );

drop policy if exists "user_avatars_update" on storage.objects;
create policy "user_avatars_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or private.is_admin_user()
    )
  )
  with check (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or private.is_admin_user()
    )
  );

drop policy if exists "user_avatars_delete" on storage.objects;
create policy "user_avatars_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'user-avatars'
    and (storage.foldername(name))[1] = 'avatars'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or private.is_admin_user()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 10D.4 — admin_set_user_avatar: set a target user's avatar path (admin-tier only)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.admin_set_user_avatar(target_user_id uuid, new_avatar_path text)
returns public.users
language plpgsql
security definer
set search_path to 'public', 'private', 'auth'
as $$
declare
  caller_role text := private.current_app_role();
  target      public.users;
begin
  if coalesce(caller_role, '') not in ('super_admin', 'admin', 'master_admin') then
    raise exception 'Not authorized to manage users' using errcode = '42501';
  end if;

  select * into target from public.users where id = target_user_id;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  update public.users
    set avatar_path = new_avatar_path,
        avatar_updated_at = now(),
        updated_at = now()
    where id = target_user_id
    returning * into target;

  return target;
end;
$$;

revoke all on function public.admin_set_user_avatar(uuid, text) from public;
grant execute on function public.admin_set_user_avatar(uuid, text) to authenticated;

commit;
