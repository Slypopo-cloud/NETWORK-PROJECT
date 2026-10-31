import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'dotenv';

const required = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_API_URL',
  'API_PORT',
  'DASHBOARD_ORIGIN',
  'PORTAL_ORIGIN',
  'CORS_ALLOWED_ORIGINS',
];

const env = existsSync('.env') ? parse(readFileSync('.env')) : {};
let failed = false;

for (const name of required) {
  const isSet = typeof env[name] === 'string' && env[name].trim().length > 0;
  console.log(`${name}: ${isSet ? 'set' : 'MISSING'}`);
  failed ||= !isSet;
}

function isProjectRootUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      !value.endsWith('/')
    );
  } catch {
    return false;
  }
}

const supabaseUrlIsRoot = isProjectRootUrl(env.SUPABASE_URL);
const viteSupabaseUrlIsRoot = isProjectRootUrl(env.VITE_SUPABASE_URL);
console.log(`SUPABASE_URL is an https project root without path/trailing slash: ${supabaseUrlIsRoot ? 'PASS' : 'FAIL'}`);
console.log(`VITE_SUPABASE_URL is an https project root without path/trailing slash: ${viteSupabaseUrlIsRoot ? 'PASS' : 'FAIL'}`);
const supabaseUrlsMatch =
  typeof env.SUPABASE_URL === 'string' &&
  env.SUPABASE_URL === env.VITE_SUPABASE_URL;
console.log(`Supabase URLs are identical: ${supabaseUrlsMatch ? 'PASS' : 'FAIL'}`);
failed ||= !supabaseUrlIsRoot || !viteSupabaseUrlIsRoot || !supabaseUrlsMatch;

const keysAreDifferent =
  Boolean(env.SUPABASE_ANON_KEY) &&
  Boolean(env.SUPABASE_SERVICE_ROLE_KEY) &&
  env.SUPABASE_ANON_KEY !== env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`Supabase anon and service role keys differ: ${keysAreDifferent ? 'PASS' : 'FAIL'}`);
failed ||= !keysAreDifferent;

if (failed) process.exitCode = 1;