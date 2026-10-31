CREATE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM public.users AS u
  WHERE u.auth_user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE FUNCTION public.current_user_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT tm.tenant_id
  FROM public.tenant_members AS tm
  JOIN public.users AS u ON u.id = tm.user_id
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND tm.status = 'active';
$$;

CREATE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users AS u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.role = 'platform_owner'
      AND u.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_tenant_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_platform_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated, service_role;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_select ON public.tenants
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_tenant_ids()) OR public.is_platform_owner());
CREATE POLICY tenants_insert ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_owner());
CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY tenants_delete ON public.tenants
  FOR DELETE TO authenticated
  USING (id IN (SELECT public.current_user_tenant_ids()));

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON public.users
  FOR SELECT TO authenticated
  USING (
    auth_user_id = (SELECT auth.uid())
    OR tenant_id IN (SELECT public.current_user_tenant_ids())
    OR public.is_platform_owner()
  );
CREATE POLICY users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    role <> 'platform_owner'
    AND tenant_id IN (SELECT public.current_user_tenant_ids())
  );
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (
    role <> 'platform_owner'
    AND tenant_id IN (SELECT public.current_user_tenant_ids())
  );
CREATE POLICY users_delete ON public.users
  FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant_members',
    'branding',
    'packages',
    'customers',
    'transactions',
    'sessions',
    'gateways',
    'devices',
    'gateway_commands'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated USING (tenant_id IN (SELECT public.current_user_tenant_ids()) OR public.is_platform_owner())',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE TO authenticated USING (tenant_id IN (SELECT public.current_user_tenant_ids())) WITH CHECK (tenant_id IN (SELECT public.current_user_tenant_ids()))',
      table_name
    );
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE TO authenticated USING (tenant_id IN (SELECT public.current_user_tenant_ids()))',
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    OR public.is_platform_owner()
  );
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND (actor_user_id IS NULL OR actor_user_id = public.current_app_user_id())
  );
REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_select ON public.platform_settings
  FOR SELECT TO authenticated
  USING (
    public.is_platform_owner()
    OR tenant_id IN (SELECT public.current_user_tenant_ids())
  );
CREATE POLICY platform_settings_insert ON public.platform_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_platform_owner()
    OR tenant_id IN (SELECT public.current_user_tenant_ids())
  );
CREATE POLICY platform_settings_update ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_owner()
    OR tenant_id IN (SELECT public.current_user_tenant_ids())
  )
  WITH CHECK (
    public.is_platform_owner()
    OR tenant_id IN (SELECT public.current_user_tenant_ids())
  );
CREATE POLICY platform_settings_delete ON public.platform_settings
  FOR DELETE TO authenticated
  USING (
    public.is_platform_owner()
    OR tenant_id IN (SELECT public.current_user_tenant_ids())
  );