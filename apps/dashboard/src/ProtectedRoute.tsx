import type { ReactNode } from 'react';
import type { AuthUser } from '@homeguard/shared';

interface ProtectedRouteProps {
  user: AuthUser | null;
  loading: boolean;
  unauthenticated: ReactNode;
  mfaRequired: ReactNode;
  children: ReactNode;
}

export default function ProtectedRoute({
  user,
  loading,
  unauthenticated,
  mfaRequired,
  children,
}: ProtectedRouteProps) {
  if (loading) {
    return <main className="p-8 text-sm text-slate-600">Checking your session…</main>;
  }

  if (!user) return unauthenticated;
  if (user.mfaRequired && user.assuranceLevel !== 'aal2') return mfaRequired;
  return children;
}