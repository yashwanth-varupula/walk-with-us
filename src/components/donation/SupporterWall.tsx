import { useCallback, useEffect, useState } from 'react';
import {
  Heart,
  HeartHandshake,
  RefreshCw,
} from 'lucide-react';
import {
  getPublicDonationsForRequest,
  type PublicDonationItem,
} from '../../services/donations';
import { formatPaiseToINR } from '../../lib/money';
import { formatDate, formatRelative } from '../../lib/format';

export interface SupporterWallProps {
  requestId: string;
  hasTarget?: boolean;
  refreshTrigger?: number;
  className?: string;
}

/**
 * Derives clean initials from a donor's display name for avatar rendering.
 * Fallbacks safely for single names, punctuation, or unusual characters.
 */
function getInitials(name: string): string {
  if (!name) return 'S';
  const clean = name.trim();
  if (!clean) return 'S';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Public Supporter Wall Component.
 *
 * Displays recent verified contributions for a published help request.
 * Strictly reads from the sanitized `public_donations` database view.
 *
 * PRIVACY GUARANTEES:
 * - Never queries private `donations` table.
 * - Never requests or displays donor email, phone, payment IDs, or gateway secrets.
 * - Enforces "Anonymous Supporter" whenever `isAnonymous` is true.
 * - Failures are isolated and recoverable without breaking checkout or campaign details.
 */
export function SupporterWall({
  requestId,
  hasTarget = true,
  refreshTrigger = 0,
  className = '',
}: SupporterWallProps) {
  const [supporters, setSupporters] = useState<PublicDonationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchSupporters = useCallback(async (isActive: () => boolean) => {
    if (!requestId) {
      setSupporters([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const result = await getPublicDonationsForRequest(requestId);

    if (!isActive()) return;

    if (result.error) {
      setError(result.error);
      setSupporters([]);
    } else {
      setSupporters(result.data);
      setError(null);
    }
    setLoading(false);
  }, [requestId]);

  useEffect(() => {
    let active = true;
    void fetchSupporters(() => active);
    return () => {
      active = false;
    };
  }, [fetchSupporters, retryCount, refreshTrigger]);

  // If this is a non-monetary aid request and has no contributions, hide the wall gracefully
  if (!hasTarget && !loading && !error && supporters.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="supporters-heading" className={`space-y-4 ${className}`}>
      {/* Section Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="supporters-heading" className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Recent Supporters
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            Community members who have stepped forward to support this request.
          </p>
        </div>
        {!loading && !error && supporters.length > 0 && (
          <span className="inline-flex items-center rounded-sm bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary-strong border border-primary/20">
            {supporters.length >= 20
              ? '20 recent supporters'
              : `${supporters.length} ${supporters.length === 1 ? 'supporter' : 'supporters'}`}
          </span>
        )}
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div
          className="space-y-3"
          aria-busy="true"
          aria-label="Loading recent supporters"
        >
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-4 rounded-control border border-line bg-surface p-3 sm:px-4 sm:py-3.5"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full bg-slate-200 animate-pulse" />
                <div className="space-y-1.5">
                  <div className="h-3.5 w-28 rounded bg-slate-200 animate-pulse" />
                  <div className="h-3 w-16 rounded bg-slate-100 animate-pulse" />
                </div>
              </div>
              <div className="h-4 w-14 rounded bg-slate-200 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {/* Error State with Retry Action */}
      {!loading && error && (
        <div
          role="alert"
          className="rounded-card border border-rose-200 bg-rose-50/70 p-5 text-center"
        >
          <p className="text-xs font-semibold text-rose-900">
            Unable to load recent supporters
          </p>
          <p className="mt-1 text-xs text-rose-700 max-w-sm mx-auto leading-relaxed">
            We encountered a problem loading public contributions. Your ability to donate remains unaffected.
          </p>
          <button
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-control border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 shadow-2xs hover:bg-rose-50 focus-visible:outline-2 focus-visible:outline-primary transition-colors min-h-[36px]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>Try again</span>
          </button>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && supporters.length === 0 && (
        <div className="rounded-card border border-dashed border-line bg-surface/60 p-6 sm:p-8 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-soft text-primary">
            <HeartHandshake className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-sm font-semibold text-ink">Be the first supporter</p>
          <p className="mt-1 text-xs text-ink-muted max-w-sm mx-auto leading-relaxed">
            No public contributions recorded yet. Every contribution directly helps this family reach their goal.
          </p>
        </div>
      )}

      {/* Populated Supporter List */}
      {!loading && !error && supporters.length > 0 && (
        <ul
          role="list"
          aria-label="Recent supporters list"
          className="divide-y divide-line/60 rounded-card border border-line bg-surface overflow-hidden"
        >
          {supporters.map((item) => {
            const isAnon = item.isAnonymous;
            const displayName = isAnon
              ? 'Anonymous Supporter'
              : (item.donorDisplayName?.trim() || 'Supporter');
            const amountFormatted = formatPaiseToINR(item.amountPaise);
            const relativeTime = formatRelative(item.createdAt);
            const fullDate = formatDate(item.createdAt);

            return (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 p-3.5 sm:px-4 sm:py-3.5 transition-colors hover:bg-slate-50/70"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {isAnon ? (
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-strong shadow-2xs"
                      aria-label="Anonymous supporter"
                      title="Anonymous Supporter"
                    >
                      <Heart className="h-4 w-4 text-primary fill-primary/20" aria-hidden="true" />
                    </div>
                  ) : (
                    <div
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-ink-muted border border-slate-200/60 shadow-2xs"
                      aria-hidden="true"
                    >
                      {getInitials(displayName)}
                    </div>
                  )}

                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">
                      {displayName}
                    </p>
                    <time
                      dateTime={item.createdAt}
                      title={fullDate}
                      className="block text-xs text-ink-subtle mt-0.5"
                    >
                      {relativeTime}
                    </time>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-sm font-bold text-ink tabular-nums">
                    {amountFormatted}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
