import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from './app.js';
import {
  requireBrandingManagementRole,
  requireAuth,
  requireStaffManagementRole,
} from './auth/middleware.js';

const fixtures = vi.hoisted(() => ({
  authUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  assuranceLevel: 'aal1',
  role: 'tenant_owner',
  missingConfiguration: false,
  invalidToken: false,
  invalidCredentials: false,
  tenantStatus: 'active',
  auditEvents: [] as Array<Record<string, unknown>>,
  profile: {
    id: '10000000-0000-4000-8000-000000000001',
    auth_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tenant_id: '11111111-1111-4111-8111-111111111111' as string | null,
    email: 'owner.akwaaba@example.test',
    full_name: 'Sample Akwaaba Owner',
    role: 'tenant_owner',
    status: 'active',
  },
  membership: {
    tenant_id: '11111111-1111-4111-8111-111111111111',
    role: 'tenant_owner',
    status: 'active',
  },
}));

vi.mock('./auth/supabase.js', () => {
  function queryFor(table: string) {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({
        data:
          table === 'users'
            ? fixtures.profile
            : table === 'tenants'
              ? { status: fixtures.tenantStatus }
              : fixtures.membership,
        error: null,
      }),
      insert: async (record: Record<string, unknown>) => {
        fixtures.auditEvents.push(record);
        return { error: null };
      },
    };
    return query;
  }

  return {
    missingConfigurationVariable: (error: unknown) =>
      error instanceof Error && error.message === 'SUPABASE_URL is not configured'
        ? 'SUPABASE_URL'
        : undefined,
    getAuthClient: () => {
      if (fixtures.missingConfiguration) {
        throw new Error('SUPABASE_URL is not configured');
      }
      return {
      auth: {
        getClaims: async () => ({
          data: fixtures.invalidToken
            ? null
            : {
                claims: {
                  sub: fixtures.authUserId,
                  aal: fixtures.assuranceLevel,
                },
              },
          error: fixtures.invalidToken ? new Error('invalid token') : null,
        }),
        signInWithPassword: async () => {
          if (fixtures.invalidCredentials) {
            return { data: { user: null, session: null }, error: new Error('invalid') };
          }
          return {
            data: {
              user: { id: fixtures.authUserId },
              session: { access_token: 'sample-access-token', refresh_token: 'sample-refresh-token' },
            },
            error: null,
          };
        },
      },
      };
    },
    getUserScopedClient: () => ({ from: queryFor }),
    getServiceClient: () => ({ from: queryFor }),
  };
});

function setIdentity(role: string, assuranceLevel = 'aal1') {
  fixtures.role = role;
  fixtures.assuranceLevel = assuranceLevel;
  fixtures.profile.role = role;
  fixtures.profile.tenant_id = role === 'platform_owner' ? null : '11111111-1111-4111-8111-111111111111';
  fixtures.membership.role = role;
  fixtures.membership.tenant_id = '11111111-1111-4111-8111-111111111111';
  fixtures.invalidCredentials = false;
  fixtures.missingConfiguration = false;
  fixtures.invalidToken = false;
  fixtures.tenantStatus = 'active';
}

afterEach(() => {
  setIdentity('tenant_owner');
  fixtures.auditEvents.length = 0;
});

