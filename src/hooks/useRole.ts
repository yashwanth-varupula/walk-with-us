import { useAuth } from './useAuth';
import { STAFF_ROLES, isUserRole, USER_ROLES, type UserRole } from '../lib/roles';

/* Re-exported so existing `import { STAFF_ROLES } from '../../hooks/useRole'`
   call sites keep working. The definitions now live in lib/roles.ts. */
export { STAFF_ROLES, isUserRole, USER_ROLES };
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
 *
 * This hook used to issue its own `get_my_role()` RPC on every mount. Because
 * both the header and the footer call `useIsStaff()`, and every page that
 * renders them mounts a fresh instance, a single cold page load fired the role
 * RPC two to three times over. It now consumes the single shared lookup.
 *
 * It still fails closed: the provider leaves the role null on any error, an
 * unrecognised payload, or while loading, and StaffRoute treats null as
 * "not staff".
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
