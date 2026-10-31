import {
  clientStatusUpdateSchema,
  platformSettingsSchema,
} from '@homeguard/shared';
import { Router, type Request, type Response } from 'express';
import { getServiceClient } from '../auth/supabase.js';
import { requireAuth, requireRole } from '../auth/middleware.js';

const router = Router();
router.use(requireAuth(), requireRole('platform_owner'));

const settingsKeys = ['price_minimum_pesewas', 'price_maximum_pesewas'] as const;

function sendFailure(response: Response, _error: unknown): void {
  void _error;
  console.error('Platform data request failed.');
  response.status(500).json({
    error: { code: 'PLATFORM_DATA_UNAVAILABLE', message: 'Platform data is unavailable.' },
  });
}

function parseSettingValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (value && typeof value === 'object' && 'value' in value) {
    const stored = value.value;
    if (typeof stored === 'number' && Number.isSafeInteger(stored) && stored >= 0) return stored;
  }
  return undefined;
}

async function loadClients() {
  const service = getServiceClient();
  const [{ data: tenants, error: tenantsError }, { data: members, error: membersError }] =
    await Promise.all([
      service.from('tenants').select('id,name,status,created_at').order('created_at', { ascending: false }),
      service.from('tenant_members').select('tenant_id').eq('status', 'active'),
    ]);
  if (tenantsError) throw tenantsError;
  if (membersError) throw membersError;

  const counts = new Map<string, number>();
  for (const member of members ?? []) {
    counts.set(member.tenant_id, (counts.get(member.tenant_id) ?? 0) + 1);
  }

  return (tenants ?? []).map((tenant) => ({
    id: tenant.id,
    name: tenant.name,
    status: tenant.status,
    createdAt: tenant.created_at,
    activeUsers: counts.get(tenant.id) ?? 0,
  }));
}

router.get('/overview', async (_request, response) => {
  try {
    const service = getServiceClient();
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - 6);
    const [clients, sessionsResult, transactionResult] = await Promise.all([
      loadClients(),
      service.from('sessions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      service.from('transactions').select('amount_pesewas,created_at').eq('status', 'paid'),
    ]);
    if (sessionsResult.error) throw sessionsResult.error;
    if (transactionResult.error) throw transactionResult.error;

    const revenueByDate = new Map<string, number>();
    const revenueLast7Days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      revenueByDate.set(key, 0);
      return { date: key, revenuePesewas: 0 };
    });
    let totalRevenuePesewas = 0;
    for (const transaction of transactionResult.data ?? []) {
      const amount = Number(transaction.amount_pesewas);
      if (Number.isSafeInteger(amount) && amount >= 0) {
        totalRevenuePesewas += amount;
        const key = String(transaction.created_at).slice(0, 10);
        if (revenueByDate.has(key)) revenueByDate.set(key, revenueByDate.get(key)! + amount);
      }
    }
    for (const day of revenueLast7Days) day.revenuePesewas = revenueByDate.get(day.date) ?? 0;

    response.json({
      success: true,
      data: {
        totalClients: clients.length,
        activeSessions: sessionsResult.count ?? 0,
        totalRevenuePesewas,
        systemUptimeSeconds: Math.floor(process.uptime()),
        revenueLast7Days,
        recentClients: clients.slice(0, 5),
      },
    });
  } catch (error) {
    sendFailure(response, error);
  }
});

router.get('/clients', async (_request, response) => {
  try {
    response.json({ success: true, data: await loadClients() });
  } catch (error) {
    sendFailure(response, error);
  }
});

