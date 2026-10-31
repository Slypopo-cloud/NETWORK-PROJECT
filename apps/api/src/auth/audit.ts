import type { RequestUser } from './middleware.js';
import { getServiceClient } from './supabase.js';

export interface AuthAuditEvent {
  action: 'sign_in' | 'role_denied';
  details: Record<string, unknown>;
}

export async function writeAuthAuditEvent(
  user: RequestUser,
  event: AuthAuditEvent,
): Promise<void> {
  const { error } = await getServiceClient().from('audit_logs').insert({
    tenant_id: user.tenantId,
    actor_user_id: user.profileId,
    action: event.action,
    entity_type: 'auth',
    details: event.details,
  });

  if (error) throw error;
}