import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Heart,
  Inbox,
  MapPin,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';

import {
  listStaffReviewQueue,
  STAFF_URGENCY_VALUES,
  staffErrorText,
  type StaffError,
  type StaffRequestStatus,
  type StaffRequestSummary,
  type StaffUrgency,
} from '../../services/staffRequests';
import { formatCount, formatINR, formatLocation, formatRelative } from '../../lib/format';
import { StatusBadge, UrgencyIndicator } from './staffUi';
import { useCategoryNames } from './useCategoryNames';

type TabId =
  | 'needs_action'
  | 'awaiting'
  | 'under_review'
  | 'ready_to_publish'
  | 'published'
  | 'rejected'
  | 'all';

interface TabItem {
  id: TabId;
  label: string;
  statuses?: readonly StaffRequestStatus[];
  highlight?: boolean;
}

const TABS: TabItem[] = [
  {
    id: 'needs_action',
    label: 'Needs Action',
    statuses: ['submitted', 'under_review', 'verified'],
    highlight: true,
  },
  {
    id: 'awaiting',
    label: 'Awaiting Review',
    statuses: ['submitted'],
  },
  {
    id: 'under_review',
    label: 'Under Review',
    statuses: ['under_review'],
  },
  {
    id: 'ready_to_publish',
    label: 'Ready to Publish',
    statuses: ['verified'],
  },
  {
    id: 'published',
    label: 'Published',
    statuses: ['published'],
  },
  {
    id: 'rejected',
    label: 'Rejected',
    statuses: ['rejected'],
  },
  {
    id: 'all',
    label: 'All Requests',
    statuses: [
      'submitted',
      'under_review',
      'verified',
      'published',
      'rejected',
      'active',
      'resolved',
      'closed',
    ],
  },
];

