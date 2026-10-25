import { supabase } from '../lib/supabase';
import { devErrorSuffix, extractStructuredError, isRlsError } from '../lib/errors';
import type { User } from '@supabase/supabase-js';
import {
  DOCUMENT_STATUSES,
  REQUEST_STATUSES,
  URGENCY_LEVELS,
  type DocumentStatus,
  type RequestStatus,
  type UrgencyLevel,
} from '../lib/status';
import {
  REQUEST_IMAGES_BUCKET,
  getRequestCoverImageUrl,
  parseValidatedDocumentPath,
} from './helpRequests';

/**
 * Staff request-review service.
 *
 * AUTHORIZATION MODEL
 * --------------------
 * Every read and write in this file is authorised by Postgres, not by this
 * code. The browser only ever filters and shapes what RLS already permits:
 *
 *   - help_requests            staff/admin SELECT policy (existing)
 *   - help_request_documents   staff/admin SELECT + UPDATE policies (existing)
 *   - admin_actions            staff/admin SELECT policy (existing)
 *   - request-documents bucket staff SELECT, private bucket, signed URLs only
 *
 * There is deliberately no service_role usage, no client-side role decision,
 * and no duplicate RLS policy. If a staff policy is removed in the database,
 * these calls fail closed with 42501 rather than silently succeeding.
 *
 * STATUS WRITES
 * -------------
 * This service performs NO direct write to help_requests and NO insert into
 * admin_actions. `authenticated` no longer holds table-level UPDATE on
 * help_requests, and every lifecycle transition is owned by a SECURITY DEFINER
 * function that moves the status and writes its audit row in one transaction:
 *
 *   - transition_help_request()        submitted -> under_review -> verified/rejected
 *   - set_document_verification_status()  document verification (unchanged)
 *
 * AUDIT INVARIANT
 * ---------------
 * A staff decision can no longer exist without its admin_actions row, and an
 * admin_actions row can no longer exist for a decision that did not take
 * effect. Neither half is achievable from the browser, because the two writes
 * happen inside one database transaction that either commits or rolls back.
 */

/* ------------------------------------------------------------------ types */

/**
 * Staff query types are ALIASES of the shared vocabulary in `lib/status`, not
 * second copies of it.
 *
 * This file previously re-declared `StaffRequestStatus`, `DocumentStatus`,
 * `StaffUrgency` and `STAFF_URGENCY_VALUES` as its own literals. That is the
 * exact duplication `lib/status` was written to end, and it was already costing
 * something: `StaffRequestStatus` listed only 5 of the 9 real request statuses,
 * so any query that needed `draft`/`active`/`resolved`/`closed` — the
 * dashboard's "recently published" section among them — could not be expressed
 * in the type at all. Aliasing the canonical unions means the database's real
 * vocabulary is the only one in the codebase, and a status added to
 * `REQUEST_STATUSES` is immediately usable everywhere.
 */
export type StaffRequestStatus = RequestStatus;
export type StaffUrgency = UrgencyLevel;

/** Re-exported so `import type { DocumentStatus } from '.../staffRequests'` works. */
export type { DocumentStatus };

/**
 * Runtime guards for the two vocabularies.
 *
 * These exist for URL input, not for internal callers. The staff list and
 * dashboard read a status from the query string, which is a raw string
 * controlled by whoever wrote the URL. A type assertion is not a filter, so the
 * value is checked against the real enum list before it can reach a query.
 * Rejecting an unknown status here is also what stops `?status=verified_at`
 * from being sent to PostgREST as a column filter on a column the requester is
 * not meant to probe.
 */
export function isStaffRequestStatus(value: unknown): value is StaffRequestStatus {
  return typeof value === 'string' && (REQUEST_STATUSES as readonly string[]).includes(value);
}

export function isStaffDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * The review queue is deliberately only the two states a reviewer changes FROM:
 * submitted and under_review.
 *
 * `verified` is NOT in this list, and that used to strand the lifecycle: once a
 * request was verified it left the queue entirely, so the only remaining
 * lifecycle action — publish_help_request() — became unreachable from the UI.
 * Verified requests are listed by `listStaffReadyToPublish` instead, so the two
 * views are disjoint and a reviewer is never shown work they cannot act on.
 */
export const STAFF_QUEUE_STATUSES = ['submitted', 'under_review'] as const satisfies readonly RequestStatus[];
export type StaffQueueStatus = (typeof STAFF_QUEUE_STATUSES)[number];

/** Requests a publisher can still act on. */
export const STAFF_PUBLISHABLE_STATUSES = ['verified'] as const satisfies readonly RequestStatus[];
export type StaffPublishableStatus = (typeof STAFF_PUBLISHABLE_STATUSES)[number];

/**
 * The urgency levels, re-exported from the single shared list so a staff screen
 * cannot offer an urgency the wizard does not collect, or vice versa.
 */
export const STAFF_URGENCY_VALUES = URGENCY_LEVELS;

export const STAFF_PAGE_SIZE = 25;
export const MAX_STAFF_PAGE_SIZE = 100;

export interface StaffRequestSummary {
  id: string;
  title: string;
  description: string;
  categoryId: string | null;
  urgency: StaffUrgency;
  status: StaffRequestStatus;
  targetAmount: number | null;
  raisedAmount: number | null;
  locationCity: string | null;
  locationState: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  submittedAt: string | null;
  /**
   * Moved up from `StaffRequestDetail` so queue rows can say when a request went
   * live. The dashboard's "recently published" section is ordered by this
   * column, and it previously had to display the *submitted* date beside it,
   * because the queue select did not include it — a list described as "most
   * recent first" showing an unrelated date.
   */
  publishedAt: string | null;
  imagePath: string | null;
  imageUrl: string | null;
}

export interface StaffRequestDetail extends StaffRequestSummary {
  requesterId: string;
  verifiedAt: string | null;
  verificationNotes: string | null;
  rejectionReason: string | null;
}

