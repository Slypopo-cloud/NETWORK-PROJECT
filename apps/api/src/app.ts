import cors from 'cors';
import express from 'express';
import { appRoleSchema, signInRequestSchema } from '@homeguard/shared';
import { writeAuthAuditEvent } from './auth/audit.js';
import {
  requireRole,
  requireAuth,
  type RequestUser,
} from './auth/middleware.js';
import {
  getAuthClient,
  getServiceClient,
  missingConfigurationVariable,
} from './auth/supabase.js';
import platformRouter from './platform/router.js';

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      const allowedOrigins = new Set(
        (
          process.env.CORS_ALLOWED_ORIGINS ??
          'http://localhost:5173,http://localhost:5174'
        )
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      );
      callback(null, !origin || allowedOrigins.has(origin));
    },
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'OPTIONS'],
  }),
);
app.use(express.json());
app.use('/v1/platform', platformRouter);

app.get('/v1/health', (_request, response) => {
  response.json({
    success: true,
    data: {
      status: 'ok',
    },
  });
});

app.get('/v1/me', requireAuth({ allowPendingMfa: true }), (request, response) => {
  const user = request.authUser!;
  response.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      tenantId: user.tenantId,
      assuranceLevel: user.assuranceLevel,
      mfaRequired: user.mfaRequired,
    },
  });
});

app.post('/v1/auth/sign-in', async (request, response, next) => {
  const parsed = signInRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'A valid email and password are required.' },
    });
    return;
  }

  try {
    const { data: authData, error: authError } = await getAuthClient().auth.signInWithPassword(parsed.data);
    if (authError || !authData.user || !authData.session) {
      response.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      });
      return;
    }

    const serviceClient = getServiceClient();
    const { data: profile, error: profileError } = await serviceClient
      .from('users')
      .select('id, auth_user_id, tenant_id, email, full_name, role, status')
      .eq('auth_user_id', authData.user.id)
      .maybeSingle();

    if (profileError || !profile || profile.status !== 'active') {
      response.status(403).json({
        error: { code: 'PROFILE_UNAVAILABLE', message: 'This account is not active in HomeGuard.' },
      });
      return;
    }

    const profileRole = appRoleSchema.safeParse(profile.role);
    if (!profileRole.success) {
      response.status(403).json({
        error: { code: 'INVALID_ROLE', message: 'The account has an unsupported role.' },
      });
      return;
    }

    let role = profileRole.data;
    let tenantId: string | null = null;
    if (role !== 'platform_owner') {
      if (!profile.tenant_id) {
        response.status(403).json({
          error: { code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active tenant membership is required.' },
        });
        return;
      }

      const { data: membership, error: membershipError } = await serviceClient
        .from('tenant_members')
        .select('tenant_id, role, status')
        .eq('user_id', profile.id)
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'active')
        .maybeSingle();

      if (membershipError || !membership) {
        response.status(403).json({
          error: { code: 'TENANT_MEMBERSHIP_REQUIRED', message: 'An active tenant membership is required.' },
        });
        return;
      }

      const { data: tenant, error: tenantError } = await serviceClient
        .from('tenants')
        .select('status')
        .eq('id', membership.tenant_id)
        .maybeSingle();
      if (tenantError || tenant?.status !== 'active') {
        response.status(403).json({
          error: { code: 'TENANT_UNAVAILABLE', message: 'This tenant is not active.' },
        });
        return;
      }

      const membershipRole = appRoleSchema.safeParse(membership.role);
      if (!membershipRole.success || membershipRole.data === 'platform_owner') {
        response.status(403).json({
          error: { code: 'INVALID_ROLE', message: 'The account has an unsupported tenant role.' },
        });
        return;
      }

      role = membershipRole.data;
      tenantId = membership.tenant_id;
    }

    const { data: sessionClaims, error: claimsError } = await getAuthClient().auth.getClaims(
      authData.session.access_token,
    );
    if (claimsError || !sessionClaims) {
      response.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'Could not verify the sign-in token.' },
      });
      return;
    }

    const user: RequestUser = {
      id: profile.id,
      authUserId: authData.user.id,
      profileId: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      role,
      tenantId,
      assuranceLevel: sessionClaims.claims.aal === 'aal2' ? 'aal2' : 'aal1',
      mfaRequired: role === 'platform_owner' || role === 'support',
    };

    await writeAuthAuditEvent(user, {
      action: 'sign_in',
      details: { assuranceLevel: user.assuranceLevel },
    });

    response.json({
      success: true,
      data: {
        accessToken: authData.session.access_token,
        refreshToken: authData.session.refresh_token,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get(
  '/v1/tenant/ping',
  requireAuth(),
  requireRole('tenant_owner', 'manager', 'cashier', 'support'),
  (request, response) => {
    response.json({
      success: true,
      data: { scope: 'tenant', tenantId: request.authUser!.tenantId },
    });
  },
);

app.get(
  '/v1/platform/ping',
  requireAuth(),
  requireRole('platform_owner'),
  (_request, response) => {
    response.json({ success: true, data: { scope: 'platform' } });
  },
);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  void _next;
  const missingVariable = missingConfigurationVariable(error);
  if (missingVariable) {
    console.error(`Missing server configuration variable: ${missingVariable}`);
    response.status(503).json({
      error: { code: 'SERVER_NOT_CONFIGURED', message: 'server is not configured' },
    });
    return;
  }
  console.error('API request failed.');
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
  });
});

export default app;