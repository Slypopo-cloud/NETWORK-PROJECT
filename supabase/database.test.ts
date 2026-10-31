import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const tenantAId = '11111111-1111-4111-8111-111111111111';
const tenantBId = '22222222-2222-4222-8222-222222222222';
const authUserAId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const platformOwnerAuthId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const packageBId = '41000000-0000-4000-8000-000000000001';
const customerBId = '62000000-0000-4000-8000-000000000001';
const transactionBId = '63000000-0000-4000-8000-000000000001';
const sessionBId = '64000000-0000-4000-8000-000000000001';

const expectedColumns: Record<string, string[]> = {
  tenants: ['id', 'name', 'status', 'created_at', 'updated_at'],
  users: [
    'id',
    'auth_user_id',
    'tenant_id',
    'email',
    'full_name',
    'role',
    'status',
    'created_at',
    'updated_at',
  ],
  tenant_members: [
    'id',
    'tenant_id',
    'user_id',
    'role',
    'status',
    'created_at',
    'updated_at',
  ],
  branding: [
    'id',
    'tenant_id',
    'logo_path',
    'primary_color',
    'secondary_color',
    'welcome_message',
    'status',
    'created_at',
    'updated_at',
  ],
  packages: [
    'id',
    'tenant_id',
    'name',
    'price_pesewas',
    'duration_seconds',
    'status',
    'created_at',
    'updated_at',
  ],
  customers: [
    'id',
    'tenant_id',
    'full_name',
    'phone',
    'email',
    'status',
    'created_at',
    'updated_at',
  ],
  transactions: [
    'id',
    'tenant_id',
    'customer_id',
    'package_id',
    'amount_pesewas',
    'status',
    'payment_provider',
    'provider_reference',
    'created_at',
    'updated_at',
  ],
  sessions: [
    'id',
    'tenant_id',
    'customer_id',
    'package_id',
    'transaction_id',
    'gateway_id',
    'started_at',
    'end_time',
    'status',
    'created_at',
    'updated_at',
  ],
  gateways: [
    'id',
    'tenant_id',
    'name',
    'mac_address',
    'ip_address',
    'status',
    'last_seen_at',
    'created_at',
    'updated_at',
  ],
  audit_logs: [
    'id',
    'tenant_id',
    'actor_user_id',
    'action',
    'entity_type',
    'entity_id',
    'details',
    'created_at',
    'updated_at',
  ],
  devices: [
    'id',
    'tenant_id',
    'customer_id',
    'session_id',
    'gateway_id',
    'mac_address',
    'ip_address',
    'hostname',
    'status',
    'first_seen_at',
    'last_seen_at',
    'created_at',
    'updated_at',
  ],
  gateway_commands: [
    'id',
    'tenant_id',
    'gateway_id',
    'requested_by',
    'command',
    'payload',
    'result',
    'status',
    'created_at',
    'updated_at',
  ],
  platform_settings: [
    'id',
    'tenant_id',
    'setting_key',
    'setting_value',
    'description',
    'status',
    'created_at',
    'updated_at',
  ],
};

const tenantOwnedTables = Object.keys(expectedColumns).filter(
  (tableName) => tableName !== 'tenants',
);

const restrictedTenantRows = [
  {
    table: 'packages',
    id: packageBId,
    update: `UPDATE public.packages SET name = 'Changed by tenant A' WHERE id = $1`,
  },
  {
    table: 'customers',
    id: customerBId,
    update: `UPDATE public.customers SET full_name = 'Changed by tenant A' WHERE id = $1`,
  },
  {
    table: 'transactions',
    id: transactionBId,
    update: `UPDATE public.transactions SET status = 'paid' WHERE id = $1`,
  },
  {
    table: 'sessions',
    id: sessionBId,
    update: `UPDATE public.sessions SET status = 'ended' WHERE id = $1`,
  },
] as const;

