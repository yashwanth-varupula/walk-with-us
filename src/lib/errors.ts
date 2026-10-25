/**
 * Shared, token-safe normalisation of Supabase/PostgREST errors.
 *
 * PostgREST errors are plain objects ({ code, details, hint, message }), not
 * Error instances. Both the requester flow and the staff console need to turn
 * them into a user-facing message plus development-only diagnostics, without
 * ever leaking internal detail into a production build or echoing a session
 * token.
 *
 * Only scalar fields are copied. No request/response bodies are retained.
 */

export interface StructuredSupabaseError {
  code: string;
  message: string;
  details: string;
  hint: string;
}

/**
 * Detect and normalise a Supabase REST error. Returns null for Error
 * instances and for values that carry neither a string `message` nor a string
 * `code`, so callers can distinguish "a real DB error" from "a thrown Error".
 */
export function extractStructuredError(err: unknown): StructuredSupabaseError | null {
  if (!err || typeof err !== 'object' || err instanceof Error) return null;
  const e = err as Record<string, unknown>;
  if (typeof e.message !== 'string' && typeof e.code !== 'string') return null;
  return {
    code: typeof e.code === 'string' ? e.code : '',
    message: typeof e.message === 'string' ? e.message : '',
    details: typeof e.details === 'string' ? e.details : '',
    hint: typeof e.hint === 'string' ? e.hint : '',
  };
}

/**
 * Development-only suffix exposing the concrete error code, details and hint.
 * Returns an empty string in production builds, so raw diagnostic text is never
 * shown to end users. Safe by construction: the three fields are scalars and
 * never contain credentials.
 */
export function devErrorSuffix(structured: StructuredSupabaseError): string {
  if (!import.meta.env.DEV) return '';
  const parts: string[] = [];
  if (structured.code) parts.push(`code: ${structured.code}`);
  if (structured.details) parts.push(`details: ${structured.details}`);
  if (structured.hint) parts.push(`hint: ${structured.hint}`);
  const joined = parts.join(' | ');
  return joined ? ` (${joined})` : '';
}

/** True when the error is a Postgres / PostgREST RLS refusal. */
export function isRlsError(err: unknown): boolean {
  const s = extractStructuredError(err);
  if (!s) return false;
  const lower = s.message.toLowerCase();
  return s.code === '42501' || lower.includes('row-level security') || lower.includes('policy');
}

/**
 * Checks if an error from Supabase Auth indicates an email rate limit / throttle.
 *
 * Supabase GoTrue returns HTTP 429 when:
 * 1. The default built-in SMTP mailer hits project-level hourly limits (e.g. 2 emails/hour).
 * 2. An individual user requests confirmation or password reset emails faster than `smtp_max_frequency` (default 60s).
 * 3. The server responds with `over_email_send_rate_limit` or `email rate limit exceeded`.
 */
export function isAuthRateLimitError(err: unknown): boolean {
  if (!err) return false;

  if (typeof err === 'object') {
    const e = err as Record<string, unknown>;
    if (e.status === 429) return true;
    if (typeof e.code === 'string' && /rate_limit|over_email|too_many_requests/i.test(e.code)) return true;
    if (typeof e.message === 'string' && isRateLimitMessage(e.message)) return true;
  }

  if (err instanceof Error) {
    if (isRateLimitMessage(err.message)) return true;
  }

  return false;
}

function isRateLimitMessage(msg: string): boolean {
  return /rate limit|over_email_send_rate_limit|too many requests|seconds/i.test(msg);
}

/**
 * Extracts a suggested cooldown period in seconds from a rate limit error or header,
 * defaulting to 60 seconds (Supabase default `smtp_max_frequency`).
 */
export function getAuthRateLimitCooldown(err: unknown, defaultCooldown = 60): number {
  if (!err || typeof err !== 'object') return defaultCooldown;
  const e = err as Record<string, unknown>;
  const msg = typeof e.message === 'string' ? e.message : '';
  const match = msg.match(/(?:after|wait)\s+(\d+)\s+seconds/i);
  if (match && match[1]) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 3600) return parsed;
  }
  return defaultCooldown;
}

/**
 * Generates an empathetic, actionable message for users affected by email rate limits,
 * explaining why the limit occurred and directing them to wait or check spam.
 */
export function formatAuthRateLimitMessage(
  action: 'signup' | 'resend' | 'login' | 'reset',
  cooldownSeconds?: number,
): string {
  const waitText = cooldownSeconds && cooldownSeconds > 0
    ? `Please wait ${cooldownSeconds} seconds before requesting another email.`
    : 'Please wait a short while before trying again.';

  switch (action) {
    case 'signup':
      return `Email delivery rate limit reached. The authentication server limits email requests to prevent abuse. If you just registered, your account may already have been created. ${waitText} Check your spam or junk folder in the meantime.`;
    case 'resend':
      return `Email delivery is temporarily rate-limited. ${waitText} Please check your spam or junk folder before requesting again.`;
    case 'reset':
      return `Password reset requests are temporarily rate-limited. ${waitText}`;
    case 'login':
    default:
      return `Too many verification requests. ${waitText}`;
  }
}

/**
 * Identifies whether an error or response indicates an existing account with the same email.
 */
export function isDuplicateAccountError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error
    ? err.message
    : typeof (err as Record<string, unknown>).message === 'string'
      ? (err as Record<string, string>).message
      : '';
  return /already registered|already in use|user_already_exists|already exists/i.test(msg);
}

