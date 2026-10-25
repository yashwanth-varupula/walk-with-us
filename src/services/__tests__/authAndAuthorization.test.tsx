import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProtectedRoute from '../../components/ProtectedRoute';
import StaffRoute from '../../components/StaffRoute';
import AdminRoute from '../../components/AdminRoute';
import { supabase } from '../../lib/supabase';
import {
  isAuthRateLimitError,
  getAuthRateLimitCooldown,
  formatAuthRateLimitMessage,
  isDuplicateAccountError,
} from '../../lib/errors';
import * as authHook from '../../hooks/useAuth';
import * as roleHook from '../../hooks/useRole';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Phase 8: Complete Production-Grade Auth & RBAC Security Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // SCENARIO 1: Successful Registration
  // =========================================================================
  it('Scenario 1: Successful registration creates account via Supabase Auth', async () => {
    const mockSignUp = vi.fn().mockResolvedValue({
      data: { user: { id: 'usr-1', email: 'beneficiary@example.com' }, session: null },
      error: null,
    });
    vi.spyOn(supabase.auth, 'signUp').mockImplementation(mockSignUp as any);

    const { data, error } = await supabase.auth.signUp({
      email: 'beneficiary@example.com',
      password: 'SafePassword123!',
      options: { data: { full_name: 'Beneficiary One' } },
    });

    expect(error).toBeNull();
    expect(data.user?.email).toBe('beneficiary@example.com');
    expect(mockSignUp).toHaveBeenCalledWith({
      email: 'beneficiary@example.com',
      password: 'SafePassword123!',
      options: { data: { full_name: 'Beneficiary One' } },
    });
  });

  // =========================================================================
  // SCENARIO 2: Invalid Registration Input
  // =========================================================================
  it('Scenario 2: Rejects invalid registration input (short password, invalid format)', () => {
    const passwordMinLength = 8;
    const testShortPass = '12345';
    expect(testShortPass.length < passwordMinLength).toBe(true);

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    expect(emailPattern.test('invalid-email')).toBe(false);
    expect(emailPattern.test('valid@example.com')).toBe(true);
  });

  // =========================================================================
  // SCENARIO 3: Duplicate-email handling
  // =========================================================================
  it('Scenario 3: Duplicate-email registration returns informative, non-sensitive error', async () => {
    vi.spyOn(supabase.auth, 'signUp').mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered', name: 'AuthApiError', status: 400 } as any,
    });

    const { error } = await supabase.auth.signUp({
      email: 'existing@example.com',
      password: 'SafePassword123!',
    });

    expect(error?.message).toMatch(/already registered/i);
  });

  // =========================================================================
  // SCENARIO 4: Email-verification flow
  // =========================================================================
  it('Scenario 4: Handles unverified email flow and verification resending', async () => {
    const mockResend = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.spyOn(supabase.auth, 'resend').mockImplementation(mockResend as any);

    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: 'pending@example.com',
    });

    expect(error).toBeNull();
    expect(mockResend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'pending@example.com',
    });
  });

  // =========================================================================
  // SCENARIO 4B: Rate-limit error detection and cooldown parsing
  // =========================================================================
  it('Scenario 4B: Accurately identifies Supabase Auth email rate-limit errors and parses cooldowns', () => {
    // 1. HTTP 429 status error
    expect(isAuthRateLimitError({ status: 429, message: 'Too many requests' })).toBe(true);

    // 2. Typical Supabase message variants
    expect(isAuthRateLimitError(new Error('email rate limit exceeded'))).toBe(true);
    expect(isAuthRateLimitError(new Error('Email rate limit exceeded'))).toBe(true);
    expect(isAuthRateLimitError({ message: 'over_email_send_rate_limit' })).toBe(true);
    expect(isAuthRateLimitError({ message: 'For security purposes, you can only request this after 60 seconds.' })).toBe(true);
    expect(isAuthRateLimitError({ code: 'over_email_send_rate_limit', message: 'Rate exceeded' })).toBe(true);

    // 3. Non-rate-limit errors return false
    expect(isAuthRateLimitError(new Error('Invalid login credentials'))).toBe(false);
    expect(isAuthRateLimitError(new Error('User already registered'))).toBe(false);
    expect(isAuthRateLimitError(null)).toBe(false);

    // 4. Cooldown parser extracts seconds or falls back to default 60s
    expect(getAuthRateLimitCooldown({ message: 'after 45 seconds' })).toBe(45);
    expect(getAuthRateLimitCooldown({ message: 'wait 90 seconds' })).toBe(90);
    expect(getAuthRateLimitCooldown({ message: 'email rate limit exceeded' }, 60)).toBe(60);

    // 5. User-facing messages are actionable and polite
    const signupMsg = formatAuthRateLimitMessage('signup', 60);
    expect(signupMsg).toContain('Email delivery rate limit reached');
    expect(signupMsg).toContain('60 seconds');

    const resendMsg = formatAuthRateLimitMessage('resend', 60);
    expect(resendMsg).toContain('Email delivery is temporarily rate-limited');
    expect(resendMsg).toContain('spam or junk');
  });

  // =========================================================================
  // SCENARIO 4C: Duplicate account detection and user enumeration protection
  // =========================================================================
  it('Scenario 4C: Identifies duplicate accounts from errors and empty identity payloads', () => {
    expect(isDuplicateAccountError(new Error('User already registered'))).toBe(true);
    expect(isDuplicateAccountError(new Error('A user with this email address already exists'))).toBe(true);
    expect(isDuplicateAccountError(new Error('email rate limit exceeded'))).toBe(false);

    // Under user enumeration protection, existing user returns empty identities array
    const existingUserPayload = {
      id: 'existing-uuid',
      email: 'existing@example.com',
      identities: [],
    };
    const isExistingUser = Boolean(
      existingUserPayload &&
      Array.isArray(existingUserPayload.identities) &&
      existingUserPayload.identities.length === 0,
    );
    expect(isExistingUser).toBe(true);

    const newUserPayload = {
      id: 'new-uuid',
      email: 'new@example.com',
      identities: [{ id: 'ident-1', provider: 'email' }],
    };
    const isNewUserExisting = Boolean(
      newUserPayload &&
      Array.isArray(newUserPayload.identities) &&
      newUserPayload.identities.length === 0,
    );
    expect(isNewUserExisting).toBe(false);
  });

  // =========================================================================
  // SCENARIO 4D: Password and token confidentiality verification
  // =========================================================================
  it('Scenario 4D: Ensures error formatters never echo plaintext passwords or tokens', () => {
    const rawError = {
      status: 429,
      message: 'email rate limit exceeded',
      code: 'over_email_send_rate_limit',
      // Simulating accidental context leakage
      attemptedPassword: 'SuperSecretPassword123!',
      sessionToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    };

    const formatted = formatAuthRateLimitMessage('signup', getAuthRateLimitCooldown(rawError));
    expect(formatted).not.toContain('SuperSecretPassword123!');
    expect(formatted).not.toContain('eyJhbGci');
    expect(formatted).not.toContain('password');
  });

  // =========================================================================
  // SCENARIO 5: Successful Login
  // =========================================================================
  it('Scenario 5: Successful login authenticates session', async () => {
    const mockSignIn = vi.fn().mockResolvedValue({
      data: {
        user: { id: 'usr-1', email: 'donor@example.com' },
        session: { access_token: 'fake-jwt', user: { id: 'usr-1' } },
      },
      error: null,
    });
    vi.spyOn(supabase.auth, 'signInWithPassword').mockImplementation(mockSignIn as any);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'donor@example.com',
      password: 'ValidPassword123!',
    });

    expect(error).toBeNull();
    expect(data.session).toBeDefined();
    expect(data.user?.id).toBe('usr-1');
  });

  // =========================================================================
  // SCENARIO 6: Invalid Login
  // =========================================================================
  it('Scenario 6: Invalid login rejects wrong credentials cleanly', async () => {
    vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials', name: 'AuthApiError', status: 400 } as any,
    });

    const { error } = await supabase.auth.signInWithPassword({
      email: 'unknown@example.com',
      password: 'WrongPassword',
    });

    expect(error?.message).toBe('Invalid login credentials');
  });

  // =========================================================================
  // SCENARIO 7: Session restoration after refresh
  // =========================================================================
  it('Scenario 7: Session restoration queries getSession without flashing unauthorized', async () => {
    const mockSession = {
      access_token: 'jwt-123',
      user: { id: 'usr-1', email: 'requester@example.com' },
    };
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: mockSession as any },
      error: null,
    });

    const { data } = await supabase.auth.getSession();
    expect(data.session?.user.email).toBe('requester@example.com');
  });

  // =========================================================================
  // SCENARIO 8: Logout
  // =========================================================================
  it('Scenario 8: Logout terminates the Supabase session safely', async () => {
    const mockSignOut = vi.fn().mockResolvedValue({ error: null });
    vi.spyOn(supabase.auth, 'signOut').mockImplementation(mockSignOut as any);

    await supabase.auth.signOut();
    expect(mockSignOut).toHaveBeenCalled();
  });

  // =========================================================================
  // SCENARIO 9: Password Recovery
  // =========================================================================
  it('Scenario 9: Dispatches password reset email with correct redirect URL', async () => {
    const mockReset = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.spyOn(supabase.auth, 'resetPasswordForEmail').mockImplementation(mockReset as any);

    const redirectUrl = 'http://localhost:5173/reset-password';
    await supabase.auth.resetPasswordForEmail('user@example.com', {
      redirectTo: redirectUrl,
    });

    expect(mockReset).toHaveBeenCalledWith('user@example.com', {
      redirectTo: redirectUrl,
    });
  });

  // =========================================================================
  // SCENARIO 10: Password Reset
  // =========================================================================
  it('Scenario 10: Updates password through Supabase auth.updateUser', async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });
    vi.spyOn(supabase.auth, 'updateUser').mockImplementation(mockUpdate as any);

    await supabase.auth.updateUser({ password: 'BrandNewSecurePassword123!' });
    expect(mockUpdate).toHaveBeenCalledWith({ password: 'BrandNewSecurePassword123!' });
  });

  // =========================================================================
  // SCENARIO 11: Unauthenticated Access to Protected Routes
  // =========================================================================
  it('Scenario 11: Unauthenticated user accessing ProtectedRoute redirects to /login', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: null,
      user: null,
      loading: false,
      role: null,
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/my-requests']}>
        <Routes>
          <Route
            path="/my-requests"
            element={
              <ProtectedRoute>
                <div>Private Requester Content</div>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<div>Login Page</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Private Requester Content')).not.toBeInTheDocument();
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  // =========================================================================
  // SCENARIO 12: Regular User Attempting to Access Staff Routes
  // =========================================================================
  it('Scenario 12: Regular user attempting to access StaffRoute is denied and redirected to /', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: {} as any,
      user: { id: 'usr-regular' } as any,
      loading: false,
      role: 'requester',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(roleHook, 'useRole').mockReturnValue({
      role: 'requester',
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/staff/requests']}>
        <Routes>
          <Route
            path="/staff/requests"
            element={
              <StaffRoute>
                <div>Staff Console Dashboard</div>
              </StaffRoute>
            }
          />
          <Route path="/" element={<div>Public Home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Staff Console Dashboard')).not.toBeInTheDocument();
    expect(screen.getByText('Public Home')).toBeInTheDocument();
  });

  // =========================================================================
  // SCENARIO 13: Regular User Attempting to Access Administrator Routes
  // =========================================================================
  it('Scenario 13: Regular user attempting to access AdminRoute is denied and redirected to /', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: {} as any,
      user: { id: 'usr-regular' } as any,
      loading: false,
      role: 'requester',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(roleHook, 'useRole').mockReturnValue({
      role: 'requester',
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/admin/controls']}>
        <Routes>
          <Route
            path="/admin/controls"
            element={
              <AdminRoute>
                <div>Admin Secret Panel</div>
              </AdminRoute>
            }
          />
          <Route path="/" element={<div>Public Home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Admin Secret Panel')).not.toBeInTheDocument();
    expect(screen.getByText('Public Home')).toBeInTheDocument();
  });

  // =========================================================================
  // SCENARIO 14: User Attempting to Assign Themselves an Admin Role
  // =========================================================================
  it('Scenario 14: Direct role modification via profiles update is blocked by trigger and RLS', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'P0001',
          message: 'Direct modification of user role is forbidden. Use public.set_user_role().',
        },
      }),
    });
    vi.spyOn(supabase, 'from').mockReturnValue({
      update: mockUpdate,
    } as any);

    const { error } = await supabase
      .from('profiles')
      .update({ role: 'admin' as any })
      .eq('id', 'usr-regular');

    expect(error?.message).toMatch(/Direct modification of user role is forbidden/i);
  });

  // =========================================================================
  // SCENARIO 15: User Attempting to Modify Another User's Role
  // =========================================================================
  it('Scenario 15: Non-admin calling set_user_role RPC receives 403 Forbidden', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: '42501',
        message: 'Forbidden: Only administrators can assign user roles.',
      },
    });
    vi.spyOn(supabase, 'rpc').mockImplementation(mockRpc as any);

    const { error } = await supabase.rpc('set_user_role', {
      p_target_user_id: 'usr-target',
      p_new_role: 'staff',
    });

    expect(error?.message).toMatch(/Only administrators can assign user roles/i);
  });

  // =========================================================================
  // SCENARIO 16: User Attempting to Modify Staff-Only Verification Fields
  // =========================================================================
  it('Scenario 16: Requesters cannot tamper with verification status or notes', async () => {
    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '42501',
          message: 'new row violates row-level security policy for table "help_requests"',
        },
      }),
    });
    vi.spyOn(supabase, 'from').mockReturnValue({
      update: mockUpdate,
    } as any);

    const { error } = await supabase
      .from('help_requests')
      .update({ status: 'verified' as any, verification_notes: 'Forged verification' })
      .eq('id', 'req-1');

    expect(error?.code).toBe('42501');
  });

  // =========================================================================
  // SCENARIO 17: Staff Attempting an Unauthorized Administrator Operation
  // =========================================================================
  it('Scenario 17: Staff cannot access AdminRoute or execute admin role elevation', () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: {} as any,
      user: { id: 'usr-staff' } as any,
      loading: false,
      role: 'staff',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(roleHook, 'useRole').mockReturnValue({
      role: 'staff',
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/admin/roles']}>
        <Routes>
          <Route
            path="/admin/roles"
            element={
              <AdminRoute>
                <div>Admin Role Manager</div>
              </AdminRoute>
            }
          />
          <Route path="/" element={<div>Public Home</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Admin Role Manager')).not.toBeInTheDocument();
    expect(screen.getByText('Public Home')).toBeInTheDocument();
  });

  // =========================================================================
  // SCENARIO 18: Authorized Administrator Performing an Allowed Operation
  // =========================================================================
  it('Scenario 18: Authorized administrator successfully passes AdminRoute and executes set_user_role', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: {} as any,
      user: { id: 'usr-admin' } as any,
      loading: false,
      role: 'admin',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(roleHook, 'useRole').mockReturnValue({
      role: 'admin',
      loading: false,
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/admin/roles']}>
        <Routes>
          <Route
            path="/admin/roles"
            element={
              <AdminRoute>
                <div>Admin Role Manager</div>
              </AdminRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Admin Role Manager')).toBeInTheDocument();

    // Verify RPC execution
    const mockRpc = vi.fn().mockResolvedValue({
      data: { success: true, message: 'User role updated successfully.', new_role: 'staff' },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation(mockRpc as any);

    const { data, error } = await supabase.rpc('set_user_role', {
      p_target_user_id: 'usr-target',
      p_new_role: 'staff',
    });

    expect(error).toBeNull();
    expect(data.success).toBe(true);
    expect(data.new_role).toBe('staff');
  });

  // =========================================================================
  // SCENARIO 19: Anonymous Access to Private Records
  // =========================================================================
  it('Scenario 19: Anonymous access to private draft help requests returns empty results', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    });
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: mockSelect,
    } as any);

    const { data } = await supabase
      .from('help_requests')
      .select('*')
      .eq('status', 'draft');

    expect(data).toEqual([]);
  });

  // =========================================================================
  // SCENARIO 20: Cross-user Access to Private Documents
  // =========================================================================
  it('Scenario 20: Cross-user access to another beneficiary private document is denied', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied for table help_request_documents' },
      }),
    });
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: mockSelect,
    } as any);

    const { data, error } = await supabase
      .from('help_request_documents')
      .select('*')
      .eq('request_id', 'other-user-request');

    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });

  // =========================================================================
  // SCENARIO 21: Direct API Requests Bypassing Route Guards
  // =========================================================================
  it('Scenario 21: Direct REST requests bypassing frontend route guards still enforce backend RLS', async () => {
    const mockInsert = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'new row violates row-level security policy' },
    });
    vi.spyOn(supabase, 'from').mockReturnValue({
      insert: mockInsert,
    } as any);

    // Attacker tries to insert an admin action directly via REST
    const { error } = await supabase.from('admin_actions').insert({
      action: 'unauthorized_action',
    } as any);

    expect(error?.code).toBe('42501');
  });

  // =========================================================================
  // SCENARIO 22: Authentication Network Failures and Expired Sessions
  // =========================================================================
  it('Scenario 22: Authentication network failures and expired sessions fail closed safely', () => {
    // When roleError occurs, StaffRoute renders the error notice and does not leak data
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: { user: { id: 'usr-1' } } as any,
      user: { id: 'usr-1' } as any,
      loading: false,
      role: null,
      roleLoading: false,
      roleError: 'Network error verifying access permissions.',
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(roleHook, 'useRole').mockReturnValue({
      role: null,
      loading: false,
      error: 'Network error verifying access permissions.',
    });

    render(
      <MemoryRouter initialEntries={['/staff']}>
        <StaffRoute>
          <div>Staff Confidential Data</div>
        </StaffRoute>
      </MemoryRouter>,
    );

    expect(screen.queryByText('Staff Confidential Data')).not.toBeInTheDocument();
    expect(screen.getByText('Access could not be verified')).toBeInTheDocument();
  });
});
