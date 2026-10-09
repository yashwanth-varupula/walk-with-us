import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  formatINR,
  formatCount,
  formatLocation,
  formatRelative,
} from '../../lib/format';
import {
  isDocumentStatus,
  isRequestStatus,
  requestStatusMeta,
  urgencyMeta,
  DOCUMENT_STATUS_META,
} from '../../lib/status';

/**
 * Shared staff-console presentation.
 *
 * CONSOLIDATION: this file used to own its own copies of the status labels, the
 * urgency labels, and `formatINR` / `formatDate` / `formatDateTime`. That meant
 * a fifth definition of the same enums, which is exactly how the requester's
 * timeline and the staff queue drifted apart in the first place. The labels and
 * formatters now come from `lib/status` and `lib/format`; what stays here is
 * only the part that is genuinely staff-specific: the console's own colour
 * palette and panel layout.
 *
 * Staff keep their own wording (and their own colours) because a reviewer needs
 * precise internal language — "Rejected", not the requester's "Sent back" — but
 * they no longer keep their own copy of what those words mean.
 */

export { formatDate, formatDateTime, formatINR };

/**
 * The console palette. Deliberately more saturated than the requester-facing
 * tones in `lib/status`: these badges are scanned in dense tables, not read as
 * prose. `ring-1 ring-inset` keeps adjacent pills legible in a dense list.
 */
const REQUEST_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  submitted: 'bg-sky-100 text-sky-800 ring-sky-600/20',
  under_review: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  rejected: 'bg-rose-100 text-rose-800 ring-rose-600/20',
  verified: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  published: 'bg-violet-100 text-violet-800 ring-violet-600/20',
  active: 'bg-teal-100 text-teal-800 ring-teal-600/20',
  resolved: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  closed: 'bg-slate-200 text-slate-700 ring-slate-500/20',
};

const DOCUMENT_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 ring-amber-600/20',
  verified: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  rejected: 'bg-rose-100 text-rose-800 ring-rose-600/20',
};

const FALLBACK_STYLE = 'bg-slate-100 text-slate-700 ring-slate-500/20';

/**
 * One badge for both request statuses and document statuses, because the review
 * page renders a document status right next to a request status and two
 * differently-shaped components would be indistinguishable in a dense list.
 *
 * The label comes from the shared enum tables, so an unknown value from the
 * database still renders as readable text rather than an empty pill.
 */
export function StatusBadge({ status }: { status: string }) {
  if (isRequestStatus(status)) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
          REQUEST_STATUS_STYLES[status] ?? FALLBACK_STYLE
        }`}
      >
        {requestStatusMeta(status).staffLabel}
      </span>
    );
  }

  if (isDocumentStatus(status)) {
    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
          DOCUMENT_STATUS_STYLES[status] ?? FALLBACK_STYLE
        }`}
      >
        {DOCUMENT_STATUS_META[status].staffLabel}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${FALLBACK_STYLE}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const URGENCY_STYLES: Record<string, string> = {
  low: 'text-slate-600 bg-slate-100',
  medium: 'text-sky-700 bg-sky-50',
  high: 'text-amber-700 bg-amber-50',
  critical: 'text-rose-700 bg-rose-50',
};

/**
 * Urgency is shown as text plus colour, never colour alone, so it stays
 * readable for colour-blind staff and in printouts.
 */
