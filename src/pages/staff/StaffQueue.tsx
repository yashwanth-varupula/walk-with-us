import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Inbox, LayoutDashboard, Search, SlidersHorizontal, Upload } from 'lucide-react';
/* Types ride in on the value import via inline `type`; see StaffDashboard. */
import {
  listStaffReviewQueue,
  isStaffRequestStatus,
  STAFF_PAGE_SIZE,
  STAFF_URGENCY_VALUES,
  staffErrorText,
  type StaffError,
  type StaffRequestStatus,
  type StaffRequestSummary,
  type StaffUrgency,
} from '../../services/staffRequests';
import { formatCount } from '../../lib/format';
import { Panel, RequestRow, RowSkeletons } from './staffUi';
import { useCategoryNames } from './useCategoryNames';

type StatusFilter = StaffRequestStatus | 'all';
type UrgencyFilter = StaffUrgency | 'all';

/**
 * The two work tabs stay deliberately disjoint.
 *
 * "Review queue" is the work a reviewer does: submitted and under_review, the
 * only states a reviewer can move a request out of. "Ready to publish" is the
 * work a publisher does: verified, the only state publish_help_request() accepts.
 * A verified request used to vanish from the console entirely, leaving the
 * lifecycle unable to finish.
 *
 * A third destination, "Recently closed", is a FILTER over the same queue rather
 * than a third tab: rejected/published/active/resolved/closed are all
 * "already decided" states with no available action, so they are one view
 * instead of four. It is selected with `?view=closed` and filtered with
 * `?status=`, which is what the dashboard's rejected and published links point
 * at.
 */
type QueueView = 'review' | 'publish' | 'closed';

const VIEWS: { id: QueueView; label: string; description: string }[] = [
  {
    id: 'review',
    label: 'Review queue',
    description: 'Requests waiting to be checked and verified.',
  },
  {
    id: 'publish',
    label: 'Ready to publish',
    description: 'Verified requests awaiting publication to the public site.',
  },
  {
    id: 'closed',
    label: 'Recently closed',
    description: 'Decided requests. Nothing here can be actioned any further.',
  },
];

/** Per-view status options. The dashboard deep-links to exactly these values. */
const REVIEW_STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All awaiting review' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
];

const CLOSED_STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All decided' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'published', label: 'Published' },
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const URGENCY_OPTIONS: { value: UrgencyFilter; label: string }[] = [
  { value: 'all', label: 'Any urgency' },
  ...STAFF_URGENCY_VALUES.map((u) => ({ value: u as UrgencyFilter, label: u })),
];

/** Statuses that mean "decided, no action available". */
const CLOSED_STATUSES: readonly StaffRequestStatus[] = [
  'rejected',
  'published',
  'active',
  'resolved',
  'closed',
];

/** The view a status belongs to, so a deep link from the dashboard selects the right tab. */
function viewForStatus(status: StatusFilter): QueueView {
  if (status === 'submitted' || status === 'under_review') return 'review';
  if (status === 'verified') return 'publish';
  if (status !== 'all' && CLOSED_STATUSES.includes(status)) return 'closed';
  // 'all', or a status with no dedicated view (draft). The review queue is the
  // safe default because it is the console's primary job.
  return 'review';
}

/**
 * Parses the URL into a view + filters + page, and writes changes back.
 *
 * WHY THE URL IS THE SOURCE OF TRUTH
 * ----------------------------------
 * This queue used to hold `status`, `urgency` and `search` in local state, so
 * `/staff/requests?status=verified` was silently ignored and the reviewer was
 * shown the default review queue instead of the 12 verified requests the
 * dashboard tile had just promised. Every filter is now read from — and written
 * back to — the query string, so a dashboard link, a bookmark and a shared link
 * all reproduce the same list.
 *
 * `page` is in the URL too, and that is not cosmetic. It used to be local state,
 * so the `merged.delete('page')` below reset a query parameter that nothing ever
 * read: changing the status filter while on page 3 kept page 3 in state and
 * rendered page 3 of the new, shorter list — usually an empty page, which reads
 * as "the queue is broken".
 */