export interface StaffDocument {
  id: string;
  requestId: string;
  storagePath: string;
  uploadedBy: string;
  documentType: string | null;
  status: DocumentStatus;
  createdAt: string | null;
}

export type StaffErrorSource =
  | 'queue'
  | 'request'
  | 'documents-list'
  | 'document-url'
  | 'document-status'
  | 'cover-image'
  | 'audit'
  | 'transition';

export interface StaffError {
  source: StaffErrorSource;
  message: string;
  code?: string;
  details?: string;
  hint?: string;
  /**
   * Machine-readable failure mode. Present for document-status and request
   * transition RPC failures, where the UI needs to tell an actionable conflict
   * apart from a hard error without matching on message text.
   */
  kind?: DocumentRpcFailure | TransitionFailure;
}

export type StaffResult<T> = { data: T | null; error: StaffError | null };

/* -------------------------------------------------------------- utilities */

function toStaffError(source: StaffErrorSource, err: unknown, safeMessage: string): StaffError {
  const structured = extractStructuredError(err);
  if (!structured) {
    return { source, message: safeMessage };
  }
  return {
    source,
    message: safeMessage,
    code: structured.code || undefined,
    details: import.meta.env.DEV ? structured.details || undefined : undefined,
    hint: import.meta.env.DEV ? structured.hint || undefined : undefined,
  };
}

/** Append development-only technical detail to a staff-facing message. */
export function staffErrorText(error: StaffError): string {
  if (!import.meta.env.DEV) return error.message;
  const s = devErrorSuffix({
    code: error.code ?? '',
    message: error.message,
    details: error.details ?? '',
    hint: error.hint ?? '',
  });
  return `${error.message}${s}`;
}

/**
 * Neutralise a user-supplied search term before it reaches a PostgREST `.or()`
 * filter. That filter is a mini expression language, so an unsanitised value
 * containing commas, dots or parentheses could inject additional filter
 * clauses and widen the query. LIKE wildcards are escaped so the search is
 * literal, and the length is bounded to keep the URL sane.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw
    .replace(/\\/g, ' ')
    .replace(/[%_]/g, (c) => `\\${c}`)
    .replace(/[,().:*"'=!<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/** Bounded page window: never allow an unbounded or negative range. */
function clampPageSize(size: number): number {
  if (!Number.isFinite(size) || size < 1) return STAFF_PAGE_SIZE;
  return Math.min(Math.floor(size), MAX_STAFF_PAGE_SIZE);
}

function clampPage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.floor(page);
}

/**
 * Confirm the identity we were handed is the identity the live session holds.
 * This mirrors the check in the requester upload path. It is defence in depth:
 * `admin_id` is taken from the Supabase session, and the database policy is the
 * real enforcement, but refusing to act on a mismatched context avoids writing
 * an audit row attributed to a stale user object.
 */
async function assertSessionMatches(user: User): Promise<boolean> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[staff] could not read session', { message: error.message });
    return false;
  }
  return data.session?.user?.id === user.id;
}

/* ------------------------------------------------------------ queue query */

/**
 * Columns a staff list query is allowed to sort by.
 *
 * A whitelist, not a caller-supplied string. The dashboard needs a different
 * order for its "recent" sections than the queue does: "recently published"
 * means newest `published_at`, and "recently rejected" means newest
 * `updated_at` (a rejected request is terminal, so its `updated_at` IS the
 * moment it was rejected — there is no `rejected_at` column). Hard-coding one
 * order would have meant the "recent" lists were really "oldest first", which
 * is the opposite of useful.
 *
 * Only columns a staff member is already entitled to see are listed, and none of
 * them is requester PII, so ordering by them cannot become a side channel.
 */
export const STAFF_SORT_COLUMNS = {
  created: 'created_at',
  submitted: 'submitted_at',
  updated: 'updated_at',
  published: 'published_at',
} as const;

export type StaffSort = keyof typeof STAFF_SORT_COLUMNS;

export interface StaffQueueParams {
  search?: string;
  /**
   * A single lifecycle status, or 'all' for the default review set.
   *
   * Widened from the review-only pair to the full lifecycle vocabulary so the
   * queue can be deep-linked from a dashboard tile (`?status=verified`,
   * `?status=rejected`, `?status=published`). Those links used to be dead: the
   * queue read no URL state at all, so a click on a tile landed on the default
   * view and silently showed a different list than the number that was clicked.
   * `STAFF_QUEUE_STATUSES` still supplies the default for 'all'.
   */
  status?: StaffRequestStatus | 'all';
  urgency?: StaffUrgency | 'all';
  page?: number;
  pageSize?: number;
  /**
   * Restrict to a different fixed status set, e.g. STAFF_PUBLISHABLE_STATUSES.
   * Ignored when `status` is an explicit single status. Always one of the
   * project's own `as const` tuples, never caller-supplied strings.
   */
  statuses?: readonly StaffRequestStatus[];
  /** Sort column key. Defaults to `created`, which is what the queue wants. */
  sort?: StaffSort;
}

export interface StaffQueueResult {
  rows: StaffRequestSummary[];
  total: number;
  page: number;
  pageSize: number;
}

const QUEUE_COLUMNS =
  'id, title, description, category_id, urgency, status, target_amount, raised_amount, ' +
  'location_city, location_state, created_at, updated_at, submitted_at, published_at, image_path';

/**
 * Raw row shape returned by PostgREST for the queue/detail selects.
 *
 * The Supabase client in this project is intentionally untyped (no generated
 * Database generic), so query rows arrive as an opaque error-ish type. These
 * interfaces describe the exact columns selected above and are asserted at the
 * boundary. The column list and the field names here are kept in sync
 * deliberately: both are checked against the live schema.
 */
