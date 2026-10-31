import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from './app.js';

const platformUserId = '90000000-0000-4000-8000-000000000001';
const tenantAId = '11111111-1111-4111-8111-111111111111';
const tenantBId = '22222222-2222-4222-8222-222222222222';

const fixtures = vi.hoisted(() => ({
  authUserId: '90000000-0000-4000-8000-000000000001',
  assuranceLevel: 'aal2',
  auditRows: [
    {
      id: '91000000-0000-4000-8000-000000000001',
      action: 'tenant_suspended',
      entity_type: 'tenant',
      entity_id: '11111111-1111-4111-8111-111111111111',
      actor_user_id: '90000000-0000-4000-8000-000000000001',
      created_at: '2026-10-30T12:00:00.000Z',
      details: { reason: 'Abuse report' },
    },
  ],
  insertedAudit: [] as Array<Record<string, unknown>>,
  settings: new Map<string, number>([
    ['price_minimum_pesewas', 100],
    ['price_maximum_pesewas', 5000],
  ]),
  tenantStatus: new Map<string, string>([
    ['11111111-1111-4111-8111-111111111111', 'active'],
    ['22222222-2222-4222-8222-222222222222', 'suspended'],
  ]),
}));

vi.mock('./auth/supabase.js', () => {
  const tenantRows = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Akwaaba Wi-Fi', status: 'active', created_at: '2026-10-01T00:00:00.000Z' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Royal Connect', status: 'suspended', created_at: '2026-10-02T00:00:00.000Z' },
  ];
  const activeMembers = [
    { tenant_id: '11111111-1111-4111-8111-111111111111' },
    { tenant_id: '11111111-1111-4111-8111-111111111111' },
    { tenant_id: '22222222-2222-4222-8222-222222222222' },
  ];
  const transactions = [
    { amount_pesewas: 1250, created_at: new Date(Date.now() - 86400000).toISOString() },
    { amount_pesewas: 2750, created_at: new Date().toISOString() },
  ];

  function makeQuery(table: string) {
    const query: any = {
      operation: 'select',
      filters: {} as Record<string, unknown>,
      payload: undefined as unknown,
      select() { return this; },
      eq(column: string, value: unknown) { this.filters[column] = value; return this; },
      gte(column: string, value: unknown) { this.filters[`gte:${column}`] = value; return this; },
      lte(column: string, value: unknown) { this.filters[`lte:${column}`] = value; return this; },
      is(column: string, value: unknown) { this.filters[column] = value; return this; },
      in(column: string, value: unknown) { this.filters[column] = value; return this; },
      order() { return this; },
      limit() { return this; },
      update(payload: unknown) { this.operation = 'update'; this.payload = payload; return this; },
      insert(payload: unknown) {
        this.operation = 'insert';
        this.payload = payload;
        return this;
      },
      async maybeSingle() {
        if (table === 'tenants' && this.operation === 'update') {
          const id = String(this.filters.id);
          const tenant = tenantRows.find((row) => row.id === id);
          if (!tenant) return { data: null, error: null };
          const status = (this.payload as { status: string }).status;
          fixtures.tenantStatus.set(id, status);
          tenant.status = status;
          return { data: { id: tenant.id, name: tenant.name, status }, error: null };
        }
        if (table === 'users') {
          const platformOwner = fixtures.authUserId === platformUserId;
          return {
            data: {
              id: platformOwner ? platformUserId : '90000000-0000-4000-8000-000000000002',
              auth_user_id: fixtures.authUserId,
              tenant_id: platformOwner ? null : tenantAId,
              email: platformOwner ? 'platform.owner@example.test' : 'owner.akwaaba@example.test',
              full_name: platformOwner ? 'Platform Owner' : 'Tenant Owner',
              role: platformOwner ? 'platform_owner' : 'tenant_owner',
              status: 'active',
            },
            error: null,
          };
        }
        if (table === 'tenant_members') {
          return { data: { tenant_id: tenantAId, role: 'tenant_owner', status: 'active' }, error: null };
        }
        if (table === 'tenants') {
          return { data: { status: 'active' }, error: null };
        }
        if (table === 'platform_settings') {
          const key = String(this.filters.setting_key);
          const exists = fixtures.settings.has(key);
          return { data: exists ? { id: `92000000-0000-4000-8000-${key === 'price_minimum_pesewas' ? '000000000001' : '000000000002'}` } : null, error: null };
        }
        return { data: null, error: null };
      },
      async throwOnError() {
        if (table === 'audit_logs' && this.operation === 'insert') fixtures.insertedAudit.push(this.payload as Record<string, unknown>);
        return { data: null, error: null };
      },
      result() {
        if (table === 'tenants') {
          return { data: tenantRows, error: null, count: null };
        }
        if (table === 'tenant_members') {
          return { data: activeMembers, error: null, count: null };
        }
        if (table === 'sessions') {
          return { data: null, error: null, count: 48 };
        }
        if (table === 'transactions') {
          return { data: transactions, error: null, count: null };
        }
        if (table === 'platform_settings') {
          return {
            data: [...fixtures.settings].map(([setting_key, value]) => ({ setting_key, setting_value: { value } })),
            error: null,
            count: null,
          };
        }
        if (table === 'audit_logs') {
          return { data: fixtures.auditRows, error: null, count: null };
        }
        return { data: [], error: null, count: null };
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(this.result()).then(resolve, reject);
      },
    };
    return query;
  }

  return {
    getAuthClient: () => ({
      auth: {
        getClaims: async () => ({ data: { claims: { sub: fixtures.authUserId, aal: fixtures.assuranceLevel } }, error: null }),
      },
    }),
    getServiceClient: () => ({ from: makeQuery }),
  };
});

