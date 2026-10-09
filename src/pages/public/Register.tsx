import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import Button, { LinkButton } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Card';

const MIN_PASSWORD_LENGTH = 8;

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!fullName || !email || !password || !confirmPassword) {
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
      const { sessionCreated } = await signUp(email, password, fullName);

      if (sessionCreated) {
        /*
          Email confirmation is switched off, so the user is already signed in.
          Go straight to the app rather than telling them to check an inbox for
          a link that will never be sent — the previous version always claimed
          the email was on its way and then redirected to /login, which is a dead
          end for someone who already has a working session.
        */
        navigate('/my-requests', { replace: true });
        return;
      }

      setSuccess('Account created. Check your email for the confirmation link, then sign in.');
    } catch (err: unknown) {
      // AuthApiError messages are safe to show. Anything else gets a generic
      // message so an unexpected object is never stringified into the DOM.
      setError(
        err instanceof Error && err.message ? err.message : 'Registration failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex min-h-[70vh] items-center justify-center bg-canvas py-12">
      <div className="container-narrow max-w-md">
        <h1 className="text-center text-2xl font-bold tracking-tight">Create an account</h1>
        <p className="mt-2 text-center text-sm text-ink-muted">
          You need an account to ask for help, attach documents, and track a request.
        </p>

        <div className="mt-6">
          {/*
            role="alert" on both. The previous version used a bare <p>, so a
            validation failure was rendered silently — a screen reader user
            pressed submit and nothing was announced.
          */}
          {error && <Alert tone="stop" className="mb-4">{error}</Alert>}
          {success && <Alert tone="good" className="mb-4">{success}</Alert>}
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-5">
          <Field label="Full name" required>
            {(p) => (
              <Input
                {...p}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
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
              <Input
                {...p}
                type="password"
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            )}
          </Field>

          <Field label="Confirm password" required>
            {(p) => (
              <Input
                {...p}
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                invalid={confirmPassword.length > 0 && confirmPassword !== password}
              />
            )}
          </Field>

          <Button type="submit" size="lg" block loading={loading} loadingLabel="Creating your account…">
            Create account
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

        {/*
          There is no "forgot password" link on either this page or the login
          page because there is no password reset flow — supabase.auth
          .resetPasswordForEmail is not called anywhere in this app. A link
          pointing at a route that does not exist lands on a blank page, so it
          is omitted rather than shipped broken.
        */}
        <p className="mt-6 text-center text-sm">
          <LinkButton to="/help" variant="ghost" size="sm">
            Browse help requests instead
          </LinkButton>
        </p>
      </div>
    </section>
  );
}
