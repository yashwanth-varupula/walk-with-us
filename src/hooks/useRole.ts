import { useAuth } from './useAuth';
import {
  STAFF_ROLES,
  ADMIN_ROLES,
  isUserRole,
  isAdminRole,
  USER_ROLES,
  type UserRole,
} from '../lib/roles';

/* Re-exported so existing call sites keep working. */
export { STAFF_ROLES, ADMIN_ROLES, isUserRole, isAdminRole, USER_ROLES };
export type { UserRole };

interface RoleState {
  role: UserRole | null;
  /** True while either the session or the role lookup is still in flight. */
  loading: boolean;
  /** Set when the role lookup itself failed. The role stays null (fail closed). */
  error: string | null;
}

/**
 * Reads the role already resolved by <AuthProvider>.
 * Fails closed on any error or missing value.
 */
export function useRole(): RoleState {
  const { role, roleLoading, roleError, loading: authLoading } = useAuth();
  return { role, loading: authLoading || roleLoading, error: roleError };
}

/** Convenience: is the current user staff or admin? False while still loading. */
export function useIsStaff(): boolean {
  const { role } = useRole();
  return role !== null && STAFF_ROLES.includes(role);
}

/** Convenience: is the current user an administrator? False while still loading. */
export function useIsAdmin(): boolean {
  const { role } = useRole();
  return role !== null && ADMIN_ROLES.includes(role);
}
