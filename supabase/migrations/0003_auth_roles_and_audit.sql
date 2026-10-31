ALTER TYPE public.app_role RENAME VALUE 'owner' TO 'tenant_owner';

ALTER TABLE public.audit_logs
  ALTER COLUMN tenant_id DROP NOT NULL;

CREATE FUNCTION public.current_user_tenant_role(target_tenant_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT tm.role
  FROM public.tenant_members AS tm
  JOIN public.users AS u ON u.id = tm.user_id
  WHERE u.auth_user_id = (SELECT auth.uid())
    AND tm.tenant_id = target_tenant_id
    AND tm.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_tenant_ids()
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
    AND tm.status = 'active'
    AND (
      tm.role <> 'support'
      OR (SELECT auth.jwt() ->> 'aal') = 'aal2'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_platform_owner()
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
      AND (SELECT auth.jwt() ->> 'aal') = 'aal2'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_tenant_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_role(uuid) TO authenticated, service_role;

DROP POLICY tenant_insert ON public.tenant_members;
DROP POLICY tenant_update ON public.tenant_members;
DROP POLICY tenant_delete ON public.tenant_members;
CREATE POLICY tenant_members_insert ON public.tenant_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_tenant_role(tenant_id) = 'tenant_owner'
    OR (
      public.current_user_tenant_role(tenant_id) = 'manager'
      AND role IN ('cashier', 'support')
    )
  );
CREATE POLICY tenant_members_update ON public.tenant_members
  FOR UPDATE TO authenticated
  USING (
    public.current_user_tenant_role(tenant_id) = 'tenant_owner'
    OR (
      public.current_user_tenant_role(tenant_id) = 'manager'
      AND user_id <> public.current_app_user_id()
      AND role IN ('cashier', 'support')
    )
  )
  WITH CHECK (
    public.current_user_tenant_role(tenant_id) = 'tenant_owner'
    OR (
      public.current_user_tenant_role(tenant_id) = 'manager'
      AND user_id <> public.current_app_user_id()
      AND role IN ('cashier', 'support')
    )
  );
CREATE POLICY tenant_members_delete ON public.tenant_members
  FOR DELETE TO authenticated
  USING (
    public.current_user_tenant_role(tenant_id) = 'tenant_owner'
    OR (
      public.current_user_tenant_role(tenant_id) = 'manager'
      AND user_id <> public.current_app_user_id()
      AND role IN ('cashier', 'support')
    )
  );

DROP POLICY users_insert ON public.users;
DROP POLICY users_update ON public.users;
DROP POLICY users_delete ON public.users;
CREATE POLICY users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND (
      public.current_user_tenant_role(tenant_id) = 'tenant_owner'
      OR (
        public.current_user_tenant_role(tenant_id) = 'manager'
        AND role IN ('cashier', 'support')
      )
    )
  );
CREATE POLICY users_update ON public.users
  FOR UPDATE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND (
      public.current_user_tenant_role(tenant_id) = 'tenant_owner'
      OR (
        public.current_user_tenant_role(tenant_id) = 'manager'
        AND id <> public.current_app_user_id()
        AND role IN ('cashier', 'support')
      )
    )
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND (
      public.current_user_tenant_role(tenant_id) = 'tenant_owner'
      OR (
        public.current_user_tenant_role(tenant_id) = 'manager'
        AND id <> public.current_app_user_id()
        AND role IN ('cashier', 'support')
      )
    )
  );
CREATE POLICY users_delete ON public.users
  FOR DELETE TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND (
      public.current_user_tenant_role(tenant_id) = 'tenant_owner'
      OR (
        public.current_user_tenant_role(tenant_id) = 'manager'
        AND id <> public.current_app_user_id()
        AND role IN ('cashier', 'support')
      )
    )
  );

DROP POLICY tenant_insert ON public.branding;
DROP POLICY tenant_update ON public.branding;
DROP POLICY tenant_delete ON public.branding;
CREATE POLICY branding_insert ON public.branding
  FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager')
  );
CREATE POLICY branding_update ON public.branding
  FOR UPDATE TO authenticated
  USING (public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager'))
  WITH CHECK (
    public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager')
  );
CREATE POLICY branding_delete ON public.branding
  FOR DELETE TO authenticated
  USING (public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager'));

DROP POLICY tenants_update ON public.tenants;
DROP POLICY tenants_delete ON public.tenants;
CREATE POLICY tenants_update ON public.tenants
  FOR UPDATE TO authenticated
  USING (public.current_user_tenant_role(id) = 'tenant_owner')
  WITH CHECK (public.current_user_tenant_role(id) = 'tenant_owner');
CREATE POLICY tenants_delete ON public.tenants
  FOR DELETE TO authenticated
  USING (public.current_user_tenant_role(id) = 'tenant_owner');

DROP POLICY audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = public.current_app_user_id()
    AND (
      (tenant_id IS NULL AND public.is_platform_owner())
      OR tenant_id IN (SELECT public.current_user_tenant_ids())
    )
  );

CREATE POLICY audit_logs_service_insert ON public.audit_logs
  FOR INSERT TO service_role
  WITH CHECK (true);