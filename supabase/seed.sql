-- SAMPLE DATA ONLY. These profiles are not Supabase Auth accounts and cannot log in.
-- Replace with real Auth users before using this database outside development.

INSERT INTO public.tenants (id, name, status)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Akwaaba Wi-Fi', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'Royal Connect', 'active')
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name, status = EXCLUDED.status;

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
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
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
ON CONFLICT (tenant_id, user_id) DO UPDATE
SET role = EXCLUDED.role, status = EXCLUDED.status;

INSERT INTO public.branding (
  id, tenant_id, logo_path, primary_color, secondary_color, welcome_message, status
)
VALUES
  ('30000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'sample/akwaaba-logo.png', '#0878d1', '#082c55', 'SAMPLE: Welcome to Akwaaba Wi-Fi', 'active'),
  ('40000000-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'sample/royal-logo.png', '#00a789', '#123b62', 'SAMPLE: Welcome to Royal Connect', 'active')
ON CONFLICT (tenant_id) DO UPDATE
SET logo_path = EXCLUDED.logo_path,
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
ON CONFLICT (tenant_id, name) DO UPDATE
SET price_pesewas = EXCLUDED.price_pesewas,
    duration_seconds = EXCLUDED.duration_seconds,
    status = EXCLUDED.status;

INSERT INTO public.gateways (id, tenant_id, name, mac_address, ip_address, status)
VALUES
  ('50000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'SAMPLE Akwaaba Gateway', '02:00:00:00:00:01', '192.0.2.10', 'offline'),
  ('50000000-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'SAMPLE Royal Gateway', '02:00:00:00:00:02', '192.0.2.20', 'offline')
ON CONFLICT (tenant_id, name) DO UPDATE
SET mac_address = EXCLUDED.mac_address,
    ip_address = EXCLUDED.ip_address,
    status = EXCLUDED.status;