import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, FileEdit, Plus, RefreshCw } from 'lucide-react';

import {
  getCategories,
  getMyHelpRequests,
  type Category,
  type UserHelpRequestSummary,
} from '../../services/helpRequests';

import { LinkButton } from '../../components/ui/Button';
import { Alert, SkeletonCard } from '../../components/ui/Card';
import { REQUEST_STATUSES } from '../../lib/status';
import RequestCard from '../../components/ui/RequestCard';

const FILTERS = [
  { key: 'all', label: 'All Requests' },
  { key: 'in_review', label: 'In Review' },
  { key: 'published', label: 'Published & Live' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'draft', label: 'Drafts' },
  { key: 'rejected', label: 'Needs Attention' },
] as const;

type FilterKey = (typeof FILTERS)[number]['key'];

const STATUSES_FOR_FILTER: Record<FilterKey, readonly string[]> = {
  all: REQUEST_STATUSES,
  in_review: ['submitted', 'under_review', 'verified'],
  published: ['published', 'active'],
  resolved: ['resolved', 'closed'],
  draft: ['draft'],
  rejected: ['rejected'],
};

export default function MyRequests() {
  const [requests, setRequests] = useState<UserHelpRequestSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async (isActive: () => boolean) => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await getMyHelpRequests();
    if (!isActive()) return;
    if (loadError) {
      setRequests([]);
      setError(loadError.message);
    } else {
      setRequests(data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load, attempt]);

  useEffect(() => {
    let active = true;
    void getCategories().then((result) => {
      if (!active) return;
      if (!result.error) setCategories(result.data);
    });
    return () => {
      active = false;
    };
  }, []);

  const categoryName = useCallback(
    (id: string | null) => categories.find((c) => c.id === id)?.name ?? null,
    [categories],
  );

  const drafts = requests.filter((r) => r.status === 'draft');
  const inReviewCount = requests.filter(
    (r) => r.status === 'submitted' || r.status === 'under_review' || r.status === 'verified',
  ).length;

  const visible = requests.filter((request) =>
    STATUSES_FOR_FILTER[filter].includes(request.status),
  );

  return (
    <div className="min-h-screen bg-canvas py-6 sm:py-10">
      <div className="container-page space-y-6 sm:space-y-8">
        {/* 1. Restrained Page Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between border-b border-line pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Your Requests
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              {requests.length} {requests.length === 1 ? 'request' : 'requests'}
              {inReviewCount > 0 ? ` · ${inReviewCount} currently under review` : ''}
            </p>
          </div>

          <div>
            <LinkButton
              to="/request-help"
              size="sm"
              className="w-full sm:w-auto min-h-[44px]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Start New Request
            </LinkButton>
          </div>
        </header>

        {/* 2. Draft Continuation Notice (When Drafts Exist) */}
        {drafts.length > 0 && (
          <section
            className="rounded-card border border-primary-soft-strong bg-primary-soft/40 p-4 sm:p-5"
            aria-label="Unfinished draft notice"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary text-white">
                  <FileEdit className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-ink">
                    You have {drafts.length} unfinished draft{drafts.length === 1 ? '' : 's'}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">
                    Drafts remain private to your account until you submit them for review.
                  </p>
                </div>
              </div>

              <LinkButton
                to={`/request-help?draftId=${encodeURIComponent(drafts[0].id)}`}
                size="sm"
                className="shrink-0 w-full sm:w-auto min-h-[44px]"
              >
                Continue Draft
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </LinkButton>
            </div>
          </section>
        )}

        {/* 3. Real Backend Error Alert */}
        {error && (
          <Alert tone="stop" title="Could not load your requests">
            <p className="text-xs sm:text-sm">{error}</p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-rose-300 bg-surface px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try Again
            </button>
          </Alert>
        )}

        {/* 4. Status Filter Row: Contained scroll container preventing mobile overflow */}
        <nav
          className="w-full max-w-full overflow-x-auto no-scrollbar border-b border-line -mb-2"
          role="navigation"
          aria-label="Filter requests by status"
        >
          <div className="flex items-center gap-1 min-w-max pb-2">
            {FILTERS.map((tab) => {
              const count = requests.filter((r) =>
                STATUSES_FOR_FILTER[tab.key].includes(r.status),
              ).length;
              const active = filter === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setFilter(tab.key)}
                  aria-pressed={active}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-control px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-primary min-h-[44px] ${
                    active
                      ? 'bg-primary-soft text-primary-strong font-semibold'
                      : 'text-ink-muted hover:text-ink hover:bg-slate-100/60'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-xs tabular-nums ${
                      active ? 'text-primary-strong font-bold' : 'text-ink-subtle'
                    }`}
                  >
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* 5. Case List / Loading / Empty States */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : requests.length === 0 ? (
          /* Calm, Human Empty State for New Requesters */
          <div className="rounded-card border border-line bg-surface p-8 sm:p-12 text-center">
            <h2 className="text-lg font-bold text-ink sm:text-xl">
              No requests submitted yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-xs sm:text-sm text-ink-muted leading-relaxed">
              When you submit a request for assistance, it will appear here so you can track its review, verification, and community support.
            </p>
            <div className="mt-6">
              <LinkButton to="/request-help" size="md">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Start a Help Request
              </LinkButton>
            </div>
          </div>
        ) : visible.length === 0 ? (
          /* Filtered Empty State */
          <div className="rounded-card border border-line bg-surface p-8 text-center">
            <h2 className="text-base font-bold text-ink sm:text-lg">
              No requests in this group
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-ink-muted">
              None of your requests are currently in the selected stage.
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="inline-flex items-center justify-center rounded-control border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
              >
                View all requests
              </button>
            </div>
          </div>
        ) : (
          /* Professional Spaced Case List */
          <div
            className="space-y-4 sm:space-y-5"
            aria-label="Requests list"
          >
            {visible.map((request) => (
              <RequestCard
                key={request.id}
                request={request}
                categoryName={categoryName(request.categoryId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}