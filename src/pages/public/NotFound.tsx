import { Link, useLocation } from 'react-router-dom';
import { Compass, Home, LifeBuoy, Search } from 'lucide-react';

/**
 * 404 screen for any route that does not exist.
 *
 * Registered as the catch-all (`path="*"`) inside the public layout, so an
 * unknown URL produces a real page with real navigation rather than a blank
 * white screen. It deliberately echoes back nothing except the path the visitor
 * actually typed, which they already know.
 */
export default function NotFound() {
  const location = useLocation();
  const attempted = location.pathname;

  return (
    <section className="flex min-h-screen items-center justify-center bg-white px-4 py-16">
      <div className="w-full max-w-lg text-center">
        <Compass className="mx-auto mb-4 h-12 w-12 text-emerald-600" aria-hidden="true" />
        <p className="text-sm font-semibold tracking-wide text-emerald-700 uppercase">
          Error 404
        </p>
        <h1 className="mt-2 mb-3 text-3xl font-bold text-slate-900">We could not find that page</h1>
        <p className="mb-6 text-slate-600">
          The address <span className="font-mono text-sm text-slate-800">{attempted}</span> does not
          match anything on this site. It may have been moved, or the link that brought you here may
          be out of date.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-700"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
            Go to the home page
          </Link>
          <Link
            to="/help"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-900 hover:bg-slate-50"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            Browse published requests
          </Link>
        </div>

        <p className="mt-8 text-sm text-slate-500">
          Need help with your own request?{' '}
          <Link
            to="/request-help"
            className="inline-flex items-center gap-1 font-semibold text-emerald-700 underline"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden="true" />
            Start a help request
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
