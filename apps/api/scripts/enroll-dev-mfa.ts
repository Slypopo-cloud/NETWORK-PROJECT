import { createHmac } from 'node:crypto';
import {
  assertDevelopmentEnvironment,
  createAnonClient,
  createAdminClient,
  readDevCredentials,
  reportSafeFailure,
  requireSupabaseConfig,
  writeDevCredentials,
} from './dev-auth-shared.js';

const mfaEmails = [
  'platform.owner@example.test',
  'support.akwaaba@example.test',
  'support.royal@example.test',
];

function decodeBase32(secret: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];

  for (const character of secret.toUpperCase().replace(/=+$/u, '').replace(/\s/gu, '')) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error('Supabase returned an invalid TOTP setup secret.');
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

function currentTotpCode(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function main(): Promise<void> {
  assertDevelopmentEnvironment();
  const { url, anonKey, serviceRoleKey } = requireSupabaseConfig(true);
  if (!anonKey) throw new Error('SUPABASE_ANON_KEY is required.');

  const credentials = await readDevCredentials();
  const admin = createAdminClient(url, serviceRoleKey);
  const mfaCredentials = credentials.mfa.filter(
    (entry) => !mfaEmails.includes(entry.email.toLowerCase()),
  );
  const client = createAnonClient(url, anonKey);

  try {
    for (const email of mfaEmails) {
      const userCredential = credentials.users.find(
        (entry) => entry.email.toLowerCase() === email,
      );
      if (!userCredential) {
        throw new Error('Run the dev-user creation script before enrolling MFA.');
      }

      const { data: existingFactors, error: existingFactorsError } = await admin.auth.admin.mfa.listFactors({
        userId: userCredential.id,
      });
      if (existingFactorsError) throw existingFactorsError;
      for (const factor of existingFactors.factors) {
        const { error } = await admin.auth.admin.mfa.deleteFactor({
          id: factor.id,
          userId: userCredential.id,
        });
        if (error) throw error;
      }

      const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
        email: userCredential.email,
        password: userCredential.password,
      });
      if (signInError || !signedIn.session) {
        throw new Error(`Could not authenticate development MFA user ${email}.`);
      }

      const { data: factors, error: factorsError } = await client.auth.mfa.listFactors();
      if (factorsError) throw factorsError;

      const savedFactor = credentials.mfa.find(
        (entry) => entry.email.toLowerCase() === email,
      );
      if (
        savedFactor &&
        factors.all.some((factor) => factor.id === savedFactor.factorId && factor.factor_type === 'totp')
      ) {
        mfaCredentials.push(savedFactor);
        await client.auth.signOut({ scope: 'local' });
        continue;
      }

      for (const factor of factors.all) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
          if (error) throw error;
        }
      }

      const { data: enrolled, error: enrollError } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'HomeGuard Dev Test',
      });
      if (enrollError) throw enrollError;

      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
        factorId: enrolled.id,
      });
      if (challengeError) throw challengeError;

      const { error: verifyError } = await client.auth.mfa.verify({
        factorId: enrolled.id,
        challengeId: challenge.id,
        code: currentTotpCode(enrolled.totp.secret),
      });
      if (verifyError) throw verifyError;

      mfaCredentials.push({
        email: userCredential.email,
        factorId: enrolled.id,
        secret: enrolled.totp.secret,
        uri: enrolled.totp.uri,
      });

      const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
    }
  } catch {
    await client.auth.signOut({ scope: 'local' });
    throw new Error('Enrollment failed. Check safe configuration requirements and retry.');
  }

  await writeDevCredentials({ ...credentials, mfa: mfaCredentials });
  console.log(`Enrolled TOTP factors for ${mfaEmails.length} development users.`);
  console.log('TOTP secrets were saved only to the git-ignored dev-credentials.local.txt file.');
}

main().catch(reportSafeFailure);
