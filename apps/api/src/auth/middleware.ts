import type { AppRole, AuthUser } from '@homeguard/shared';
import type { NextFunction, Request, Response } from 'express';
import { writeAuthAuditEvent } from './audit.js';
import {
  getAuthClient,
  getServiceClient,
  missingConfigurationVariable,
} from './supabase.js';

export type RequestUser = AuthUser & {
  authUserId: string;
  profileId: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    authUser?: RequestUser;
  }
}

function sendError(
  response: Response,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({ error: { code, message } });
}

function bearerToken(request: Request): string | undefined {
  const match = request.header('authorization')?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function requireAuth(options: { allowPendingMfa?: boolean } = {}) {
  return async function authenticateRequest(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
  const token = bearerToken(request);
  if (!token) {
    sendError(response, 401, 'UNAUTHENTICATED', 'A valid bearer token is required.');
    return;
  }

  try {
    const { data: claimsData, error: claimsError } = await getAuthClient().auth.getClaims(token);
    const claims = claimsData?.claims;
    const authUserId = claims?.sub;
    if (claimsError || typeof authUserId !== 'string') {
      sendError(response, 401, 'INVALID_TOKEN', 'The access token is invalid or expired.');
      return;
    }

    const client = getServiceClient();
    const { data: profile, error: profileError } = await client
      .from('users')
      .select('id, auth_user_id, email, full_name, role, status, tenant_id')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (profileError || !profile || profile.status !== 'active') {
      sendError(response, 403, 'PROFILE_UNAVAILABLE', 'This account is not active in HomeGuard.');
      return;
    }

    let role = profile.role as AppRole;
    let tenantId: string | null = null;

    if (role !== 'platform_owner') {
      if (!profile.tenant_id) {
        sendError(response, 403, 'TENANT_MEMBERSHIP_REQUIRED', 'An active tenant membership is required.');
        return;
      }

      const { data: membership, error: membershipError } = await client
        .from('tenant_members')
        .select('tenant_id, role, status')
        .eq('user_id', profile.id)
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'active')
        .maybeSingle();

      if (membershipError || !membership) {
        sendError(response, 403, 'TENANT_MEMBERSHIP_REQUIRED', 'An active tenant membership is required.');
        return;
      }

      const { data: tenant, error: tenantError } = await client
        .from('tenants')
        .select('status')
        .eq('id', membership.tenant_id)
        .maybeSingle();
      if (tenantError || tenant?.status !== 'active') {
        sendError(response, 403, 'TENANT_UNAVAILABLE', 'This tenant is not active.');
        return;
      }

      tenantId = membership.tenant_id;
      role = membership.role as AppRole;
    }

    if (!['platform_owner', 'tenant_owner', 'manager', 'cashier', 'support'].includes(role)) {
      sendError(response, 403, 'INVALID_ROLE', 'The account has an unsupported role.');
      return;
    }

    request.authUser = {
      id: profile.id,
      authUserId,
      profileId: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      role,
      tenantId,
      assuranceLevel: claims?.aal === 'aal2' ? 'aal2' : 'aal1',
      mfaRequired: role === 'platform_owner' || role === 'support',
    };

    if (
      !options.allowPendingMfa &&
      request.authUser.mfaRequired &&
      request.authUser.assuranceLevel !== 'aal2'
    ) {
      await recordRoleDenial(request.authUser, [], 'mfa_required');
      sendError(response, 403, 'MFA_REQUIRED', 'Complete multi-factor authentication to continue.');
      return;
    }

    next();
  } catch (error) {
    const missingVariable = missingConfigurationVariable(error);
    if (missingVariable) {
      console.error(`Missing server configuration variable: ${missingVariable}`);
      sendError(response, 503, 'SERVER_NOT_CONFIGURED', 'server is not configured');
      return;
    }
    console.error('Authentication middleware failed.');
    sendError(response, 503, 'AUTH_SERVICE_UNAVAILABLE', 'Authentication could not be verified.');
  }
  };
}

export function requireRole(...allowedRoles: AppRole[]) {
  return async function roleMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> {
    const user = request.authUser;
    if (!user) {
      sendError(response, 401, 'UNAUTHENTICATED', 'A valid bearer token is required.');
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      await recordRoleDenial(user, allowedRoles, 'role_not_allowed');
      sendError(response, 403, 'FORBIDDEN', 'Your role cannot access this resource.');
      return;
    }

    if (user.mfaRequired && user.assuranceLevel !== 'aal2') {
      await recordRoleDenial(user, allowedRoles, 'mfa_required');
      sendError(response, 403, 'MFA_REQUIRED', 'Complete multi-factor authentication to continue.');
      return;
    }

    next();
  };
}

export const requireStaffManagementRole = requireRole(
  'platform_owner',
  'tenant_owner',
  'manager',
);

export const requireBrandingManagementRole = requireRole(
  'platform_owner',
  'tenant_owner',
  'manager',
);

async function recordRoleDenial(
  user: RequestUser,
  requiredRoles: AppRole[],
  reason: 'role_not_allowed' | 'mfa_required',
): Promise<void> {
  try {
    await writeAuthAuditEvent(user, {
      action: 'role_denied',
      details: { role: user.role, requiredRoles, reason },
    });
  } catch (error) {
    console.error('Could not write role-denied audit event:', error);
  }
}