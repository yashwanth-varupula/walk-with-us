import { HeartHandshake, LogIn, LogOut, ShieldCheck, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useIsStaff } from '../../hooks/useRole';

const linkClass =
  'rounded-sm text-sm text-ink-muted transition-colors hover:text-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-primary';

export default function Footer() {
  const { user, signOut } = useAuth();
  const isStaff = useIsStaff();

  return (
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="container-page py-10 sm:py-14">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          {/* Brand & Mission */}
          <div className="lg:col-span-2">
            <Link
              to="/"
              className="inline-flex items-center gap-2.5 rounded-control text-primary focus:outline-none focus-visible:outline-2 focus-visible:outline-primary"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-control bg-primary text-white shadow-xs">
                <HeartHandshake className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="text-lg font-bold tracking-tight text-ink">Walk With Us</span>
            </Link>

            <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
              A trusted humanitarian community platform connecting people facing hardship with
              caring individuals ready to support through verified donations, volunteering, and
              partnerships.
            </p>

            <div className="mt-4 flex items-center gap-2 rounded-control bg-primary-soft/60 px-3 py-2 text-xs font-medium text-primary-strong max-w-xs border border-primary-soft-strong/50">
              <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span>Every published request is reviewed and verified by staff.</span>
            </div>
          </div>

          {/* Navigation Columns */}
          <nav aria-label="Explore Causes">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-subtle">Causes & Help</h2>
            <ul className="mt-4 flex flex-col gap-2.5">
              {[
                { to: '/help', label: 'Browse Requests' },
                { to: '/request-help', label: 'Get Help' },
                { to: '/donate', label: 'Donate Funds' },
                { to: '/volunteer', label: 'Volunteer Time' },
                { to: '/partner', label: 'Partner with Us' },
              ].map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className={linkClass}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="About Walk With Us">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-subtle">Organization</h2>
            <ul className="mt-4 flex flex-col gap-2.5">
              {[
                { to: '/about', label: 'About Walk With Us' },
                { to: '/#how-it-works', label: 'How It Works' },
                { to: '/impact', label: 'Verified Impact' },
                { to: '/contact', label: 'Contact Us' },
                ...(user ? [{ to: '/my-requests', label: 'My Requests' }] : []),
                ...(isStaff ? [{ to: '/staff', label: 'Staff Console' }] : []),
              ].map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className={linkClass}>
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Account Access">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink-subtle">Account</h2>
            <ul className="mt-4 flex flex-col gap-2.5">
              {user ? (
                <>
                  <li className="text-xs text-ink-subtle truncate">
                    Signed in as <span className="font-semibold text-ink">{user.email?.split('@')[0]}</span>
                  </li>
                  <li>
                    <Link to="/my-requests" className={linkClass}>
                      Track My Requests
                    </Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => void signOut()}
                      className="inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-rose-700 hover:text-rose-800 transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <LogOut className="h-4 w-4" aria-hidden="true" />
                      Sign out
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Link to="/login" className={linkClass}>
                      <span className="inline-flex items-center gap-1.5">
                        <LogIn className="h-4 w-4" aria-hidden="true" />
                        Log in
                      </span>
                    </Link>
                  </li>
                  <li>
                    <Link to="/register" className={linkClass}>
                      <span className="inline-flex items-center gap-1.5">
                        <UserPlus className="h-4 w-4" aria-hidden="true" />
                        Register
                      </span>
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
        </div>

        <div className="mt-12 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-line pt-6 text-xs text-ink-subtle">
          <p>
            &copy; {new Date().getFullYear()} Walk With Us. All rights reserved. Built for real community impact.
          </p>
          <p className="text-ink-subtle">
            Verified humanitarian support platform.
          </p>
        </div>
      </div>
    </footer>
  );
}