interface HelpRequestRow {
  id: string;
  title: string;
  description: string;
  category_id: string | null;
  urgency: string;
  status: string;
  target_amount: number | null;
  raised_amount: number | null;
  location_city: string | null;
  location_state: string | null;
  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
  image_path?: string | null;
  requester_id?: string;
  verified_at?: string | null;
  published_at?: string | null;
  verification_notes?: string | null;
  rejection_reason?: string | null;
}

/**
 * Loads the staff review queue from real data. Defaults to the two statuses
 * staff actually act on (submitted, under_review) and always applies a bounded
 * range so the query can never pull an unbounded result set.
 */
export async function listStaffReviewQueue(
  params: StaffQueueParams = {},
): Promise<StaffQueueResult & { error: StaffError | null }> {
  const page = clampPage(params.page ?? 1);
  const pageSize = clampPageSize(params.pageSize ?? STAFF_PAGE_SIZE);
  const from = (page - 1) * pageSize;

  const statuses: readonly StaffRequestStatus[] =
    params.status && params.status !== 'all'
      ? [params.status]
      : (params.statuses ?? STAFF_QUEUE_STATUSES);

  // `STAFF_SORT_COLUMNS` is a closed set, so this cannot become a way to order by
  // an arbitrary column. `!` on the status filter stops PostgREST's default
  // "relevance" ordering for a filtered list, which would otherwise produce a
  // non-deterministic order across pages.
  const sortColumn = STAFF_SORT_COLUMNS[params.sort ?? 'created'];

  let query = supabase
    .from('help_requests')
    .select(QUEUE_COLUMNS, { count: 'exact' })
    .in('status', statuses)
    .order(sortColumn, { ascending: false, nullsFirst: false })
    .range(from, from + pageSize - 1);

  if (params.urgency && params.urgency !== 'all') {
    query = query.eq('urgency', params.urgency);
  }

  const term = params.search ? sanitizeSearchTerm(params.search) : '';
  if (term) {
    query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('[staff] queue query failed', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {
      rows: [],
      total: 0,
      page,
      pageSize,
      error: toStaffError('queue', error, 'The review queue could not be loaded.'),
    };
  }

  const rows: StaffRequestSummary[] = ((data ?? []) as unknown as HelpRequestRow[]).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    categoryId: row.category_id ?? null,
    urgency: row.urgency as StaffUrgency,
    status: row.status as StaffRequestStatus,
    targetAmount: row.target_amount ?? null,
    raisedAmount: row.raised_amount ?? null,
    locationCity: row.location_city ?? null,
    locationState: row.location_state ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    submittedAt: row.submitted_at ?? null,
    publishedAt: row.published_at ?? null,
    imagePath: row.image_path ?? null,
    imageUrl: getRequestCoverImageUrl(row.image_path),
  }));

  return { rows, total: count ?? rows.length, page, pageSize, error: null };
}

/**
 * Requests that have been verified and are waiting to be published.
 *
 * This exists so the last lifecycle step is actually reachable. `verified` is
 * the only status from which `publish_help_request()` accepts a transition, and
 * a request in that state is not in the review queue, so without this list a
 * verified request would sit in the database with no way to finish it.
 *
 * Authorisation is unchanged: the read is authorised by the existing staff SELECT
 * policy, and the publish itself is still performed by the SECURITY DEFINER
 * function, never by a direct UPDATE from the browser.
 */
export async function listStaffReadyToPublish(
  params: Omit<StaffQueueParams, 'status' | 'statuses'> = {},
): Promise<StaffQueueResult & { error: StaffError | null }> {
  return listStaffReviewQueue({ ...params, statuses: STAFF_PUBLISHABLE_STATUSES });
}

/* ------------------------------------------------- single request + detail */

const DETAIL_COLUMNS = `${QUEUE_COLUMNS}, requester_id, verified_at, published_at, verification_notes, rejection_reason`;

/**
 * Loads one request for the review screen.
 *
 * Deliberately does NOT join or fetch the requester's profile. The staff UI
 * shows request content and city/state only, so no requester PII (name, phone,
 * email, avatar) is read, transmitted, or rendered. `requester_id` is returned
 * for internal reference but is not displayed.
 */
