-- Fix insert policies to include master_admin role.
-- The 20260517_entity_insert_policies.sql migration omitted master_admin,
-- blocking insert attempts from users with that role.

ALTER POLICY clients_insert_internal ON public.clients
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid())
    IN ('super_admin', 'admin', 'manager', 'master_admin')
  );

ALTER POLICY campaigns_insert_internal ON public.campaigns
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'admin', 'master_admin')
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND client_id IN (SELECT id FROM public.clients WHERE manager_id = auth.uid())
    )
  );

ALTER POLICY leads_insert_internal ON public.leads
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'admin', 'master_admin')
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND client_id IN (SELECT id FROM public.clients WHERE manager_id = auth.uid())
    )
  );

ALTER POLICY domains_insert_internal ON public.domains
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'admin', 'master_admin')
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND client_id IN (SELECT id FROM public.clients WHERE manager_id = auth.uid())
    )
  );
