import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../lib/supabase';
import { extractStructuredError } from '../lib/errors';
import { isDocumentStatus, type DocumentStatus } from '../lib/status';

export type HelpRequestUrgency = 'low' | 'medium' | 'high' | 'critical';

export const URGENCY_VALUES: readonly HelpRequestUrgency[] = ['low', 'medium', 'high', 'critical'];

export function isHelpRequestUrgency(value: unknown): value is HelpRequestUrgency {
  return typeof value === 'string' && (URGENCY_VALUES as readonly string[]).includes(value);
}

/**
 * The statuses the PUBLIC site is allowed to read.
 *
 * The only status this product ever moves a request to that is meant to be
 * visible to anonymous visitors is `published`, written by
 * public.publish_help_request(). `draft`, `submitted`, `under_review` and
 * `verified` are all in-flight and `rejected` is a dead end, so none of them may
 * ever be returned from a public query. This is the client half of the
 * restriction; the RLS policy "Public can view published requests" is the
 * authoritative half and is preserved in the database.
 */
export const PUBLIC_REQUEST_STATUSES = ['published'] as const;

export interface HelpRequestDraftInput {
  title: string;
  description: string;
  categoryId: string;
  urgency: HelpRequestUrgency;
  targetAmount: number;
  locationCity: string;
  locationState: string;
}

export interface HelpRequestDraftResult {
  id: string;
  status: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  /** Real copy stored on the `categories` row. Null when the column is absent. */
  description: string | null;
}

/**
 * Reads the live signed-in user id from the Supabase session.
 *
 * Every identity used by this module comes from here and never from a prop, a
 * form field, or a URL. The browser therefore has no value it could substitute
 * for `auth.uid()`: `requester_id` is taken from the session and cross-checked
 * against the RLS policy, which independently requires
 * `requester_id = auth.uid()`.
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[helpRequests] could not read the current session', error.message);
    return null;
  }
  return data.session?.user?.id ?? null;
}

/** A plain, user-safe failure object used across the requester-facing services. */
export interface HelpRequestServiceFailure {
  message: string;
  code: string;
}

const NOT_SIGNED_IN: HelpRequestServiceFailure = {
  message: 'You must be signed in to do that. Please sign in and try again.',
  code: '28000',
};

/**
 * The public bucket for help request cover images.
 * Unlike request-documents, this bucket is public and holds only non-sensitive cover imagery.
 */
export const REQUEST_IMAGES_BUCKET = 'request-images';

/**
 * Derives the public URL for a stored cover image path.
 * Returns null if no path is provided.
 */
