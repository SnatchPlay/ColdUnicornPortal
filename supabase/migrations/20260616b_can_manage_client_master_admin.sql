-- Fix private.can_manage_client to include master_admin.
--
-- The clients_update_scoped policy uses USING (private.can_manage_client(id)).
-- Without master_admin in the allow-list, any UPDATE from a master_admin session
-- matched 0 rows, causing the gateway to return 404 "Client record was not found."
--
-- Root cause: the original function was written before master_admin was added as a
-- role (20260520_master_admin_role.sql), and was not updated when the other helpers
-- (is_admin_user, can_access_client, is_internal_user) were extended in
-- 20260520_master_admin_rls.sql and 20260526_master_admin_private_is_internal_user.sql.

CREATE OR REPLACE FUNCTION private.can_manage_client(target_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'private', 'auth'
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN private.current_app_role() IN ('super_admin', 'admin', 'master_admin') THEN true
    WHEN private.current_app_role() = 'manager' THEN EXISTS (
      SELECT 1
      FROM public.clients
      WHERE id = target_client_id
        AND manager_id = auth.uid()
    )
    ELSE false
  END;
$$;
