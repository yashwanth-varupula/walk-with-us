import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Mail } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import Button, { LinkButton } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Card';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError('Please provide your email address.');
      return;
    }

    setLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: redirectUrl,
      });

      if (resetError) {
        setError(resetError.message || 'Failed to send password reset email.');
      } else {
        setSubmitted(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error requesting reset.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex min-h-[70vh] items-center justify-center bg-canvas py-12">
      <div className="container-narrow max-w-md">
        <div className="mb-4">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Back to Sign In</span>
          </Link>
        </div>

        <h1 className="text-center text-2xl font-bold tracking-tight text-ink">
          Reset your password
        </h1>
        <p className="mt-2 text-center text-sm text-ink-muted">
          Enter the email address registered with your account and we will send you a secure link to reset your password.
        </p>

        {error && <Alert tone="stop" className="mt-6">{error}</Alert>}

        {submitted ? (
          <div className="mt-6 rounded-card border border-emerald-200 bg-emerald-50/70 p-6 text-center space-y-4">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-emerald-950">Reset link sent</h2>
              <p className="mt-1 text-xs text-emerald-800 leading-relaxed">
                If an account exists for <strong>{email}</strong>, a password reset link has been dispatched. Please check your inbox and spam folder.
              </p>
            </div>
            <div className="pt-2">
              <LinkButton to="/login" variant="secondary" size="sm" block>
                Return to Sign In
              </LinkButton>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
            <Field label="Account Email" required>
              {(p) => (
                <Input
                  {...p}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="email"
                  autoFocus
                />
              )}
            </Field>

            <Button
              type="submit"
              size="lg"
              block
              loading={loading}
              loadingLabel="Sending reset link…"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              <span>Send Password Reset Link</span>
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
