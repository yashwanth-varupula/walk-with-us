import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ClipboardList, ExternalLink, Heart, Inbox, LayoutDashboard, ListChecks, LogOut, Shield } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useRole } from '../../hooks/useRole';

/**
 * The console-level destinations.
 *
 * `end` controls NavLink's OWN match, which is what sets `aria-current`. The
 * dashboard link needs `end: true` so that it does not also announce itself as
 * the current page while the reviewer is inside /staff/requests/... — and
 * "All requests" needs `end: false` for the same reason, so that a per-request
 * screen keeps that item current instead of announcing nothing at all.
 *
 * The visible highlight is computed separately below, because "is the reviewer
 * looking at the dashboard" is a question about the path, not about which
 * segment matched.
 */
const CONSOLE_NAV = [
  { to: '/staff', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/staff/requests', label: 'All requests', icon: ListChecks, end: false },
  { to: '/staff/enquiries', label: 'Enquiries', icon: Inbox, end: false },
  { to: '/staff/donations', label: 'Donations', icon: Heart, end: false },
] as const;

/**
 * Shell for the staff console.
 *
 * Deliberately separate from MainLayout: the internal review console does not
 * carry the public marketing header or footer, but it lives inside the same
 * single <Routes> tree in App.tsx. There is no second BrowserRouter and no
 * second ErrorBoundary.
 */
export default function StaffLayout() {
  const { user, signOut } = useAuth();
  const { role } = useRole();
  const location = useLocation();

  // The per-request screen sits under "All requests" in the hierarchy, so that
  // nav item stays lit while reviewing. Derived from the path rather than from a
  // route match so it is correct for any request id.
  const inReviewScreen = /^\/staff\/requests\/.+/.test(location.pathname);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-white">
              <ClipboardList className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900">Walk With Us</p>
              <p className="text-xs text-slate-500">Staff review console</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {role && (
              <span className="hidden rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 capitalize sm:inline">
                {role}
              </span>
            )}
            <span className="hidden max-w-[16rem] truncate text-xs text-slate-500 md:inline">
              {user?.email}
            </span>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Public site</span>
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>

        {/*
          Console navigation. `aria-current="page"` is set by NavLink, so the
          active destination is announced, not just coloured.
        */}
        <nav aria-label="Staff console" className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl gap-1 px-2 sm:px-4 lg:px-6">
            {[
              ...CONSOLE_NAV,
              ...(role === 'admin'
                ? [{ to: '/staff/users', label: 'User Roles', icon: Shield, end: false }]
                : []),
            ].map((entry) => {
              const Icon = entry.icon;
              const active = inReviewScreen
                ? entry.to === '/staff/requests'
                : entry.to === '/staff/enquiries'
                ? location.pathname.startsWith('/staff/enquiries')
                : entry.to === '/staff/donations'
                ? location.pathname.startsWith('/staff/donations')
                : entry.to === '/staff/users'
                ? location.pathname.startsWith('/staff/users')
                : entry.to === location.pathname;
              return (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  end={entry.end}
                  className={
                    active
                      ? 'inline-flex items-center gap-1.5 border-b-2 border-emerald-600 px-3 py-2.5 text-sm font-semibold text-emerald-800'
                      : 'inline-flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-900'
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {entry.label}
                </NavLink>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-4 text-xs text-slate-500 sm:px-6 lg:px-8">
          Internal use only. Every decision recorded here is written to the audit log with your
          account.
        </div>
      </footer>
    </div>
  );
}
