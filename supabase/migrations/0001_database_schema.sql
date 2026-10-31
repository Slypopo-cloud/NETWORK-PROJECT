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
  'pending',
  'paid',
  'failed',
  'refunded',
  'cancelled'
);
CREATE TYPE public.session_status AS ENUM (
  'active',
  'ended',
  'expired',
  'revoked'
);
CREATE TYPE public.gateway_status AS ENUM ('online', 'offline', 'maintenance');
CREATE TYPE public.device_status AS ENUM ('connected', 'disconnected', 'blocked');
CREATE TYPE public.gateway_command_status AS ENUM (
  'queued',
  'sent',
  'succeeded',
  'failed',
  'cancelled'
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

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER tenant_members_set_updated_at
  BEFORE UPDATE ON public.tenant_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER branding_set_updated_at
  BEFORE UPDATE ON public.branding
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER packages_set_updated_at
  BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customers_set_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER gateways_set_updated_at
  BEFORE UPDATE ON public.gateways
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER sessions_set_updated_at
  BEFORE UPDATE ON public.sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER devices_set_updated_at
  BEFORE UPDATE ON public.devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER gateway_commands_set_updated_at
  BEFORE UPDATE ON public.gateway_commands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER platform_settings_set_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();