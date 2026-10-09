import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { isUserRole, type UserRole } from '../lib/roles';

interface AuthValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  role: UserRole | null;
  /** True while the session OR the role lookup is still in flight. */
  roleLoading: boolean;
  roleError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Returns whether a session was created.
   *
   * This matters because Supabase behaves differently depending on whether
   * email confirmation is switched on: with it on, signUp returns no session and
   * the user must click a link in their inbox; with it off, they are signed in
   * immediately. The register form has to say the right thing in each case, and
   * it cannot guess — so the SDK's actual answer is surfaced rather than assumed.
   */
  signUp: (email: string, password: string, fullName: string) => Promise<{ sessionCreated: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

/**
 * Resolves the signed-in user and their role ONCE for the whole app.
 *
 * Previously `useAuth()` was a plain hook with its own `getSession()` call and
 * its own `onAuthStateChange` subscription, and the header, the footer and every
 * page called it independently. A single page therefore opened 4-6 duplicate
 * session requests, and `useIsStaff()` fired a separate `get_my_role()` RPC
 * per call site — so a cold load made 2 redundant role round-trips and each one
 * could resolve at a different moment, briefly rendering a logged-out header
 * next to a staff-only menu item.
 *
 * This provider keeps the exact same public API, so all existing call sites are
 * unchanged; they just share one source of truth now.
 *
 * SECURITY: the role is resolved from the server via `get_my_role()` only. It is
 * never read from localStorage, a form field, or a client-asserted JWT claim,
 * and it fails closed to null on any error.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<UserRole | null>(null);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // `getSession()` reads the local session and is enough to paint a
    // signed-in header. Authority is never derived from it — see below.
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      listener?.subscription.unsubscribe();
    };
  }, []);

  const userId = user?.id ?? null;

  // Guards against a stale response for a previous user overwriting the role of
  // a user who has since signed in.
  const roleRequestRef = useRef(0);

  useEffect(() => {
    if (loading) return;

    if (!userId) {
      roleRequestRef.current += 1;
      setRole(null);
      setRoleError(null);
      setRoleLoading(false);
      return;
    }

    const requestId = ++roleRequestRef.current;
    setRoleLoading(true);
    setRoleError(null);

    supabase.rpc('get_my_role').then(({ data, error }) => {
      if (requestId !== roleRequestRef.current) return;

      setRoleLoading(false);

      if (error) {
        console.error('[auth] get_my_role failed', {
          code: (error as { code?: string }).code ?? null,
          message: error.message,
        });
        setRole(null);
        setRoleError('Your access level could not be verified. Please try again.');
        return;
      }

      if (!isUserRole(data)) {
        // A profile row that has not been created yet, or a role this build does
        // not know about. Either way it is NOT staff, so deny.
        console.warn('[auth] get_my_role returned an unusable payload:', data);
        setRole(null);
        return;
      }

      setRole(data);
    });

    return () => {
      // Invalidate any in-flight response for the previous user.
      if (requestId === roleRequestRef.current) roleRequestRef.current += 1;
    };
  }, [userId, loading]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
        // Required by Postgres RLS policies on profiles, so the row is created
        // in the same call rather than by a second request that could fail
        // after the account already exists.
        emailRedirectTo: `${window.location.origin}/login`,
      },
    });
    if (error) throw error;
    return { sessionCreated: Boolean(data.session) };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      user,
      loading,
      role,
      roleLoading,
      roleError,
      signIn,
      signUp,
      signOut,
    }),
    [session, user, loading, role, roleLoading, roleError, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthContext(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider> (see main.tsx).');
  }
  return ctx;
}

/**
 * Session + user + the server-resolved role. Backed by the shared provider, so
 * the number of `getSession()` and `get_my_role()` calls no longer grows with
 * the number of components on the page.
 */
export function useAuth(): AuthValue {
  return useAuthContext();
}
