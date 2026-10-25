import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, RotateCw, AlertCircle } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import {
  isAuthRateLimitError,
  getAuthRateLimitCooldown,
  formatAuthRateLimitMessage,
  isDuplicateAccountError,
} from '../../lib/errors';
import Button, { LinkButton } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Card';

const MIN_PASSWORD_LENGTH = 8;

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Email verification pending state
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const { signUp } = useAuth();
  const navigate = useNavigate();

  // Cooldown countdown timers
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleResendVerification = async () => {
    if (!pendingVerificationEmail || resending || resendCooldown > 0) return;
    setResending(true);
    setResendMessage(null);
    setResendError(null);
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: 'signup',
        email: pendingVerificationEmail,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
        },
      });
      if (resendErr) {
        if (isAuthRateLimitError(resendErr)) {
          const waitSec = getAuthRateLimitCooldown(resendErr, 60);
          setResendCooldown(waitSec);
          setResendError(formatAuthRateLimitMessage('resend', waitSec));
        } else {
          setResendError(resendErr.message || 'Failed to resend confirmation email.');
        }
      } else {
        setResendMessage('Verification email resent. Please check your inbox and spam folder.');
        setResendCooldown(60);
      }
    } catch (err: unknown) {
      if (isAuthRateLimitError(err)) {
        const waitSec = getAuthRateLimitCooldown(err, 60);
        setResendCooldown(waitSec);
        setResendError(formatAuthRateLimitMessage('resend', waitSec));
      } else {
        setResendError(err instanceof Error ? err.message : 'Unexpected error resending email.');
      }
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || cooldown > 0) return;

    setError(null);
    setSuccess(null);
    setIsRateLimited(false);
    setIsDuplicate(false);

    const trimmedFullName = fullName.trim();
    const trimmedEmail = email.trim();

    if (!trimmedFullName || !trimmedEmail || !password || !confirmPassword) {
      setError('All fields are required.');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const result = await signUp(trimmedEmail, password, trimmedFullName);

      if (result.sessionCreated) {
        // Email confirmation is disabled or user was auto-confirmed: go directly to application
        navigate('/my-requests', { replace: true });
        return;
      }

      // If Supabase indicates user already exists (e.g. empty identities array under user enumeration protection)
      if (result.isExistingUser) {
        setIsDuplicate(true);
        setError('An account with this email already exists. Please sign in or reset your password.');
        return;
      }

      // Legitimate new registration awaiting email confirmation
      setPendingVerificationEmail(trimmedEmail);
      setResendCooldown(60); // Confirmation email was just sent; enforce 60s cooldown
      setSuccess('Account created. Check your email for the confirmation link, then sign in.');
    } catch (err: unknown) {
      if (isAuthRateLimitError(err)) {
        const waitSec = getAuthRateLimitCooldown(err, 60);
        setCooldown(waitSec);
        setIsRateLimited(true);
        setError(formatAuthRateLimitMessage('signup', waitSec));
      } else if (isDuplicateAccountError(err)) {
        setIsDuplicate(true);
        setError('An account with this email already exists. Please sign in or reset your password.');
      } else {
        const msg = err instanceof Error ? err.message : '';
        setError(msg || 'Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Render Verification Pending Screen
  if (pendingVerificationEmail) {
    return (
      <section className="flex min-h-[70vh] items-center justify-center bg-canvas py-12">
        <div className="container-narrow max-w-md">
          <div className="rounded-card border border-emerald-200 bg-emerald-50/70 p-6 text-center space-y-4 shadow-sm">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <Mail className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-emerald-950">Verify your email address</h1>
              <p className="mt-2 text-sm text-emerald-800 leading-relaxed">
                Check your email for the confirmation link to activate your account for <strong>{pendingVerificationEmail}</strong>.
              </p>
            </div>

            {resendMessage && (
              <Alert tone="good" className="text-xs text-left">
                {resendMessage}
              </Alert>
            )}
            {resendError && (
              <Alert tone="stop" className="text-xs text-left">
                {resendError}
              </Alert>
            )}

            <div className="pt-2 space-y-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                block
                onClick={handleResendVerification}
                loading={resending}
                disabled={resending || resendCooldown > 0}
                loadingLabel="Resending link…"
              >
                <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : 'Resend verification email'}
              </Button>

              <LinkButton to="/login" variant="ghost" size="sm" block>
                Return to Sign In
              </LinkButton>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-[70vh] items-center justify-center bg-canvas py-12">
      <div className="container-narrow max-w-md">
        <h1 className="text-center text-2xl font-bold tracking-tight">Create an account</h1>
        <p className="mt-2 text-center text-sm text-ink-muted">
          You need an account to ask for help, attach documents, and track a request.
        </p>

        <div className="mt-6 space-y-3">
          {error && <Alert tone="stop">{error}</Alert>}
          {success && <Alert tone="good">{success}</Alert>}

          {isRateLimited && (
            <div className="rounded-card border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-amber-950">Did you just register?</p>
                  <p className="mt-1 leading-relaxed">
                    If you already submitted this form, your account may already have been created.
                    Check your email inbox and spam folder, or try logging in.
                  </p>
                </div>
              </div>
              <div className="pt-1">
                <LinkButton to="/login" variant="secondary" size="sm">
                  Go to Sign In
                </LinkButton>
              </div>
            </div>
          )}

          {isDuplicate && (
            <div className="rounded-card border border-primary/20 bg-primary/5 p-4 text-xs text-ink space-y-2">
              <p className="font-medium text-ink">
                An account with this email address already exists.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <LinkButton to="/login" variant="secondary" size="sm">
                  Sign In
                </LinkButton>
                <LinkButton to="/forgot-password" variant="ghost" size="sm">
                  Reset Password
                </LinkButton>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
          <Field label="Full name" required>
            {(p) => (
              <Input
                {...p}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                autoFocus
              />
            )}
          </Field>

          <Field label="Email" required>
            {(p) => (
              <Input
                {...p}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            )}
          </Field>

          <Field
            label="Password"
            required
            hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          >
            {(p) => (
              <div className="relative">
                <Input
                  {...p}
                  type={showPassword ? 'text' : 'password'}
                  minLength={MIN_PASSWORD_LENGTH}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  aria-label={showPassword ? 'Hide password characters' : 'Show password characters'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Field>

          <Field label="Confirm password" required>
            {(p) => (
              <div className="relative">
                <Input
                  {...p}
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  invalid={confirmPassword.length > 0 && confirmPassword !== password}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                  aria-label={showConfirmPassword ? 'Hide confirmation characters' : 'Show confirmation characters'}
                  title={showConfirmPassword ? 'Hide confirmation' : 'Show confirmation'}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            )}
          </Field>

          <Button
            type="submit"
            size="lg"
            block
            loading={loading}
            disabled={loading || cooldown > 0}
            loadingLabel="Creating your account…"
          >
            {cooldown > 0 ? `Please wait (${cooldown}s)` : 'Create account'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-ink-muted">
          Already have an account?{' '}
          <Link
            to="/login"
            className="rounded-sm font-medium text-primary underline underline-offset-2 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Sign in
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