afterEach(() => {
  fixtures.insertedAudit.length = 0;
  fixtures.settings.set('price_minimum_pesewas', 100);
  fixtures.settings.set('price_maximum_pesewas', 5000);
  fixtures.tenantStatus.set(tenantAId, 'active');
  fixtures.tenantStatus.set(tenantBId, 'suspended');
});

describe('platform owner endpoints', () => {
  const auth = { Authorization: 'Bearer platform-aal2-token' };

  it('requires authentication and platform-owner authorization', async () => {
    const unauthenticated = await request(app).get('/v1/platform/overview');
    expect(unauthenticated.status).toBe(401);

    fixtures.authUserId = '90000000-0000-4000-8000-000000000002';
    const forbidden = await request(app).get('/v1/platform/overview').set(auth);
    expect(forbidden.status).toBe(403);
    fixtures.authUserId = platformUserId;
  });

  it('returns overview KPI values, seven revenue days and recent clients', async () => {
    const response = await request(app).get('/v1/platform/overview').set(auth);
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalClients: 2,
      activeSessions: 48,
      totalRevenuePesewas: 4000,
      systemUptimeSeconds: expect.any(Number),
    });
    expect(response.body.data.revenueLast7Days).toHaveLength(7);
    expect(response.body.data.recentClients).toHaveLength(2);
    expect(response.body.data.recentClients[0]).toHaveProperty('activeUsers');
  });

  it('lists clients with active-user counts and statuses', async () => {
    const response = await request(app).get('/v1/platform/clients').set(auth);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({ name: 'Akwaaba Wi-Fi', status: 'active', activeUsers: 2 }),
      expect.objectContaining({ name: 'Royal Connect', status: 'suspended', activeUsers: 1 }),
    ]);
  });

  it('requires a written reason and audits client status changes', async () => {
    const missingReason = await request(app)
      .patch(`/v1/platform/clients/${tenantAId}/status`)
      .set(auth)
      .send({ status: 'suspended' });
    expect(missingReason.status).toBe(400);
    expect(fixtures.insertedAudit).toHaveLength(0);

    const suspended = await request(app)
      .patch(`/v1/platform/clients/${tenantAId}/status`)
      .set(auth)
      .send({ status: 'suspended', reason: 'Verified abuse report' });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.status).toBe('suspended');
    expect(fixtures.insertedAudit[0]).toMatchObject({
      action: 'tenant_suspended',
      details: { reason: 'Verified abuse report' },
    });
  });

  it('reads and stores valid global pricing limits in pesewas', async () => {
    const current = await request(app).get('/v1/platform/settings').set(auth);
    expect(current.status).toBe(200);
    expect(current.body.data).toEqual({ priceMinimumPesewas: 100, priceMaximumPesewas: 5000 });

    const invalid = await request(app)
      .put('/v1/platform/settings')
      .set(auth)
      .send({ priceMinimumPesewas: 6000, priceMaximumPesewas: 5000 });
    expect(invalid.status).toBe(400);

    const updated = await request(app)
      .put('/v1/platform/settings')
      .set(auth)
      .send({ priceMinimumPesewas: 200, priceMaximumPesewas: 9000 });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toEqual({ priceMinimumPesewas: 200, priceMaximumPesewas: 9000 });
    expect(fixtures.insertedAudit.at(-1)).toMatchObject({ action: 'platform_settings_updated' });
  });

  it('lists audit events with filters and exposes no mutation routes', async () => {
    const response = await request(app)
      .get('/v1/platform/audit-logs?action=tenant_suspended&from=2026-10-01&to=2026-11-01')
      .set(auth);
    expect(response.status).toBe(200);
    expect(response.body.data[0]).toMatchObject({ action: 'tenant_suspended' });

    const update = await request(app).patch('/v1/platform/audit-logs/91000000-0000-4000-8000-000000000001').set(auth).send({ action: 'edited' });
    const remove = await request(app).delete('/v1/platform/audit-logs/91000000-0000-4000-8000-000000000001').set(auth);
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);
  });
});
