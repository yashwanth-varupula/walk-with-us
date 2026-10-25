import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../Login';
import Register from '../Register';
import ForgotPassword from '../ForgotPassword';
import ResetPassword from '../ResetPassword';
import { supabase } from '../../../lib/supabase';
import * as authHook from '../../../hooks/useAuth';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Authentication Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Login Page', () => {
    it('renders form fields, submit button, and navigation links', () => {
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
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );

      expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /forgot password\?/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /create one/i })).toBeInTheDocument();
    });

    it('validates required fields before submitting', async () => {
      const mockSignIn = vi.fn();
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: mockSignIn,
        signUp: vi.fn(),
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/please fill in both fields/i)).toBeInTheDocument();
      expect(mockSignIn).not.toHaveBeenCalled();
    });

    it('submits credentials and navigates on success', async () => {
      const mockSignIn = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: mockSignIn,
        signUp: vi.fn(),
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'test@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'Secret1234!' } });
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith('test@example.com', 'Secret1234!');
        expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      });
    });

    it('displays error alert on invalid credentials', async () => {
      const mockSignIn = vi.fn().mockRejectedValue(new Error('Invalid login credentials'));
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: mockSignIn,
        signUp: vi.fn(),
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'wrong@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'badpassword' } });
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
    });

    it('handles resend confirmation rate limit with user guidance', async () => {
      const mockSignIn = vi.fn().mockRejectedValue(new Error('Email not confirmed'));
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: mockSignIn,
        signUp: vi.fn(),
        signOut: vi.fn(),
      });

      const mockResend = vi.fn().mockResolvedValue({
        data: null,
        error: { status: 429, message: 'over_email_send_rate_limit' },
      });
      vi.spyOn(supabase.auth, 'resend').mockImplementation(mockResend as any);

      render(
        <MemoryRouter>
          <Login />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'unconfirmed@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'password123' } });
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

      expect(await screen.findByText(/email address has not been confirmed/i)).toBeInTheDocument();

      const resendBtn = screen.getByRole('button', { name: /resend confirmation email/i });
      fireEvent.click(resendBtn);

      expect(await screen.findByText(/email delivery is temporarily rate-limited/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /resend confirmation \(\d+s\)/i })).toBeDisabled();
    });
  });

  describe('Register Page', () => {
    it('validates password minimum length and confirmation match', async () => {
      const mockSignUp = vi.fn();
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: vi.fn(),
        signUp: mockSignUp,
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Register />
        </MemoryRouter>,
      );

      // Short password
      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Doe' } });
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'jane@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: '123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: '123' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/your password must be at least 8 characters/i)).toBeInTheDocument();
      expect(mockSignUp).not.toHaveBeenCalled();

      // Mismatched passwords
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'validPassword123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'differentPassword456' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it('redirects to /my-requests when session is created immediately', async () => {
      const mockSignUp = vi.fn().mockResolvedValue({ sessionCreated: true });
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: vi.fn(),
        signUp: mockSignUp,
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Register />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Jane Doe' } });
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'jane@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'validPassword123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'validPassword123' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith('jane@example.com', 'validPassword123', 'Jane Doe');
        expect(mockNavigate).toHaveBeenCalledWith('/my-requests', { replace: true });
      });
    });

    it('shows confirmation instructions when email verification is required', async () => {
      const mockSignUp = vi.fn().mockResolvedValue({ sessionCreated: false });
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: vi.fn(),
        signUp: mockSignUp,
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Register />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'John Smith' } });
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'john@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'safePassword123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'safePassword123' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/check your email for the confirmation link/i)).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('handles rate limit errors during registration gracefully with wait guidance and prevents repeated submission', async () => {
      const rateLimitErr = new Error('email rate limit exceeded');
      (rateLimitErr as any).status = 429;
      const mockSignUp = vi.fn().mockRejectedValue(rateLimitErr);
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: vi.fn(),
        signUp: mockSignUp,
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Register />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Rate Limited' } });
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'ratelimit@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'safePassword123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'safePassword123' } });

      const submitBtn = screen.getByRole('button', { name: /create account/i });
      fireEvent.click(submitBtn);

      expect(await screen.findByText(/email delivery rate limit reached/i)).toBeInTheDocument();
      expect(screen.getByText(/did you just register\?/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /go to sign in/i })).toBeInTheDocument();

      // Submit button should be disabled during cooldown
      expect(screen.getByRole('button', { name: /please wait/i })).toBeDisabled();

      // Clicking while disabled should not trigger another signUp call
      fireEvent.click(screen.getByRole('button', { name: /please wait/i }));
      expect(mockSignUp).toHaveBeenCalledTimes(1);
    });

    it('correctly handles duplicate email registration under user enumeration protection without claiming account creation', async () => {
      const mockSignUp = vi.fn().mockResolvedValue({
        sessionCreated: false,
        isExistingUser: true,
        userCreated: false,
      });
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: vi.fn(),
        signUp: mockSignUp,
        signOut: vi.fn(),
      });

      render(
        <MemoryRouter>
          <Register />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Existing User' } });
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'existing@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'safePassword123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'safePassword123' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      // Does not claim "Account created"
      expect(screen.queryByText(/account created/i)).not.toBeInTheDocument();

      // Explains account already exists and offers sign in / reset password
      expect(await screen.findByText(/an account with this email already exists/i)).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('link', { name: /reset password/i })).toBeInTheDocument();
    });

    it('enforces cooldown and handles resend verification rate limits on pending screen', async () => {
      const mockSignUp = vi.fn().mockResolvedValue({
        sessionCreated: false,
        userCreated: true,
        isExistingUser: false,
      });
      vi.spyOn(authHook, 'useAuth').mockReturnValue({
        session: null,
        user: null,
        loading: false,
        role: null,
        roleLoading: false,
        roleError: null,
        signIn: vi.fn(),
        signUp: mockSignUp,
        signOut: vi.fn(),
      });

      const mockResend = vi.fn().mockResolvedValue({
        data: null,
        error: { status: 429, message: 'For security purposes, you can only request this after 60 seconds.' },
      });
      vi.spyOn(supabase.auth, 'resend').mockImplementation(mockResend as any);

      render(
        <MemoryRouter>
          <Register />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: 'Cooldown User' } });
      fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'cooldown@example.com' } });
      fireEvent.change(screen.getByLabelText(/^password/i), { target: { value: 'safePassword123' } });
      fireEvent.change(screen.getByLabelText(/confirm password/i), { target: { value: 'safePassword123' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      expect(await screen.findByText(/verify your email address/i)).toBeInTheDocument();

      // Resend button starts with cooldown disabled
      const resendBtn = screen.getByRole('button', { name: /resend email/i });
      expect(resendBtn).toBeDisabled();
      expect(mockResend).not.toHaveBeenCalled();
    });
  });

  describe('ForgotPassword Page', () => {
    it('sends reset link and shows confirmation alert', async () => {
      const mockReset = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase.auth, 'resetPasswordForEmail').mockImplementation(mockReset as any);

      render(
        <MemoryRouter>
          <ForgotPassword />
        </MemoryRouter>,
      );

      expect(screen.getByRole('heading', { name: /reset your password/i })).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/account email/i), { target: { value: 'user@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /send password reset link/i }));

      await waitFor(() => {
        expect(mockReset).toHaveBeenCalledWith('user@example.com', {
          redirectTo: expect.stringContaining('/reset-password'),
        });
      });

      expect(await screen.findByText(/reset link sent/i)).toBeInTheDocument();
      expect(screen.getByText(/user@example.com/i)).toBeInTheDocument();
    });

    it('handles reset request errors gracefully', async () => {
      vi.spyOn(supabase.auth, 'resetPasswordForEmail').mockResolvedValue({
        error: { message: 'Rate limit exceeded' },
      } as any);

      render(
        <MemoryRouter>
          <ForgotPassword />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/account email/i), { target: { value: 'user@example.com' } });
      fireEvent.click(screen.getByRole('button', { name: /send password reset link/i }));

      expect(await screen.findByText(/rate limit exceeded/i)).toBeInTheDocument();
    });
  });

  describe('ResetPassword Page', () => {
    it('updates password and provides navigation to account', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'u-1' } } },
      } as any);
      vi.spyOn(supabase.auth, 'onAuthStateChange').mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      } as any);

      const mockUpdate = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase.auth, 'updateUser').mockImplementation(mockUpdate as any);

      render(
        <MemoryRouter>
          <ResetPassword />
        </MemoryRouter>,
      );

      fireEvent.change(screen.getByLabelText(/^new password/i), { target: { value: 'BrandNewPass123' } });
      fireEvent.change(screen.getByLabelText(/confirm new password/i), { target: { value: 'BrandNewPass123' } });
      fireEvent.click(screen.getByRole('button', { name: /update password/i }));

      await waitFor(() => {
        expect(mockUpdate).toHaveBeenCalledWith({ password: 'BrandNewPass123' });
      });

      expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /continue to account/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/my-requests', { replace: true });
    });
  });
});
