import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, RotateCw } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  isAuthRateLimitError,
  getAuthRateLimitCooldown,
  formatAuthRateLimitMessage,
} from '../../lib/errors';
import Button, { LinkButton } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Card';

/** The path a protected route asked for, if it supplied one. */
function safeReturnPath(state: unknown): string {
  const candidate = (state as { from?: { pathname?: unknown } } | null)?.from?.pathname;
  // Only a same-origin absolute path. Anything else (a full URL, a protocol
  // relative "//evil.example", a non-string) falls back to the home page, so
  // `?from=` cannot be used as an open redirect after login.
  if (typeof candidate === 'string' && /^\/(?!\/)/.test(candidate)) {
    return candidate;
  }
  return '/';
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Email confirmation resend states
  const [isUnconfirmedEmail, setIsUnconfirmedEmail] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);

  const { signIn, session, loading: sessionLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = safeReturnPath(location.state);

  // Cooldown timer for resending confirmation email
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  /*
    Someone who is already signed in has no business on this form. Bounce them
    once the session is known, rather than letting them submit credentials that
    are guaranteed to be ignored and then sitting on a useless form.
  */
  useEffect(() => {
    if (!sessionLoading && session) {
      navigate(from, { replace: true });
    }
  }, [session, sessionLoading, from, navigate]);

  const handleResendConfirmation = async () => {
    const trimmed = email.trim();
    if (!trimmed || resending || resendCooldown > 0) return;
    setResending(true);
    setResendSuccess(null);
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: trimmed,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });
      if (resendErr) {
        if (isAuthRateLimitError(resendErr)) {
          const waitSec = getAuthRateLimitCooldown(resendErr, 60);
          setResendCooldown(waitSec);
          setError(formatAuthRateLimitMessage('resend', waitSec));
        } else {
          setError(resendErr.message || 'Failed to resend confirmation email.');
        }
      } else {
        setResendSuccess('Confirmation link resent! Check your inbox and spam folder.');
        setResendCooldown(60);
      }
    } catch (err: unknown) {
      if (isAuthRateLimitError(err)) {
        const waitSec = getAuthRateLimitCooldown(err, 60);
        setResendCooldown(waitSec);
        setError(formatAuthRateLimitMessage('resend', waitSec));
      } else {
        setError(err instanceof Error ? err.message : 'Error resending confirmation.');
      }
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsUnconfirmedEmail(false);
    setResendSuccess(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('Please fill in both fields.');
      return;
    }
    setLoading(true);
    try {
      await signIn(trimmedEmail, password);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? err.message : 'Invalid credentials.';
      if (/email not confirmed|email_not_confirmed/i.test(msg)) {
        setIsUnconfirmedEmail(true);
        setError('Your email address has not been confirmed yet.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex min-h-[70vh] items-center justify-center bg-canvas py-12">
      <div className="container-narrow max-w-md">
        <h1 className="text-center text-2xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-center text-sm text-ink-muted">
          Sign in to ask for help, attach documents, and track your requests.
        </p>

        {error && <Alert tone="stop" className="mt-6">{error}</Alert>}
        {resendSuccess && <Alert tone="good" className="mt-6">{resendSuccess}</Alert>}

        {isUnconfirmedEmail && (
          <div className="mt-4 rounded-card border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
            <p>
              Please check your email inbox to verify your account before logging in.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleResendConfirmation}
              loading={resending}
              disabled={resending || resendCooldown > 0}
              loadingLabel="Resending…"
            >
              <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {resendCooldown > 0 ? `Resend confirmation (${resendCooldown}s)` : 'Resend confirmation email'}
            </Button>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
          <Field label="Email" required>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
              />
            )}
          </Field>

          <Field label="Password" required>
            {(p) => (
              <div className="relative">
                <Input
                  {...p}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Field>

          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-xs font-semibold text-primary hover:underline focus:outline-none focus-visible:outline-2 focus-visible:outline-primary"
            >
              Forgot password?
            </Link>
          </div>

          <Button
            type="submit"
            size="lg"
            block
            loading={loading}
            loadingLabel="Signing you in…"
          >
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Do not have an account?{' '}
          <Link
            to="/register"
            className="rounded-sm font-medium text-primary underline underline-offset-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Create one
          </Link>
        </p>

        <p className="mt-4 text-center text-sm">
          <LinkButton to="/help" variant="ghost" size="sm">
            Browse help requests instead
          </LinkButton>
        </p>
      </div>
    </section>
  );
}
