/**
 * The single place money, dates and counts are formatted.
 *
 * Before this module the same four functions existed in five files with three
 * different empty-value conventions and two different currencies — including
 * one that formatted USD, which would have rendered a rupee amount as `$1,200`
 * the moment anyone wired it up. Every consumer now imports from here.
 *
 * The locale is pinned to `en-IN` rather than left undefined. An undefined
 * locale renders differently depending on the visitor's OS settings, which
 * meant the same database row could display as "5 Mar 2026" on one machine and
 * "3/5/2026" on another.
 */

const LOCALE = 'en-IN';
const CURRENCY = 'INR';

const moneyFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

const moneyCompactFormatter = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * Format a rupee amount. Returns an em dash for null/undefined so "no amount
 * set" is visibly different from "zero rupees", and never throws on a string.
 */
export function formatINR(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n === null) return '—';
  return moneyFormatter.format(n);
}

/** Compact form for tight spaces (cards, stat tiles): ₹1.2L, ₹45K. */
export function formatINRCompact(value: number | string | null | undefined): string {
  const n = toFiniteNumber(value);
  if (n === null) return '—';
  return moneyCompactFormatter.format(n);
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** e.g. "5 Mar 2026". Em dash for missing or unparseable input. */
export function formatDate(value: string | null | undefined): string {
  const d = parse(value);
  return d ? dateFormatter.format(d) : '—';
}

/** e.g. "5 Mar 2026, 14:30". */
export function formatDateTime(value: string | null | undefined): string {
  const d = parse(value);
  return d ? dateTimeFormatter.format(d) : '—';
}

/**
 * Coarse relative time, e.g. "3 days ago". Used for "last updated" hints where
 * an absolute timestamp would be noise. Anything older than 30 days falls back
 * to the absolute date, which is more useful than "59 days ago".
 */
export function formatRelative(value: string | null | undefined): string {
  const d = parse(value);
  if (!d) return '—';
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 0) return dateFormatter.format(d);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days > 30) return dateFormatter.format(d);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const numberFormatter = new Intl.NumberFormat(LOCALE);

/** Plain grouped number, e.g. "1,204". */
export function formatCount(value: number | null | undefined): string {
  return numberFormatter.format(value ?? 0);
}

/**
 * Funding progress as a whole-number percentage, clamped to 0–100.
 *
 * Clamping both ends matters: `raised_amount` is a numeric column and nothing
 * in the schema guarantees it is non-negative, and an unclamped value rendered
 * `width: -50%` on the request detail bar.
 */
export function fundingPercent(raised: number | null | undefined, target: number | null | undefined): number {
  const r = toFiniteNumber(raised) ?? 0;
  const t = toFiniteNumber(target) ?? 0;
  if (t <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((r / t) * 100)));
}

/** Join city and state, skipping whichever is missing. */
export function formatLocation(city: string | null | undefined, state: string | null | undefined): string {
  const parts = [city, state].map((p) => (p ?? '').trim()).filter(Boolean);
  return parts.length ? parts.join(', ') : '';
}

/** Truncate on a word boundary for card excerpts. */
export function excerpt(text: string | null | undefined, maxChars = 160): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** "3 documents" / "1 document" */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
