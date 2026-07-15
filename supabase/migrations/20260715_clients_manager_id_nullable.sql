-- Make `clients.manager_id` optional.
--
-- Product change: a client can now be created (and left) without an assigned owner. Previously
-- the column was NOT NULL, which forced every new client to pick a CS Manager up front. The UI
-- already renders an unassigned client as "Unassigned" (it just never had a way to persist that
-- state), so this simply lets NULL through.
--
-- Safety of the existing RLS: `private.can_access_client` gates managers with
-- `manager_id = auth.uid()` (see 20260520_master_admin_rls.sql). For a NULL `manager_id` that
-- predicate is false, so an unassigned client is invisible to every manager and visible only to
-- admin/master_admin/super_admin — exactly the intended behaviour for an unowned client. No
-- policy change is required.
--
-- The FK `clients_manager_id_fkey -> users(id)` is unaffected: a NULL value is not checked by the
-- foreign key, and non-NULL ids still must reference a real user. Assigning an admin (not only a
-- `manager` role) is likewise already allowed by the FK.

begin;

alter table public.clients
  alter column manager_id drop not null;

commit;
