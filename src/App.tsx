import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import MainLayout from './components/layout/MainLayout';
import Home from './pages/public/Home';
import ProtectedRoute from './components/ProtectedRoute';
import StaffRoute from './components/StaffRoute';
import AdminRoute from './components/AdminRoute';
import StaffLayout from './pages/staff/StaffLayout';
import { LinkButton } from './components/ui/Button';

/*
  Route-level code splitting.

  Every page used to be imported eagerly, so one 691 kB bundle (189 kB gzipped)
  was downloaded before the landing page could paint — including the entire
  staff console, the five-step request wizard, and four of the six secondary
  pages, none of which a first-time visitor uses. Splitting by route means the
  landing page ships only what it renders, and the rest is fetched on demand.

  `Home` and `StaffLayout` stay eager on purpose: Home is the entry point for
  every visit, and StaffLayout is the shell the staff routes suspend inside, so
  importing it lazily would only add a round trip before the console appears.
*/
const RequestHelp = lazy(() => import('./pages/public/RequestHelp'));
const Help = lazy(() => import('./pages/public/Help'));
const HelpDetails = lazy(() => import('./pages/public/HelpDetails'));
const Login = lazy(() => import('./pages/public/Login'));
const Register = lazy(() => import('./pages/public/Register'));
const ForgotPassword = lazy(() => import('./pages/public/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/public/ResetPassword'));
const NotFound = lazy(() => import('./pages/public/NotFound'));
const About = lazy(() => import('./pages/public/About'));
const Impact = lazy(() => import('./pages/public/Impact'));
const Contact = lazy(() => import('./pages/public/Contact'));
const Donate = lazy(() => import('./pages/public/Donate'));
const Volunteer = lazy(() => import('./pages/public/Volunteer'));
const Partner = lazy(() => import('./pages/public/Partner'));
const MyRequests = lazy(() => import('./pages/protected/MyRequests'));
const MyDonations = lazy(() => import('./pages/protected/MyDonations'));
const Profile = lazy(() => import('./pages/protected/Profile'));
const UserRequestDetail = lazy(() => import('./pages/protected/UserRequestDetail'));
const StaffDashboard = lazy(() => import('./pages/staff/StaffDashboard'));
const StaffQueue = lazy(() => import('./pages/staff/StaffQueue'));
const StaffRequestReview = lazy(() => import('./pages/staff/StaffRequestReview'));
const StaffEnquiryInbox = lazy(() => import('./pages/staff/StaffEnquiryInbox'));
const StaffDonations = lazy(() => import('./pages/staff/StaffDonations'));
const AdminUserManagement = lazy(() => import('./pages/staff/AdminUserManagement'));

/**
 * Placeholder shown while a route chunk is in flight.
 *
 * Sized like real content on purpose: a 200px-tall spinner that collapses to
 * zero when the page arrives produces a visible layout jump on every
 * navigation, which is worse than a short wait.
 */
function RouteFallback() {
  return (
    <div
      className="flex items-center justify-center py-24"
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-3 text-sm text-ink-muted">
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-primary"
          aria-hidden="true"
        />
        Loading…
      </span>
    </div>
  );
}

/**
 * The complete route table. Everything the product links to is registered here,
 * and EVERY branch ends in `*` so no URL can produce a blank screen.
 *
 * Public layout (header + footer)
 *   /                  landing page
 *   /about             what we do and how verification works
 *   /impact            live figures, and an honest list of what is not measured
 *   /contact           contact channels and a mailto composer
 *   /donate            donation amounts, with the payment boundary stated
 *   /donate/:id        same, with one published request preselected
 *   /volunteer         volunteer application, degrades honestly without its table
 *   /partner           partner enquiry, degrades honestly without its table
 *   /help              published requests only
 *   /help/:id          one published request
 *   /login /register   authentication
 *   *                  404
 *
 * Protected requester area (requires a session)
 *   /request-help          the "I NEED HELP" wizard, protected so a draft is always
 *                          created against a real auth.uid()
 *   /my-requests           the requester's own list
 *   /my-requests/:id       one of the requester's own requests, with lifecycle
 *
 * Staff console
 *   /staff                 operations dashboard: the five lifecycle queues with
 *                          real counts, plus search, urgency and stage filters
 *   /staff/requests        the full paginated queue, for searching every request
 *   /staff/requests/:id    review / verify / reject / publish one request
 *   /staff/*               404 INSIDE the console
 *
 * `/staff/requests/:id` is declared BEFORE `/staff/requests`. React Router v6
 * ranks routes by specificity, not by declaration order, so a static segment
 * still wins over the sibling that has none — but the two are kept adjacent and
 * commented because moving the `:id` route above the index would be wrong in a
 * way that only shows up as a blank page.
 *
 * NOTE ON THE STAFF CATCH-ALL: a `*` inside the /staff branch is required. The
 * top-level `*` belongs to the MainLayout branch and does NOT cover /staff,
 * because /staff is a separate branch of the same <Routes> tree. Without a
 * nested `*`, any unmatched path under /staff — /staffx, /staff/xyz, or bare
 * /staff/requests — matched nothing at all and React Router rendered null,
 * producing a completely blank white page with no error, no header and no way
 * out. That was a live bug, and the comment above claiming otherwise was wrong.
 *
 * LEGACY REDIRECTS
 *   /request/staff  an earlier staff entry point, redirected to /staff.
 *   /request/:id    the requester detail page used to live here, one level away
 *                   from the list that links to it. It now lives at
 *                   /my-requests/:id so the list and the detail share one path
 *                   segment, and a hand-typed or shared /request/:id link is
 *                   redirected rather than dead-ending on the 404. Declared
 *                   BEFORE /request/staff's own sibling ordering is irrelevant
 *                   here, but the static /request/staff route must still match
 *                   first, so it is declared before the /request/:id redirect.
 */
