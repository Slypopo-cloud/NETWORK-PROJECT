-- HomeGuard full setup for an empty Supabase project.
-- Paste this entire file into the Supabase SQL Editor and run it once.
-- Keep this file aligned with supabase/migrations/ and supabase/seed.sql.

-- ============================================================
-- Migration 0001: database schema
-- Source: supabase/migrations/0001_database_schema.sql
-- ============================================================
CREATE TYPE public.app_role AS ENUM (
  'platform_owner',
  'owner',
  'manager',
  'cashier',
  'support'
);

CREATE TYPE public.tenant_status AS ENUM ('active', 'suspended');
CREATE TYPE public.user_status AS ENUM ('invited', 'active', 'suspended');
CREATE TYPE public.membership_status AS ENUM ('invited', 'active', 'suspended');
CREATE TYPE public.branding_status AS ENUM ('draft', 'active');
CREATE TYPE public.package_status AS ENUM ('active', 'inactive', 'archived');
CREATE TYPE public.customer_status AS ENUM ('active', 'blocked');
CREATE TYPE public.transaction_status AS ENUM (
  'pending', 'paid', 'failed', 'refunded', 'cancelled'
);
CREATE TYPE public.session_status AS ENUM ('active', 'ended', 'expired', 'revoked');
CREATE TYPE public.gateway_status AS ENUM ('online', 'offline', 'maintenance');
CREATE TYPE public.device_status AS ENUM ('connected', 'disconnected', 'blocked');
CREATE TYPE public.gateway_command_status AS ENUM (
  'queued', 'sent', 'succeeded', 'failed', 'cancelled'
);
CREATE TYPE public.setting_status AS ENUM ('active', 'inactive');

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status public.tenant_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users (id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  role public.app_role NOT NULL,
  status public.user_status NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_platform_owner_tenant_check CHECK (
    (role = 'platform_owner' AND tenant_id IS NULL)
    OR (role <> 'platform_owner' AND tenant_id IS NOT NULL)
  )
);

CREATE TABLE public.tenant_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  status public.membership_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_members_tenant_user_unique UNIQUE (tenant_id, user_id),
  CONSTRAINT tenant_members_role_check CHECK (role <> 'platform_owner')
);

CREATE TABLE public.branding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants (id) ON DELETE CASCADE,
  logo_path text,
  primary_color text NOT NULL DEFAULT '#0b63ce',
  secondary_color text NOT NULL DEFAULT '#0b315d',
  welcome_message text,
  status public.branding_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  price_pesewas integer NOT NULL CHECK (price_pesewas >= 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds > 0),
  status public.package_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT packages_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  email text,
  status public.customer_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  package_id uuid REFERENCES public.packages (id) ON DELETE SET NULL,
  amount_pesewas integer NOT NULL CHECK (amount_pesewas >= 0),
  status public.transaction_status NOT NULL DEFAULT 'pending',
  payment_provider text,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.gateways (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  mac_address text,
  ip_address inet,
  status public.gateway_status NOT NULL DEFAULT 'offline',
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gateways_tenant_name_unique UNIQUE (tenant_id, name)
);

CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  package_id uuid REFERENCES public.packages (id) ON DELETE SET NULL,
  transaction_id uuid REFERENCES public.transactions (id) ON DELETE SET NULL,
  gateway_id uuid REFERENCES public.gateways (id) ON DELETE SET NULL,
  started_at timestamptz,
  end_time timestamptz,
  status public.session_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_end_after_start_check CHECK (
    end_time IS NULL OR started_at IS NULL OR end_time >= started_at
  )
);

CREATE TABLE public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers (id) ON DELETE SET NULL,
  session_id uuid REFERENCES public.sessions (id) ON DELETE SET NULL,
  gateway_id uuid REFERENCES public.gateways (id) ON DELETE SET NULL,
  mac_address text NOT NULL,
  ip_address inet,
  hostname text,
  status public.device_status NOT NULL DEFAULT 'disconnected',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_tenant_mac_unique UNIQUE (tenant_id, mac_address)
);