export async function getStaffRequestById(id: string): Promise<StaffResult<StaffRequestDetail>> {
  if (!id) {
    return {
      data: null,
      error: { source: 'request', message: 'That request reference is not valid.' },
    };
  }

  const { data, error } = await supabase
    .from('help_requests')
    .select(DETAIL_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    if (isRlsError(error) || (error as { code?: string }).code === 'PGRST116') {
      // RLS refusal and "no visible row" are deliberately reported identically
      // so a non-staff caller cannot use the response to probe which request
      // ids exist.
      return {
        data: null,
        error: { source: 'request', message: 'That request could not be found.' },
      };
    }
    console.error('[staff] request detail query failed', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {
      data: null,
      error: toStaffError('request', error, 'This request could not be loaded.'),
    };
  }

  if (!data) {
    return { data: null, error: { source: 'request', message: 'That request could not be found.' } };
  }

  // Safe: the `if (!data)` guard above has already narrowed this to a real row.
  const row = data as unknown as HelpRequestRow;

  return {
    data: {
      id: row.id,
      title: row.title,
      description: row.description,
      categoryId: row.category_id ?? null,
      urgency: row.urgency as StaffUrgency,
      status: row.status as StaffRequestStatus,
      targetAmount: row.target_amount ?? null,
      raisedAmount: row.raised_amount ?? null,
      locationCity: row.location_city ?? null,
      locationState: row.location_state ?? null,
      createdAt: row.created_at ?? null,
      updatedAt: row.updated_at ?? null,
      submittedAt: row.submitted_at ?? null,
      publishedAt: row.published_at ?? null,
      imagePath: row.image_path ?? null,
      imageUrl: getRequestCoverImageUrl(row.image_path),
      requesterId: row.requester_id as string,
      verifiedAt: row.verified_at ?? null,
      verificationNotes: row.verification_notes ?? null,
      rejectionReason: row.rejection_reason ?? null,
    },
    error: null,
  };
}

/* -------------------------------------------------------------- documents */

/** The private requester-document bucket. It must never be made public. */
export const STAFF_DOCUMENT_BUCKET = 'request-documents';

/** Signed links are short-lived and minted on demand, never stored. */
export const SIGNED_URL_TTL_SECONDS = 300;

/** Raw row shape for the help_request_documents select. */
interface DocumentRow {
  id: string;
  request_id: string;
  storage_path: string;
  uploaded_by: string;
  document_type: string | null;
  status: string;
  created_at: string | null;
}

export async function listStaffRequestDocuments(
  requestId: string,
): Promise<StaffResult<StaffDocument[]>> {
  const { data, error } = await supabase
    .from('help_request_documents')
    .select('id, request_id, storage_path, uploaded_by, document_type, status, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[staff] document list failed', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {
      data: null,
      error: toStaffError('documents-list', error, 'The documents for this request could not be loaded.'),
    };
  }

  return {
    data: ((data ?? []) as unknown as DocumentRow[]).map((row) => ({
      id: row.id,
      requestId: row.request_id,
      storagePath: row.storage_path,
      uploadedBy: row.uploaded_by,
      documentType: row.document_type ?? null,
      status: row.status as DocumentStatus,
      createdAt: row.created_at ?? null,
    })),
    error: null,
  };
}

/**
 * Mints a short-lived signed URL so staff can open a private document in a new
 * tab without downloading it into the app.
 *
 * The bucket stays private and no public URL is ever produced: this calls
 * `createSignedUrl`, never `getPublicUrl`. Authorisation is enforced by the
 * existing storage.objects SELECT policy for staff, so a requester calling this
 * same function with their own token receives 400/403 and no URL.
 *
 * The URL is returned to the caller for immediate navigation only. It is not
 * persisted, cached, logged, or stored in component state beyond the click.
 *
 * `download` names the file the browser should save. It is a caller-supplied
 * string that lands in a `Content-Disposition` header, so it is sanitised to
 * `[A-Za-z0-9._-]` and length-capped here: an unescaped quote or newline in a
 * filename is a header-injection primitive. Callers should pass a value derived
 * from `getDocumentDisplayName`, which is already restricted, but this function
 * does not rely on that.
 */
export async function createStaffDocumentUrl(
  storagePath: string,
  options: { download?: string } = {},
): Promise<StaffResult<{ signedUrl: string }>> {
  const parsedPath = parseValidatedDocumentPath(storagePath);
  if (!parsedPath) {
    return {
      data: null,
      error: { source: 'document-url', message: 'That document reference is not valid.' },
    };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData?.session?.user?.id) {
    return {
      data: null,
      error: {
        source: 'document-url',
        message: 'You must be signed in to open this document.',
        code: '28000',
      },
    };
  }

  const download = options.download ? safeDownloadName(options.download) : null;

  const { data, error } = await supabase.storage
    .from(STAFF_DOCUMENT_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS, {
      download: download ?? false,
    });

  if (error) {
    console.error('[staff] signed URL failed', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {
      data: null,
      error: toStaffError('document-url', error, 'This document could not be opened.'),
    };
  }

  if (!data?.signedUrl) {
    return {
      data: null,
      error: { source: 'document-url', message: 'This document could not be opened.' },
    };
  }

  return { data: { signedUrl: data.signedUrl }, error: null };
}

/**
 * Strips everything that could break out of a `Content-Disposition` filename
 * parameter. Returns null when nothing usable survives, so the caller falls
 * back to a plain inline open rather than sending a header with an empty name.
 */
function safeDownloadName(raw: string): string | null {
  const cleaned = raw
    .replace(/[^A-Za-z0-9.\-_]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80)
    .replace(/^[.\-_]+/, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Distinguishes document-status RPC failure modes for the UI.
 *
 * The request-mismatch and already-in-that-status cases are both raised with
 * errcode 22023, so the Postgres code alone cannot separate them and the message
 * text has to be inspected. Classifying once, here, keeps that fragile text
 * matching in one place instead of leaking into the components.
 */
export type DocumentRpcFailure =
  | 'unauthorized'
  | 'not-found'
  | 'request-mismatch'
  | 'already-in-that-status'
  | 'failed';

/**
 * Resolves a safe, staff-facing message for a document-status RPC failure.
 * The SQL raises distinct errcodes per failure mode so the UI can explain what
 * went wrong without leaking internals to a production user.
 */
function classifyDocumentRpcError(err: unknown): {
  kind: DocumentRpcFailure;
  message: string;
} {
  const structured = extractStructuredError(err);
  const code = structured?.code ?? '';
  const detail = structured?.message ?? '';

  // 28000 = unauthenticated, 42501 = role check failed (or RLS). Both are
  // "you may not do this" from the staff member's point of view.
  if (code === '42501' || code === '28000') {
    return { kind: 'unauthorized', message: 'You are not authorized to update this document.' };
  }
  if (code === 'P0002' || detail.includes('Document not found')) {
    return { kind: 'not-found', message: 'This document could not be found.' };
  }
  if (detail.includes('does not belong to the supplied request')) {
    return { kind: 'request-mismatch', message: 'This document does not belong to this request.' };
  }
  if (detail.includes('already marked')) {
    return { kind: 'already-in-that-status', message: 'This document is already in that status.' };
  }
  // Includes a missing function (PGRST202, migration not yet applied) and any
  // audit-insert failure. The SQL rolls back in that case, so this is accurate.
  return {
    kind: 'failed',
    message: 'The document could not be updated. No change was applied.',
  };
}

/**
 * Records a staff verification decision on one document.
 *
 * This is the ONLY application path for document verification status. It
 * delegates to the SECURITY DEFINER function `set_document_verification_status`
 * so the document update and its `admin_actions` row are written in one
 * database transaction: if the audit write fails, the status change is rolled
 * back and the two can never diverge.
 *
 * Only three values cross the wire, and none of them is an identity:
 *   - p_document_id  which document
 *   - p_new_status   the new document_status
 *   - p_request_id   the expected parent request, used only as a cross-check
 * `admin_id` is auth.uid() inside PostgreSQL and is never sent by the browser.
 */
export async function setStaffDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  requestId: string,
): Promise<StaffResult<{ id: string; status: DocumentStatus }>> {
  /*
    Refuse a value outside the enum before it reaches the wire.

    `status` is typed, but the value can originate from a rendered list, and the
    database would reject anything invalid with a generic error. Checking here
    turns a confusing round-trip failure into a local, specific message, and
    guarantees only the three real document_status values are ever sent.
  */
  if (!isStaffDocumentStatus(status)) {
    return {
      data: null,
      error: {
        source: 'document-status',
        message: 'That document status is not valid.',
        kind: 'failed',
      },
    };
  }

  const { data, error } = await supabase.rpc('set_document_verification_status', {
    p_document_id: documentId,
    p_new_status: status,
    p_request_id: requestId,
  });

  if (error) {
    const classified = classifyDocumentRpcError(error);
    console.error('[staff] document status RPC failed', {
      kind: classified.kind,
      code: extractStructuredError(error)?.code ?? null,
      message: extractStructuredError(error)?.message ?? null,
    });
    return {
      data: null,
      error: {
        ...toStaffError('document-status', error, classified.message),
        kind: classified.kind,
      },
    };
  }

  if (!data || typeof data !== 'object') {
    return {
      data: null,
      error: {
        source: 'document-status',
        message: 'The document could not be updated. No change was applied.',
        kind: 'failed',
      },
    };
  }

  // The RPC echoes the committed row. Verify it matches what was requested
  // before reporting success, so a surprising payload can never render as a
  // confirmed decision the database did not actually make.
  const result = data as { id?: unknown; status?: unknown };
  if (result.id !== documentId || result.status !== status) {
    console.error('[staff] document status RPC returned an unexpected payload', result);
    return {
      data: null,
      error: {
        source: 'document-status',
        message: 'The document could not be updated. No change was applied.',
        kind: 'failed',
      },
    };
  }

  return { data: { id: documentId, status }, error: null };
}

/* -------------------------------------------------------------- transitions */

/**
 * The complete allowlist of staff transitions, and the single source of truth
 * for it. Each entry names the status the row must currently hold and the status
 * it may move to, which is exactly the pair the database re-checks under a row
 * lock. There is deliberately no generic `updateStatus(anyStatus)` path, so a
 * caller cannot ask for `draft`, `published`, `active`, `resolved` or `closed`,
 * and the requester's own transitions remain unreachable from staff code.
 *
 * This mirrors public.transition_help_request() in the database. The TypeScript
 * union is a convenience for callers; the SQL is the enforcement, and a
 * transition invented here would be rejected with 22023.
 */
const STAFF_TRANSITION = {
  under_review: { expected: 'submitted', action: 'review_started' },
  verified: { expected: 'under_review', action: 'request_verified' },
  rejected: { expected: 'under_review', action: 'request_rejected' },
} as const satisfies Record<string, { expected: StaffRequestStatus; action: string }>;

export type StaffTransitionTarget = keyof typeof STAFF_TRANSITION;

/** Notes longer than this are refused by the database, so refuse them here too. */
export const MAX_TRANSITION_NOTES = 2000;

/**
 * Distinguishes transition-RPC failure modes for the UI.
 *
 * The SQL raises a distinct SQLSTATE for each class of refusal, except that the
 * whole "wrong state / not permitted / notes problem" family shares 22023, so
 * that one has to be separated by message text. Classifying once, here, keeps
 * that matching out of the components.
 */
export type TransitionFailure =
  | 'unauthorized'
  | 'not-found'
  | 'not-allowed'
  | 'stale-status'
  | 'notes-required'
  | 'notes-too-long'
  | 'unavailable'
  | 'failed';

/**
 * Resolves a safe, staff-facing message for a transition-RPC failure. Every
 * branch is accurate about the same thing: the function is one transaction, so
 * if it raised, no status change and no audit row was committed.
 */
function classifyTransitionError(err: unknown): {
  kind: TransitionFailure;
  message: string;
  source: StaffErrorSource;
} {
  const structured = extractStructuredError(err);
  const code = structured?.code ?? '';
  const detail = structured?.message ?? '';

  if (code === '42501' || code === '28000') {
    return {
      kind: 'unauthorized',
      message: 'You are not authorized to review requests.',
      source: 'transition',
    };
  }
  if (code === 'P0002') {
    return {
      kind: 'not-found',
      message: 'This request could not be found.',
      source: 'transition',
    };
  }
  if (code === 'PGRST202') {
    return {
      kind: 'unavailable',
      message: 'Request review is temporarily unavailable. Refresh the page and try again.',
      source: 'transition',
    };
  }
  if (code === '22023') {
    if (detail.includes('is not permitted')) {
      return {
        kind: 'not-allowed',
        message: 'That status change is not permitted.',
        source: 'transition',
      };
    }
    if (detail.includes('no longer in the expected state')) {
      return {
        kind: 'stale-status',
        message:
          'This request is no longer in the state you expected, so no change was made. Reload to see its current status.',
        source: 'transition',
      };
    }
    if (detail.includes('2000 characters or fewer')) {
      return {
        kind: 'notes-too-long',
        message: 'Notes must be 2000 characters or fewer.',
        source: 'transition',
      };
    }
    if (detail.includes('Notes are required')) {
      return {
        kind: 'notes-required',
        message: 'Add notes before recording this decision.',
        source: 'transition',
      };
    }
  }
  // Anything else — including a failed admin_actions insert and a missing
  // function — aborted the whole transaction, so nothing was applied. Reported
  // as 'audit' so the screen can say so in as many words.
  return {
    kind: 'failed',
    message: 'This decision could not be recorded, so no change was applied.',
    source: 'audit',
  };
}

interface TransitionInput {
  user: User;
  requestId: string;
  target: StaffTransitionTarget;
  notes: string | null;
}

/**
 * Applies a staff transition through the SECURITY DEFINER function
 * `transition_help_request`.
 *
 * This replaces a client-side sequence that inserted the admin_actions row from
 * the browser and then updated help_requests in a second HTTP request. Two
 * requests cannot be one transaction, so that path could record a decision that
 * never took effect, or change a status with no record of who did it. It also
 * wrote a `transition_failed` audit row to paper over the gap, which is a second
 * place a decision could be recorded.
 *
 * There is now exactly one database call. Inside it:
 *   1. the role is read from public.get_my_role(), never from the browser;
 *   2. the row is locked FOR UPDATE, so two reviewers racing produce one winner;
 *   3. the expected status is verified against the locked row, so a stale tab is
 *      rejected rather than overwriting a decision;
 *   4. the status change and the single admin_actions row commit together, and
 *      a failure in either rolls back both.
 *
 * Only three values cross the wire — which request, which transition, and the
 * notes — and none of them is an identity: admin_id is auth.uid() inside
 * PostgreSQL. `verified_at` and `reviewed_by` are also set there, which is why
 * the caller must refetch the row rather than patch its own copy of the status.
 */
async function applyStaffTransition(
  input: TransitionInput,
): Promise<StaffResult<{ id: string; status: StaffRequestStatus }>> {
  const { user, requestId, target, notes } = input;
  const { expected } = STAFF_TRANSITION[target];

  // Defence in depth, not authorisation: the database decides. Refusing to act
  // on a mismatched context avoids attributing a decision to a stale user object.
  if (!(await assertSessionMatches(user))) {
    return {
      data: null,
      error: {
        source: 'transition',
        message: 'Your session has changed. Please sign in again and retry.',
      },
    };
  }

  const { data, error } = await supabase.rpc('transition_help_request', {
    p_request_id: requestId,
    p_new_status: target,
    p_expected_status: expected,
    p_notes: notes,
  });

  if (error) {
    const classified = classifyTransitionError(error);
    console.error('[staff] transition RPC failed', {
      requestId,
      target,
      expected,
      kind: classified.kind,
      code: extractStructuredError(error)?.code ?? null,
      message: extractStructuredError(error)?.message ?? null,
    });
    return {
      data: null,
      error: {
        ...toStaffError('transition', error, classified.message),
        source: classified.source,
        kind: classified.kind,
      },
    };
  }

  // Verify the echoed row before reporting success, so a surprising payload can
  // never render as a decision the database did not actually make. previous_status
  // is the value read under the lock, i.e. the state the reviewer acted on.
  const result = (data ?? null) as
    | { id?: unknown; status?: unknown; previous_status?: unknown }
    | null;
  if (
    !result ||
    result.id !== requestId ||
    result.status !== target ||
    result.previous_status !== expected
  ) {
    console.error('[staff] transition RPC returned an unexpected payload', result);
    return {
      data: null,
      error: {
        source: 'transition',
        message:
          'This decision could not be confirmed, so it has not been applied. Reload the request to see its current status.',
      },
    };
  }

  return { data: { id: requestId, status: target }, error: null };
}

/** submitted -> under_review. Marks that staff have picked the request up. */
export function startRequestReview(
  user: User,
  requestId: string,
): Promise<StaffResult<{ id: string; status: StaffRequestStatus }>> {
  return applyStaffTransition({
    user,
    requestId,
    target: 'under_review',
    notes: 'Review started.',
  });
}

/** under_review -> verified. Requires verification notes. */
export function verifyRequest(
  user: User,
  requestId: string,
  verificationNotes: string,
): Promise<StaffResult<{ id: string; status: StaffRequestStatus }>> {
  const notes = verificationNotes.trim();
  if (!notes) {
    return Promise.resolve({
      data: null,
      error: {
        source: 'transition',
        message: 'Add verification notes before marking this request verified.',
      },
    });
  }
  if (notes.length > MAX_TRANSITION_NOTES) {
    return Promise.resolve({
      data: null,
      error: {
        source: 'transition',
        message: 'Verification notes must be 2000 characters or fewer.',
      },
    });
  }

  return applyStaffTransition({ user, requestId, target: 'verified', notes });
}

/** under_review -> rejected. Requires a rejection reason. */
export function rejectRequest(
  user: User,
  requestId: string,
  rejectionReason: string,
): Promise<StaffResult<{ id: string; status: StaffRequestStatus }>> {
  const reason = rejectionReason.trim();
  if (!reason) {
    return Promise.resolve({
      data: null,
      error: {
        source: 'transition',
        message: 'Add a rejection reason before rejecting this request.',
      },
    });
  }
  if (reason.length > MAX_TRANSITION_NOTES) {
    return Promise.resolve({
      data: null,
      error: {
        source: 'transition',
        message: 'The rejection reason must be 2000 characters or fewer.',
      },
    });
  }

  return applyStaffTransition({ user, requestId, target: 'rejected', notes: reason });
}

/**
 * verified -> published.
 * Calls SECURITY DEFINER public.publish_help_request(uuid).
 * Atomically verifies row lock, status = verified, sets published_at = now(),
 * and writes admin_actions row for 'request_published'.
 */
export async function publishHelpRequest(
  user: User,
  requestId: string,
): Promise<StaffResult<{ id: string; status: StaffRequestStatus }>> {
  if (!(await assertSessionMatches(user))) {
    return {
      data: null,
      error: {
        source: 'transition',
        message: 'Your session has changed. Please sign in again and retry.',
      },
    };
  }

  const { data, error } = await supabase.rpc('publish_help_request', {
    p_request_id: requestId,
  });

  if (error) {
    const structured = extractStructuredError(error);
    const code = structured?.code ?? '';
    const detail = structured?.message ?? '';
    let message = 'This request could not be published. No change was applied.';
    let kind: TransitionFailure = 'failed';

    if (code === '42501' || code === '28000') {
      message = 'You are not authorized to publish requests.';
      kind = 'unauthorized';
    } else if (code === 'P0002') {
      message = 'This request could not be found.';
      kind = 'not-found';
    } else if (code === '22023') {
      message = detail.includes('cannot be published')
        ? detail
        : 'This request is no longer in the verified state and cannot be published.';
      kind = 'stale-status';
    }

    console.error('[staff] publish RPC failed', {
      requestId,
      kind,
      code,
      message: structured?.message ?? null,
    });

    return {
      data: null,
      error: {
        ...toStaffError('transition', error, message),
        kind,
      },
    };
  }

  const result = (data ?? null) as
    | { id?: unknown; status?: unknown; previous_status?: unknown }
    | null;

  if (!result || result.id !== requestId || result.status !== 'published') {
    console.error('[staff] publish RPC returned unexpected payload', result);
    return {
      data: null,
      error: {
        source: 'transition',
        message: 'Publishing could not be confirmed. Reload to check the request status.',
      },
    };
  }

  return { data: { id: requestId, status: 'published' }, error: null };
}

/* ----------------------------------------------------------- cover images */

export const COVER_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const COVER_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface CoverImageUploadResult {
  imagePath: string;
  imageUrl: string;
  warning?: string;
}

/**
 * Uploads a public cover image for a help request.
 *
 * Bucket: `request-images` (public bucket, separate from private `request-documents`).
 * Path convention: `${requestId}/cover-${uuid}.${extension}`
 *
 * Upload sequence:
 * 1. Validate file size (<= 5MB) and type (JPEG, PNG, WebP).
 * 2. Upload to `request-images` bucket.
 * 3. Update `help_requests.image_path` via `public.set_request_cover_image` RPC (or direct column update fallback).
 * 4. If DB update fails, immediately rollback (delete) the uploaded file.
 * 5. If successful and a previous cover image exists, delete old image (non-blocking cleanup).
 */
export async function uploadStaffRequestCoverImage(
  requestId: string,
  file: File,
  currentImagePath?: string | null,
): Promise<StaffResult<CoverImageUploadResult>> {
  if (!requestId) {
    return {
      data: null,
      error: { source: 'cover-image', message: 'That request reference is not valid.' },
    };
  }

  // 1. File size check (<= 5MB)
  if (file.size > COVER_IMAGE_MAX_SIZE_BYTES) {
    return {
      data: null,
      error: {
        source: 'cover-image',
        message: 'The selected image exceeds 5 MB. Please select an image under 5 MB.',
      },
    };
  }

  // 2. MIME type & extension check
  const mimeType = (file.type || '').toLowerCase();
  const nameParts = file.name.split('.');
  const rawExt = nameParts.length > 1 ? nameParts[nameParts.length - 1].toLowerCase() : '';

  let extension = '';
  if (mimeType === 'image/jpeg') extension = 'jpg';
  else if (mimeType === 'image/png') extension = 'png';
  else if (mimeType === 'image/webp') extension = 'webp';
  else if (rawExt === 'jpg' || rawExt === 'jpeg') extension = 'jpg';
  else if (rawExt === 'png') extension = 'png';
  else if (rawExt === 'webp') extension = 'webp';

  if (!extension) {
    return {
      data: null,
      error: {
        source: 'cover-image',
        message: 'Unsupported format. Cover images must be JPEG, PNG, or WebP.',
      },
    };
  }

  // 3. Generate canonical path: {requestId}/cover-{uuid}.{ext}
  const fileUuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const storagePath = `${requestId}/cover-${fileUuid}.${extension}`;

  // 4. Upload to public storage bucket
  const contentType =
    extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';

  const { error: uploadError } = await supabase.storage
    .from(REQUEST_IMAGES_BUCKET)
    .upload(storagePath, file, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    console.error('[staff] cover image upload failed', {
      code: (uploadError as { code?: string }).code ?? null,
      message: uploadError.message,
    });
    return {
      data: null,
      error: toStaffError('cover-image', uploadError, 'Could not upload the cover image to storage.'),
    };
  }

  // 5. Update database: authoritative RPC mutation (no direct table fallback)
  const { error: rpcError } = await supabase.rpc('set_request_cover_image', {
    p_request_id: requestId,
    p_image_path: storagePath,
  });

  // 6. Rollback if RPC failed: delete newly uploaded storage object
  if (rpcError) {
    console.error('[staff] set_request_cover_image RPC failed, rolling back uploaded file', {
      code: (rpcError as { code?: string }).code ?? null,
      message: rpcError.message,
    });
    try {
      await supabase.storage.from(REQUEST_IMAGES_BUCKET).remove([storagePath]);
    } catch (cleanupErr) {
      console.warn('[staff] rollback storage deletion failed', cleanupErr);
    }
    return {
      data: null,
      error: toStaffError('cover-image', rpcError, 'Could not associate the cover image with this request in the database.'),
    };
  }

  // 7. Cleanup old image file if present and different (non-blocking)
  let warning: string | undefined;
  if (currentImagePath && currentImagePath !== storagePath) {
    try {
      const { error: removeOldError } = await supabase.storage
        .from(REQUEST_IMAGES_BUCKET)
        .remove([currentImagePath]);
      if (removeOldError) {
        console.warn('[staff] could not remove previous cover image file from storage', removeOldError.message);
        warning = 'The new cover image was saved, but the previous image file could not be deleted from storage.';
      }
    } catch (e) {
      console.warn('[staff] failed to delete old cover image', e);
    }
  }

  const imageUrl = getRequestCoverImageUrl(storagePath) ?? '';

  return {
    data: {
      imagePath: storagePath,
      imageUrl,
      warning,
    },
    error: null,
  };
}

/**
 * Removes the cover image from a request.
 * Sets `image_path` to NULL in the database, and deletes the storage object.
 */
export async function removeStaffRequestCoverImage(
  requestId: string,
  currentImagePath: string | null,
): Promise<StaffResult<{ success: boolean; warning?: string }>> {
  if (!requestId) {
    return {
      data: null,
      error: { source: 'cover-image', message: 'That request reference is not valid.' },
    };
  }

  // 1. Update database to NULL: authoritative RPC mutation (no direct table fallback)
  const { error: rpcError } = await supabase.rpc('set_request_cover_image', {
    p_request_id: requestId,
    p_image_path: null,
  });

  if (rpcError) {
    console.error('[staff] set_request_cover_image RPC failed on remove', {
      code: (rpcError as { code?: string }).code ?? null,
      message: rpcError.message,
    });
    return {
      data: null,
      error: toStaffError('cover-image', rpcError, 'Could not remove the cover image from the database.'),
    };
  }

  // 2. Remove file from storage if present (non-blocking)
  let warning: string | undefined;
  if (currentImagePath) {
    try {
      const { error: removeError } = await supabase.storage
        .from(REQUEST_IMAGES_BUCKET)
        .remove([currentImagePath]);
      if (removeError) {
        console.warn('[staff] could not delete cover image file from storage', removeError.message);
        warning = 'The cover image reference was removed, but the file could not be deleted from storage.';
      }
    } catch (e) {
      console.warn('[staff] failed to delete cover image from storage', e);
    }
  }

  return {
    data: {
      success: true,
      warning,
    },
    error: null,
  };
}

/* ----------------------------------------------------------- review history */

export interface StaffAuditEntry {
  id: string;
  action: string;
  /** `old -> new` for a transition, or null for a document-status change. */
  oldStatus: string | null;
  newStatus: string | null;
  notes: string | null;
  createdAt: string | null;
}

export type AuditTrailResult =
  | { data: StaffAuditEntry[]; error: null; unavailable: false }
  | { data: null; error: StaffError; unavailable: false }
  /**
   * The staff role is not permitted to read `admin_actions` in this deployment.
   *
   * This is a distinct outcome from "no history exists", and the UI must say so
   * rather than rendering an empty list. An empty list reads as "nothing has
   * happened", which for a request that is visibly `published` is a lie. See the
   * note on the function for why this is a normal, non-exceptional state.
   */
  | { data: null; error: null; unavailable: true };

/**
 * Reads the audit trail for one request.
 *
 * The `admin_actions` rows are the ONLY record of who decided what and when:
 * `help_requests` keeps the current status and the latest notes, but not the
 * sequence, and not the actor. Every transition RPC writes exactly one row
 * inside the same transaction as the status change, so this history cannot drift
 * from the lifecycle.
 *
 * Rows include the requester's own `request_submitted` event and every
 * `document_status_changed` row, because those share the same `request_id` —
 * which is exactly what a reviewer wants: one chronological list of everything
 * that has happened to the request.
 *
 * WHY `unavailable` IS A NORMAL OUTCOME
 * -------------------------------------
 * Whether staff can read `admin_actions` is a property of the deployed RLS
 * policies, not of this code, and it has not been confirmed for this project.
 * If the policy is absent the select returns 42501 and every request would show
 * "review history failed to load" on a screen whose primary job is reviewing.
 * So a permission refusal is reported as `unavailable`, and the page states
 * plainly that history is not visible to this role while still showing every
 * field the request row itself carries (status, verification notes, rejection
 * reason, timestamps). The screen stays fully usable; only the optional extra
 * is missing.
 *
 * No profile join is performed. That is deliberate: it avoids depending on a
 * `profiles` SELECT policy that may not grant staff access, and it keeps
 * requester personal data out of the audit view. `admin_id` is an opaque uuid
 * and is rendered as a short reference, not resolved to a name.
 */
export async function listRequestAuditTrail(requestId: string): Promise<AuditTrailResult> {
  if (!requestId) {
    return {
      data: null,
      error: { source: 'audit', message: 'That request reference is not valid.' },
      unavailable: false,
    };
  }

  const { data, error } = await supabase
    .from('admin_actions')
    .select('id, action, old_status, new_status, notes, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    // 42501/28000, or a PostgREST "column does not exist" (PGRST204) if the
    // deployed table differs from the shape the migrations write. Both mean the
    // same thing to a reviewer: the trail is not available to this role.
    const code = (error as { code?: string }).code ?? '';
    if (code === '42501' || code === '28000' || code === 'PGRST204' || code === 'PGRST205') {
      console.warn('[staff] admin_actions is not readable by this role; history hidden', { code });
      return { data: null, error: null, unavailable: true };
    }
    console.error('[staff] audit trail query failed', { code, message: error.message });
    return {
      data: null,
      error: toStaffError('audit', error, 'The review history could not be loaded.'),
      unavailable: false,
    };
  }

  const rows = (data ?? []) as unknown as {
    id?: unknown;
    action?: unknown;
    old_status?: unknown;
    new_status?: unknown;
    notes?: unknown;
    created_at?: unknown;
  }[];

  return {
    data: rows.map((row, index) => ({
      // `id` is used for the React key. Some deployments of the audit table may
      // not expose it through RLS-visible columns, so a positional fallback keeps
      // the list keyed without inventing an id.
      id: typeof row.id === 'string' && row.id ? row.id : `audit-${index}`,
      action: typeof row.action === 'string' ? row.action : 'unknown',
      oldStatus: typeof row.old_status === 'string' ? row.old_status : null,
      newStatus: typeof row.new_status === 'string' ? row.new_status : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      createdAt: typeof row.created_at === 'string' ? row.created_at : null,
    })),
    error: null,
    unavailable: false,
  };
}
