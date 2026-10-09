import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  HeartHandshake,
  LogOut,
  Menu,
  ShieldAlert,
  User,
  X,
  FileText,
  Heart,
  HandHeart,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useIsStaff } from '../../hooks/useRole';
import { LinkButton } from '../ui/Button';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-control px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
    isActive ? 'bg-primary-soft text-primary-strong' : 'text-ink-muted hover:text-ink hover:bg-slate-100/70'
  }`;

const HELP_OTHERS_LINKS = [
  { to: '/help', label: 'Browse all requests', icon: FileText, desc: 'Find people who need community support' },
  { to: '/donate', label: 'Donate funds', icon: Heart, desc: 'Contribute towards verified goals' },
  { to: '/volunteer', label: 'Volunteer time', icon: HandHeart, desc: 'Offer practical transport or local support' },
  { to: '/partner', label: 'Partner with us', icon: HeartHandshake, desc: 'For NGOs, businesses & community groups' },
];

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpDropdownOpen, setHelpDropdownOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const helpDropdownRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const { user, signOut } = useAuth();
  const isStaff = useIsStaff();
  const location = useLocation();
  const { pathname, hash } = location;

  // Scroll to hash target if present (handles client-side transitions to /#how-it-works)
  useEffect(() => {
    if (hash === '#how-it-works') {
      const scrollToTarget = () => {
        const element = document.getElementById('how-it-works');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
          return true;
        }
        return false;
      };

      if (!scrollToTarget()) {
        // If element is not in DOM yet (e.g. Home chunk still mounting), retry after next frame
        const timer = setTimeout(scrollToTarget, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [pathname, hash]);

  const handleHowItWorksClick = () => {
    setMobileOpen(false);
    if (pathname === '/') {
      const element = document.getElementById('how-it-works');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  // Close menus on route change
  useEffect(() => {
    setMobileOpen(false);
    setHelpDropdownOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  // Click outside and Escape handling for desktop dropdowns
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (helpDropdownRef.current && !helpDropdownRef.current.contains(target)) {
        setHelpDropdownOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(target)) {
        setUserMenuOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHelpDropdownOpen(false);
        setUserMenuOpen(false);
        setMobileOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Lock scroll on mobile sheet
  useEffect(() => {
    if (mobileOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileOpen]);

  const inHelpOthers = HELP_OTHERS_LINKS.some(
    (link) => pathname === link.to || pathname.startsWith(`${link.to}/`),
  );

  return (
    <header className="sticky top-0 z-40 w-full border-b border-line/80 bg-surface/90 backdrop-blur-md transition-shadow">
      <a href="#main-content" className="sr-only-focusable">
        Skip to main content
      </a>

      <div className="container-page">
        <div className="flex h-18 items-center justify-between gap-4">
          {/* Brand Logo */}
          <Link
            to="/"
            className="group flex shrink-0 items-center gap-2.5 rounded-lg focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="Walk With Us Home"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-xs transition-transform duration-200 group-hover:scale-105">
              <HeartHandshake className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <span className="block text-xl font-extrabold tracking-tight text-ink group-hover:text-primary transition-colors">
                Walk With Us
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                Community Support
              </span>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Main Navigation">
            <NavLink to="/help" className={navLinkClass}>
              Browse Help
            </NavLink>

            <Link
              to="/#how-it-works"
              onClick={handleHowItWorksClick}
              className="rounded-control px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink hover:bg-slate-100/70 transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              How It Works
            </Link>

            <NavLink to="/about" className={navLinkClass}>
              About
            </NavLink>

            <NavLink to="/impact" className={navLinkClass}>
              Impact
            </NavLink>

            {user && (
              <NavLink to="/my-requests" className={navLinkClass}>
                My Requests
              </NavLink>
            )}

            {isStaff && (
              <NavLink
                to="/staff"
                className="inline-flex items-center gap-1.5 rounded-control bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 transition-colors"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                Staff Console
              </NavLink>
            )}
          </nav>

          {/* Desktop Actions & User Area */}
          <div className="hidden items-center gap-2.5 lg:flex">
            {/* Help Others Dropdown */}
            <div className="relative" ref={helpDropdownRef}>
              <button
                type="button"
                onClick={() => setHelpDropdownOpen((v) => !v)}
                aria-expanded={helpDropdownOpen}
                aria-haspopup="true"
                aria-controls="help-others-dropdown"
                className={`inline-flex items-center gap-1 rounded-control px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  inHelpOthers
                    ? 'bg-primary-soft text-primary-strong'
                    : 'text-ink-muted hover:text-ink hover:bg-slate-100/70'
                }`}
              >
                Help Others
                <ChevronDown
                  className={`h-4 w-4 transition-transform duration-200 ${
                    helpDropdownOpen ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>

              {helpDropdownOpen && (
                <div
                  id="help-others-dropdown"
                  className="absolute right-0 top-full z-50 mt-2 w-72 rounded-card border border-line bg-surface p-2 shadow-xl animate-in fade-in zoom-in-95 duration-150"
                >
                  <ul className="space-y-1">
                    {HELP_OTHERS_LINKS.map((item) => (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          onClick={() => setHelpDropdownOpen(false)}
                          className={({ isActive }) =>
                            `flex items-start gap-3 rounded-control p-2.5 transition-colors ${
                              isActive
                                ? 'bg-primary-soft text-primary-strong'
                                : 'hover:bg-slate-50 text-ink'
                            }`
                          }
                        >
                          <item.icon className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
                          <div>
                            <span className="block text-sm font-semibold">{item.label}</span>
                            <span className="block text-xs text-ink-muted">{item.desc}</span>
                          </div>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <LinkButton to="/request-help" size="sm">
              Get Help
            </LinkButton>

            {user ? (
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  aria-expanded={userMenuOpen}
                  aria-haspopup="true"
                  className="flex items-center gap-2 rounded-control border border-line bg-surface py-1.5 pl-2 pr-3 text-sm font-medium text-ink hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary transition-colors"
                >
                  <div className="flex h-7 w-7 items-center justify-center rounded-control bg-primary-soft text-primary-strong">
                    <User className="h-4 w-4" />
                  </div>
                  <span className="max-w-[120px] truncate text-xs">{user.email?.split('@')[0]}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-ink-subtle" />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-52 rounded-card border border-line bg-surface p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150">
                    <NavLink
                      to="/my-requests"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-ink hover:bg-slate-100 transition-colors"
                    >
                      <FileText className="h-4 w-4 text-ink-muted" />
                      My Requests
                    </NavLink>
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        void signOut();
                      }}
                      className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Link
                  to="/login"
                  className="rounded-control px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink transition-colors"
                >
                  Sign In
                </Link>
                <LinkButton to="/register" variant="secondary" size="sm">
                  Register
                </LinkButton>
              </div>
            )}
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2 lg:hidden">
            <LinkButton to="/request-help" size="sm" className="px-3 py-1.5 text-xs">
              Get Help
            </LinkButton>

            <button
              type="button"
              className="inline-flex items-center justify-center rounded-control border border-line bg-surface p-2 text-ink hover:bg-slate-100 focus:outline-none focus-visible:outline-2 focus-visible:outline-primary min-h-[44px] min-w-[44px]"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
            >
              {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileOpen && (
        <div
          id="mobile-navigation"
          className="fixed inset-x-0 top-18 bottom-0 z-50 overflow-y-auto border-t border-line bg-surface/98 p-5 backdrop-blur-lg lg:hidden"
        >
          <div className="flex flex-col gap-4">
            {/* Top mobile actions */}
            <div className="grid grid-cols-2 gap-2.5">
              <LinkButton to="/request-help" block size="md">
                Get Help
              </LinkButton>
              <LinkButton to="/help" variant="secondary" block size="md">
                Browse Help
              </LinkButton>
            </div>

            {/* Core Links */}
            <nav className="flex flex-col divide-y divide-line/40 border-y border-line/60 py-1">
              {[
                { to: '/', label: 'Home' },
                { to: '/help', label: 'Browse Help' },
                { to: '/#how-it-works', label: 'How It Works', isHash: true },
                { to: '/about', label: 'About Us' },
                { to: '/impact', label: 'Impact' },
                { to: '/contact', label: 'Contact' },
                ...(user ? [{ to: '/my-requests', label: 'My Requests' }] : []),
                ...(isStaff ? [{ to: '/staff', label: 'Staff Console' }] : []),
              ].map((link) => {
                if ('isHash' in link && link.isHash) {
                  return (
                    <Link
                      key={link.to}
                      to={link.to}
                      onClick={handleHowItWorksClick}
                      className="px-2 py-3 text-sm font-medium text-ink hover:text-primary transition-colors"
                    >
                      {link.label}
                    </Link>
                  );
                }

                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === '/'}
                    className={({ isActive }) =>
                      `px-2 py-3 text-sm font-medium transition-colors ${
                        isActive ? 'font-semibold text-primary' : 'text-ink hover:text-primary'
                      }`
                    }
                  >
                    {link.label}
                  </NavLink>
                );
              })}
            </nav>

            {/* Ways to Give Section */}
            <div className="border-t border-line pt-4">
              <p className="px-4 text-xs font-bold uppercase tracking-wider text-ink-subtle">
                Ways to Help
              </p>
              <div className="mt-2 space-y-1">
                {HELP_OTHERS_LINKS.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-control px-4 py-2.5 text-sm font-semibold transition-colors ${
                        isActive ? 'bg-primary-soft text-primary-strong' : 'text-ink hover:bg-slate-100'
                      }`
                    }
                  >
                    <link.icon className="h-4 w-4 text-primary" />
                    {link.label}
                  </NavLink>
                ))}
              </div>
            </div>

            {/* User Session Footer */}
            <div className="border-t border-line pt-4">
              {user ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 px-2 text-xs text-ink-muted">
                    <User className="h-4 w-4" />
                    <span>Signed in as <strong>{user.email}</strong></span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void signOut()}
                    className="flex w-full items-center justify-center gap-2 rounded-control border border-line py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Log out
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <LinkButton to="/login" variant="secondary" block>
                    Log in
                  </LinkButton>
                  <LinkButton to="/register" block>
                    Register
                  </LinkButton>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
