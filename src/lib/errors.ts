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