export function getRequestCoverImageUrl(imagePath?: string | null): string | null {
  if (!imagePath || typeof imagePath !== 'string') return null;
  const trimmed = imagePath.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  try {
    const { data } = supabase.storage?.from(REQUEST_IMAGES_BUCKET)?.getPublicUrl(trimmed) ?? {};
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

export interface PublicHelpRequest {
  id: string;
  title: string;
  description: string;
  status: string;
  urgency: HelpRequestUrgency;
  categoryId: string | null;
  targetAmount: number | null;
  raisedAmount: number | null;
  locationCity: string | null;
  locationState: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  imagePath: string | null;
  imageUrl: string | null;
  isDemo?: boolean;
}

export interface PublicHelpRequestDetail extends PublicHelpRequest {
  updatedAt: string | null;
}

export interface PublicQueryResult<T> {
  data: T;
  error: HelpRequestServiceFailure | null;
}

/**
 * Columns that are safe to expose to an anonymous visitor.
 *
 * requester_id, reviewed_by, verification_notes, rejection_reason and every
 * other internal or staff-only column is deliberately absent, so it cannot leak
 * through this SELECT even if the RLS policy were later widened by mistake.
 */
const PUBLIC_COLUMNS =
  'id, title, description, status, urgency, category_id, target_amount, raised_amount, ' +
  'location_city, location_state, published_at, created_at, image_path, is_demo';

function toPublicRequest(row: Record<string, unknown>): PublicHelpRequest {
  const imagePath = (row.image_path as string | null) ?? null;
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    description: String(row.description ?? ''),
    status: String(row.status ?? ''),
    urgency: isHelpRequestUrgency(row.urgency) ? row.urgency : 'low',
    categoryId: (row.category_id as string | null) ?? null,
    targetAmount: (row.target_amount as number | null) ?? null,
    raisedAmount: (row.raised_amount as number | null) ?? null,
    locationCity: (row.location_city as string | null) ?? null,
    locationState: (row.location_state as string | null) ?? null,
    publishedAt: (row.published_at as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
    imagePath,
    imageUrl: getRequestCoverImageUrl(imagePath),
    isDemo: Boolean(row.is_demo),
  };
}

function publicReadFailure(
  action: 'list' | 'detail',
  raw: unknown,
): HelpRequestServiceFailure {
  return {
    message:
      action === 'list'
        ? 'Published help requests could not be loaded. Please try again.'
        : 'This help request could not be loaded. Please try again.',
    code: extractStructuredError(raw)?.code ?? '',
  };
}

/**
 * Retrieve the published help requests that are visible to unauthenticated
 * visitors.
 *
 * Only `status = 'published'` is requested. A draft, a submission, a request
 * under review, a merely-verified request and a rejected one are all excluded
 * twice over: by this filter and by the existing RLS SELECT policy. A database
 * error is RETURNED, never swallowed, so the page can tell "there is nothing
 * published yet" apart from "the query failed" — the two look identical if a
 * failure is collapsed into an empty array.
 *
 * No service_role key is involved: this runs on the anon/authenticated session
 * and is authorised entirely by RLS.
 */
export const PUBLIC_PAGE_SIZE = 12;
const PUBLIC_MAX_PAGE_SIZE = 60;

export interface PublicPageOptions {
  /** Rows to skip, for "load more". */
  offset?: number;
  /** Rows to return. Clamped to PUBLIC_MAX_PAGE_SIZE. */
  limit?: number;
}

export interface PublicPageResult {
  rows: PublicHelpRequest[];
  /** True when the server may have more rows beyond this page. */
  hasMore: boolean;
  error: HelpRequestServiceFailure | null;
}

/**
 * Paginated public request list.
 *
 * The original `getPublicHelpRequests()` had no LIMIT, so it asked Postgres for
 * every published row on every load of the landing page and the browse page. It
 * is retained for the small internal callers that genuinely want the whole set,
 * but anything user-facing uses this function so response size stays bounded as
 * the table grows.
 *
 * One extra row is requested to detect `hasMore` without a second COUNT query.
 */
export async function getPublicHelpRequestsPage(
  options: PublicPageOptions = {},
): Promise<PublicPageResult> {
  const limit = Math.min(
    Math.max(1, Math.floor(options.limit ?? PUBLIC_PAGE_SIZE)),
    PUBLIC_MAX_PAGE_SIZE,
  );
  const offset = Math.max(0, Math.floor(options.offset ?? 0));

  const { data, error } = await supabase
    .from('help_requests')
    .select(PUBLIC_COLUMNS)
    .in('status', [...PUBLIC_REQUEST_STATUSES])
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit);

  if (error) {
    console.error('Error fetching public help requests page:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return { rows: [], hasMore: false, error: publicReadFailure('list', error) };
  }

  const all = ((data ?? []) as unknown as Record<string, unknown>[]).map(toPublicRequest);
  return {
    rows: all.slice(0, limit),
    hasMore: all.length > limit,
    error: null,
  };
}

export async function getPublicHelpRequests(): Promise<PublicQueryResult<PublicHelpRequest[]>> {
  const { data, error } = await supabase
    .from('help_requests')
    .select(PUBLIC_COLUMNS)
    .in('status', [...PUBLIC_REQUEST_STATUSES])
    .order('published_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error('Error fetching public help requests:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return { data: [], error: publicReadFailure('list', error) };
  }

  return {
    data: ((data ?? []) as unknown as Record<string, unknown>[]).map(toPublicRequest),
    error: null,
  };
}

/**
 * Exact number of published requests, counted by the database.
 *
 * A headline figure must never be inferred from a page of rows. Reporting
 * "60 live requests" because a bounded query happened to return 60 is a
 * fabricated statistic: the real total could be anything larger. PostgREST's
 * `count: 'exact'` with `head: true` performs a real COUNT server-side and
 * returns no row bodies, so the number is exact for any table size.
 *
 * Reads only the public projection under the same RLS policy as the list, so it
 * needs no elevated access.
 */
export async function countPublicHelpRequests(): Promise<{
  count: number | null;
  error: HelpRequestServiceFailure | null;
}> {
  const { count, error } = await supabase
    .from('help_requests')
    .select('id', { count: 'exact', head: true })
    .in('status', [...PUBLIC_REQUEST_STATUSES]);

  if (error) {
    console.error('Error counting public help requests:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return { count: null, error: publicReadFailure('list', error) };
  }

  return { count: count ?? 0, error: null };
}

/**
 * Every published request, paged internally.
 *
 * The impact page sums `target_amount` and counts distinct cities across ALL
 * published rows, so it cannot read one bounded page — a partial sum presented
 * as a total is a false figure. Each network response stays bounded at
 * PUBLIC_MAX_PAGE_SIZE; only the in-memory accumulation grows. `truncated`
 * reports honestly if the safety cap is ever reached, so the caller can label
 * the figure rather than pass off a partial aggregate as complete.
 */
export async function getAllPublicHelpRequests(
  maxRows = 5000,
): Promise<{ rows: PublicHelpRequest[]; truncated: boolean; error: HelpRequestServiceFailure | null }> {
  const rows: PublicHelpRequest[] = [];
  let offset = 0;

  for (;;) {
    const page = await getPublicHelpRequestsPage({ limit: PUBLIC_MAX_PAGE_SIZE, offset });
    if (page.error) {
      return { rows, truncated: false, error: page.error };
    }
    if (page.rows.length === 0) {
      return { rows, truncated: false, error: null };
    }
    rows.push(...page.rows);
    if (!page.hasMore || rows.length >= maxRows) {
      return { rows, truncated: page.hasMore, error: null };
    }
    offset += page.rows.length;
  }
}

/**
 * Fetch a single public help request by id.
 *
 * A row whose status is anything other than `published` is treated exactly like
 * a row that does not exist, so a draft or a rejected request cannot be probed
 * for existence by walking ids.
 */
export async function getHelpRequestById(
  id: string,
): Promise<{ data: PublicHelpRequestDetail | null; error: HelpRequestServiceFailure | null }> {
  if (!id) {
    return { data: null, error: { message: 'That request reference is not valid.', code: '' } };
  }

  const { data, error } = await supabase
    .from('help_requests')
    .select(`${PUBLIC_COLUMNS}, updated_at`)
    .eq('id', id)
    .in('status', [...PUBLIC_REQUEST_STATUSES])
    .maybeSingle();

  if (error) {
    console.error('Error fetching public help request:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return { data: null, error: publicReadFailure('detail', error) };
  }

  if (!data) {
    return { data: null, error: null };
  }

  const row = data as unknown as Record<string, unknown>;
  return {
    data: { ...toPublicRequest(row), updatedAt: (row.updated_at as string | null) ?? null },
    error: null,
  };
}

/**
 * Fetch the active help request categories.
 *
 * Read with the anon/authenticated session; authorisation comes from the
 * existing public SELECT policy on `categories`. A database error is reported
 * rather than collapsed into an empty list, so a form can say "categories could
 * not be loaded" instead of silently offering no choices.
 */
export async function getCategories(): Promise<PublicQueryResult<Category[]>> {
  // `description` is a real column on `categories` (verified against the live
  // schema), so the homepage can show the organisation's own wording instead of
  // inventing a subtitle per category.
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, icon, description')
    .eq('is_active', true)
    .order('name');

  if (error) {
    console.error('Error fetching categories:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {
      data: [],
      error: { message: 'Help categories could not be loaded. Please try again.', code: error.code ?? '' },
    };
  }

  return {
    data: (((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ''),
      slug: (row.slug as string | null) ?? '',
      icon: (row.icon as string | null) ?? null,
      description: (row.description as string | null) ?? null,
    }))) as Category[],
    error: null,
  };
}

/**
 * Create a new draft help request owned by the signed-in user.
 *
 * `requester_id` is read from the live Supabase session — the same value the
 * database will see as auth.uid() — and never from form input, a prop, or a URL.
 *
 * `status` is deliberately NOT part of the payload. The column is NOT NULL with
 * DEFAULT 'draft', so the database decides the initial lifecycle state, and the
 * requester INSERT policy (requester_id = auth.uid() AND status = 'draft')
 * still passes because the default is applied before WITH CHECK is evaluated.
 * Sending it from here would only create a second place where the initial
 * status is declared, free to drift from the schema.
 */
export async function createHelpRequestDraft(
  input: HelpRequestDraftInput,
): Promise<{ data: HelpRequestDraftResult | null; error: Error | null }> {
  const requesterId = await getCurrentUserId();
  if (!requesterId) {
    return { data: null, error: new Error(NOT_SIGNED_IN.message) };
  }

  const { data, error } = await supabase
    .from('help_requests')
    .insert({
      requester_id: requesterId,
      title: input.title,
      description: input.description,
      category_id: input.categoryId,
      urgency: input.urgency,
      target_amount: input.targetAmount,
      location_city: input.locationCity,
      location_state: input.locationState,
    })
    .select('id, status')
    .single();

  if (error) {
    console.error('createHelpRequestDraft failed', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
  }

  return { data: data as HelpRequestDraftResult | null, error };
}

/**
 * Update an existing draft owned by the signed-in user.
 *
 * Exactly the seven requester-editable columns are written: title, description,
 * category_id, urgency, target_amount, location_city, location_state. No
 * lifecycle column appears in the payload — not status, not requester_id, not
 * reviewed_by, not verified_at, not published_at, not submitted_at, not
 * raised_amount — so the browser cannot reach them at all. The database
 * reinforces this: 20260927_secure_help_request_transitions.sql removed the
 * table-level UPDATE grant from `authenticated` and granted UPDATE on only these
 * seven columns, so a payload naming anything else is refused with 42501 before
 * RLS is consulted.
 *
 * `updated_at` is intentionally absent: it is not a granted column and is
 * maintained by the database's BEFORE UPDATE trigger. `id` cannot appear in a
 * PostgREST PATCH body either, and `created_at` is not granted.
 *
 * The `.eq('status', 'draft')` filter is a READ predicate, not a write, and
 * stays: it is what stops a stale tab from overwriting a request that has
 * already been submitted. Ownership remains enforced by the requester UPDATE
 * policy, which requires requester_id = auth.uid().
 */
export async function updateHelpRequestDraft(
  requestId: string,
  input: HelpRequestDraftInput,
): Promise<{ data: HelpRequestDraftResult | null; error: Error | null }> {
  if (!requestId) {
    return { data: null, error: new Error('A request id is required.') };
  }

  const { data, error } = await supabase
    .from('help_requests')
    .update({
      title: input.title,
      description: input.description,
      category_id: input.categoryId,
      urgency: input.urgency,
      target_amount: input.targetAmount,
      location_city: input.locationCity,
      location_state: input.locationState,
    })
    .eq('id', requestId)
    .eq('status', 'draft')
    .select('id, status')
    .maybeSingle();

  if (error) {
    console.error('updateHelpRequestDraft failed', {
      requestId,
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
  }

  if (!error && !data) {
    // No error, no row: the filter matched nothing. The request is not a draft
    // any more, or it is no longer ours. Either way it must not be reported as
    // a successful save.
    console.error('updateHelpRequestDraft matched no row', { requestId });
    return {
      data: null,
      error: new Error(
        'This request is no longer an editable draft, so nothing was saved. It may have already been submitted.',
      ),
    };
  }

  return { data: data as HelpRequestDraftResult | null, error };
}

/**
 * Machine-readable failure modes for submit_help_request. The SQL raises a
 * distinct SQLSTATE per cause, so the UI never has to match on message text to
 * tell "already submitted" apart from "not your request".
 */
export type SubmitFailure =
  | 'unauthenticated'
  | 'not-owner'
  | 'not-found'
  | 'not-a-draft'
  | 'unavailable'
  | 'failed';

/**
 * Failure returned by submitHelpRequest. `message` is already user-safe, so the
 * UI can show it as-is; `code` carries the raw SQLSTATE and is only rendered as
 * a development-only diagnostic. This is a plain object rather than an Error
 * because a PostgREST error is not one, and the submit path classifies by code
 * instead of by instanceof.
 */
export interface SubmitRequestError {
  kind: SubmitFailure;
  message: string;
  code: string;
}

/**
 * Failure modes raised by submit_help_request, keyed by SQLSTATE:
 *   28000  no session            -> the sign-in prompt is the right response
 *   42501  not the owner         -> ownership problem, NOT an auth problem
 *   P0002  request does not exist
 *   22023  the request is not a draft, so it cannot be submitted
 *   PGRST202  the function is not deployed (migration not applied yet)
 */
function classifySubmitError(err: unknown): { kind: SubmitFailure; message: string } {
  const structured = extractStructuredError(err);
  const code = structured?.code ?? '';

  if (code === '28000') {
    return { kind: 'unauthenticated', message: 'You must be signed in to submit a request.' };
  }
  if (code === '42501') {
    return {
      kind: 'not-owner',
      message: 'You can only submit your own requests.',
    };
  }
  if (code === 'P0002') {
    return {
      kind: 'not-found',
      message: 'This request could not be found. It may have already been submitted.',
    };
  }
  if (code === '22023') {
    return {
      kind: 'not-a-draft',
      message: 'This request is no longer a draft, so it cannot be submitted. It may have already been submitted.',
    };
  }
  if (code === 'PGRST202') {
    return {
      kind: 'unavailable',
      message: 'Submitting is temporarily unavailable. Please refresh the page and try again.',
    };
  }
  // The function writes the status and its audit row in one transaction, so
  // reaching here means nothing was committed.
  return {
    kind: 'failed',
    message: 'Your request could not be submitted. Nothing was changed — please try again.',
  };
}

/**
 * Transition an owned request from 'draft' to 'submitted'.
 *
 * Delegates to the SECURITY DEFINER function `submit_help_request`, which owns
 * the whole transition: it locks the row, checks that the caller is the owner
 * and that the request really is a draft, moves it to 'submitted', stamps
 * submitted_at, and writes the matching admin_actions row — all in one
 * transaction. If the audit write fails the status change is rolled back with
 * it, so a submission can never exist without its audit record.
 *
 * This replaced a direct `.update({ status: 'submitted' })` PATCH, which wrote
 * no audit row at all and depended entirely on a permissive RLS policy. The
 * browser now supplies exactly one value, p_request_id: the owner is auth.uid()
 * inside PostgreSQL, never a parameter.
 */
export async function submitHelpRequest(
  requestId: string,
): Promise<{ data: HelpRequestDraftResult | null; error: SubmitRequestError | null }> {
  const { data, error } = await supabase.rpc('submit_help_request', {
    p_request_id: requestId,
  });

  if (error) {
    const classified = classifySubmitError(error);
    // Token-safe diagnostic log for the exact submission failure.
    console.error('submitHelpRequest failed', {
      requestId,
      kind: classified.kind,
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
    return {
      data: null,
      error: { ...classified, code: (error as { code?: string }).code ?? '' },
    };
  }

  // The RPC echoes the committed row. It must match what was asked for before
  // success is reported, so a surprising payload can never render as a
  // submitted request the database did not actually move.
  const result = (data ?? null) as { id?: unknown; status?: unknown } | null;
  if (!result || result.id !== requestId || result.status !== 'submitted') {
    console.error('submitHelpRequest returned an unexpected payload', result);
    return {
      data: null,
      error: {
        kind: 'failed',
        message:
          'Your request could not be confirmed as submitted. Refresh the page to check its current status.',
        code: '',
      },
    };
  }

  return { data: { id: result.id as string, status: result.status as string }, error: null };
}

/**
 * Owner-scoped read of a single help record before submission.
 *
 * The owner is resolved from the live session and applied as a filter. It is
 * defence in depth and diagnostics only: the authoritative checks are the
 * requester SELECT policy (requester_id = auth.uid()) and, for the actual
 * status change, the SECURITY DEFINER function submit_help_request(), which
 * locks the row and re-checks ownership and status server-side.
 */
export async function getOwnedHelpRequestStatus(requestId: string) {
  const requesterId = await getCurrentUserId();
  if (!requesterId) {
    return {
      data: null,
      error: new Error(NOT_SIGNED_IN.message),
    };
  }

  const { data, error } = await supabase
    .from('help_requests')
    .select('id, status')
    .eq('id', requestId)
    .eq('requester_id', requesterId)
    .maybeSingle();

  if (error) {
    console.error('getOwnedHelpRequestStatus failed', {
      requestId,
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
    return { data: null, error };
  }

  return { data: data as { id: string; status: string } | null, error: null };
}

/**
 * Private storage bucket used for requester documents. It must stay private;
 * this code only reads/writes it through authenticated, owner-scoped calls.
 */
export const DOCUMENT_BUCKET = 'request-documents';

/**
 * Reasonable client-side upload limits. Server policies remain the source of
 * truth; these limits exist to give users prompt, understandable feedback.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_DOCUMENTS_PER_REQUEST = 10;
export const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'] as const;

/**
 * The complete set of values this client will ever write to
 * help_request_documents.document_type.
 *
 * Evidence: document_type is NOT an enum — it is absent from the project's
 * pg_enum list (document_status / request_status / urgency_level / user_role
 * only) — and the column is NOT NULL with no default, so the client must always
 * supply a value. It is a constrained text column, so the client pins itself to
 * exactly these three lowercase tokens and never invents a fourth.
 *
 * '.jpeg' and '.jpg' are both normalised to 'jpg' so a single canonical token
 * is stored regardless of which extension the user picked.
 */
export const DOCUMENT_TYPES = ['pdf', 'jpg', 'png'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface HelpRequestDocumentRecord {
  id: string;
  requestId: string;
  storagePath: string;
  uploadedBy: string;
  createdAt: string;
  /**
   * The document's own verification state, read from the real `status` column
   * (document_status: pending | verified | rejected).
   *
   * This is requester-safe by design: it is the outcome of staff checking a file
   * the requester themselves uploaded, and they are entitled to know whether it
   * was accepted. It is NOT the reviewer's reasoning — `admin_actions.notes` is
   * never selected anywhere in this module.
   */
  status: DocumentStatus;
  /** Null for records the server did not populate (e.g. an optimistic entry). */
  documentType: DocumentType | null;
}

/**
 * Normalized error returned by help-request services. It always carries a
 * human message plus, when available, the raw technical fields from the
 * Supabase client (PostgREST for database rows, storage-js for Storage).
 * `source` tells the UI whether the failure happened in the private bucket or
 * in the help_request_documents table, so the two are never conflated. Keep
 * this token-free: it is safe to show in the development console.
 */
export type HelpRequestServiceErrorSource =
  | 'storage-upload'
  | 'storage-cleanup'
  | 'storage-remove'
  | 'document-url'
  | 'documents-insert'
  | 'documents-delete'
  | 'documents-list';

export interface HelpRequestServiceError {
  source: HelpRequestServiceErrorSource;
  message: string;
  name?: string;
  code?: string;
  status?: string | number;
  details?: string;
  hint?: string;
}

/**
 * Extracts the technical fields carried by a Supabase storage-js error
 * (StorageApiError, StorageUnknownError) or a plain PostgREST object, when
 * they are present. Every field is read defensively because error shapes vary
 * across SDK versions. Only token-safe scalar fields are copied.
 */
function errorFields(err: unknown): {
  name?: string;
  code?: string;
  status?: string | number;
  details?: string;
  hint?: string;
} {
  if (!err || typeof err !== 'object') return {};
  const e = err as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
  const statusVal = e.status ?? e.statusCode;
  const status =
    typeof statusVal === 'number' || typeof statusVal === 'string' ? statusVal : undefined;
  const body = e.error;
  const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const bodyMessage = bodyObj ? str(bodyObj.message) : str(body);
  return {
    name: str(e.name),
    code: str(e.code) ?? (bodyObj ? str(bodyObj.code) : undefined),
    status,
    details: bodyMessage ? (bodyMessage !== str(e.message) ? bodyMessage : undefined) : undefined,
    hint: str(e.hint),
  };
}

const SAFE_STORAGE_ID_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const SAFE_STORAGE_FILENAME = /^[a-zA-Z0-9._-]+$/;

const CANONICAL_MIME_BY_DOC_TYPE: Record<DocumentType, (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number]> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/**
 * Validates and decomposes a private document storage path of the canonical form:
 * `{userId}/{requestId}/{uuid}-{sanitizedFilename}`.
 * Rejects empty segments, path traversal (`..`), backslashes, and extra folder levels.
 */
export function parseValidatedDocumentPath(
  storagePath: string,
): { userId: string; requestId: string; fileName: string } | null {
  if (!storagePath || typeof storagePath !== 'string') return null;
  if (storagePath.includes('\\') || storagePath.includes('..')) return null;

  const segments = storagePath.split('/');
  if (segments.length !== 3) return null;

  const [userId, requestId, fileName] = segments;
  if (!SAFE_STORAGE_ID_SEGMENT.test(userId) || !SAFE_STORAGE_ID_SEGMENT.test(requestId)) {
    return null;
  }
  if (!fileName || !SAFE_STORAGE_FILENAME.test(fileName) || fileName.startsWith('.')) {
    return null;
  }

  return { userId, requestId, fileName };
}

/**
 * Client-side validation for a document file. Returns a human-readable problem
 * string when the file is not acceptable, or null when it can be uploaded.
 */
export function validateDocumentFile(file: File): string | null {
  const dotIndex = file.name.lastIndexOf('.');
  const ext = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : '';
  const mime = file.type.toLowerCase();
  const typeAllowed =
    mime === '' ||
    mime === 'image/jpg' ||
    (ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mime);
  const extAllowed = (ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(ext);
  if (!typeAllowed || !extAllowed) {
    return 'Only PDF, JPG, or PNG files are allowed.';
  }
  // Second gate: ensure extension and MIME type agree and resolve to a valid DocumentType.
  if (!resolveDocumentType(file)) {
    return 'Only PDF, JPG, or PNG files are allowed.';
  }
  if (file.size <= 0) {
    return 'The selected file is empty. Please choose a different file.';
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return 'This file is larger than the 5 MB limit. Please choose a smaller file.';
  }
  return null;
}

/**
 * Derives `document_type` from the actual uploaded file, never from a
 * hard-coded constant. Returns one of DOCUMENT_TYPES, or null when the file is
 * not a type this app accepts or when the extension and MIME type conflict.
 *
 * Returning null (instead of guessing a default such as 'pdf') is deliberate:
 * document_type is NOT NULL, and writing a value that mislabels the file would
 * corrupt review data. A null is caught by validateDocumentFile before any
 * Storage or database write happens, so no partial upload is ever created.
 */
export function resolveDocumentType(file: File): DocumentType | null {
  const name = file.name.toLowerCase();
  const dotIndex = name.lastIndexOf('.');
  const ext = dotIndex >= 0 ? name.slice(dotIndex) : '';
  const mime = file.type.toLowerCase();

  let extType: DocumentType | null = null;
  if (ext === '.pdf') extType = 'pdf';
  else if (ext === '.jpg' || ext === '.jpeg') extType = 'jpg';
  else if (ext === '.png') extType = 'png';

  let mimeType: DocumentType | null = null;
  if (mime === 'application/pdf') mimeType = 'pdf';
  else if (mime === 'image/jpeg' || mime === 'image/jpg') mimeType = 'jpg';
  else if (mime === 'image/png') mimeType = 'png';
  else if (mime !== '') {
    // Non-empty unrecognized MIME type must never be accepted even if the filename ends in .pdf/.jpg/.png
    return null;
  }

  if (extType && mimeType && extType !== mimeType) {
    return null;
  }

  return extType ?? mimeType;
}

function sanitizeDocumentName(name: string): string {
  const baseName = (name.split(/[/\\]/).pop() ?? name).trim();
  const dotIndex = baseName.lastIndexOf('.');
  const rawExt = dotIndex > 0 ? baseName.slice(dotIndex).toLowerCase() : '';
  const ext = (ALLOWED_DOCUMENT_EXTENSIONS as readonly string[]).includes(rawExt) ? rawExt : '';
  const rawStem = ext ? baseName.slice(0, dotIndex) : baseName;

  const maxStemLength = Math.max(1, 60 - ext.length);
  const cleanedStem = rawStem
    .replace(/[^a-zA-Z0-9.\-_]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, maxStemLength)
    .replace(/[.\-_]+$/g, '');

  const safeStem = cleanedStem || 'document';
  return `${safeStem}${ext}`;
}

/**
 * Builds a private storage path owned by the authenticated user:
 * {userId}/{requestId}/{uuid}-{sanitizedFilename}. The user id and request id
 * are always derived from the authenticated session / saved draft, never from
 * free-form user input.
 */
export function buildDocumentStoragePath(userId: string, requestId: string, file: File): string {
  if (!SAFE_STORAGE_ID_SEGMENT.test(userId) || !SAFE_STORAGE_ID_SEGMENT.test(requestId)) {
    throw new Error('Invalid user or request identifier for document storage path.');
  }
  return `${userId}/${requestId}/${crypto.randomUUID()}-${sanitizeDocumentName(file.name)}`;
}

/**
 * Human-friendly label for a document: just the original filename portion of
 * the private storage path. The full path is never shown in the UI.
 */
export function getDocumentDisplayName(storagePath: string): string {
  const leaf = storagePath.split('/').pop() ?? storagePath;
  return leaf.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/,
    '',
  );
}

/**
 * Lists documents attached to a request. Only rows the current user is allowed
 * to read (owner-scoped via RLS) are returned.
 */
export async function listHelpRequestDocuments(requestId: string) {
  // `status` (document_status) and `document_type` are the two extra columns the
  // requester detail page needs. Both are facts about the requester's OWN
  // uploaded file, readable by them under "Requesters can view own documents"
  // (uploaded_by = auth.uid()). No staff note, reviewer id or admin_action is
  // selected, so this cannot widen what the owner learns.
  const { data, error } = await supabase
    .from('help_request_documents')
    .select('id, request_id, storage_path, uploaded_by, created_at, status, document_type')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error listing help request documents:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
      details: (error as { details?: string }).details ?? null,
      hint: (error as { hint?: string }).hint ?? null,
    });
    return {
      data: null,
      error: {
        source: 'documents-list',
        message: 'Saved documents could not be loaded.',
        ...errorFields(error),
      },
    };
  }

  return {
    data: (((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      requestId: String(row.request_id),
      storagePath: String(row.storage_path),
      uploadedBy: String(row.uploaded_by),
      createdAt: String(row.created_at ?? ''),
      status: isDocumentStatus(row.status) ? row.status : 'pending',
      documentType: (DOCUMENT_TYPES as readonly string[]).includes(String(row.document_type))
        ? (row.document_type as DocumentType)
        : null,
    }))) as HelpRequestDocumentRecord[],
    error: null,
  };
}

/**
 * Uploads a single document for a saved request.
 *
 * The uploader identity is read from the live session inside this function, so
 * the storage path prefix and the `uploaded_by` column are both the database's
 * idea of the caller rather than anything the caller passed in. The object is
 * written to the PRIVATE `request-documents` bucket first; only on success is a
 * matching help_request_documents row inserted with the storage path — never a
 * public URL. If the row insert fails, the just-uploaded object is removed so no
 * orphaned private file is left behind, and the user is told which of the two
 * steps went wrong.
 */
export async function uploadHelpRequestDocument(params: {
  requestId: string;
  file: File;
  /** Called with 0–100 as bytes reach Storage. Omit for an indeterminate bar. */
  onProgress?: (percent: number) => void;
}): Promise<{
  data: HelpRequestDocumentRecord | null;
  error: HelpRequestServiceError | null;
}> {
  const { requestId, file, onProgress } = params;

  const userId = await getCurrentUserId();
  if (!userId) {
    return {
      data: null,
      error: { source: 'storage-upload', message: NOT_SIGNED_IN.message, code: NOT_SIGNED_IN.code },
    };
  }

  if (!SAFE_STORAGE_ID_SEGMENT.test(requestId) || !SAFE_STORAGE_ID_SEGMENT.test(userId)) {
    return {
      data: null,
      error: {
        source: 'storage-upload',
        message: 'A valid request reference is required before uploading documents.',
      },
    };
  }

  // Validate file extension, MIME consistency, non-zero size, and <= 5 MB BEFORE touching Storage.
  const validationMessage = validateDocumentFile(file);
  const documentType = resolveDocumentType(file);
  if (validationMessage || !documentType) {
    return {
      data: null,
      error: {
        source: 'storage-upload',
        message: validationMessage ?? 'Only PDF, JPG, or PNG files are allowed.',
      },
    };
  }

  // {userId}/{requestId}/{uuid}-{filename}: owner-scoped, request-scoped, and
  // collision-free, so two requesters can never address each other's objects.
  const storagePath = buildDocumentStoragePath(userId, requestId, file);
  const canonicalContentType = CANONICAL_MIME_BY_DOC_TYPE[documentType];

  const upload = await uploadObjectToPrivateBucket({
    bucket: DOCUMENT_BUCKET,
    path: storagePath,
    file,
    contentType: canonicalContentType,
    onProgress,
  });

  if (upload.error) {
    const uploadError = upload.error as {
      message?: string;
      statusCode?: string | number;
      name?: string;
    };
    // The object was rejected by the private bucket. No row is written.
    console.error('Document upload rejected by Storage:', {
      bucket: DOCUMENT_BUCKET,
      status: uploadError.statusCode ?? null,
      name: uploadError.name ?? null,
      message: uploadError.message ?? 'unknown',
    });
    return {
      data: null,
      error: {
        source: 'storage-upload',
        // Deliberately NOT uploadError.message: a Storage rejection can echo
        // bucket internals. The technical fields are carried alongside for the
        // development console only.
        message: 'This document could not be uploaded. Please try again.',
        ...errorFields(uploadError),
      },
    };
  }

  // Storage-first, then the database row. Only these four real columns are
  // written: request_id, storage_path, uploaded_by, document_type. No public
  // URL is ever generated or stored.
  const { error: insertError } = await supabase
    .from('help_request_documents')
    .insert({
      request_id: requestId,
      storage_path: storagePath,
      uploaded_by: userId,
      document_type: documentType,
    });

  if (insertError) {
    const cleanup = await supabase.storage.from(DOCUMENT_BUCKET).remove([storagePath]);
    if (cleanup.error) {
      console.error('Upload row insert failed and storage cleanup also failed:', {
        insertError,
        cleanupError: cleanup.error,
        storagePath,
      });
      return {
        data: null,
        error: {
          source: 'storage-cleanup',
          message:
            'The file was uploaded but could not be saved to your request, and the file could not be removed. Please contact support.',
          ...errorFields(cleanup.error),
        },
      };
    }
    console.error('Document row insert failed; uploaded object was cleaned up:', {
      code: (insertError as { code?: string }).code ?? null,
      message: insertError.message,
      details: (insertError as { details?: string }).details ?? null,
      hint: (insertError as { hint?: string }).hint ?? null,
    });
    return {
      data: null,
      error: {
        source: 'documents-insert',
        message: 'The file was uploaded but could not be attached to your request.',
        ...errorFields(insertError),
      },
    };
  }

  onProgress?.(100);

  return {
    data: {
      id: '',
      requestId,
      storagePath,
      uploadedBy: userId,
      createdAt: new Date().toISOString(),
      // Newly uploaded evidence starts unreviewed. The column's own default is
      // 'pending', and staff move it through set_document_verification_status.
      status: 'pending',
      documentType,
    },
    error: null,
  };
}

/**
 * Upload one file to the PRIVATE `request-documents` bucket, reporting progress.
 *
 * WHY THIS IS NOT `supabase.storage.from(bucket).upload(...)`
 * ------------------------------------------------------
 * supabase-js v2 issues the Storage POST through `fetch`, which exposes no
 * upload-progress events. A 5 MB document on a slow connection therefore showed
 * a spinner with no feedback at all, and a user who was unsure whether anything
 * was happening would reasonably press the button again. XMLHttpRequest is the
 * only browser API that reports `upload.onprogress`, so the upload is performed
 * directly against the documented Storage endpoint:
 *
 *     POST {SUPABASE_URL}/storage/v1/object/{bucket}/{path}?upsert=false
 *
 * SECURITY — identical to the SDK call it replaces:
 *   * `Authorization: Bearer <access token>` is read from the LIVE SESSION. It
 *     is never a value the caller supplies, so the identity authorising the
 *     write is the same one RLS sees as auth.uid().
 *   * `apikey` is the project's PUBLISHABLE key, which is already in the bundle
 *     and grants nothing on its own. No service_role key is involved.
 *   * Authorisation is still enforced server-side by the storage.objects INSERT
 *     policy scoped to the caller's own folder. A forged path is rejected by the
 *     database, not by anything in this function.
 *   * The bucket stays private. Nothing here returns or stores a URL.
 *
 * If XHR is unavailable the SDK upload is used as a fallback, so functionality
 * degrades to "no progress bar" rather than to "cannot upload".
 */
async function uploadObjectToPrivateBucket(params: {
  bucket: string;
  path: string;
  file: File;
  contentType: string;
  onProgress?: (percent: number) => void;
}): Promise<{ error: unknown | null }> {
  const { bucket, path, file, contentType, onProgress } = params;

  const useXhr = typeof XMLHttpRequest !== 'undefined' && Boolean(SUPABASE_URL);
  if (!useXhr) {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, file, { contentType, upsert: false });
    onProgress?.(100);
    return { error };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session?.access_token) {
    return { error: sessionError ?? new Error('No active session for storage upload.') };
  }

  return new Promise<{ error: unknown | null }>((resolve) => {
    const xhr = new XMLHttpRequest();
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const url = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}?upsert=false`;

    xhr.open('POST', url, true);
    xhr.setRequestHeader('authorization', `Bearer ${sessionData.session.access_token}`);
    if (SUPABASE_PUBLISHABLE_KEY) {
      xhr.setRequestHeader('apikey', SUPABASE_PUBLISHABLE_KEY);
    }
    xhr.setRequestHeader('content-type', contentType);
    xhr.setRequestHeader('x-upsert', 'false');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total === 0) return;
      onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };

    xhr.onerror = () => {
      // A network-level failure never reached Storage, so no object exists and
      // there is nothing to clean up.
      onProgress?.(0);
      resolve({ error: Object.assign(new Error('Network error during upload.'), { name: 'UploadNetworkError' }) });
    };

    xhr.onabort = () => {
      onProgress?.(0);
      resolve({ error: Object.assign(new Error('Upload aborted.'), { name: 'UploadAbortedError' }) });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve({ error: null });
        return;
      }
      let message = `Storage rejected the upload (${xhr.status}).`;
      let code = '';
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string; code?: string };
        if (parsed.message) message = parsed.message;
        if (parsed.code) code = parsed.code;
      } catch {
        // Non-JSON error body (a proxy page, a gateway error). The status is
        // enough; the raw body is never shown to a user.
      }
      resolve({
        error: Object.assign(new Error(message), { name: 'StorageApiError', statusCode: xhr.status, code }),
      });
    };

    xhr.send(file);
  });
}

/**
 * Removes a document: deletes the storage object first and only then the
 * matching help_request_documents row. If the object cannot be deleted the row
 * is left untouched; if the row delete then fails, a clear error is returned
 * instead of claiming success. RLS restricts deletion to the owner.
 */
export async function removeHelpRequestDocument(params: {
  requestId: string;
  storagePath: string;
}): Promise<{ ok: boolean; error: HelpRequestServiceError | null }> {
  const { requestId, storagePath } = params;

  const parsedPath = parseValidatedDocumentPath(storagePath);
  if (!parsedPath || !SAFE_STORAGE_ID_SEGMENT.test(requestId)) {
    return {
      ok: false,
      error: {
        source: 'storage-remove',
        message: 'That document reference is not valid.',
      },
    };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return {
      ok: false,
      error: {
        source: 'storage-remove',
        message: NOT_SIGNED_IN.message,
        code: NOT_SIGNED_IN.code,
      },
    };
  }

  if (parsedPath.userId !== userId || parsedPath.requestId !== requestId) {
    return {
      ok: false,
      error: {
        source: 'storage-remove',
        message: 'You are not authorized to remove this document.',
        code: '42501',
      },
    };
  }

  const { error: storageError } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .remove([storagePath]);

  if (storageError) {
    const missing =
      storageError.statusCode === '404' ||
      /not found|no such object/i.test(storageError.message);
    return {
      ok: false,
      error: {
        source: 'storage-remove',
        message: missing
          ? 'The document could not be found in storage. It may have already been removed.'
          : 'This document could not be removed. Please try again.',
        ...errorFields(storageError),
      },
    };
  }

  const { error: rowError } = await supabase
    .from('help_request_documents')
    .delete()
    .eq('request_id', requestId)
    .eq('storage_path', storagePath);

  if (rowError) {
    return {
      ok: false,
      error: {
        source: 'documents-delete',
        message:
          'The file was removed from storage but the request record could not be updated. Please try removing it again.',
        ...errorFields(rowError),
      },
    };
  }

  return { ok: true, error: null };
}

/**
 * Mint a short-lived signed URL so the OWNER can open one of their own private
 * documents.
 *
 * The `request-documents` bucket stays private forever: this calls
 * `createSignedUrl` and never `getPublicUrl`, so no unauthenticated URL for a
 * requester document is ever produced, stored, or logged. Authorisation comes
 * from the storage.objects SELECT policy, which is scoped to the folder's first
 * path segment (the uploader's user id); a requester cannot mint a URL for
 * somebody else's document, and neither can a different user with a guessed
 * path.
 *
 * The URL is returned for immediate navigation only. It is never persisted, and
 * it expires after an hour.
 */
export async function createRequesterDocumentUrl(
  storagePath: string,
): Promise<{ data: { signedUrl: string } | null; error: HelpRequestServiceError | null }> {
  const parsedPath = parseValidatedDocumentPath(storagePath);
  if (!parsedPath) {
    return {
      data: null,
      error: { source: 'document-url', message: 'That document reference is not valid.' },
    };
  }

  const userId = await getCurrentUserId();
  if (!userId) {
    return {
      data: null,
      error: {
        source: 'document-url',
        message: NOT_SIGNED_IN.message,
        code: NOT_SIGNED_IN.code,
      },
    };
  }

  if (parsedPath.userId !== userId) {
    return {
      data: null,
      error: {
        source: 'document-url',
        message: 'You are not authorized to open this document.',
        code: '42501',
      },
    };
  }

  const { data, error } = await supabase.storage
    .from(DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, 3600, { download: false });

  if (error || !data?.signedUrl) {
    console.error('createRequesterDocumentUrl failed', {
      code: (error as { code?: string })?.code ?? null,
      message: error?.message ?? null,
    });
    return {
      data: null,
      error: {
        source: 'document-url',
        message: 'This document could not be opened.',
        ...errorFields(error),
      },
    };
  }

  return { data: { signedUrl: data.signedUrl }, error: null };
}

export interface UserHelpRequestSummary {
  id: string;
  title: string;
  description: string;
  status: string;
  urgency: HelpRequestUrgency;
  categoryId: string | null;
  targetAmount: number | null;
  raisedAmount: number | null;
  locationCity: string | null;
  locationState: string | null;
  createdAt: string;
  submittedAt: string | null;
  updatedAt: string | null;
  rejectionReason: string | null;
  /**
   * Always null. `help_requests` has no `resolved_at` column, so nothing is read
   * for it; it is kept so `lib/status` can keep taking a resolved timestamp and so
   * the shape stays stable if the column is ever added. Every consumer is
   * null-guarded, and the request_status enum already distinguishes
   * `resolved`/`closed` on its own.
   */
  resolvedAt: string | null;
  /** Number of evidence files attached, via a bounded count on the owner-scoped table. */
  documentCount: number;
}

export interface UserHelpRequestDetail extends UserHelpRequestSummary {
  verifiedAt: string | null;
  publishedAt: string | null;
}

/**
 * Columns an owner may read about their own request.
 *
 * `verification_notes` and `reviewed_by` are deliberately NOT selected: those
 * are internal staff working notes, and a requester is not entitled to the
 * reviewer's private reasoning. The owner does get `rejection_reason`, which is
 * written for them, and the lifecycle timestamps they need to track progress.
 *
 * `requester_id` is not selected either — the caller already knows they are the
 * owner, so the value would never be displayed and would only be one more
 * identity in browser memory.
 *
 * `resolved_at` is deliberately NOT selected: the column does not exist on
 * `help_requests`. PostgREST rejects the whole statement with 42703 for an
 * unknown column, so naming it here broke BOTH /my-requests and
 * /my-requests/:id outright rather than degrading one field. Do not re-add it
 * without first confirming the column exists.
 */
const OWNED_COLUMNS =
  'id, title, description, status, urgency, category_id, target_amount, raised_amount, ' +
  'location_city, location_state, created_at, submitted_at, updated_at, rejection_reason';

const OWNED_DETAIL_COLUMNS = `${OWNED_COLUMNS}, verified_at, published_at`;

/**
 * Number of evidence files per owned request, for the /my-requests list.
 *
 * A second, owner-scoped query rather than an embedded aggregate, because
 * PostgREST's embedded count needs `Prefer: count=exact` and returns the total
 * on every row; here only the ids are pulled (bounded, and capped well below
 * the 10-document-per-request limit) and counted in memory.
 *
 * `uploaded_by = auth.uid()` is applied as well as the request-id list. The
 * "Requesters can view own documents" SELECT policy scopes this to the caller
 * regardless, so a request id belonging to somebody else yields no rows.
 */
async function getDocumentCountsForOwner(
  requesterId: string,
  requestIds: string[],
): Promise<Record<string, number>> {
  if (requestIds.length === 0) return {};

  const { data, error } = await supabase
    .from('help_request_documents')
    .select('request_id')
    .eq('uploaded_by', requesterId)
    .in('request_id', requestIds)
    .limit(requestIds.length * MAX_DOCUMENTS_PER_REQUEST);

  if (error) {
    // Non-fatal: the list is still correct without the attachment count, so the
    // page simply omits the figure rather than failing the whole load.
    console.error('Document count lookup failed; continuing without counts:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {};
  }

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as { request_id: string }[]) {
    counts[row.request_id] = (counts[row.request_id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Fetch every help request owned by the signed-in user.
 *
 * The owner id is resolved from the live session inside this function, so a
 * caller cannot ask for somebody else's list, and the requester SELECT policy
 * independently guarantees `requester_id = auth.uid()` even if that filter were
 * removed. A query failure is returned as an error with an EMPTY list — the
 * caller must show the error rather than render "you have no requests".
 */
export async function getMyHelpRequests(): Promise<{
  data: UserHelpRequestSummary[];
  error: Error | null;
}> {
  const requesterId = await getCurrentUserId();
  if (!requesterId) {
    return { data: [], error: new Error(NOT_SIGNED_IN.message) };
  }

  const { data, error } = await supabase
    .from('help_requests')
    .select(OWNED_COLUMNS)
    .eq('requester_id', requesterId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyHelpRequests failed:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return { data: [], error: new Error('Your requests could not be loaded. Please try again.') };
  }

  const raw = (data ?? []) as unknown as Record<string, unknown>[];
  const documentCounts = await getDocumentCountsForOwner(
    requesterId,
    raw.map((row) => String(row.id)),
  );

  const rows: UserHelpRequestSummary[] = raw.map((row) => {
    const id = String(row.id);
    return {
      id,
      title: String(row.title ?? ''),
      description: String(row.description ?? ''),
      status: String(row.status ?? ''),
      urgency: isHelpRequestUrgency(row.urgency) ? row.urgency : 'low',
      categoryId: (row.category_id as string | null) ?? null,
      targetAmount: (row.target_amount as number | null) ?? null,
      raisedAmount: (row.raised_amount as number | null) ?? null,
      locationCity: (row.location_city as string | null) ?? null,
      locationState: (row.location_state as string | null) ?? null,
      createdAt: String(row.created_at ?? ''),
      submittedAt: (row.submitted_at as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? null,
      rejectionReason: (row.rejection_reason as string | null) ?? null,
      resolvedAt: (row.resolved_at as string | null) ?? null,
      documentCount: documentCounts[id] ?? 0,
    };
  });

  return { data: rows, error: null };
}

/**
 * Fetch a single help request owned by the signed-in user, with lifecycle
 * detail. Returns `{ data: null, error: null }` for a request that is not
 * visible to this user, which is deliberately the same answer as "no such id".
 */
export async function getOwnedHelpRequestById(
  requestId: string,
): Promise<{ data: UserHelpRequestDetail | null; error: Error | null }> {
  if (!requestId) {
    return { data: null, error: new Error('A request id is required.') };
  }

  const requesterId = await getCurrentUserId();
  if (!requesterId) {
    return { data: null, error: new Error(NOT_SIGNED_IN.message) };
  }

  const { data, error } = await supabase
    .from('help_requests')
    .select(OWNED_DETAIL_COLUMNS)
    .eq('id', requestId)
    .eq('requester_id', requesterId)
    .maybeSingle();

  if (error) {
    console.error('getOwnedHelpRequestById failed:', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return { data: null, error: new Error('This request could not be loaded. Please try again.') };
  }

  if (!data) {
    return { data: null, error: null };
  }

  const row = data as unknown as Record<string, unknown>;
  const id = String(row.id);
  const documentCounts = await getDocumentCountsForOwner(requesterId, [id]);

  return {
    data: {
      id,
      title: String(row.title ?? ''),
      description: String(row.description ?? ''),
      status: String(row.status ?? ''),
      urgency: isHelpRequestUrgency(row.urgency) ? row.urgency : 'low',
      categoryId: (row.category_id as string | null) ?? null,
      targetAmount: (row.target_amount as number | null) ?? null,
      raisedAmount: (row.raised_amount as number | null) ?? null,
      locationCity: (row.location_city as string | null) ?? null,
      locationState: (row.location_state as string | null) ?? null,
      createdAt: String(row.created_at ?? ''),
      submittedAt: (row.submitted_at as string | null) ?? null,
      updatedAt: (row.updated_at as string | null) ?? null,
      rejectionReason: (row.rejection_reason as string | null) ?? null,
      resolvedAt: (row.resolved_at as string | null) ?? null,
      verifiedAt: (row.verified_at as string | null) ?? null,
      publishedAt: (row.published_at as string | null) ?? null,
      documentCount: documentCounts[id] ?? 0,
    },
    error: null,
  };
}