function App() {
  return (
    <Routes>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<Home />} />
        <Route
          path="about"
          element={
            <Suspense fallback={<RouteFallback />}>
              <About />
            </Suspense>
          }
        />
        <Route
          path="impact"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Impact />
            </Suspense>
          }
        />
        <Route
          path="contact"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Contact />
            </Suspense>
          }
        />
        <Route
          path="donate"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Donate />
            </Suspense>
          }
        />
        {/*
          Direct donation to one published request, reached from a request
          detail page's "Donate" action. Same component as /donate: the id is
          read from the route and only preselected when it resolves to a
          request that is published and still short of its goal.
        */}
        <Route
          path="donate/:requestId"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Donate />
            </Suspense>
          }
        />
        <Route
          path="volunteer"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Volunteer />
            </Suspense>
          }
        />
        <Route
          path="partner"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Partner />
            </Suspense>
          }
        />
        <Route
          path="request-help"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <RequestHelp />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="my-requests"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <MyRequests />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="my-donations"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <MyDonations />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="profile"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <Profile />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route path="request/staff" element={<Navigate to="/staff" replace />} />
        {/* Old requester detail URL. Redirects so shared links keep working. */}
        <Route path="request/:id" element={<LegacyRequesterDetailRedirect />} />
        <Route
          path="my-requests/:id"
          element={
            <ProtectedRoute>
              <Suspense fallback={<RouteFallback />}>
                <UserRequestDetail />
              </Suspense>
            </ProtectedRoute>
          }
        />
        <Route
          path="help"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Help />
            </Suspense>
          }
        />
        <Route
          path="help/:id"
          element={
            <Suspense fallback={<RouteFallback />}>
              <HelpDetails />
            </Suspense>
          }
        />
        <Route
          path="login"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Login />
            </Suspense>
          }
        />
        <Route
          path="register"
          element={
            <Suspense fallback={<RouteFallback />}>
              <Register />
            </Suspense>
          }
        />
        <Route
          path="forgot-password"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ForgotPassword />
            </Suspense>
          }
        />
        <Route
          path="reset-password"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ResetPassword />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <Suspense fallback={<RouteFallback />}>
              <NotFound />
            </Suspense>
          }
        />
      </Route>

      {/*
        Staff console. Added as a second branch of the SAME <Routes> tree:
        no second BrowserRouter, no second ErrorBoundary, no second App.
        StaffRoute resolves the role server-side via get_my_role() and fails
        closed; the authoritative enforcement is the existing RLS policies and
        the SECURITY DEFINER transition functions.
      */}
      <Route
        path="/staff"
        element={
          <StaffRoute>
            <StaffLayout />
          </StaffRoute>
        }
      >
        <Route
          index
          element={
            <Suspense fallback={<RouteFallback />}>
              <StaffDashboard />
            </Suspense>
          }
        />
        <Route
          path="requests"
          element={
            <Suspense fallback={<RouteFallback />}>
              <StaffQueue />
            </Suspense>
          }
        />
        <Route
          path="requests/:id"
          element={
            <Suspense fallback={<RouteFallback />}>
              <StaffRequestReview />
            </Suspense>
          }
        />
        <Route
          path="enquiries"
          element={
            <Suspense fallback={<RouteFallback />}>
              <StaffEnquiryInbox />
            </Suspense>
          }
        />
        <Route
          path="donations"
          element={
            <Suspense fallback={<RouteFallback />}>
              <StaffDonations />
            </Suspense>
          }
        />
        <Route
          path="users"
          element={
            <AdminRoute>
              <Suspense fallback={<RouteFallback />}>
                <AdminUserManagement />
              </Suspense>
            </AdminRoute>
          }
        />
        {/* Anything else under /staff renders a real 404 inside the console
            shell, so a typo leaves the user with navigation instead of a blank
            page. Declared last so it never shadows a real route. */}
        <Route path="*" element={<StaffNotFound />} />
      </Route>
    </Routes>
  );
}

/**
 * Sends an old /request/:id link to its new home at /my-requests/:id.
 *
 * A separate component rather than `<Navigate to="/my-requests/:id">` because
 * `Navigate` does NOT interpolate route params: the literal string ":id" would
 * be pushed onto the stack, producing a requester-detail page asking the
 * database for a request whose id is the four characters ":id". The id has to
 * be read out of the matched params and re-inserted explicitly.
 *
 * The id is not validated here. It is a path segment being carried across a
 * rename; the detail page and its owner-scoped query remain the only thing that
 * decides whether the request may be shown.
 */
function LegacyRequesterDetailRedirect() {
  const { id } = useParams();
  return <Navigate to={id ? `/my-requests/${encodeURIComponent(id)}` : '/my-requests'} replace />;
}

/**
 * 404 for the staff console.
 *
 * Rendered inside StaffLayout so the user keeps the console header and a way
 * back to the queue. Routing these users to the public 404 would strip the
 * console chrome and look like the session had been dropped.
 */
function StaffNotFound() {
  return (
    <div className="rounded-card border border-line bg-white px-6 py-16 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
        That address does not exist in the staff console. Check the link, or go back to the
        dashboard.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton to="/staff" size="sm">
          Back to the dashboard
        </LinkButton>
        <LinkButton to="/staff/requests" size="sm" variant="secondary">
          Full queue
        </LinkButton>
        <LinkButton to="/" size="sm" variant="ghost">
          Public site
        </LinkButton>
      </div>
    </div>
  );
}

export default App;
