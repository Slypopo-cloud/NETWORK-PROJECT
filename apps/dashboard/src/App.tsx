import { useEffect, useState, type FormEvent } from 'react';
import {
  apiErrorSchema,
  authUserSchema,
  signInRequestSchema,
  signInResponseSchema,
  type AuthUser,
} from '@homeguard/shared';
import type { Session } from '@supabase/supabase-js';
import ProtectedRoute from './ProtectedRoute.js';
import { supabase } from './lib/supabase.js';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface MfaChallenge {
  factorId: string;
  challengeId: string;
  qrCode?: string;
  secret?: string;
}

async function loadAuthUser(accessToken: string): Promise<AuthUser> {
  const response = await fetch(`${apiUrl}/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload: unknown = await response.json();

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    throw new Error(
      parsedError.success
        ? parsedError.data.error.message
        : 'Could not load your HomeGuard profile.',
    );
  }

  return authUserSchema.parse((payload as { data: unknown }).data);
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setUser(null);
        setMfaChallenge(null);
      }
    });

    void supabase.auth.getSession().then(({ data: sessionData }) => {
      setSession(sessionData.session);
      if (!sessionData.session) setLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.access_token) {
      setUser(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setErrorMessage('');
    void loadAuthUser(session.access_token)
      .then((profile) => {
        if (!cancelled) setUser(profile);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setUser(null);
          setErrorMessage(error instanceof Error ? error.message : 'Profile lookup failed.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (!supabase || !user?.mfaRequired || user.assuranceLevel === 'aal2') {
      setMfaChallenge(null);
      return;
    }

    let cancelled = false;
    setWorking(true);
    void (async () => {
      const { data: factorData, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;

      let factorId = factorData.totp.find((candidate) => candidate.status === 'verified')?.id;
      let qrCode: string | undefined;
      let secret: string | undefined;

      if (!factorId) {
        const unverifiedFactor = factorData.all.find(
          (candidate) =>
            candidate.factor_type === 'totp' && candidate.status === 'unverified',
        );
        if (unverifiedFactor) {
          const { error: removeError } = await supabase.auth.mfa.unenroll({
            factorId: unverifiedFactor.id,
          });
          if (removeError) throw removeError;
        }

        const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: 'HomeGuard Dashboard',
        });
        if (enrollError) throw enrollError;
        factorId = enrolled.id;
        qrCode = enrolled.totp.qr_code;
        secret = enrolled.totp.secret;
      }

      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeError) throw challengeError;

      if (!cancelled) {
        setMfaChallenge({ factorId, challengeId: challenge.id, qrCode, secret });
      }
    })()
      .catch((error: unknown) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : 'Could not start MFA.');
        }
      })
      .finally(() => {
        if (!cancelled) setWorking(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user?.assuranceLevel, user?.mfaRequired]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setWorking(true);
    setErrorMessage('');
    setSignedOut(false);
    try {
      const request = signInRequestSchema.parse({ email, password });
      const response = await fetch(`${apiUrl}/v1/auth/sign-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const parsedError = apiErrorSchema.safeParse(payload);
        throw new Error(
          parsedError.success ? parsedError.data.error.message : 'Sign-in failed.',
        );
      }

      const tokens = signInResponseSchema.parse(payload).data;
      const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (sessionError) throw sessionError;
      setSession(sessionData.session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setWorking(false);
    }
  }

  async function handleMfaVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !mfaChallenge) return;

    setWorking(true);
    setErrorMessage('');
    const { error } = await supabase.auth.mfa.verify({
      factorId: mfaChallenge.factorId,
      challengeId: mfaChallenge.challengeId,
      code: mfaCode,
    });
    if (error) {
      setErrorMessage(error.message);
      setWorking(false);
      return;
    }

    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setMfaCode('');
    setWorking(false);
  }

  async function handleSignOut() {
    if (!supabase) return;
    setWorking(true);
    const { error } = await supabase.auth.signOut();
    if (error) setErrorMessage(error.message);
    else setSignedOut(true);
    setWorking(false);
  }

  if (!supabase) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
        <p className="max-w-lg border border-amber-300 bg-white p-5 text-sm text-amber-900">
          Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the root .env file.
        </p>
      </main>
    );
  }

  if (signedOut) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-100 px-5 py-12">
        <section className="w-full max-w-md border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm font-semibold text-sky-800">HOMEGUARD</p>
          <h1 className="mt-3 text-2xl font-semibold text-slate-950">You are signed out</h1>
          <p className="mt-2 text-sm text-slate-600">Your session has ended.</p>
          <button
            className="mt-6 w-full bg-[#082c55] px-4 py-2.5 font-semibold text-white"
            onClick={() => setSignedOut(false)}
            type="button"
          >
            Return to sign in
          </button>
        </section>
      </main>
    );
  }

  const signInScreen = (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-5 py-12">
      <section className="w-full max-w-md border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-sky-800">HOMEGUARD</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Use your HomeGuard account.</p>
        <form className="mt-7 space-y-5" onSubmit={handleSignIn}>
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input
              autoComplete="username"
              className="mt-1 block w-full border border-slate-300 px-3 py-2 text-base"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input
              autoComplete="current-password"
              className="mt-1 block w-full border border-slate-300 px-3 py-2 text-base"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {errorMessage && <p className="text-sm text-red-700">{errorMessage}</p>}
          <button
            className="w-full bg-[#082c55] px-4 py-2.5 font-semibold text-white disabled:opacity-60"
            disabled={working}
            type="submit"
          >
            {working ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );

  const mfaScreen = (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-5 py-12">
      <section className="w-full max-w-md border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold text-sky-800">ACCOUNT SECURITY</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">
          {mfaChallenge?.qrCode ? 'Set up an authenticator' : 'Verify your identity'}
        </h1>
        {mfaChallenge?.qrCode && (
          <div className="mt-5 space-y-3 text-sm text-slate-700">
            <p>Scan this code in an authenticator app, then enter its six-digit code.</p>
            <img alt="Authenticator setup QR code" className="h-48 w-48" src={mfaChallenge.qrCode} />
            <p className="break-all">Manual setup key: {mfaChallenge.secret}</p>
          </div>
        )}
        {!mfaChallenge && working && <p className="mt-4 text-sm text-slate-600">Preparing MFA…</p>}
        <form className="mt-6 space-y-4" onSubmit={handleMfaVerify}>
          <label className="block text-sm font-medium text-slate-700">
            Authenticator code
            <input
              autoComplete="one-time-code"
              className="mt-1 block w-full border border-slate-300 px-3 py-2 text-base"
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setMfaCode(event.target.value)}
              pattern="[0-9]{6}"
              required
              value={mfaCode}
            />
          </label>
          {errorMessage && <p className="text-sm text-red-700">{errorMessage}</p>}
          <button
            className="w-full bg-[#082c55] px-4 py-2.5 font-semibold text-white disabled:opacity-60"
            disabled={working || !mfaChallenge}
            type="submit"
          >
            Verify code
          </button>
        </form>
        <button className="mt-4 text-sm text-slate-600 underline" onClick={handleSignOut} type="button">
          Sign out
        </button>
      </section>
    </main>
  );

  return (
    <ProtectedRoute
      loading={loading}
      mfaRequired={mfaScreen}
      unauthenticated={signInScreen}
      user={user}
    >
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <aside className="fixed inset-y-0 left-0 flex w-64 flex-col bg-[#082c55] p-5 text-white">
          <div>
            <p className="text-xl font-semibold">HomeGuard</p>
            <p className="mt-1 text-sm text-sky-100">Wi-Fi Management Platform</p>
          </div>
          <nav aria-label="Dashboard navigation" className="mt-10">
            <a className="block border-l-2 border-sky-300 bg-white/10 px-3 py-2 text-sm font-medium" href="#overview">
              Dashboard
            </a>
          </nav>
          <div className="mt-auto border-t border-white/20 pt-4">
            <p className="truncate text-sm font-semibold">{user?.fullName}</p>
            <p className="mt-1 text-xs capitalize text-sky-100">{user?.role.replaceAll('_', ' ')}</p>
            <button
              className="mt-4 border border-white/40 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
              disabled={working}
              onClick={handleSignOut}
              type="button"
            >
              Sign out
            </button>
          </div>
        </aside>
        <main className="ml-64 min-h-screen px-8 py-10" id="overview">
          <p className="text-sm font-semibold uppercase text-sky-800">Dashboard</p>
          <h1 className="mt-2 text-3xl font-semibold">Welcome, {user?.fullName}</h1>
          <p className="mt-3 text-slate-600">Your authenticated HomeGuard workspace is ready.</p>
        </main>
      </div>
    </ProtectedRoute>
  );
}