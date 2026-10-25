/**
 * The authoritative role list, mirroring the `user_role` enum in Postgres:
 * requester, donor, volunteer, partner, staff, admin.
 *
 * This list exists so the app can VALIDATE whatever the database returns. It is
 * never used to decide what a user is allowed to do on its own — that decision
 * is always the database's, via `get_my_role()` and RLS. Its only job is to
 * fail closed when the payload is missing or unrecognised.
 *
 * It lives in its own module because both useAuth (which resolves the role) and
 * useRole (which consumes it) need it, and a module that imports from its own
 * consumer is a circular dependency waiting to bite.
 */
export const USER_ROLES = [
  'requester',
  'donor',
  'volunteer',
  'partner',
  'staff',
  'admin',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

/** Roles permitted into the staff console. Everything else is denied. */
export const STAFF_ROLES: readonly UserRole[] = ['staff', 'admin'];

/** Roles permitted into administrative controls. Everything else is denied. */
export const ADMIN_ROLES: readonly UserRole[] = ['admin'];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(role: UserRole | null): boolean {
  return role === 'admin';
}