CREATE TABLE public.gateway_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  gateway_id uuid NOT NULL REFERENCES public.gateways (id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  command text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  status public.gateway_command_status NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.users (id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.platform_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants (id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  setting_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  status public.setting_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX platform_settings_global_key_unique
  ON public.platform_settings (setting_key)
  WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX platform_settings_tenant_key_unique
  ON public.platform_settings (tenant_id, setting_key)
  WHERE tenant_id IS NOT NULL;
CREATE INDEX users_tenant_id_idx ON public.users (tenant_id);
CREATE INDEX tenant_members_tenant_id_idx ON public.tenant_members (tenant_id);
CREATE INDEX tenant_members_user_id_idx ON public.tenant_members (user_id);
CREATE INDEX branding_tenant_id_idx ON public.branding (tenant_id);
CREATE INDEX packages_tenant_id_idx ON public.packages (tenant_id);
CREATE INDEX customers_tenant_id_idx ON public.customers (tenant_id);
CREATE INDEX transactions_tenant_id_idx ON public.transactions (tenant_id);
CREATE INDEX transactions_customer_id_idx ON public.transactions (customer_id);
CREATE INDEX sessions_tenant_id_idx ON public.sessions (tenant_id);
CREATE INDEX sessions_customer_id_idx ON public.sessions (customer_id);
CREATE INDEX gateways_tenant_id_idx ON public.gateways (tenant_id);
CREATE INDEX devices_tenant_id_idx ON public.devices (tenant_id);
CREATE INDEX gateway_commands_tenant_id_idx ON public.gateway_commands (tenant_id);
CREATE INDEX audit_logs_tenant_id_idx ON public.audit_logs (tenant_id);
CREATE INDEX audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX platform_settings_tenant_id_idx ON public.platform_settings (tenant_id);

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tenants_set_updated_at BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tenant_members_set_updated_at BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER branding_set_updated_at BEFORE UPDATE ON public.branding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER packages_set_updated_at BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customers_set_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER transactions_set_updated_at BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER gateways_set_updated_at BEFORE UPDATE ON public.gateways
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER sessions_set_updated_at BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER devices_set_updated_at BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER gateway_commands_set_updated_at BEFORE UPDATE ON public.gateway_commands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER platform_settings_set_updated_at BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Migration 0002: row-level security
-- Source: supabase/migrations/0002_row_level_security.sql
-- ============================================================
CREATE FUNCTION public.current_app_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id FROM public.users AS u
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
    SELECT 1 FROM public.users AS u
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
CREATE POLICY tenants_select ON public.tenants FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_user_tenant_ids()) OR public.is_platform_owner());
CREATE POLICY tenants_insert ON public.tenants FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_owner());
CREATE POLICY tenants_update ON public.tenants FOR UPDATE TO authenticated
  USING (id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY tenants_delete ON public.tenants FOR DELETE TO authenticated
  USING (id IN (SELECT public.current_user_tenant_ids()));

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (
    auth_user_id = (SELECT auth.uid())
    OR tenant_id IN (SELECT public.current_user_tenant_ids())
    OR public.is_platform_owner()
  );
CREATE POLICY users_insert ON public.users FOR INSERT TO authenticated
  WITH CHECK (
    role <> 'platform_owner'
    AND tenant_id IN (SELECT public.current_user_tenant_ids())
  );
CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (
    role <> 'platform_owner'
    AND tenant_id IN (SELECT public.current_user_tenant_ids())
  );
CREATE POLICY users_delete ON public.users FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT public.current_user_tenant_ids()));

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenant_members', 'branding', 'packages', 'customers', 'transactions',
    'sessions', 'gateways', 'devices', 'gateway_commands'
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
CREATE POLICY audit_logs_select ON public.audit_logs FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    OR public.is_platform_owner()
  );
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IN (SELECT public.current_user_tenant_ids())
    AND (actor_user_id IS NULL OR actor_user_id = public.current_app_user_id())
  );