const PAGE_SIZE = 15;

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default function StaffDashboard() {
  const { categoryName } = useCategoryNames();

  // Active Tab & Filters
  const [activeTab, setActiveTab] = useState<TabId>('needs_action');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [urgencyFilter, setUrgencyFilter] = useState<StaffUrgency | 'all'>('all');
  const [sortOrder, setSortOrder] = useState<'created' | 'updated' | 'published'>('created');
  const [page, setPage] = useState(1);

  // Live Count Metrics
  const [counts, setCounts] = useState({
    awaiting: 0,
    underReview: 0,
    readyToPublish: 0,
    published: 0,
    rejected: 0,
  });

  // Main Queue State
  const [rows, setRows] = useState<StaffRequestSummary[]>([]);
  const [totalRows, setTotalRows] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<StaffError | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const querySequence = useRef(0);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Handle Tab switch
  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    setPage(1);
  };

  // Resolve current active tab definition
  const currentTabDef = useMemo(() => {
    return TABS.find((t) => t.id === activeTab) ?? TABS[0];
  }, [activeTab]);

  const loadData = useCallback(async () => {
    const sequence = ++querySequence.current;
    setLoading(true);
    setRefreshing(true);
    setLoadError(null);

    try {
      // Fetch exact counts across lifecycle stages in parallel with main list
      const [awaitingRes, underReviewRes, readyRes, publishedRes, rejectedRes, queueRes] =
        await Promise.all([
          listStaffReviewQueue({ statuses: ['submitted'], page: 1, pageSize: 1 }),
          listStaffReviewQueue({ statuses: ['under_review'], page: 1, pageSize: 1 }),
          listStaffReviewQueue({ statuses: ['verified'], page: 1, pageSize: 1 }),
          listStaffReviewQueue({ statuses: ['published'], page: 1, pageSize: 1 }),
          listStaffReviewQueue({ statuses: ['rejected'], page: 1, pageSize: 1 }),
          listStaffReviewQueue({
            statuses: currentTabDef.statuses,
            search: debouncedSearch.trim() || undefined,
            urgency: urgencyFilter !== 'all' ? urgencyFilter : undefined,
            sort: sortOrder,
            page,
            pageSize: PAGE_SIZE,
          }),
        ]);

      if (sequence !== querySequence.current) return;

      setCounts({
        awaiting: awaitingRes.total,
        underReview: underReviewRes.total,
        readyToPublish: readyRes.total,
        published: publishedRes.total,
        rejected: rejectedRes.total,
      });

      if (queueRes.error) {
        setRows([]);
        setTotalRows(0);
        setLoadError(queueRes.error);
      } else {
        setRows(queueRes.rows);
        setTotalRows(queueRes.total);
      }

      setUpdatedAt(new Date());
    } catch (err) {
      if (sequence !== querySequence.current) return;
      console.error('[staff] error loading queue:', err);
    } finally {
      if (sequence === querySequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentTabDef, debouncedSearch, urgencyFilter, sortOrder, page]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Derived counts
  const needsActionCount = counts.awaiting + counts.underReview + counts.readyToPublish;
  const allCount = needsActionCount + counts.published + counts.rejected;

  const getTabCount = (tabId: TabId) => {
    switch (tabId) {
      case 'needs_action':
        return needsActionCount;
      case 'all':
        return allCount;
      case 'ready_to_publish':
        return counts.readyToPublish;
      case 'awaiting':
        return counts.awaiting;
      case 'under_review':
        return counts.underReview;
      case 'published':
        return counts.published;
      case 'rejected':
        return counts.rejected;
    }
  };

  const hasActiveFilters =
    searchInput.trim().length > 0 || urgencyFilter !== 'all' || sortOrder !== 'created';

  const resetFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setUrgencyFilter('all');
    setSortOrder('created');
    setPage(1);
  };

  const totalPages = Math.ceil(totalRows / PAGE_SIZE);

  return (
    <div className="space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      {/* ============================================================
          1. HEADER (Single clean aligned row across mobile & desktop)
      ============================================================ */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Requests Review Queue
          </h1>
          <div className="mt-0.5 flex items-center gap-2 text-xs sm:text-sm text-slate-500 flex-wrap">
            {needsActionCount > 0 ? (
              <span className="font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/80 inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                {needsActionCount} action{needsActionCount === 1 ? '' : 's'} required
              </span>
            ) : (
              <span className="font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/80 inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                All reviews clear
              </span>
            )}
            <span>·</span>
            <span>{allCount} total submissions</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {updatedAt && (
            <span className="hidden sm:inline text-xs text-slate-400">
              Synced {formatClock(updatedAt)}
            </span>
          )}
          <Link
            to="/staff/enquiries"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
          >
            <Inbox className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>Enquiries</span>
          </Link>
          <Link
            to="/staff/donations"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
          >
            <Heart className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            <span>Donations</span>
          </Link>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{refreshing ? 'Syncing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* ============================================================
          2. LIFECYCLE FILTER TABS (Strict chronological workflow order)
      ============================================================ */}
      <div className="space-y-3">
        {/* Navigation Tabs */}
        <div className="border-b border-slate-200 -mx-4 px-4 sm:mx-0 sm:px-0">
          <nav
            className="-mb-px flex space-x-1 sm:space-x-3 overflow-x-auto no-scrollbar"
            aria-label="Review Queue Filter Tabs"
          >
            {TABS.map((tab) => {
              const count = getTabCount(tab.id);
              const isActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`group inline-flex items-center gap-2 border-b-2 py-2.5 px-3 text-xs sm:text-sm font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'border-slate-900 text-slate-900 font-semibold'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] tabular-nums font-semibold transition-colors ${
                      isActive
                        ? tab.highlight && count > 0
                          ? 'bg-amber-100 text-amber-900 font-bold border border-amber-300'
                          : 'bg-slate-900 text-white'
                        : tab.highlight && count > 0
                          ? 'bg-amber-50 text-amber-800 border border-amber-200/80 font-bold'
                          : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Search & Sort Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
          <div className="relative flex-1 max-w-md">
            <Search
              className="pointer-events-none absolute top-2.5 left-3 h-3.5 w-3.5 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Filter by title, description, city..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pr-3 pl-8 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 shadow-2xs"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={urgencyFilter}
              onChange={(e) => {
                setUrgencyFilter(e.target.value as StaffUrgency | 'all');
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-900 focus:outline-none shadow-2xs"
            >
              <option value="all">Any Urgency</option>
              {STAFF_URGENCY_VALUES.map((u) => (
                <option key={u} value={u}>
                  {u.charAt(0).toUpperCase() + u.slice(1)} Urgency
                </option>
              ))}
            </select>

            <select
              value={sortOrder}
              onChange={(e) => {
                setSortOrder(e.target.value as 'created' | 'updated' | 'published');
                setPage(1);
              }}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 focus:border-slate-900 focus:outline-none shadow-2xs"
            >
              <option value="created">Newest Submitted</option>
              <option value="updated">Recently Updated</option>
              <option value="published">Recently Published</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ============================================================
          3. RESPONSIVE UNIFIED REQUEST LIST (Card-feed layout)
          Zero horizontal overflow, perfectly responsive, high clarity.
      ============================================================ */}
      <div className="space-y-3">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 animate-pulse space-y-3"
              >
                <div className="flex justify-between items-center">
                  <div className="h-4 w-28 bg-slate-200 rounded" />
                  <div className="h-5 w-20 bg-slate-100 rounded-full" />
                </div>
                <div className="h-5 w-2/3 bg-slate-200 rounded" />
                <div className="h-3 w-1/2 bg-slate-100 rounded" />
                <div className="h-9 w-32 bg-slate-200 rounded-lg pt-2" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <div className="rounded-xl border border-rose-200 bg-white p-8 text-center">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-600 mb-2">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="text-sm font-semibold text-slate-900">Could not load review queue</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {staffErrorText(loadError)}
            </p>
            <button
              type="button"
              onClick={() => void loadData()}
              className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Retry
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white py-14 px-4 text-center">
            <Inbox className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" />
            <p className="mt-2 text-sm font-semibold text-slate-800">
              {hasActiveFilters
                ? 'No requests match your filters'
                : `No requests in "${currentTabDef.label}"`}
            </p>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              {hasActiveFilters
                ? 'Try adjusting your search terms or urgency level.'
                : 'All requests for this stage have been verified, processed, or moved forward.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          rows.map((row) => {
            const cat = categoryName(row.categoryId);
            const location = formatLocation(row.locationCity, row.locationState);
            const isVerified = row.status === 'verified';
            const isPending = row.status === 'submitted' || row.status === 'under_review';

            return (
              <div
                key={row.id}
                className="group rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs hover:border-slate-300 hover:shadow-xs transition-all space-y-3"
              >
                {/* Row 1: Badges & Tags */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    {cat && (
                      <span className="font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200/60">
                        {cat}
                      </span>
                    )}
                    {location && (
                      <span className="flex items-center gap-1 text-slate-500">
                        <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                        <span className="truncate max-w-[180px] sm:max-w-none">{location}</span>
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-slate-400">
                      #{row.id.slice(0, 8)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <UrgencyIndicator urgency={row.urgency} />
                    <StatusBadge status={row.status} />
                  </div>
                </div>

                {/* Row 2: Title & Description */}
                <div>
                  <Link
                    to={`/staff/requests/${row.id}`}
                    className="text-base sm:text-lg font-bold text-slate-900 hover:text-emerald-700 transition-colors block leading-snug"
                  >
                    {row.title}
                  </Link>
                  {row.description && (
                    <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 mt-1 leading-relaxed">
                      {row.description}
                    </p>
                  )}
                </div>

                {/* Row 3: Target Amount, Date & Primary Action */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                    {row.targetAmount !== null && row.targetAmount > 0 ? (
                      <div>
                        <span className="font-bold text-slate-900 text-sm tabular-nums">
                          {formatINR(row.targetAmount)}
                        </span>
                        <span className="text-slate-400 ml-1">target</span>
                        {row.raisedAmount !== null && row.raisedAmount > 0 && (
                          <span className="text-emerald-600 font-semibold ml-2">
                            · {formatINR(row.raisedAmount)} raised
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                        Direct Non-Monetary Aid
                      </span>
                    )}

                    <span className="text-slate-300 hidden sm:inline">·</span>
                    <span>
                      {row.publishedAt
                        ? `Published ${formatRelative(row.publishedAt)}`
                        : row.submittedAt
                          ? `Submitted ${formatRelative(row.submittedAt)}`
                          : row.createdAt
                            ? `Created ${formatRelative(row.createdAt)}`
                            : ''}
                    </span>
                  </div>

                  {/* Action CTA */}
                  <div>
                    {isVerified ? (
                      <Link
                        to={`/staff/requests/${row.id}`}
                        className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-semibold shadow-xs transition-colors"
                      >
                        <span>Publish Request</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    ) : isPending ? (
                      <Link
                        to={`/staff/requests/${row.id}`}
                        className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 text-xs font-semibold shadow-xs transition-colors"
                      >
                        <span>Review & Verify</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    ) : (
                      <Link
                        to={`/staff/requests/${row.id}`}
                        className="inline-flex w-full sm:w-auto items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 px-3.5 py-1.5 text-xs font-medium transition-colors"
                      >
                        <span>View Details</span>
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ============================================================
          4. PAGINATION
      ============================================================ */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t border-slate-200">
        <p className="text-xs text-slate-500">
          {totalRows > 0 ? (
            <>
              Showing <span className="font-semibold text-slate-700">{rows.length}</span> of{' '}
              <span className="font-semibold text-slate-700">{formatCount(totalRows)}</span> total
              requests
            </>
          ) : (
            '0 requests'
          )}
        </p>

        {totalPages > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Prev</span>
            </button>
            <span className="px-2 text-xs font-medium text-slate-600">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
