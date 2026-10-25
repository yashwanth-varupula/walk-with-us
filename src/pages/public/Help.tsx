import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Filter,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { LinkButton } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { CategoryCoverPlaceholder } from '../../components/ui/CategoryPlaceholder';
import {
  getCategories,
  getPublicHelpRequestsPage,
  PUBLIC_PAGE_SIZE,
  URGENCY_VALUES,
  type HelpRequestUrgency,
  type PublicHelpRequest,
} from '../../services/helpRequests';
import { formatCount, formatINR, fundingPercent, pluralise } from '../../lib/format';
import { urgencyMeta } from '../../lib/status';

const ALL_CATEGORIES = { id: 'all', label: 'All categories', slug: null } as const;
type CategoryFilter = { id: string; label: string; slug: string | null };

export default function Help() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<PublicHelpRequest[]>([]);
  const [categories, setCategories] = useState<CategoryFilter[]>([ALL_CATEGORIES]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') ?? '');
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORIES.id);
  const [categoryResolved, setCategoryResolved] = useState(false);
  const [selectedUrgency, setSelectedUrgency] = useState<HelpRequestUrgency | 'any'>('any');
  const [selectedLocation, setSelectedLocation] = useState<string>('any');
  const [fundingStatus, setFundingStatus] = useState<'all' | 'unmet' | 'critical'>('all');

  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /* ---------------------------------------------------------------- data load */

  const load = useCallback(async (isActive: () => boolean) => {
    setLoading(true);
    setError(null);

    const [page, categoryResult] = await Promise.all([
      getPublicHelpRequestsPage({ limit: PUBLIC_PAGE_SIZE }),
      getCategories(),
    ]);

    if (!isActive()) return;

    if (categoryResult.error) {
      setCategories([ALL_CATEGORIES]);
    } else {
      setCategories([
        ALL_CATEGORIES,
        ...categoryResult.data.map((c) => ({ id: c.id, label: c.name, slug: c.slug ?? null })),
      ]);
    }

    if (page.error) {
      setRows([]);
      setHasMore(false);
      setError(page.error.message);
    } else {
      setRows(page.rows);
      setHasMore(page.hasMore);
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

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const page = await getPublicHelpRequestsPage({ limit: PUBLIC_PAGE_SIZE, offset: rows.length });
    if (!mounted.current) return;
    setLoadingMore(false);
    if (page.error) {
      setError(page.error.message);
      return;
    }
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      return [...prev, ...page.rows.filter((r) => !seen.has(r.id))];
    });
    setHasMore(page.hasMore);
  };

  /* ----------------------------------------------------------- url sync */

  useEffect(() => {
    if (loading || categories.length <= 1) return;
    const slug = searchParams.get('category');
    if (slug) {
      const match = categories.find((c) => c.slug === slug);
      if (match) setSelectedCategory(match.id);
      else setSelectedCategory(ALL_CATEGORIES.id);
    }
    setCategoryResolved(true);
  }, [loading, categories, searchParams]);

  useEffect(() => {
    if (loading || !categoryResolved) return;
    const next = new URLSearchParams();
    if (searchTerm.trim()) next.set('q', searchTerm.trim());
    if (selectedCategory !== ALL_CATEGORIES.id) {
      const slug = categories.find((c) => c.id === selectedCategory)?.slug;
      if (slug) next.set('category', slug);
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [searchTerm, selectedCategory, categories, setSearchParams, loading, categoryResolved, searchParams]);

  /* ------------------------------------------------------------- modal a11y */

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileFiltersOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileFiltersOpen]);

  /* ------------------------------------------------------------ memo filters */

  const locations = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rows) if (r.locationCity) seen.add(r.locationCity);
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const categoryLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categories) map.set(c.id, c.label);
    return map;
  }, [categories]);

  const filtered = useMemo(() => {
    const needle = searchTerm.trim().toLowerCase();
    return rows.filter((r) => {
      const matchesText =
        needle.length === 0 ||
        r.title.toLowerCase().includes(needle) ||
        r.description.toLowerCase().includes(needle);
      const matchesCategory =
        selectedCategory === ALL_CATEGORIES.id || r.categoryId === selectedCategory;
      const matchesUrgency = selectedUrgency === 'any' || r.urgency === selectedUrgency;
      const matchesLocation = selectedLocation === 'any' || r.locationCity === selectedLocation;

      const hasTarget = (r.targetAmount ?? 0) > 0;
      const isUnmet = hasTarget && (r.raisedAmount ?? 0) < (r.targetAmount ?? 0);
      const matchesFunding =
        fundingStatus === 'all'
          ? true
          : fundingStatus === 'unmet'
            ? isUnmet
            : r.urgency === 'critical' || r.urgency === 'high';

      return matchesText && matchesCategory && matchesUrgency && matchesLocation && matchesFunding;
    });
  }, [rows, searchTerm, selectedCategory, selectedUrgency, selectedLocation, fundingStatus]);

  const activeFilterCount =
    (searchTerm.trim() ? 1 : 0) +
    (selectedCategory !== ALL_CATEGORIES.id ? 1 : 0) +
    (selectedUrgency !== 'any' ? 1 : 0) +
    (selectedLocation !== 'any' ? 1 : 0) +
    (fundingStatus !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedCategory(ALL_CATEGORIES.id);
    setSelectedUrgency('any');
    setSelectedLocation('any');
    setFundingStatus('all');
  };

  return (
    <div className="min-h-screen bg-canvas">
      {/* 1. Page Header & Directory Introduction */}
      <header className="border-b border-line bg-surface py-8 sm:py-12">
        <div className="container-page">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Community Directory
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
              Help someone in your community
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:text-base">
              Every request is reviewed and authenticated by staff. Connect directly with people who need financial, medical, or practical community assistance.
            </p>
          </div>

          {/* 2. Search & Category Bar */}
          <div className="mt-6 max-w-2xl">
            <div className="relative">
              <label htmlFor="help-search-input" className="sr-only">
                Search verified help requests
              </label>
              <Search
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
                aria-hidden="true"
              />
              <input
                id="help-search-input"
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by keywords, city, or cause…"
                className="field-control pl-10 pr-10 py-2.5 text-sm focus-visible:ring-2 focus-visible:ring-primary/20 min-h-[44px]"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Clear search query"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-control p-1 text-ink-subtle transition-colors hover:bg-slate-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[32px] min-w-[32px] flex items-center justify-center"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </div>

            {/* Restrained Category Scroll Bar (Mobile & Desktop) */}
            <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 pt-0.5 no-scrollbar scroll-smooth">
              {categories.map((c) => {
                const isSelected = selectedCategory === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCategory(c.id)}
                    className={`shrink-0 rounded-control px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[36px] ${
                      isSelected
                        ? 'bg-primary text-white'
                        : 'border border-line bg-surface text-ink-muted hover:border-slate-300 hover:text-ink hover:bg-slate-50'
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="container-page py-8 sm:py-12">
        {/* Controls Bar: Results count, Desktop filters, Mobile filter trigger */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink sm:text-base">
              {loading ? (
                'Loading requests…'
              ) : (
                <>
                  Showing {formatCount(filtered.length)}{' '}
                  <span className="font-normal text-ink-subtle">
                    {pluralise(filtered.length, 'request', 'requests')}
                    {rows.length !== filtered.length && ` (filtered from ${formatCount(rows.length)})`}
                  </span>
                </>
              )}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {/* Mobile Filter Trigger */}
            <button
              type="button"
              onClick={() => setMobileFiltersOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px] lg:hidden"
            >
              <Filter className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Desktop Secondary Filters */}
            <div className="hidden items-center gap-2 lg:flex">
              {/* Urgency select */}
              <select
                value={selectedUrgency}
                onChange={(e) => setSelectedUrgency(e.target.value as HelpRequestUrgency | 'any')}
                aria-label="Filter by urgency"
                className="rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-slate-300 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
              >
                <option value="any">All Urgencies</option>
                {URGENCY_VALUES.map((u) => (
                  <option key={u} value={u}>
                    {urgencyMeta(u).label}
                  </option>
                ))}
              </select>

              {/* Location select (only if locations exist) */}
              {locations.length > 0 && (
                <select
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  aria-label="Filter by location"
                  className="rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-slate-300 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
                >
                  <option value="any">All Locations</option>
                  {locations.map((city) => (
                    <option key={city} value={city}>
                      {city}
                    </option>
                  ))}
                </select>
              )}

              {/* Funding status select */}
              <select
                value={fundingStatus}
                onChange={(e) => setFundingStatus(e.target.value as 'all' | 'unmet' | 'critical')}
                aria-label="Filter by funding progress"
                className="rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-slate-300 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
              >
                <option value="all">All Funding States</option>
                <option value="unmet">Needs Funding</option>
                <option value="critical">Critical / High Urgency</option>
              </select>
            </div>

            {/* Clear Filters button (if any active) */}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-slate-50 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
              >
                <RotateCcw className="h-3 w-3 text-ink-subtle" aria-hidden="true" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Active Filter Badges */}
        {activeFilterCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-subtle">Filtered by:</span>
            {searchTerm.trim() && (
              <span className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-0.5 text-xs text-ink">
                <span>"{searchTerm.trim()}"</span>
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  aria-label="Remove search filter"
                  className="rounded-control p-0.5 text-ink-subtle hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            )}
            {selectedCategory !== ALL_CATEGORIES.id && (
              <span className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-0.5 text-xs text-ink">
                <span>Category: {categoryLabels.get(selectedCategory)}</span>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(ALL_CATEGORIES.id)}
                  aria-label="Remove category filter"
                  className="rounded-control p-0.5 text-ink-subtle hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            )}
            {selectedUrgency !== 'any' && (
              <span className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-0.5 text-xs text-ink">
                <span>Urgency: {urgencyMeta(selectedUrgency).label}</span>
                <button
                  type="button"
                  onClick={() => setSelectedUrgency('any')}
                  aria-label="Remove urgency filter"
                  className="rounded-control p-0.5 text-ink-subtle hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            )}
            {selectedLocation !== 'any' && (
              <span className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-0.5 text-xs text-ink">
                <span>City: {selectedLocation}</span>
                <button
                  type="button"
                  onClick={() => setSelectedLocation('any')}
                  aria-label="Remove location filter"
                  className="rounded-control p-0.5 text-ink-subtle hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            )}
            {fundingStatus !== 'all' && (
              <span className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-2 py-0.5 text-xs text-ink">
                <span>
                  {fundingStatus === 'unmet' ? 'Needs Funding' : 'High Priority'}
                </span>
                <button
                  type="button"
                  onClick={() => setFundingStatus('all')}
                  aria-label="Remove funding filter"
                  className="rounded-control p-0.5 text-ink-subtle hover:text-ink"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        )}

        {/* Requests Editorial Directory Section */}
        <section aria-label="Published help requests" className="mt-6">
          {loading ? (
            <div className="divide-y divide-line border-t border-b border-line">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="py-6 sm:py-8 space-y-3 animate-pulse">
                  <div className="h-3 w-32 bg-slate-200 rounded-control" />
                  <div className="h-5 w-3/4 max-w-md bg-slate-200 rounded-control" />
                  <div className="h-4 w-full max-w-lg bg-slate-100 rounded-control" />
                  <div className="h-2 w-48 bg-slate-100 rounded-control" />
                </div>
              ))}
            </div>
          ) : error ? (
            <ErrorState
              title="We could not load the help requests"
              message={error}
              onRetry={() => setAttempt((n) => n + 1)}
            />
          ) : filtered.length === 0 ? (
            rows.length === 0 ? (
              /* Database empty state: No requests published at all */
              <div className="mx-auto max-w-md py-12 text-center">
                <h3 className="text-lg font-bold text-ink">
                  No Active Help Requests Right Now
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  All published requests have either met their goals or are currently progressing through our team's verification process. Check back soon, or request assistance if you or your family are facing a crisis.
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <LinkButton to="/request-help" size="sm" className="min-h-[44px]">
                    Ask for Help
                  </LinkButton>
                  <LinkButton to="/volunteer" variant="secondary" size="sm" className="min-h-[44px]">
                    Volunteer With Us
                  </LinkButton>
                </div>
              </div>
            ) : (
              /* Filter empty state: Active filters yielded no matches */
              <div className="mx-auto max-w-md py-12 text-center">
                <h3 className="text-lg font-bold text-ink">
                  No Requests Match These Filters
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                  {hasMore
                    ? `None of the ${formatCount(rows.length)} currently loaded requests match your selected filters. You can clear filters or load more requests from the database.`
                    : `We couldn't find any requests matching your current criteria. Try broadening your keywords or resetting filters.`}
                </p>
                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink shadow-xs hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
                    <span>Clear all filters</span>
                  </button>
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      className="inline-flex items-center gap-1.5 rounded-control bg-primary px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-strong transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
                    >
                      <span>Load More from Database</span>
                    </button>
                  )}
                </div>
              </div>
            )
          ) : (
            <>
              {/* Editorial Directory List */}
              <div className="divide-y divide-line border-t border-b border-line" role="feed" aria-label="Help request directory">
                {filtered.map((r) => {
                  const catName = r.categoryId ? (categoryLabels.get(r.categoryId) ?? null) : null;
                  const loc = [r.locationCity, r.locationState].filter(Boolean).join(', ');
                  const hasTarget = (r.targetAmount ?? 0) > 0;
                  const percent = hasTarget ? fundingPercent(r.raisedAmount, r.targetAmount) : 0;
                  const isHighPriority = r.urgency === 'critical' || r.urgency === 'high';

                  return (
                    <article
                      key={r.id}
                      className="py-6 sm:py-8 flex flex-col md:flex-row md:items-start md:justify-between gap-6 transition-colors hover:bg-canvas/40"
                    >
                      <div className="flex flex-col sm:flex-row gap-5 min-w-0 flex-1">
                        <div className="w-full sm:w-44 sm:h-32 shrink-0 overflow-hidden rounded-md border border-line bg-canvas">
                          {r.imageUrl ? (
                            <img
                              src={r.imageUrl}
                              alt={r.title}
                              className="h-44 sm:h-full w-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <CategoryCoverPlaceholder categoryName={catName} size="md" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                            {r.isDemo && (
                              <>
                                <span className="inline-flex items-center font-medium text-slate-700 text-[10px] bg-slate-100 px-2 py-0.5 rounded-control border border-slate-300 shadow-2xs">
                                  Sample
                                </span>
                                <span>·</span>
                              </>
                            )}
                            {catName && <span className="font-semibold text-primary">{catName}</span>}
                            {catName && loc && <span>·</span>}
                            {loc && (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3 w-3 text-ink-subtle" aria-hidden="true" />
                                {loc}
                              </span>
                            )}
                            {isHighPriority && (
                              <>
                                <span>·</span>
                                <span className="font-semibold text-accent">
                                  {urgencyMeta(r.urgency).label} Urgency
                                </span>
                              </>
                            )}
                          </div>

                          <h3 className="text-lg font-bold text-ink sm:text-xl">
                            <Link
                              to={`/help/${r.id}`}
                              className="hover:text-primary transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                            >
                              {r.title}
                            </Link>
                          </h3>

                          <p className="line-clamp-2 text-sm text-ink-muted leading-relaxed">
                            {r.description}
                          </p>

                          {hasTarget ? (
                            <div className="pt-2 max-w-md space-y-1.5">
                              <div className="flex items-baseline justify-between text-xs">
                                <span className="font-semibold text-ink tabular-nums">
                                  {formatINR(r.raisedAmount ?? 0)}
                                  <span className="font-normal text-ink-subtle">
                                    {' '}raised of {formatINR(r.targetAmount)}
                                  </span>
                                </span>
                                <span className="font-semibold text-primary tabular-nums">
                                  {percent}%
                                </span>
                              </div>
                              <ProgressBar value={percent} size="sm" />
                            </div>
                          ) : (
                            <p className="pt-1 text-xs text-ink-subtle font-medium">
                              Direct non-monetary aid (volunteer / supplies)
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3 self-start md:self-center">
                        <LinkButton
                          to={`/help/${r.id}`}
                          variant="secondary"
                          size="sm"
                          className="min-h-[44px]"
                        >
                          View Request
                          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </LinkButton>
                      </div>
                    </article>
                  );
                })}
              </div>

              {/* Load More Pagination */}
              {hasMore && (
                <div className="mt-10 flex flex-col items-center justify-center gap-2 text-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="inline-flex items-center gap-2 rounded-control border border-line bg-surface px-5 py-2.5 text-sm font-medium text-ink shadow-xs transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
                        <span>Loading more requests…</span>
                      </>
                    ) : (
                      <>
                        <span>Load More Help Requests</span>
                        <ArrowDown className="h-4 w-4 text-ink-subtle" aria-hidden="true" />
                      </>
                    )}
                  </button>
                  <p className="text-xs text-ink-subtle">
                    Loaded {formatCount(rows.length)} published {pluralise(rows.length, 'request', 'requests')}
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      {/* Mobile Filters Drawer Modal */}
      {mobileFiltersOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 backdrop-blur-xs lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-filter-title"
          onClick={() => setMobileFiltersOpen(false)}
        >
          <div
            className="w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-6 shadow-2xl animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-line">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 id="mobile-filter-title" className="text-base font-bold text-ink">
                  Filter Requests
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="rounded-control p-2 text-ink-subtle hover:bg-slate-100 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close filter drawer"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="mt-5 space-y-6">
              {/* Category */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2.5">
                  Category
                </label>
                <div className="flex flex-wrap gap-2">
                  {categories.map((c) => {
                    const isSelected = selectedCategory === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCategory(c.id)}
                        className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                          isSelected
                            ? 'bg-primary text-white'
                            : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                        <span>{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Urgency */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2.5">
                  Urgency Level
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedUrgency('any')}
                    className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                      selectedUrgency === 'any'
                        ? 'bg-primary text-white'
                        : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                    }`}
                  >
                    {selectedUrgency === 'any' && <Check className="h-3 w-3" aria-hidden="true" />}
                    <span>All Urgencies</span>
                  </button>
                  {URGENCY_VALUES.map((u) => {
                    const isSelected = selectedUrgency === u;
                    return (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setSelectedUrgency(u)}
                        className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                          isSelected
                            ? 'bg-primary text-white'
                            : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                        <span>{urgencyMeta(u).label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Location */}
              {locations.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2.5">
                    Location
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedLocation('any')}
                      className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                        selectedLocation === 'any'
                          ? 'bg-primary text-white'
                          : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                      }`}
                    >
                      {selectedLocation === 'any' && <Check className="h-3 w-3" aria-hidden="true" />}
                      <span>All Locations</span>
                    </button>
                    {locations.map((city) => {
                      const isSelected = selectedLocation === city;
                      return (
                        <button
                          key={city}
                          type="button"
                          onClick={() => setSelectedLocation(city)}
                          className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                            isSelected
                              ? 'bg-primary text-white'
                              : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
                          <span>{city}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Funding Status */}
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-ink-subtle mb-2.5">
                  Funding Progress
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setFundingStatus('all')}
                    className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                      fundingStatus === 'all'
                        ? 'bg-primary text-white'
                        : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                    }`}
                  >
                    {fundingStatus === 'all' && <Check className="h-3 w-3" aria-hidden="true" />}
                    <span>All Requests</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFundingStatus('unmet')}
                    className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                      fundingStatus === 'unmet'
                        ? 'bg-primary text-white'
                        : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                    }`}
                  >
                    {fundingStatus === 'unmet' && <Check className="h-3 w-3" aria-hidden="true" />}
                    <span>Needs Funding</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFundingStatus('critical')}
                    className={`inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-xs font-medium transition-colors min-h-[44px] ${
                      fundingStatus === 'critical'
                        ? 'bg-primary text-white'
                        : 'border border-line bg-canvas text-ink-muted hover:border-slate-300 hover:text-ink'
                    }`}
                  >
                    {fundingStatus === 'critical' && <Check className="h-3 w-3" aria-hidden="true" />}
                    <span>Critical / High Urgency</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="mt-8 flex gap-3 border-t border-line pt-4">
              <button
                type="button"
                onClick={clearFilters}
                className="flex-1 rounded-control border border-line py-2.5 text-sm font-medium text-ink hover:bg-slate-50 transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
              >
                Reset All
              </button>
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(false)}
                className="flex-1 rounded-control bg-primary py-2.5 text-sm font-medium text-white shadow-xs hover:bg-primary-strong transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