REVOKE UPDATE, DELETE ON public.audit_logs FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT TO authenticated
  USING (public.is_platform_owner() OR tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY platform_settings_insert ON public.platform_settings FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_owner() OR tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY platform_settings_update ON public.platform_settings FOR UPDATE TO authenticated
  USING (public.is_platform_owner() OR tenant_id IN (SELECT public.current_user_tenant_ids()))
  WITH CHECK (public.is_platform_owner() OR tenant_id IN (SELECT public.current_user_tenant_ids()));
CREATE POLICY platform_settings_delete ON public.platform_settings FOR DELETE TO authenticated
  USING (public.is_platform_owner() OR tenant_id IN (SELECT public.current_user_tenant_ids()));

-- ============================================================
-- Migration 0003: auth roles and audit
-- Source: supabase/migrations/0003_auth_roles_and_audit.sql
-- ============================================================
ALTER TYPE public.app_role RENAME VALUE 'owner' TO 'tenant_owner';

ALTER TABLE public.audit_logs ALTER COLUMN tenant_id DROP NOT NULL;

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
    AND (tm.role <> 'support' OR (SELECT auth.jwt() ->> 'aal') = 'aal2');
$$;

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users AS u
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
CREATE POLICY tenant_members_insert ON public.tenant_members FOR INSERT TO authenticated
  WITH CHECK (
    public.current_user_tenant_role(tenant_id) = 'tenant_owner'
    OR (public.current_user_tenant_role(tenant_id) = 'manager' AND role IN ('cashier', 'support'))
  );
CREATE POLICY tenant_members_update ON public.tenant_members FOR UPDATE TO authenticated
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
CREATE POLICY tenant_members_delete ON public.tenant_members FOR DELETE TO authenticated
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
CREATE POLICY users_insert ON public.users FOR INSERT TO authenticated
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
CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated
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
CREATE POLICY users_delete ON public.users FOR DELETE TO authenticated
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
CREATE POLICY branding_insert ON public.branding FOR INSERT TO authenticated
  WITH CHECK (public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager'));
CREATE POLICY branding_update ON public.branding FOR UPDATE TO authenticated
  USING (public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager'))
  WITH CHECK (public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager'));
CREATE POLICY branding_delete ON public.branding FOR DELETE TO authenticated
  USING (public.current_user_tenant_role(tenant_id) IN ('tenant_owner', 'manager'));

DROP POLICY tenants_update ON public.tenants;
DROP POLICY tenants_delete ON public.tenants;
CREATE POLICY tenants_update ON public.tenants FOR UPDATE TO authenticated
  USING (public.current_user_tenant_role(id) = 'tenant_owner')
  WITH CHECK (public.current_user_tenant_role(id) = 'tenant_owner');
CREATE POLICY tenants_delete ON public.tenants FOR DELETE TO authenticated
  USING (public.current_user_tenant_role(id) = 'tenant_owner');

DROP POLICY audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = public.current_app_user_id()
    AND (
      (tenant_id IS NULL AND public.is_platform_owner())
      OR tenant_id IN (SELECT public.current_user_tenant_ids())
    )
  );
CREATE POLICY audit_logs_service_insert ON public.audit_logs
  FOR INSERT TO service_role WITH CHECK (true);

-- ============================================================
-- SAMPLE seed data
-- Source: supabase/seed.sql
-- The Auth IDs are intentionally NULL; create/link Auth accounts separately.
-- ============================================================
INSERT INTO public.tenants (id, name, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Akwaaba Wi-Fi', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'Royal Connect', 'active')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

INSERT INTO public.users (id, auth_user_id, tenant_id, email, full_name, role, status)
VALUES
  ('00000000-0000-4000-8000-000000000001', NULL, NULL, 'platform.owner@example.test', 'SAMPLE Platform Owner', 'platform_owner', 'active'),
  ('10000000-0000-4000-8000-000000000001', NULL, '11111111-1111-4111-8111-111111111111', 'owner.akwaaba@example.test', 'SAMPLE Akwaaba Owner', 'tenant_owner', 'active'),
  ('10000000-0000-4000-8000-000000000002', NULL, '11111111-1111-4111-8111-111111111111', 'manager.akwaaba@example.test', 'SAMPLE Akwaaba Manager', 'manager', 'active'),
  ('10000000-0000-4000-8000-000000000003', NULL, '11111111-1111-4111-8111-111111111111', 'cashier.akwaaba@example.test', 'SAMPLE Akwaaba Cashier', 'cashier', 'active'),
  ('10000000-0000-4000-8000-000000000004', NULL, '11111111-1111-4111-8111-111111111111', 'support.akwaaba@example.test', 'SAMPLE Akwaaba Support', 'support', 'active'),
  ('20000000-0000-4000-8000-000000000001', NULL, '22222222-2222-4222-8222-222222222222', 'owner.royal@example.test', 'SAMPLE Royal Owner', 'tenant_owner', 'active'),
  ('20000000-0000-4000-8000-000000000002', NULL, '22222222-2222-4222-8222-222222222222', 'manager.royal@example.test', 'SAMPLE Royal Manager', 'manager', 'active'),
  ('20000000-0000-4000-8000-000000000003', NULL, '22222222-2222-4222-8222-222222222222', 'cashier.royal@example.test', 'SAMPLE Royal Cashier', 'cashier', 'active'),
  ('20000000-0000-4000-8000-000000000004', NULL, '22222222-2222-4222-8222-222222222222', 'support.royal@example.test', 'SAMPLE Royal Support', 'support', 'active')
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  email = EXCLUDED.email,
  full_name = EXCLUDED.full_name,
  role = EXCLUDED.role,
  status = EXCLUDED.status;

INSERT INTO public.tenant_members (tenant_id, user_id, role, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-000000000001', 'tenant_owner', 'active'),
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-000000000002', 'manager', 'active'),
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-000000000003', 'cashier', 'active'),
  ('11111111-1111-4111-8111-111111111111', '10000000-0000-4000-8000-000000000004', 'support', 'active'),
  ('22222222-2222-4222-8222-222222222222', '20000000-0000-4000-8000-000000000001', 'tenant_owner', 'active'),
  ('22222222-2222-4222-8222-222222222222', '20000000-0000-4000-8000-000000000002', 'manager', 'active'),
  ('22222222-2222-4222-8222-222222222222', '20000000-0000-4000-8000-000000000003', 'cashier', 'active'),
  ('22222222-2222-4222-8222-222222222222', '20000000-0000-4000-8000-000000000004', 'support', 'active')
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

INSERT INTO public.branding (id, tenant_id, logo_path, primary_color, secondary_color, welcome_message, status)
VALUES
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'sample/akwaaba-logo.png', '#0878d1', '#082c55', 'SAMPLE: Welcome to Akwaaba Wi-Fi', 'active'),
  ('40000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'sample/royal-logo.png', '#00a789', '#123b62', 'SAMPLE: Welcome to Royal Connect', 'active')
ON CONFLICT (tenant_id) DO UPDATE SET
  logo_path = EXCLUDED.logo_path,
  primary_color = EXCLUDED.primary_color,
  secondary_color = EXCLUDED.secondary_color,
  welcome_message = EXCLUDED.welcome_message,
  status = EXCLUDED.status;

INSERT INTO public.packages (id, tenant_id, name, price_pesewas, duration_seconds, status)
VALUES
  ('31000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', '1 Hour', 300, 3600, 'active'),
  ('31000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', '1 Day', 1000, 86400, 'active'),
  ('31000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', '7 Days', 5000, 604800, 'active'),
  ('41000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', '1 Hour', 300, 3600, 'active'),
  ('41000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', '1 Day', 1000, 86400, 'active'),
  ('41000000-0000-4000-8000-000000000003', '22222222-2222-4222-8222-222222222222', '7 Days', 5000, 604800, 'active')
ON CONFLICT (tenant_id, name) DO UPDATE SET
  price_pesewas = EXCLUDED.price_pesewas,
  duration_seconds = EXCLUDED.duration_seconds,
  status = EXCLUDED.status;

INSERT INTO public.gateways (id, tenant_id, name, mac_address, ip_address, status)
VALUES
  ('50000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'SAMPLE Akwaaba Gateway', '02:00:00:00:00:01', '192.0.2.10', 'offline'),
  ('50000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'SAMPLE Royal Gateway', '02:00:00:00:00:02', '192.0.2.20', 'offline')
ON CONFLICT (tenant_id, name) DO UPDATE SET
  mac_address = EXCLUDED.mac_address,
  ip_address = EXCLUDED.ip_address,
  status = EXCLUDED.status;