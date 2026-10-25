import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useRole, ADMIN_ROLES } from '../hooks/useRole';

interface AdminRouteProps {
  children: ReactNode;
}

/**
 * Authorization guard for administrative controls.
 *
 * Fails closed:
 * - Session or role still loading -> access checking spinner
 * - No session -> /login with redirect preservation
 * - Role is not admin -> redirect to "/" with `replace`
 * - Database RLS and server-side RPCs remain the true security boundary.
 */
export default function AdminRoute({ children }: AdminRouteProps) {
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
          <p className="text-sm text-slate-600">Verifying administrative access...</p>
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

  if (role === null || !ADMIN_ROLES.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
