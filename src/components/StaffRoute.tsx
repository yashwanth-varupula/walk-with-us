import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRole, STAFF_ROLES } from '../hooks/useRole';

interface StaffRouteProps {
  children: ReactNode;
}

/**
 * Authorization guard for the staff console.
 *
 * This is UX protection, not security. It stops a requester/donor/volunteer/
 * partner from ever seeing staff screens or the data behind them, but the real
 * enforcement is Postgres RLS: every staff query in services/staffRequests.ts
 * is already scoped by the staff policies, so a user who bypasses this
 * component in devtools still receives zero rows and 42501 on writes.
 *
 * Behaviour:
 * - session still loading, or role still resolving -> loading screen
 * - no session -> /login, preserving the intended destination
 * - role is not staff/admin -> redirect to "/" with `replace`
 *
 * The denial path deliberately reveals nothing: not whether the account exists,
 * not what role it holds, and not whether the requested request id is real.
 */
export default function StaffRoute({ children }: StaffRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { role, loading: roleLoading, error: roleError } = useRole();
  const location = useLocation();

  if (authLoading || (user && roleLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600"
            aria-hidden="true"
          />
          <p className="text-sm text-slate-600">Checking your access...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (roleError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-xl border border-amber-200 bg-white p-6 text-center shadow">
          <h1 className="text-lg font-semibold text-slate-900">Access could not be verified</h1>
          <p className="mt-2 text-sm text-slate-600">{roleError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Fail closed: an unresolved or non-staff role is denied, never assumed.
  if (role === null || !STAFF_ROLES.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
