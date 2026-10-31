import { chmod, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

export const repositoryRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
export const credentialsPath = resolve(repositoryRoot, 'dev-credentials.local.txt');

config({ path: resolve(repositoryRoot, '.env') });

export interface DevUserCredential {
  id: string;
  email: string;
  password: string;
}

export interface DevMfaCredential {
  email: string;
  factorId: string;
  secret: string;
  uri: string;
}

export interface DevCredentialsFile {
  users: DevUserCredential[];
  mfa: DevMfaCredential[];
}

export function assertDevelopmentEnvironment(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run a dev-auth script with NODE_ENV=production.');
  }
  if (process.env.ALLOW_DEV_AUTH_PROVISIONING !== 'true') {
    throw new Error('Set ALLOW_DEV_AUTH_PROVISIONING=true in .env to run this dev-only script.');
  }
}

export function requireSupabaseConfig(includeAnonKey: boolean): {
  url: string;
  serviceRoleKey: string;
  anonKey?: string;
} {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  if (includeAnonKey) required.push('SUPABASE_ANON_KEY');
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  }

  return {
    url: process.env.SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    anonKey: process.env.SUPABASE_ANON_KEY,
  };
}

export function createAdminClient(url: string, serviceRoleKey: string) {
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export function createAnonClient(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export async function readDevCredentials(): Promise<DevCredentialsFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(credentialsPath, 'utf8'));
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('users' in parsed) ||
      !Array.isArray(parsed.users) ||
      !('mfa' in parsed) ||
      !Array.isArray(parsed.mfa)
    ) {
      throw new Error('invalid credential file format');
    }
    return parsed as DevCredentialsFile;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { users: [], mfa: [] };
    }
    throw new Error('Could not read dev-credentials.local.txt safely.', { cause: error });
  }
}

export async function writeDevCredentials(credentials: DevCredentialsFile): Promise<void> {
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(credentialsPath, 0o600);
}

export function reportSafeFailure(_error: unknown): void {
  void _error;
  console.error('Dev auth setup failed; no credentials were printed.');
  process.exitCode = 1;
}
