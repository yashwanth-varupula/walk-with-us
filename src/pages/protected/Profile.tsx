import { useEffect, useState, type FormEvent } from 'react';
import {
  User,
  Shield,
  KeyRound,
  Mail,
  Calendar,
  CheckCircle2,
  LogOut,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import Button from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Card';
import { PageHeader, Section } from '../../components/ui/PageShell';

const MIN_PASSWORD_LENGTH = 8;

export default function Profile() {
  const { user, role, signOut } = useAuth();

  // Profile details state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string>('');

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Email change state
  const [newEmail, setNewEmail] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadProfile() {
      if (!user) return;
      try {
        setProfileLoading(true);
        const { data, error } = await supabase
          .from('profiles')
          .select('full_name, phone, role, is_active, created_at')
          .eq('id', user.id)
          .single();

        if (error) throw error;
        if (data && active) {
          setFullName(data.full_name || '');
          setPhone(data.phone || '');
          if (data.created_at) {
            setMemberSince(new Date(data.created_at).toLocaleDateString());
          }
        }
      } catch (err: unknown) {
        if (active) {
          setProfileError(err instanceof Error ? err.message : 'Failed to load profile.');
        }
      } finally {
        if (active) setProfileLoading(false);
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [user]);

  const handleUpdateProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileSaving(true);
    setProfileSuccess(null);
    setProfileError(null);

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setProfileError('Full name cannot be blank.');
      setProfileSaving(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          phone: phone.trim() || null,
        })
        .eq('id', user.id);

      if (error) throw error;
      setProfileSuccess('Profile details updated successfully.');
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleUpdatePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordSuccess(null);
    setPasswordError(null);

    if (!newPassword || !confirmPassword) {
      setPasswordError('Please provide both password fields.');
      return;
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The two passwords do not match.');
      return;
    }

    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;
      setPasswordSuccess('Password successfully updated.');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleRequestEmailChange = async (e: FormEvent) => {
    e.preventDefault();
    setEmailSuccess(null);
    setEmailError(null);

    const trimmedEmail = newEmail.trim();
    if (!trimmedEmail) {
      setEmailError('Please enter a valid new email address.');
      return;
    }
    if (trimmedEmail.toLowerCase() === user?.email?.toLowerCase()) {
      setEmailError('The new email must be different from your current email.');
      return;
    }

    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        email: trimmedEmail,
      });

      if (error) throw error;
      setEmailSuccess(
        `A verification link has been sent to ${trimmedEmail}. Confirm the link to complete the change.`,
      );
      setNewEmail('');
    } catch (err: unknown) {
      setEmailError(err instanceof Error ? err.message : 'Failed to update email address.');
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="My Profile & Account"
        lede="Manage your contact details, security credentials, and view account permissions."
      />
      <Section>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left Column: Account Summary Card */}
        <div className="space-y-6 lg:col-span-1">
          <div className="rounded-card border border-line bg-surface p-6 shadow-xs">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
                <User className="h-7 w-7" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-ink">
                  {fullName || 'Account Member'}
                </h2>
                <p className="truncate text-xs text-ink-muted">{user?.email}</p>
              </div>
            </div>

            <div className="mt-6 space-y-3 border-t border-line/70 pt-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Shield className="h-3.5 w-3.5 text-primary" />
                  Access Level
                </span>
                <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                  {role || 'Requester'}
                </span>
              </div>

              {memberSince && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    <Calendar className="h-3.5 w-3.5" />
                    Member Since
                  </span>
                  <span className="font-medium text-ink">{memberSince}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <Mail className="h-3.5 w-3.5" />
                  Status
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Active
                </span>
              </div>
            </div>

            <div className="mt-6 border-t border-line/70 pt-4">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                block
                onClick={() => void signOut()}
              >
                <LogOut className="mr-1.5 h-3.5 w-3.5" />
                Sign Out
              </Button>
            </div>
          </div>

          {/* Retention & Audit Compliance Notice */}
          <div className="rounded-card border border-slate-200 bg-slate-50 p-4 text-xs text-ink-muted space-y-2">
            <h3 className="font-semibold text-ink">Account & Financial Retention</h3>
            <p>
              To maintain transparency for beneficiaries and donors, completed help requests,
              verified documents, and financial donation transactions are retained per compliance
              requirements. For account inquiries, contact our team.
            </p>
          </div>
        </div>

        {/* Right Columns: Edit Profile & Security Sections */}
        <div className="space-y-8 lg:col-span-2">
          {/* Edit Profile Details */}
          <section className="rounded-card border border-line bg-surface p-6 shadow-xs">
            <h2 className="text-lg font-bold text-ink">Personal Information</h2>
            <p className="mt-1 text-xs text-ink-muted">
              Update the contact information associated with your requests and inquiries.
            </p>

            {profileSuccess && <Alert tone="good" className="mt-4">{profileSuccess}</Alert>}
            {profileError && <Alert tone="stop" className="mt-4">{profileError}</Alert>}

            <form onSubmit={handleUpdateProfile} className="mt-6 space-y-5">
              <Field label="Full Name" required>
                {(p) => (
                  <Input
                    {...p}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    disabled={profileLoading}
                    placeholder="Enter your name"
                  />
                )}
              </Field>

              <Field label="Phone Number" hint="Optional, used for emergency verification support.">
                {(p) => (
                  <Input
                    {...p}
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    disabled={profileLoading}
                    placeholder="+91 98765 43210"
                  />
                )}
              </Field>

              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  size="md"
                  loading={profileSaving}
                  loadingLabel="Saving Changes…"
                >
                  Save Profile
                </Button>
              </div>
            </form>
          </section>

          {/* Change Password */}
          <section className="rounded-card border border-line bg-surface p-6 shadow-xs">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-ink">Security & Password</h2>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Choose a strong, unique password to secure your account and requests.
            </p>

            {passwordSuccess && <Alert tone="good" className="mt-4">{passwordSuccess}</Alert>}
            {passwordError && <Alert tone="stop" className="mt-4">{passwordError}</Alert>}

            <form onSubmit={handleUpdatePassword} className="mt-6 space-y-5">
              <Field
                label="New Password"
                required
                hint={`Must be at least ${MIN_PASSWORD_LENGTH} characters.`}
              >
                {(p) => (
                  <div className="relative">
                    <Input
                      {...p}
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-ink-subtle hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                )}
              </Field>

              <Field label="Confirm New Password" required>
                {(p) => (
                  <Input
                    {...p}
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    invalid={confirmPassword.length > 0 && confirmPassword !== newPassword}
                  />
                )}
              </Field>

              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  size="md"
                  loading={passwordLoading}
                  loadingLabel="Updating Password…"
                >
                  Update Password
                </Button>
              </div>
            </form>
          </section>

          {/* Change Email Address */}
          <section className="rounded-card border border-line bg-surface p-6 shadow-xs">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-bold text-ink">Change Account Email</h2>
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              Current email: <strong className="text-ink">{user?.email}</strong>. Supabase will send
              confirmation links before changing the address.
            </p>

            {emailSuccess && <Alert tone="good" className="mt-4">{emailSuccess}</Alert>}
            {emailError && <Alert tone="stop" className="mt-4">{emailError}</Alert>}

            <form onSubmit={handleRequestEmailChange} className="mt-6 space-y-5">
              <Field label="New Email Address" required>
                {(p) => (
                  <Input
                    {...p}
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="new.email@example.com"
                    autoComplete="email"
                  />
                )}
              </Field>

              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  variant="secondary"
                  size="md"
                  loading={emailLoading}
                  loadingLabel="Requesting Email Change…"
                >
                  Change Email
                </Button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </Section>
  </>
  );
}