function useQueueUrlState() {
  const [params, setParams] = useSearchParams();

  const status = useMemo<StatusFilter>(() => {
    const raw = params.get('status');
    return raw && isStaffRequestStatus(raw) ? raw : 'all';
  }, [params]);

  const urgency = useMemo<UrgencyFilter>(() => {
    const raw = params.get('urgency');
    return raw && (STAFF_URGENCY_VALUES as readonly string[]).includes(raw)
      ? (raw as UrgencyFilter)
      : 'all';
  }, [params]);

  const search = params.get('q') ?? '';

  const page = useMemo(() => {
    const raw = Number.parseInt(params.get('page') ?? '1', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }, [params]);

  /*
    The tab is an explicit `view` parameter, but a bare `?status=` is still
    honoured so a dashboard tile link lands on the right tab.

    An explicit param is required rather than deriving the tab from `status`
    alone because two of the three tabs have a legitimate "all" state: `?status=all`
    is both "everything awaiting review" and "all decided requests", and those
    are different lists. Deriving the tab from the status alone made the "Recently
    closed" tab unreachable — its link was `?status=all`, which resolved to the
    review tab, so clicking it silently showed the wrong list.
  */
  const view = useMemo<QueueView>(() => {
    const raw = params.get('view');
    const match = VIEWS.find((entry) => entry.id === raw);
    if (match) return match.id;
    return viewForStatus(status);
  }, [params, status]);

  /**
   * Writes filters back to the URL.
   *
   * Any change to a filter resets `page` to 1, because page 4 of one list is
   * meaningless against another.
   */
  const apply = useCallback(
    (next: { status?: StatusFilter; urgency?: UrgencyFilter; search?: string; page?: number }) => {
      setParams(
        (prev) => {
          const merged = new URLSearchParams(prev);
          const setOrDrop = (key: string, value: string, isDefault: boolean) => {
            if (value === '' || isDefault) merged.delete(key);
            else merged.set(key, value);
          };
          const filtersChanged =
            next.status !== undefined || next.urgency !== undefined || next.search !== undefined;

          if (next.status !== undefined) setOrDrop('status', next.status, next.status === 'all');
          if (next.urgency !== undefined)
            setOrDrop('urgency', next.urgency, next.urgency === 'all');
          if (next.search !== undefined) {
            const trimmed = next.search.trim();
            setOrDrop('q', trimmed, trimmed === '');
          }

          const target = next.page ?? (filtersChanged ? 1 : undefined);
          if (target !== undefined) {
            if (target <= 1) merged.delete('page');
            else merged.set('page', String(target));
          }

          return merged;
        },
        // `replace`, so a debounced search does not push a history entry per
        // keystroke. The URL is still the source of truth on every render.
        { replace: true },
      );
    },
    [setParams],
  );

  return { status, urgency, search, page, view, apply };
}

export default function StaffQueue() {
  const { categoryName } = useCategoryNames();
  const { status, urgency, search, page, view, apply } = useQueueUrlState();

  const [rows, setRows] = useState<StaffRequestSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StaffError | null>(null);
  const loadSequence = useRef(0);

  const statusOptions = view === 'closed' ? CLOSED_STATUS_OPTIONS : REVIEW_STATUS_OPTIONS;

  /**
   * The status actually used for the query and the select's value.
   *
   * A status that is not offered by the current tab is coerced to 'all', so the
   * two can never disagree. Without this, `/staff/requests?status=draft` put the
   * review queue's dropdown in a state with no matching <option> — the select
   * rendered blank while the query filtered by `draft`, so the reviewer saw an
   * empty filter and a filtered list.
   */
  const effectiveStatus: StatusFilter = statusOptions.some((o) => o.value === status) ? status : 'all';

  // Keep the box in step with the URL when the URL changes from outside the
  // component (a dashboard link, a Back button, "Clear"). Writing only here, and
  // only when they differ, avoids a loop between the debounce and the URL.
  useEffect(() => {
    setSearchInput((current) => (current === search ? current : search));
  }, [search]);

  // Debounce the search box so typing does not fire a query per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchInput.trim() !== search.trim()) {
        apply({ search: searchInput });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [searchInput, search, apply]);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);

    const shared = {
      search,
      urgency,
      page,
      pageSize: STAFF_PAGE_SIZE,
    };

    // `status` is a real lifecycle status, or 'all' to fall back to the view's
    // own set. The publish view has no status dropdown because `verified` is the
    // only status publish_help_request() accepts, and offering any other value
    // would show an empty list.
    const result = await listStaffReviewQueue(
      view === 'publish'
        ? { ...shared, status: 'verified' }
        : view === 'closed'
          ? { ...shared, status: effectiveStatus, statuses: CLOSED_STATUSES }
          : { ...shared, status: effectiveStatus },
    );

    // A slower previous request must never overwrite a newer filter/page
    // result. This is especially important when staff change filters quickly
    // or press Refresh while a request is still in flight. `isActive` covers the
    // separate case of the whole page being torn down mid-flight.
    if (!isActive() || sequence !== loadSequence.current) return;

    setRows(result.rows);
    setTotal(result.total);
    setError(result.error);
    setLoading(false);
  }, [search, effectiveStatus, urgency, page, view]);

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / STAFF_PAGE_SIZE));
  const canPrev = page > 1;
  const canNext = page < totalPages;
  const activeView = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0];
  const hasFilters = search.trim().length > 0 || urgency !== 'all' || effectiveStatus !== 'all';

  /*
    A deep link can point past the end of the list — a shared `?page=9` after the
    queue shrank, or a browser Back onto a longer list. Clamping to the last real
    page re-queries once and settles; without it the reviewer is left staring at
    "Page 9 of 2" with no rows and no explanation.
  */
  useEffect(() => {
    if (loading || error) return;
    if (page > totalPages) apply({ page: totalPages });
  }, [loading, error, page, totalPages, apply]);

  // A search term that matches nothing is a different situation from an empty
  // queue, and conflating them is how "0 requests" gets read as "no work today".
  const searchActive = search.trim().length > 0;

  const emptyHeadline = searchActive
    ? 'No requests match these filters.'
    : view === 'publish'
      ? 'Nothing is waiting to be published.'
      : view === 'closed'
        ? 'No decided requests yet.'
        : 'No requests are currently awaiting review.';

  const emptyDetail = searchActive
    ? 'Try adjusting or clearing your active filters.'
    : view === 'publish'
      ? 'Requests appear here after a reviewer verifies them, ready to be published to the public site.'
      : view === 'closed'
        ? 'Rejected, published and later requests are kept here for reference.'
        : 'When requests are submitted by users, they will appear here for staff review.';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link to="/staff" className="inline-flex items-center gap-1 hover:text-emerald-700">
              <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
              Dashboard
            </Link>
            <span aria-hidden="true">/</span>
            <span>All requests</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Requests</h1>
          <p className="mt-1 text-sm text-slate-600">
            {activeView.description}
            {total > 0 && (
              <>
                {' '}
                <span className="font-medium text-slate-900">{formatCount(total)}</span> in this
                view.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/*
        A navigation group, not a tablist.

        This was `role="tablist"` / `role="tab"`, which announces as tabs but
        supplied none of what tabs require: no `aria-controls`, no `tabpanel`,
        and no arrow-key navigation. Screen reader users were told these were
        tabs and then found nothing to navigate between. They are real links to
        real URLs, so `aria-current="page"` is both accurate and shareable — the
        active view can be copied out of the address bar and sent to a colleague.
      */}
      <div
        role="group"
        aria-label="Staff request views"
        className="flex flex-wrap gap-2 border-b border-slate-200"
      >
        {VIEWS.map((entry) => {
          const active = entry.id === view;
          // Clicking a tab replaces the whole filter set, because carrying the
          // previous tab's `status` across would show a different list under a
          // tab the reviewer believes they just selected.
          const href =
            entry.id === 'publish'
              ? '/staff/requests?status=verified'
              : entry.id === 'closed'
                ? '/staff/requests?view=closed'
                : '/staff/requests';
          return (
            <Link
              key={entry.id}
              to={href}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'inline-flex items-center gap-1.5 border-b-2 border-emerald-600 px-4 py-2.5 text-sm font-semibold text-emerald-800'
                  : 'inline-flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-900'
              }
            >
              {entry.id === 'publish' && <Upload className="h-4 w-4" aria-hidden="true" />}
              {entry.label}
            </Link>
          );
        })}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label
              htmlFor="queue-search"
              className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase"
            >
              Search
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="queue-search"
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Title or description"
                className="w-full rounded-lg border border-slate-300 py-2 pr-3 pl-9 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            {/*
              The label is rendered only when there is a real control to name.
              This used to always render `<label htmlFor="queue-status">` while
              the publish tab put a non-focusable `<p>` at that id, so the label
              pointed at something that is not a labelable element: the click did
              nothing and assistive tech announced an unlabelled group.
            */}
            {view === 'publish' ? (
              // No select on this tab: `verified` is the only status
              // publish_help_request() accepts, so there is nothing to choose.
              <>
                <p className="mb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
                  Status
                </p>
                <p className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Verified only
                </p>
              </>
            ) : (
              <>
                <label
                  htmlFor="queue-status"
                  className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase"
                >
                  Status
                </label>
                <select
                  id="queue-status"
                  value={effectiveStatus}
                  onChange={(e) => apply({ status: e.target.value as StatusFilter })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  {statusOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          <div>
            <label
              htmlFor="queue-urgency"
              className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase"
            >
              Urgency
            </label>
            <select
              id="queue-urgency"
              value={urgency}
              onChange={(e) => apply({ urgency: e.target.value as UrgencyFilter })}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            >
              {URGENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {hasFilters && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Filters active</span>
            <button
              type="button"
              onClick={() => {
                setSearchInput('');
                apply({ search: '', urgency: 'all', status: 'all' });
              }}
              className="font-medium text-emerald-700 underline"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/*
        The error branch comes FIRST, before the empty branch. A failed query
        leaves `rows` empty, so checking `rows.length` first would render a
        database outage as "no requests are currently awaiting review" — the
        console telling staff their queue is empty when it is not.
      */}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800"
        >
          <p className="mb-1 text-base font-semibold">Unable to load requests.</p>
          <p className="text-sm">{staffErrorText(error)}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800"
          >
            Retry
          </button>
        </div>
      ) : loading ? (
        <Panel title="Results">
          <RowSkeletons count={4} />
        </Panel>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <Inbox className="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
          <p className="font-medium text-slate-900">{emptyHeadline}</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{emptyDetail}</p>
        </div>
      ) : (
        <>
          <Panel title="Results">
            <ul className="divide-y divide-slate-100">
              {rows.map((row) => (
                <li key={row.id}>
                  <RequestRow request={row} categoryName={categoryName(row.categoryId)} />
                </li>
              ))}
            </ul>
          </Panel>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Page <span className="font-medium text-slate-900">{page}</span> of {totalPages}
              {total > 0 && (
                <span className="text-slate-500"> · {formatCount(total)} total</span>
              )}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => apply({ page: Math.max(1, page - 1) })}
                disabled={!canPrev || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </button>
              <button
                type="button"
                onClick={() => apply({ page: Math.min(totalPages, page + 1) })}
                disabled={!canNext || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
