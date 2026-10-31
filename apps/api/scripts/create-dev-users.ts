import { randomBytes } from 'node:crypto';
import { createAdminClient, assertDevelopmentEnvironment, readDevCredentials, reportSafeFailure, requireSupabaseConfig, writeDevCredentials } from './dev-auth-shared.js';

const seededUsers = [
  { id: '00000000-0000-4000-8000-000000000001', email: 'platform.owner@example.test', fullName: 'SAMPLE Platform Owner' },
  { id: '10000000-0000-4000-8000-000000000001', email: 'owner.akwaaba@example.test', fullName: 'SAMPLE Akwaaba Owner' },
  { id: '10000000-0000-4000-8000-000000000002', email: 'manager.akwaaba@example.test', fullName: 'SAMPLE Akwaaba Manager' },
  { id: '10000000-0000-4000-8000-000000000003', email: 'cashier.akwaaba@example.test', fullName: 'SAMPLE Akwaaba Cashier' },
  { id: '10000000-0000-4000-8000-000000000004', email: 'support.akwaaba@example.test', fullName: 'SAMPLE Akwaaba Support' },
  { id: '20000000-0000-4000-8000-000000000001', email: 'owner.royal@example.test', fullName: 'SAMPLE Royal Owner' },
  { id: '20000000-0000-4000-8000-000000000002', email: 'manager.royal@example.test', fullName: 'SAMPLE Royal Manager' },
  { id: '20000000-0000-4000-8000-000000000003', email: 'cashier.royal@example.test', fullName: 'SAMPLE Royal Cashier' },
  { id: '20000000-0000-4000-8000-000000000004', email: 'support.royal@example.test', fullName: 'SAMPLE Royal Support' },
] as const;

async function main(): Promise<void> {
  assertDevelopmentEnvironment();
  const { url, serviceRoleKey } = requireSupabaseConfig(false);
  const admin = createAdminClient(url, serviceRoleKey);
  const credentials = await readDevCredentials();
  const userCredentials = [...credentials.users];
  const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw listError;

  for (const profile of seededUsers) {
    const byId = listedUsers.users.find((user) => user.id === profile.id);
    const byEmail = listedUsers.users.find(
      (user) => user.email?.toLowerCase() === profile.email.toLowerCase(),
    );
    if (byEmail && byEmail.id !== profile.id) {
      throw new Error('A seeded email is already linked to a different Auth user ID.');
    }
    if (byId && byId.email?.toLowerCase() !== profile.email.toLowerCase()) {
      throw new Error('A seeded Auth user ID is already linked to a different email.');
    }

    const password = randomBytes(32).toString('base64url');
    if (byId) {
      const { error } = await admin.auth.admin.updateUserById(profile.id, {
        password,
        email_confirm: true,
        user_metadata: { full_name: profile.fullName },
      });
      if (error) throw error;
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        id: profile.id,
        email: profile.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: profile.fullName },
      });
      if (error) throw error;
      if (data.user.id !== profile.id) {
        throw new Error('Supabase returned an unexpected Auth user ID.');
      }
      listedUsers.users.push(data.user);
    }

    const { data: linkedProfiles, error: linkError } = await admin
      .from('users')
      .update({ auth_user_id: profile.id })
      .eq('id', profile.id)
      .eq('email', profile.email)
      .select('id');
    if (linkError) throw linkError;
    if (linkedProfiles.length !== 1) {
      throw new Error('A seeded profile could not be linked to its Auth user.');
    }

    const savedCredential = { id: profile.id, email: profile.email, password };
    const savedIndex = userCredentials.findIndex((entry) => entry.id === profile.id);
    if (savedIndex >= 0) userCredentials[savedIndex] = savedCredential;
    else userCredentials.push(savedCredential);
    await writeDevCredentials({ ...credentials, users: [...userCredentials] });
  }

  console.log(`Created or refreshed ${userCredentials.length} development Auth users.`);
  console.log('Their passwords were saved to the git-ignored dev-credentials.local.txt file.');
}

main().catch(reportSafeFailure);