describe('Supabase database foundation', () => {
  const database = new PGlite();

  beforeAll(async () => {
    await database.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      GRANT USAGE ON SCHEMA auth TO authenticated, service_role;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT ALL ON TABLES TO authenticated, service_role;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
        SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
    `);

    for (const migration of [
      '0001_database_schema.sql',
      '0002_row_level_security.sql',
      '0003_auth_roles_and_audit.sql',
    ]) {
      await database.exec(
        await readFile(
          resolve('supabase/migrations', migration),
          'utf8',
        ),
      );
    }

    await database.exec(await readFile(resolve('supabase/seed.sql'), 'utf8'));
    await database.exec(`
      INSERT INTO auth.users (id) VALUES
        ('${authUserAId}'),
        ('${platformOwnerAuthId}');
      UPDATE public.users
        SET auth_user_id = '${authUserAId}'
        WHERE id = '10000000-0000-4000-8000-000000000001';
      UPDATE public.users
        SET auth_user_id = '${platformOwnerAuthId}'
        WHERE id = '00000000-0000-4000-8000-000000000001';

      INSERT INTO public.customers (id, tenant_id, full_name)
      VALUES ('${customerBId}', '${tenantBId}', 'SAMPLE Tenant B Customer');
      INSERT INTO public.transactions (
        id, tenant_id, customer_id, package_id, amount_pesewas, status
      ) VALUES (
        '${transactionBId}', '${tenantBId}', '${customerBId}',
        '${packageBId}', 300, 'paid'
      );
      INSERT INTO public.sessions (
        id, tenant_id, customer_id, package_id, transaction_id, started_at
      ) VALUES (
        '${sessionBId}', '${tenantBId}', '${customerBId}',
        '${packageBId}', '${transactionBId}', now()
      );
    `);
  });

  afterAll(async () => {
    await database.close();
  });

  async function authenticateAs(authUserId: string, assuranceLevel = 'aal1') {
    await database.exec(`
      RESET ROLE;
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${authUserId}', false);
      SELECT set_config(
        'request.jwt.claims',
        '{"sub":"${authUserId}","aal":"${assuranceLevel}"}',
        false
      );
    `);
  }

  it('applies migrations and seed data from an empty database', async () => {
    const tableCount = await database.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);

    expect(tableCount.rows[0].count).toBe(13);
  });

  it('creates every expected table and column', async () => {
    const columns = await database.query<{
      table_name: string;
      column_name: string;
    }>(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `);
    const actualColumns = new Map<string, string[]>();

    for (const { table_name, column_name } of columns.rows) {
      actualColumns.set(table_name, [
        ...(actualColumns.get(table_name) ?? []),
        column_name,
      ]);
    }

    expect(Object.keys(expectedColumns).sort()).toEqual(
      [...actualColumns.keys()].sort(),
    );
    for (const [tableName, columnsForTable] of Object.entries(expectedColumns)) {
      expect(actualColumns.get(tableName), tableName).toEqual(columnsForTable);
    }
  });

  it('enables RLS on all 13 tables', async () => {
    const result = await database.query<{
      relname: string;
      relrowsecurity: boolean;
    }>(`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname
    `);

    expect(result.rows).toHaveLength(13);
    expect(result.rows.every((row) => row.relrowsecurity)).toBe(true);
  });

  it('seeds the expected SAMPLE row counts', async () => {
    const expectedCounts: Record<string, number> = {
      tenants: 2,
      users: 9,
      tenant_members: 8,
      branding: 2,
      packages: 6,
      customers: 0,
      transactions: 0,
      sessions: 0,
      gateways: 2,
      audit_logs: 0,
      devices: 0,
      gateway_commands: 0,
      platform_settings: 0,
    };
    const rlsFixtureIds: Record<string, string> = {
      customers: customerBId,
      transactions: transactionBId,
      sessions: sessionBId,
    };

    for (const [tableName, expectedCount] of Object.entries(expectedCounts)) {
      const fixtureId = rlsFixtureIds[tableName];
      const result = await database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM public.${tableName}${fixtureId ? ' WHERE id <> $1' : ''}`,
        fixtureId ? [fixtureId] : [],
      );
      expect(result.rows[0].count, tableName).toBe(expectedCount);
    }
  });

  it('stores monetary values as integers', async () => {
    const result = await database.query<{
      table_name: string;
      column_name: string;
      data_type: string;
    }>(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('packages', 'price_pesewas'),
          ('transactions', 'amount_pesewas')
        )
      ORDER BY table_name
    `);

    expect(result.rows).toEqual([
      { table_name: 'packages', column_name: 'price_pesewas', data_type: 'integer' },
      { table_name: 'transactions', column_name: 'amount_pesewas', data_type: 'integer' },
    ]);
  });

  it('scopes every tenant-owned table with a tenant_id index', async () => {
    const columns = await database.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
    `);
    const indexedColumns = await database.query<{
      tablename: string;
    }>(`
      SELECT DISTINCT tablename
      FROM pg_indexes
      WHERE schemaname = 'public' AND indexdef LIKE '%tenant_id%'
    `);

    expect(columns.rows.map((row) => row.table_name).sort()).toEqual(
      [...tenantOwnedTables].sort(),
    );
    for (const tableName of tenantOwnedTables) {
      expect(
        indexedColumns.rows.some((row) => row.tablename === tableName),
        `${tableName} tenant_id index`,
      ).toBe(true);
    }
  });

  it.each(restrictedTenantRows)(
    'prevents tenant A from selecting, updating, or deleting tenant B $table rows',
    async ({ table, id, update }) => {
      await authenticateAs(authUserAId);

      const selected = await database.query<{ id: string }>(
        `SELECT id FROM public.${table} WHERE id = $1`,
        [id],
      );
      const updated = await database.query(update, [id]);
      const deleted = await database.query(
        `DELETE FROM public.${table} WHERE id = $1`,
        [id],
      );

      expect(selected.rows).toHaveLength(0);
      expect(updated.rowCount).toBe(0);
      expect(deleted.rowCount).toBe(0);
    },
  );

  it('allows a platform owner to read across tenants', async () => {
    await authenticateAs(platformOwnerAuthId, 'aal2');

    const result = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.tenants',
    );

    expect(result.rows[0].count).toBe(2);
  });

  it('requires AAL2 for platform-owner and Support tenant-data reads', async () => {
    await authenticateAs(platformOwnerAuthId, 'aal1');
    const ownerAal1 = await database.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM public.tenants',
    );
    expect(ownerAal1.rows[0].count).toBe(0);

    await database.exec(`
      RESET ROLE;
      UPDATE public.users SET role = 'support'
        WHERE id = '10000000-0000-4000-8000-000000000001';
      UPDATE public.tenant_members SET role = 'support'
        WHERE user_id = '10000000-0000-4000-8000-000000000001';
    `);
    await authenticateAs(authUserAId, 'aal1');
    const supportAal1 = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.packages WHERE tenant_id = '${tenantAId}'`,
    );
    expect(supportAal1.rows[0].count).toBe(0);

    await authenticateAs(authUserAId, 'aal2');
    const supportAal2 = await database.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM public.packages WHERE tenant_id = '${tenantAId}'`,
    );
    expect(supportAal2.rows[0].count).toBe(3);

    await database.exec(`
      RESET ROLE;
      UPDATE public.users SET role = 'tenant_owner'
        WHERE id = '10000000-0000-4000-8000-000000000001';
      UPDATE public.tenant_members SET role = 'tenant_owner'
        WHERE user_id = '10000000-0000-4000-8000-000000000001';
    `);
  });

  it.each(['cashier', 'support'])(
    'blocks %s from directly managing staff or branding through Supabase RLS',
    async (role) => {
      await database.exec(`
        RESET ROLE;
        UPDATE public.users SET role = '${role}'
          WHERE id = '10000000-0000-4000-8000-000000000001';
        UPDATE public.tenant_members SET role = '${role}'
          WHERE user_id = '10000000-0000-4000-8000-000000000001';
        SET ROLE authenticated;
        SELECT set_config('request.jwt.claim.sub', '${authUserAId}', false);
      `);

      const membershipUpdate = await database.query(`
        UPDATE public.tenant_members SET role = 'tenant_owner'
        WHERE user_id = '10000000-0000-4000-8000-000000000002'
      `);
      const userUpdate = await database.query(`
        UPDATE public.users SET full_name = 'Unauthorized edit'
        WHERE id = '10000000-0000-4000-8000-000000000002'
      `);
      const brandingUpdate = await database.query(`
        UPDATE public.branding SET primary_color = '#ffffff'
        WHERE tenant_id = '${tenantAId}'
      `);

      expect(membershipUpdate.rowCount).toBe(0);
      expect(userUpdate.rowCount).toBe(0);
      expect(brandingUpdate.rowCount).toBe(0);

      await database.exec(`
        RESET ROLE;
        UPDATE public.users SET role = 'tenant_owner'
          WHERE id = '10000000-0000-4000-8000-000000000001';
        UPDATE public.tenant_members SET role = 'tenant_owner'
          WHERE user_id = '10000000-0000-4000-8000-000000000001';
      `);
    },
  );

  it('prevents managers from elevating their own membership role', async () => {
    await database.exec(`
      RESET ROLE;
      UPDATE public.users SET role = 'manager'
        WHERE id = '10000000-0000-4000-8000-000000000001';
      UPDATE public.tenant_members SET role = 'manager'
        WHERE user_id = '10000000-0000-4000-8000-000000000001';
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${authUserAId}', false);
    `);

    const membershipUpdate = await database.query(`
      UPDATE public.tenant_members SET role = 'tenant_owner'
      WHERE user_id = '10000000-0000-4000-8000-000000000001'
    `);
    const userUpdate = await database.query(`
      UPDATE public.users SET role = 'tenant_owner'
      WHERE id = '10000000-0000-4000-8000-000000000001'
    `);

    expect(membershipUpdate.rowCount).toBe(0);
    expect(userUpdate.rowCount).toBe(0);
    await database.exec(`
      RESET ROLE;
      UPDATE public.users SET role = 'tenant_owner'
        WHERE id = '10000000-0000-4000-8000-000000000001';
      UPDATE public.tenant_members SET role = 'tenant_owner'
        WHERE user_id = '10000000-0000-4000-8000-000000000001';
    `);
  });

  it('allows audit INSERT and SELECT but rejects UPDATE and DELETE', async () => {
    await authenticateAs(authUserAId);
    const inserted = await database.query<{ id: string }>(`
      INSERT INTO public.audit_logs (tenant_id, actor_user_id, action, entity_type)
      VALUES ('${tenantAId}', '10000000-0000-4000-8000-000000000001', 'sample.test', 'test')
      RETURNING id
    `);
    const visible = await database.query<{ id: string }>(
      'SELECT id FROM public.audit_logs WHERE id = $1',
      [inserted.rows[0].id],
    );

    expect(visible.rows).toHaveLength(1);
    await expect(
      database.query('UPDATE public.audit_logs SET action = $1 WHERE id = $2', [
        'tampered',
        inserted.rows[0].id,
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      database.query('DELETE FROM public.audit_logs WHERE id = $1', [
        inserted.rows[0].id,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });
});