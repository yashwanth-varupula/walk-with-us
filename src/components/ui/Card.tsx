import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, FileQuestion, Loader2, RefreshCw, SearchX } from 'lucide-react';
import { toneClass, type Tone } from '../../lib/status';

/* ------------------------------------------------------------------ Badge */

const BADGE_TONE: Record<Tone, string> = {
  idle: 'bg-idle-soft text-idle-ink',
  info: 'bg-info-soft text-info-ink',
  warn: 'bg-warn-soft text-warn-ink',
  good: 'bg-good-soft text-good-ink',
  stop: 'bg-stop-soft text-stop-ink',
};

export function Badge({
  tone = 'idle',
  children,
  className = '',
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-xs font-medium border border-transparent ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Card */

export function Card({
  children,
  className = '',
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article' | 'section' | 'li';
}) {
  return (
    <Tag className={`rounded-card border border-line bg-surface ${className}`}>{children}</Tag>
  );
}

/** Card whose entire surface is clickable, with the link as the real target. */
export function CardLink({
  to,
  children,
  className = '',
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={`group block rounded-card border border-line bg-surface transition-colors hover:border-primary-soft-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ Alert */

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className = '',
}: {
  tone?: Tone;
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={`flex flex-wrap items-start gap-3 rounded-control border border-current/20 px-4 py-3 ${toneClass(tone)} ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ State */

/**
 * The three states every async surface must handle: loading, error, empty.
 *
 * All three previously existed as bespoke one-off markup spread across nine
 * files, and several surfaces had no empty state at all — so an empty result set
 * rendered as a blank area with no explanation. Error states now consistently
 * carry `role="alert"` so a failure is announced rather than silently painted.
 */
export function LoadingState({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-14 text-ink-muted ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm" role="status">
        {label}
      </p>
    </div>
  );
}

/** Skeleton placeholder for a card grid, so loading does not shift layout. */
export function SkeletonCard() {
  return (
    <div className="rounded-card border border-line bg-surface p-5">
      <div className="h-4 w-20 animate-pulse rounded bg-slate-200" />
      <div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-slate-200" />
      <div className="mt-2 h-4 w-full animate-pulse rounded bg-slate-100" />
      <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-slate-100" />
      <div className="mt-4 h-9 w-full animate-pulse rounded-control bg-slate-100" />
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className = '',
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 rounded-control border border-rose-200 bg-rose-50 px-6 py-12 text-center ${className}`}
    >
      <AlertTriangle className="h-6 w-6 text-rose-700" aria-hidden="true" />
      <div>
        <p className="font-semibold text-rose-900">{title}</p>
        {message && <p className="mt-1 text-sm text-rose-800">{message}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex items-center gap-1.5 rounded-control border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-800 transition-colors hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * Empty state. `variant` picks the icon so the message reads correctly —
 * "no results for your search" and "you have not asked for help yet" are very
 * different situations and were previously sharing one generic message.
 */
export function EmptyState({
  title,
  message,
  variant = 'generic',
  action,
  className = '',
}: {
  title: string;
  message?: string;
  variant?: 'generic' | 'search' | 'first-run';
  action?: ReactNode;
  className?: string;
}) {
  const Icon = variant === 'search' ? SearchX : variant === 'first-run' ? FileQuestion : FileQuestion;
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-control border border-dashed border-line bg-surface px-6 py-14 text-center ${className}`}
    >
      <Icon className="h-7 w-7 text-ink-subtle" aria-hidden="true" />
      <div>
        <p className="font-semibold text-ink">{title}</p>
        {message && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{message}</p>}
      </div>
      {action}
    </div>
  );
}