export function UrgencyIndicator({ urgency }: { urgency: string }) {
  const style = URGENCY_STYLES[urgency] ?? URGENCY_STYLES.low;
  return (
    <span className={`inline-flex items-center rounded px-2 py-1 text-xs font-medium ${style}`}>
      {urgencyMeta(urgency).label}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5">
        <h2 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

/**
 * A label/value pair for a `<dl>`. Renamed from `Field` so it can never be
 * confused with the form-control `Field` in `components/ui/Field`, which has an
 * entirely different contract.
 */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-slate-600" role="status">
      <div
        className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600"
        aria-hidden="true"
      />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------- dashboard pieces */

/**
 * One row in a dashboard section or the full queue.
 *
 * A single row component is used by both rather than two near-identical
 * markups, which is what let the two drift apart before: the queue grew
 * pagination, urgency and target columns, while the dashboard sections were
 * written separately and ended up without the category or location that a
 * reviewer actually scans for.
 *
 * The whole row is one link, so it is a single tab stop rather than a title link
 * plus an actions column. `action` is rendered OUTSIDE the link to avoid nested
 * interactive elements.
 */
export function RequestRow({
  request,
  categoryName,
  showFunding = true,
  action,
}: {
  request: StaffRequestSummaryLike;
  categoryName: string;
  showFunding?: boolean;
  action?: ReactNode;
}) {
  const location = formatLocation(request.locationCity, request.locationState);

  /**
   * The date is labelled, not just printed, because the three candidates mean
   * different things to a reviewer. A published request needs its publish date
   * (is this thing still fresh?) and a waiting one its submitted date (how long
   * has this person been waiting?). Falling back through the three, with the
   * label following the value, is what stops a "published 3 days ago" list from
   * rendering as "3 days ago" next to a request submitted in January.
   */
  const [date, dateLabel] = request.publishedAt
    ? [request.publishedAt, 'Published']
    : request.submittedAt
      ? [request.submittedAt, 'Submitted']
      : [request.createdAt, 'Created'];
  return (
    <div className="flex items-start gap-3">
      <Link
        to={`/staff/requests/${request.id}`}
        className="min-w-0 flex-1 rounded-lg px-2 py-2 -mx-2 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-slate-900">{request.title}</span>
          <UrgencyIndicator urgency={request.urgency} />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
          {categoryName && <span className="font-medium text-slate-600">{categoryName}</span>}
          {location && (
            <>
              {categoryName && <span aria-hidden="true">·</span>}
              <span>{location}</span>
            </>
          )}
          {date && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                {dateLabel} {formatRelative(date)}
              </span>
            </>
          )}
        </div>

        {showFunding && request.targetAmount !== null && (
          <p className="mt-1 text-xs text-slate-600">
            <span className="font-medium text-slate-800">{formatINR(request.targetAmount)}</span>
            {request.raisedAmount !== null && request.raisedAmount > 0 && (
              <span className="text-slate-500">
                {' '}
                · {formatINR(request.raisedAmount)} raised
              </span>
            )}
          </p>
        )}
      </Link>

      <div className="flex shrink-0 items-center gap-2 self-center">
        <StatusBadge status={request.status} />
        {action}
      </div>
    </div>
  );
}

/**
 * The subset of a request row the shared `RequestRow` needs.
 *
 * Declared structurally rather than importing `StaffRequestSummary` from the
 * service, so this presentation file has no dependency on the Supabase layer.
 * That keeps `staffUi` importable by a test or a future server-rendered console
 * without dragging `lib/supabase` (and therefore `import.meta.env`) along.
 */
export interface StaffRequestSummaryLike {
  id: string;
  title: string;
  urgency: string;
  status: string;
  targetAmount: number | null;
  raisedAmount: number | null;
  locationCity: string | null;
  locationState: string | null;
  createdAt: string | null;
  submittedAt: string | null;
  publishedAt: string | null;
}

/**
 * Placeholder rows for a loading section.
 *
 * Sized to match a real `RequestRow` so the page does not jump when data
 * arrives, and marked `aria-hidden` because the loading state is already
 * announced once by the section itself — N placeholder rows announced as
 * content would be noise.
 */
export function RowSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-start gap-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
            <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-slate-100" />
          </div>
          <div className="h-6 w-16 shrink-0 animate-pulse rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/**
 * Compact count tile for the dashboard header.
 *
 * The number is the exact `count: 'exact'` total from Postgres, not a length of
 * the rows currently on screen, so it stays honest when a section shows only the
 * first few requests.
 */
export function StatTile({
  label,
  value,
  tone = 'idle',
  to,
}: {
  label: string;
  value: number;
  tone?: 'idle' | 'warn' | 'good' | 'info' | 'stop';
  to?: string;
}) {
  const toneClass =
    tone === 'warn'
      ? 'text-amber-700'
      : tone === 'stop'
        ? 'text-rose-700'
        : tone === 'good'
          ? 'text-emerald-700'
          : tone === 'info'
            ? 'text-sky-700'
            : 'text-slate-900';

  const body = (
    <>
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>
        {formatCount(value)}
      </p>
    </>
  );

  if (!to) {
    return <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">{body}</div>;
  }

  return (
    <Link
      to={to}
      className="rounded-xl border border-slate-200 bg-white px-4 py-3 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
    >
      {body}
    </Link>
  );
}