describe('Supabase authentication and authorization', () => {
  it('rejects unauthenticated calls with the standard error shape', async () => {
    const response = await request(app).get('/v1/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'A valid bearer token is required.',
      },
    });
  });

  it('rejects invalid bearer tokens with the standard error shape', async () => {
    fixtures.invalidToken = true;
    const response = await request(app)
      .get('/v1/me')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_TOKEN');
    expect(response.body.error.message).toBe('The access token is invalid or expired.');
  });

  it('returns a secret-safe 503 when server configuration is missing', async () => {
    fixtures.missingConfiguration = true;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await request(app)
      .get('/v1/me')
      .set('Authorization', 'Bearer verified-sample-token');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { code: 'SERVER_NOT_CONFIGURED', message: 'server is not configured' },
    });
    expect(log).toHaveBeenCalledWith('Missing server configuration variable: SUPABASE_URL');
    expect(log.mock.calls.flat().join(' ')).not.toContain('not-a-real-secret');
  });

  it('returns the same safe 503 for sign-in when configuration is missing', async () => {
    fixtures.missingConfiguration = true;
    const response = await request(app)
      .post('/v1/auth/sign-in')
      .send({ email: 'owner.akwaaba@example.test', password: 'sample-password' });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      error: { code: 'SERVER_NOT_CONFIGURED', message: 'server is not configured' },
    });
  });

  it('derives tenant identity from the authenticated profile, not request input', async () => {
    setIdentity('tenant_owner');
    const response = await request(app)
      .get('/v1/tenant/ping?tenant_id=22222222-2222-4222-8222-222222222222')
      .set('Authorization', 'Bearer verified-sample-token');

    expect(response.status).toBe(200);
    expect(response.body.data.tenantId).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('rejects users whose tenant is suspended', async () => {
    fixtures.tenantStatus = 'suspended';
    const response = await request(app)
      .get('/v1/tenant/ping')
      .set('Authorization', 'Bearer verified-sample-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('TENANT_UNAVAILABLE');
  });

  it('allows pending-MFA users to inspect their profile only', async () => {
    setIdentity('platform_owner', 'aal1');
    const me = await request(app)
      .get('/v1/me')
      .set('Authorization', 'Bearer verified-sample-token');
    const platform = await request(app)
      .get('/v1/platform/ping')
      .set('Authorization', 'Bearer verified-sample-token');

    expect(me.status).toBe(200);
    expect(me.body.data.mfaRequired).toBe(true);
    expect(platform.status).toBe(403);
    expect(platform.body.error.code).toBe('MFA_REQUIRED');
  });

  it('allows tenant users on the tenant example route', async () => {
    setIdentity('cashier');
    const response = await request(app)
      .get('/v1/tenant/ping')
      .set('Authorization', 'Bearer verified-sample-token');

    expect(response.status).toBe(200);
  });

  it('requires MFA for Support routes', async () => {
    setIdentity('support', 'aal1');
    const response = await request(app)
      .get('/v1/tenant/ping')
      .set('Authorization', 'Bearer verified-sample-token');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('MFA_REQUIRED');
    expect(fixtures.auditEvents.at(-1)).toMatchObject({
      action: 'role_denied',
      details: { reason: 'mfa_required', role: 'support' },
    });
  });

  it('requires MFA for platform-owner routes and allows them at AAL2', async () => {
    setIdentity('platform_owner', 'aal1');
    const denied = await request(app)
      .get('/v1/platform/ping')
      .set('Authorization', 'Bearer verified-sample-token');

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('MFA_REQUIRED');
    expect(fixtures.auditEvents.at(-1)).toMatchObject({
      action: 'role_denied',
      details: { reason: 'mfa_required', role: 'platform_owner' },
    });

    setIdentity('platform_owner', 'aal2');
    const allowed = await request(app)
      .get('/v1/platform/ping')
      .set('Authorization', 'Bearer verified-sample-token');
    expect(allowed.status).toBe(200);
  });

  it.each([
    ['cashier', 'aal1'],
    ['support', 'aal2'],
  ])('%s cannot manage staff or branding', async (role, assuranceLevel) => {
    setIdentity(role, assuranceLevel);
    const managementApp = express();
    managementApp.get('/staff', requireAuth(), requireStaffManagementRole, (_req, res) => res.sendStatus(204));
    managementApp.get('/branding', requireAuth(), requireBrandingManagementRole, (_req, res) => res.sendStatus(204));

    for (const path of ['/staff', '/branding']) {
      const response = await request(managementApp)
        .get(path)
        .set('Authorization', 'Bearer verified-sample-token');
      expect(response.status, `${role} ${path}`).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('records a successful sign-in before returning access tokens', async () => {
    setIdentity('tenant_owner');
    const response = await request(app)
      .post('/v1/auth/sign-in')
      .send({ email: 'owner.akwaaba@example.test', password: 'sample-password' });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBe('sample-access-token');
    expect(fixtures.auditEvents.at(-1)).toMatchObject({
      action: 'sign_in',
      tenant_id: '11111111-1111-4111-8111-111111111111',
      actor_user_id: '10000000-0000-4000-8000-000000000001',
    });
  });
});