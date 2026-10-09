import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn, session, loading: sessionLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = safeReturnPath(location.state);

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('Please fill in both fields.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (err: unknown) {
      // Supabase auth failures are AuthApiError, whose message is safe to show
      // ("Invalid login credentials"). Anything else gets a generic message so
      // an unexpected object is never stringified into the DOM.
      setError(err instanceof Error && err.message ? err.message : 'Invalid credentials.');
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

        {/* role="alert": the previous bare <p> was silent to screen readers. */}
        {error && <Alert tone="stop" className="mt-6">{error}</Alert>}

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
              <Input
                {...p}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            )}
          </Field>

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

        {/*
          There is no "Forgot password?" link because there is no password reset
          flow. supabase.auth.resetPasswordForEmail is not called anywhere in this
          app, so the link used to point at /forgot-password, which had no route
          and landed on a blank page. Add the real flow (request a reset email,
          then a /reset-password route reading the recovery session) and link it
          here, rather than shipping a link that cannot work.
        */}
        <p className="mt-4 text-center text-sm">
          <LinkButton to="/help" variant="ghost" size="sm">
            Browse help requests instead
          </LinkButton>
        </p>
      </div>
    </section>
  );
}
