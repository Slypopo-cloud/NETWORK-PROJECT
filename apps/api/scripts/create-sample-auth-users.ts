import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

config({
  path: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../.env'),
});

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const samplePassword = process.env.SAMPLE_USER_PASSWORD;

if (process.env.ALLOW_SAMPLE_AUTH_PROVISIONING !== 'true') {
  throw new Error('Set ALLOW_SAMPLE_AUTH_PROVISIONING=true to create development SAMPLE accounts.');
}
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
}
if (!samplePassword || samplePassword.length < 12) {
  throw new Error('Set SAMPLE_USER_PASSWORD to a unique password of at least 12 characters.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const { data: profiles, error: profileError } = await supabase
  .from('users')
  .select('id, email, full_name, auth_user_id')
  .like('email', '%@example.test');

if (profileError) throw profileError;

const { data: authUsers, error: authUsersError } = await supabase.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});

if (authUsersError) throw authUsersError;

for (const profile of profiles) {
  let authUser = authUsers.users.find(
    (candidate) => candidate.email?.toLowerCase() === profile.email.toLowerCase(),
  );

  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: profile.email,
      password: samplePassword,
      email_confirm: true,
      user_metadata: { full_name: profile.full_name },
    });
    if (error) throw error;
    authUser = data.user;
    authUsers.users.push(authUser);
  } else {
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: samplePassword,
      email_confirm: true,
      user_metadata: { full_name: profile.full_name },
    });
    if (error) throw error;
  }

  if (profile.auth_user_id !== authUser.id) {
    const { error } = await supabase
      .from('users')
      .update({ auth_user_id: authUser.id })
      .eq('id', profile.id);
    if (error) throw error;
  }

  console.log(`Linked SAMPLE account: ${profile.email}`);
}

console.log(`Provisioned ${profiles.length} SAMPLE profiles. The password was not printed.`);