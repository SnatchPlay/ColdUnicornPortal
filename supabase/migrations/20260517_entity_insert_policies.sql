-- INSERT RLS policies for client-created entities
-- Pattern: set-based predicate matching 20260421_fix_rls_performance.sql style

-- clients: any internal role may insert (manager onboards their own clients)
CREATE POLICY clients_insert_internal ON public.clients
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid())
    IN ('super_admin', 'admin', 'manager')
  );

-- campaigns: admin/super_admin may insert for any client;
--            manager may insert only for clients assigned to them
CREATE POLICY campaigns_insert_internal ON public.campaigns
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'admin')
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND client_id IN (SELECT id FROM public.clients WHERE manager_id = auth.uid())
    )
  );

-- leads: same scoping as campaigns
CREATE POLICY leads_insert_internal ON public.leads
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'admin')
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND client_id IN (SELECT id FROM public.clients WHERE manager_id = auth.uid())
    )
  );

-- domains: same scoping as campaigns
CREATE POLICY domains_insert_internal ON public.domains
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'admin')
    OR (
      (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
      AND client_id IN (SELECT id FROM public.clients WHERE manager_id = auth.uid())
    )
  );
