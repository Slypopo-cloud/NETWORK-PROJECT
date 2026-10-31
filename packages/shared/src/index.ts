import { z } from 'zod';

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface HealthData {
  status: 'ok';
}

export const appRoleSchema = z.enum([
  'platform_owner',
  'tenant_owner',
  'manager',
  'cashier',
  'support',
]);

export type AppRole = z.infer<typeof appRoleSchema>;

export const signInRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signInResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1),
  }),
});

export const authUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().min(1),
  role: appRoleSchema,
  tenantId: z.string().uuid().nullable(),
  assuranceLevel: z.enum(['aal1', 'aal2']),
  mfaRequired: z.boolean(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export const tenantStatusSchema = z.enum(['active', 'suspended']);

export const clientStatusUpdateSchema = z.object({
  status: tenantStatusSchema,
  reason: z.string().trim().min(3).max(500),
});

export const platformSettingsSchema = z.object({
  priceMinimumPesewas: z.number().int().nonnegative(),
  priceMaximumPesewas: z.number().int().positive(),
}).refine((value) => value.priceMinimumPesewas <= value.priceMaximumPesewas, {
  message: 'Price minimum must not exceed price maximum.',
});

export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid().nullable(),
  actorUserId: z.string().uuid().nullable(),
  createdAt: z.string(),
  details: z.record(z.string(), z.unknown()),
});

export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;