import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Lock } from 'lucide-react';
import { formatDate, formatINR, formatLocation, fundingPercent } from '../../lib/format';
import { requestStatusMeta, urgencyMeta, type Tone } from '../../lib/status';
import { type UserHelpRequestSummary } from '../../services/helpRequests';

interface RequestCardProps {
  request: UserHelpRequestSummary;
  categoryName?: string | null;
}

const STATUS_DOT: Record<Tone, string> = {
  idle: 'bg-slate-400',
  info: 'bg-sky-500',
  warn: 'bg-amber-500',
  good: 'bg-emerald-600',
  stop: 'bg-rose-600',
};

export default function RequestCard({ request, categoryName }: RequestCardProps) {
  const meta = requestStatusMeta(request.status);
  const isDraft = request.status === 'draft';
  const hasTarget = typeof request.targetAmount === 'number' && request.targetAmount > 0;
  const percent = hasTarget ? fundingPercent(request.raisedAmount, request.targetAmount) : 0;
  const location = formatLocation(request.locationCity, request.locationState);

  const nextUrl = isDraft
    ? `/request-help?draftId=${encodeURIComponent(request.id)}`
    : `/my-requests/${encodeURIComponent(request.id)}`;
  const nextLabel = isDraft ? 'Continue draft' : 'View request';

  const isUrgent = request.urgency === 'high' || request.urgency === 'critical';
  const urgency = urgencyMeta(request.urgency);

  return (
    <article className="group rounded-card border border-line bg-surface p-5 sm:p-6 shadow-xs hover:shadow-md hover:border-slate-300 transition-all duration-200">
      <div className="flex flex-col gap-3">
        {/* 1. Status & Metadata Line */}
        <div className="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[meta.tone]}`} aria-hidden="true" />
              <span>{meta.requesterLabel}</span>
            </span>

            {isDraft && (
              <span className="inline-flex items-center gap-1 text-ink-subtle">
                <Lock className="h-3 w-3" aria-hidden="true" />
                <span>Private</span>
              </span>
            )}

            {isUrgent && (
              <span className="rounded-control bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[11px] font-medium text-rose-800">
                {urgency.label} urgency
              </span>
            )}

            {categoryName && (
              <span className="text-ink-subtle">·</span>
            )}
            {categoryName && (
              <span className="text-ink-muted">{categoryName}</span>
            )}

            {location && (
              <span className="text-ink-subtle">·</span>
            )}
            {location && (
              <span className="text-ink-muted">{location}</span>
            )}
          </div>

          <span className="text-[11px] text-ink-subtle tabular-nums">
            {formatDate(request.createdAt)}
          </span>
        </div>

        {/* 2. Request Title */}
        <h2 className="text-base sm:text-lg font-bold text-ink leading-snug">
          <Link
            to={nextUrl}
            className="hover:text-primary transition-colors focus:outline-none focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {request.title || 'Untitled Request'}
          </Link>
        </h2>

        {/* 3. Short Description */}
        {request.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-ink-muted sm:text-sm">
            {request.description}
          </p>
        )}

        {/* 4. Funding Progress (Quiet, Non-Boxed) */}
        {hasTarget && (
          <div className="mt-1 space-y-1.5">
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-ink">
                <strong className="font-semibold">{formatINR(request.raisedAmount ?? 0)}</strong>{' '}
                <span className="text-ink-subtle">raised of {formatINR(request.targetAmount)} goal</span>
              </span>
              <span className="font-semibold text-primary tabular-nums">{percent}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-control bg-slate-200"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-control bg-primary transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {/* 5. Footer Details & Action */}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-line/50">
          <div className="flex items-center gap-3 text-xs text-ink-subtle">
            {request.documentCount > 0 && (
              <span className="inline-flex items-center gap-1 font-medium">
                <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                <span>{request.documentCount} {request.documentCount === 1 ? 'doc' : 'docs'}</span>
              </span>
            )}
            {request.status === 'rejected' && request.rejectionReason && (
              <span className="font-medium text-rose-700">Review notes available</span>
            )}
          </div>

          <Link
            to={nextUrl}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:underline focus-visible:outline-2 focus-visible:outline-primary min-h-[44px] ${
              isDraft
                ? 'text-primary hover:text-primary-strong'
                : 'text-ink-muted hover:text-ink'
            }`}
          >
            <span>{nextLabel}</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}