router.patch('/clients/:id/status', async (request, response) => {
  const parsed = clientStatusUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Choose a status and provide a reason of at least 3 characters.' },
    });
    return;
  }

  try {
    const service = getServiceClient();
    const { data: tenant, error } = await service
      .from('tenants')
      .update({ status: parsed.data.status })
      .eq('id', request.params.id)
      .select('id,name,status')
      .maybeSingle();
    if (error) throw error;
    if (!tenant) {
      response.status(404).json({ error: { code: 'CLIENT_NOT_FOUND', message: 'Client was not found.' } });
      return;
    }

    const actor = request.authUser!;
    await service.from('audit_logs').insert({
      tenant_id: tenant.id,
      actor_user_id: actor.profileId,
      action: parsed.data.status === 'suspended' ? 'tenant_suspended' : 'tenant_reactivated',
      entity_type: 'tenant',
      entity_id: tenant.id,
      details: { reason: parsed.data.reason, tenantName: tenant.name },
    }).throwOnError();

    response.json({ success: true, data: { id: tenant.id, name: tenant.name, status: tenant.status } });
  } catch (error) {
    sendFailure(response, error);
  }
});

router.get('/settings', async (_request, response) => {
  try {
    const { data, error } = await getServiceClient()
      .from('platform_settings')
      .select('setting_key,setting_value')
      .is('tenant_id', null)
      .in('setting_key', [...settingsKeys]);
    if (error) throw error;
    const values = new Map((data ?? []).map((row) => [row.setting_key, parseSettingValue(row.setting_value)]));
    response.json({
      success: true,
      data: {
        priceMinimumPesewas: values.get(settingsKeys[0]) ?? 0,
        priceMaximumPesewas: values.get(settingsKeys[1]) ?? 100000,
      },
    });
  } catch (error) {
    sendFailure(response, error);
  }
});

router.put('/settings', async (request, response) => {
  const parsed = platformSettingsSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: { code: 'INVALID_REQUEST', message: 'Price limits must be valid non-negative pesewas, and minimum must not exceed maximum.' },
    });
    return;
  }

  try {
    const service = getServiceClient();
    const values = [
      [settingsKeys[0], parsed.data.priceMinimumPesewas],
      [settingsKeys[1], parsed.data.priceMaximumPesewas],
    ] as const;
    for (const [settingKey, value] of values) {
      const { data: existing, error: selectError } = await service
        .from('platform_settings')
        .select('id')
        .is('tenant_id', null)
        .eq('setting_key', settingKey)
        .maybeSingle();
      if (selectError) throw selectError;
      const query = existing
        ? service.from('platform_settings').update({ setting_value: { value } }).eq('id', existing.id)
        : service.from('platform_settings').insert({ setting_key: settingKey, setting_value: { value }, description: 'Platform-wide pricing limit' });
      const { error } = await query;
      if (error) throw error;
    }

    const actor = request.authUser!;
    await service.from('audit_logs').insert({
      tenant_id: null,
      actor_user_id: actor.profileId,
      action: 'platform_settings_updated',
      entity_type: 'platform_settings',
      details: {
        reason: 'Platform price limits updated',
        priceMinimumPesewas: parsed.data.priceMinimumPesewas,
        priceMaximumPesewas: parsed.data.priceMaximumPesewas,
      },
    }).throwOnError();

    response.json({ success: true, data: parsed.data });
  } catch (error) {
    sendFailure(response, error);
  }
});

router.get('/audit-logs', async (request: Request, response: Response) => {
  const action = typeof request.query.action === 'string' ? request.query.action : undefined;
  const from = typeof request.query.from === 'string' ? request.query.from : undefined;
  const to = typeof request.query.to === 'string' ? request.query.to : undefined;
  if ((from && Number.isNaN(Date.parse(from))) || (to && Number.isNaN(Date.parse(to)))) {
    response.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Date filters must be valid dates.' } });
    return;
  }

  try {
    let query = getServiceClient()
      .from('audit_logs')
      .select('id,action,entity_type,entity_id,actor_user_id,created_at,details')
      .order('created_at', { ascending: false })
      .limit(200);
    if (action) query = query.eq('action', action);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);
    const { data, error } = await query;
    if (error) throw error;
    response.json({ success: true, data: data ?? [] });
  } catch (error) {
    sendFailure(response, error);
  }
});

export default router;
