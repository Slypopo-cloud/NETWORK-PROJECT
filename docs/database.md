# Database

HomeGuard stores each Wi-Fi business as a tenant. Tenant-owned rows carry a `tenant_id`; Row Level Security limits authenticated tenant users to their own tenant. A platform owner can read across tenants. Audit logs are append-only for application roles.

All IDs are UUIDs. Timestamps use UTC-capable `timestamptz` columns. Money is stored as integer pesewas, so `300` means GH₵3.00. The `updated_at` trigger maintains modification times; audit-log timestamps are not updated.

## Tables

- `tenants`: Wi-Fi businesses and their active/suspended state.
- `users`: user profiles linked optionally to a Supabase Auth account, with a platform or tenant role.
- `tenant_members`: the user-to-tenant membership and role assignment used by access policies.
- `branding`: each tenant's logo path, colors, welcome message, and branding state.
- `packages`: Wi-Fi access offers, duration in seconds, and price in pesewas.
- `customers`: tenant-owned customer contact details and state.
- `transactions`: package purchases, amount, payment provider/reference, and payment state.
- `sessions`: customer access periods, their related package, payment, gateway, and state.
- `gateways`: tenant-owned network gateways, address information, status, and last-seen time.
- `audit_logs`: append-only records of actions and affected entities.
- `devices`: customer devices, their MAC/IP details, related session/gateway, and connection state.
- `gateway_commands`: queued gateway operations, payloads, results, and processing state.
- `platform_settings`: global settings or tenant-specific overrides stored as JSON.

## Apply

With the Supabase CLI linked to the intended project, apply the migrations with:

```sh
npx supabase db push
```

For a local Supabase database, `npx supabase db reset` applies migrations and then runs `supabase/seed.sql`. To seed a linked remote project deliberately, use `npx supabase db seed` after reviewing the sample records.

The seed data is explicitly marked SAMPLE. It creates profiles only, not Supabase Auth accounts; those sample users cannot log in. Create real Auth users and link their IDs in `public.users.auth_user_id` before using the profiles for authentication.

## Assumptions

The requested `.github/copilot-instructions.md` was not present when this schema was written. Columns follow the schema sketch in `docs/design-board.png`; tenant roles are Owner, Manager, Cashier, and Support. Each of the two sample tenants gets branding, the three requested packages, one gateway, and one staff member per role.