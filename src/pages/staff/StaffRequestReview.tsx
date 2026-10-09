import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Globe,
  History,
  Image as ImageIcon,
  Loader2,
  PlayCircle,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { getDocumentDisplayName } from '../../services/helpRequests';
/* Types ride in on the value import via inline `type`; see StaffDashboard. */
import {
  createStaffDocumentUrl,
  getStaffRequestById,
  listRequestAuditTrail,
  listStaffRequestDocuments,
  publishHelpRequest,
  rejectRequest,
  removeStaffRequestCoverImage,
  setStaffDocumentStatus,
  staffErrorText,
  startRequestReview,
  uploadStaffRequestCoverImage,
  verifyRequest,
  COVER_IMAGE_MAX_SIZE_BYTES,
  type DocumentStatus,
  type StaffAuditEntry,
  type StaffDocument,
  type StaffError,
  type StaffRequestDetail,
  type StaffRequestStatus,
} from '../../services/staffRequests';
import { requestStatusMeta } from '../../lib/status';
import {
  DetailRow,
  formatDate,
  formatDateTime,
  formatINR,
  Panel,
  Spinner,
  StatusBadge,
  UrgencyIndicator,
} from './staffUi';
import { useCategoryNames } from './useCategoryNames';

type Decision = 'verify' | 'reject' | null;
type PendingAction = 'start' | 'verify' | 'reject' | 'publish' | null;

/** Matches the 2000-character limit the transition RPC enforces server-side. */
const NOTES_MAX_LENGTH = 2000;

/**
 * The milestones shown in the Lifecycle panel, in order.
 *
 * Only steps backed by a dedicated timestamp column are dated. `updated_at` is
 * deliberately NOT used for the "Under review" and "Rejected" steps: it moves on
 * every subsequent write, so a request reviewed and rejected a month ago
 * displayed that day's date as the moment review began. Those two steps show as
 * reached with no date rather than with an invented one.
 */
const LIFECYCLE_STEPS = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'under_review', label: 'Under review' },
  { key: 'verified', label: 'Verified' },
  { key: 'published', label: 'Published' },
  { key: 'rejected', label: 'Rejected' },
] as const;

/**
 * Which statuses mean each milestone has been reached.
 *
 * This has to be an explicit set per step, and it has to include the post-publish
 * statuses. The previous check only listed `under_review | verified | published |
 * rejected`, so a request that had been published and then moved to `active`,
 * `resolved` or `closed` showed "Verified" and "Published" as NOT reached — on
 * the one screen whose job is to report what happened to a request. Those three
 * statuses are all strictly downstream of `published`.
 */
const LIFECYCLE_REACHED: Record<(typeof LIFECYCLE_STEPS)[number]['key'], readonly StaffRequestStatus[]> =
  {
    submitted: ['submitted', 'under_review', 'verified', 'published', 'active', 'resolved', 'closed', 'rejected'],
    under_review: ['under_review', 'verified', 'published', 'active', 'resolved', 'closed', 'rejected'],
    verified: ['verified', 'published', 'active', 'resolved', 'closed'],
    published: ['published', 'active', 'resolved', 'closed'],
    rejected: ['rejected'],
  };

/**
 * The milestone timestamp for each step, or null where no column records it.
 *
 * Kept separate from `LIFECYCLE_STEPS` because the steps are a module constant
 * while the timestamps are per-request.
 */
function lifecycleTimestamps(request: StaffRequestDetail): Record<string, string | null> {
  return {
    submitted: request.submittedAt,
    // No `review_started_at` and no `rejected_at` column exists.
    under_review: null,
    verified: request.verifiedAt,
    published: request.publishedAt,
    rejected: null,
  };
}

/** Statuses in which a staff decision is possible. Mirrors STAFF_TRANSITION. */
const ACTIONABLE_STATUSES: readonly StaffRequestStatus[] = [
  'submitted',
  'under_review',
  'verified',
  'rejected',
  'published',
];

export default function StaffRequestReview() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [request, setRequest] = useState<StaffRequestDetail | null>(null);
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const { categoryName: resolveCategory } = useCategoryNames();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<StaffError | null>(null);

  // Review history. `unavailable` is a distinct, expected state from "no history
  // yet" and from "failed to load" — see listRequestAuditTrail.
  const [audit, setAudit] = useState<StaffAuditEntry[] | null>(null);
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditError, setAuditError] = useState<StaffError | null>(null);
  const [auditUnavailable, setAuditUnavailable] = useState(false);

  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState<Decision>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<StaffError | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [confirmingPublish, setConfirmingPublish] = useState(false);
  // Set when a request transition committed but the row could not be re-read.
  // The status, verification_notes, verified_at, rejection_reason and
  // reviewed_by on screen are then known to be out of date, and acting on them
  // would send an expected status the database no longer holds. Every decision
  // control is withheld until the page reflects the database again.
  const [requestStale, setRequestStale] = useState(false);

  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const [docBusyId, setDocBusyId] = useState<string | null>(null);
  const [docError, setDocError] = useState<StaffError | null>(null);
  const [docNotice, setDocNotice] = useState<string | null>(null);
  // Set when a post-action refresh fails, so the rows on screen are known to be
  // out of date. Document decision controls are withheld while this is set:
  // acting on a stale status is exactly the bug this guards against.
  const [docStale, setDocStale] = useState(false);

  // Cover image management
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [coverWarning, setCoverWarning] = useState<string | null>(null);
  const [coverSuccess, setCoverSuccess] = useState<string | null>(null);
  const [confirmingRemoveCover, setConfirmingRemoveCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Guards against a stale response overwriting newer state after unmount.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /*
    Focus management for the two inline confirmation panels.

    Both are destructive or irreversible, so both ask "are you sure?" inline.
    Two things were missing: focus did not move to the confirm button, so a
    keyboard user was left with focus on the button that opened the panel and had
    to tab blind to find it; and Escape did nothing, so there was no way out
    except hunting for Cancel.
  */
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (decision !== null || confirmingPublish) {
      confirmRef.current?.focus();
    }
  }, [decision, confirmingPublish]);

  useEffect(() => {
    if (decision === null && !confirmingPublish) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (confirmingPublish) setConfirmingPublish(false);
      else setDecision(null);
      setActionError(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [decision, confirmingPublish]);

  /**
   * The review history, loaded alongside the request and documents.
   *
   * It is fetched in the same `load()` as the rest of the page rather than in an
   * effect of its own, for two reasons: it is a third read of the same row, so
   * bundling it avoids a second round-trip on first paint; and — more important —
   * it must refresh after every decision, the same way status and documents do.
   * A history panel that quietly kept showing the pre-verification entries after
   * a successful verification is worse than no history at all.
   *
   * A permission refusal is recorded as `unavailable` and never as an error. The
   * Lifecycle panel below already shows the real transition timestamps, so a
   * request with no readable trail is still fully reviewable; it just says so.
   */
  const loadAudit = useCallback(async (requestId: string): Promise<boolean> => {
    setAuditLoading(true);
    setAuditError(null);

    const result = await listRequestAuditTrail(requestId);
    if (!alive.current) return false;

    if (result.unavailable) {
      setAudit(null);
      setAuditUnavailable(true);
    } else {
      setAudit(result.data ?? []);
      setAuditUnavailable(false);
      if (result.error) setAuditError(result.error);
    }
    setAuditLoading(false);
    return result.error === null;
  }, []);

  /**
   * Re-reads the request, its documents and its review history from Supabase.
   *
   * `silent` is used after an action: the page keeps showing the committed
   * state instead of collapsing to a full-page spinner, so the refreshed
   * database state is actually what the staff member sees.
   *
   * Returns false when any query failed, so callers can surface a refresh error
   * rather than silently leaving stale data on screen.
   */
  const load = useCallback(
    async (options?: { silent?: boolean }): Promise<boolean> => {
      if (!id) return false;
      if (!options?.silent) {
        setLoading(true);
        setLoadError(null);
      }

      const [detail, docs] = await Promise.all([
        getStaffRequestById(id),
        listStaffRequestDocuments(id),
        loadAudit(id),
      ]);

      if (!alive.current) return false;

      // Only adopt the fetched rows when the read succeeded. On failure the
      // previous rows are left alone and the error is reported, so a transient
      // read error can never blank the page or present a half-applied state.
      if (detail.data) setRequest(detail.data);
      if (docs.data) setDocuments(docs.data);

      const failure = detail.error ?? docs.error ?? null;

      // Only replace the whole page on a first load. A failed post-action
      // refresh is reported inside the Documents panel instead, so the review
      // page stays usable and the reason stays visible.
      if (!options?.silent) {
        setLoadError(failure);
      }
      setLoading(false);
      return failure === null;
    },
    [id, loadAudit],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Mints a short-lived signed URL and either previews or downloads the file.
   *
   * `download` is passed to Supabase's `createSignedUrl` rather than being
   * appended as a query string, so the filename is sanitised server-side by
   * PostgREST's response-content-disposition handling and can never be used to
   * inject a header of its own. The name sent is derived from the storage path,
   * which the requester controls, so it is sanitised in the service layer before
   * it gets here.
   *
   * A download needs its own button because a reviewer checking ten documents
   * one after another in new tabs fills the tab strip with previews, and there
   * is no keyboard-friendly way to get back to the review screen from the last
   * one.
   */
  const handleDocument = async (doc: StaffDocument, mode: 'open' | 'download') => {
    setDocError(null);
    setOpeningDocId(doc.id);
    const result = await createStaffDocumentUrl(
      doc.storagePath,
      mode === 'download' ? { download: getDocumentDisplayName(doc.storagePath) } : undefined,
    );
    if (!alive.current) return;
    setOpeningDocId(null);

    if (result.error || !result.data) {
      setDocError(result.error);
      return;
    }
    // Short-lived signed URL, minted on demand, opened in a new tab and not
    // stored anywhere.
    window.open(result.data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const handleDocumentStatus = async (doc: StaffDocument, status: DocumentStatus) => {
    if (!id) return;
    setDocError(null);
    setDocNotice(null);
    setDocStale(false);
    setDocBusyId(doc.id);

    // Single database call. The SECURITY DEFINER function updates the document
    // and writes its admin_actions row in one transaction, so there is no
    // second audit call here and no client-side status write to keep in step.
    const result = await setStaffDocumentStatus(doc.id, status, id);
    if (!alive.current) return;
    setDocBusyId(null);

    // "Already in that status" is not a failure to write: it means the database
    // already holds the requested value and this page was showing stale data.
    // Re-read it either way rather than leaving the old status on screen.
    const alreadyCurrent = result.error?.kind === 'already-in-that-status';

    if (result.error && !alreadyCurrent) {
      setDocError(result.error);
      return;
    }

    // Render the authoritative database state. The requested status is never
    // assumed locally, so the document shows what was actually committed.
    const reloaded = await load({ silent: true });
    if (!alive.current) return;

    if (!reloaded) {
      // The change was written, but we could not confirm it. Say so plainly
      // instead of letting stale data stand in for the real status, and
      // withhold further decisions until the page reflects the database again.
      setDocStale(true);
      setDocError({
        source: 'documents-list',
        message:
          'The document was updated, but the latest status could not be loaded. Refresh the page to confirm before making another decision.',
      });
      return;
    }

    setDocNotice(
      alreadyCurrent
        ? 'This document is already marked in that status. Showing the current status from the database.'
        : 'Document status updated.',
    );
  };

  const runTransition = async (
    kind: Exclude<PendingAction, null>,
    fn: () => Promise<{ data: { status: string } | null; error: StaffError | null }>,
  ) => {
    setPending(kind);
    setActionError(null);
    setActionNotice(null);

    const result = await fn();
    if (!alive.current) return;
    setPending(null);

    if (result.error || !result.data) {
      setActionError(
        result.error ?? {
          source: 'transition',
          message: 'This decision could not be applied. No change was made.',
        },
      );
      // A failed transition can still mean the row moved — another reviewer may
      // have acted first, in which case the RPC rejected our stale expected
      // status. Re-read either way so the screen never keeps showing a status
      // the database no longer holds, and so the reviewer sees what happened
      // instead of re-clicking a button that will fail the same way.
      const resynced = await load({ silent: true });
      if (!alive.current) return;
      setRequestStale(!resynced);
      return;
    }

    // The transition is committed, but the screen must not patch its own copy
    // of the status. transition_help_request() also set reviewed_by and, for a
    // verified request, verified_at and verification_notes — all server-side,
    // with values the browser never sent. Re-reading is the only way those can
    // be shown truthfully, and it is also what proves which expected status the
    // database actually applied.
    const reloaded = await load({ silent: true });
    if (!alive.current) return;

    if (!reloaded) {
      setRequestStale(true);
      setActionError({
        source: 'transition',
        message:
          'The change was saved, but the latest status could not be loaded. Refresh the page to confirm it before making another decision.',
      });
      // The notes are deliberately left in the box: the decision is on record
      // and a reviewer may need to re-enter it if the refresh shows it did not
      // land. Clearing them here would discard the explanation.
      return;
    }

    setRequestStale(false);
    setDecision(null);
    setNotes('');
    setConfirmingPublish(false);
    setActionNotice(
      kind === 'start'
        ? 'Review started. This request is now under review.'
        : kind === 'verify'
          ? 'Request verified. It is now ready to be published.'
          : kind === 'publish'
            ? 'Request published! It is now live on the public Help page.'
            : 'Request rejected. The requester can see the reason on their request.',
    );
  };

  const handleStart = () => {
    if (!user || !id || requestStale) return;
    void runTransition('start', () => startRequestReview(user, id));
  };

  const handleVerify = () => {
    if (!user || !id || requestStale) return;
    void runTransition('verify', () => verifyRequest(user, id, notes));
  };

  const handleReject = () => {
    if (!user || !id || requestStale) return;
    void runTransition('reject', () => rejectRequest(user, id, notes));
  };

  const handlePublish = () => {
    if (!user || !id || requestStale) return;
    setConfirmingPublish(false);
    void runTransition('publish', () => publishHelpRequest(user, id));
  };

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !request) return;

    setCoverError(null);
    setCoverWarning(null);
    setCoverSuccess(null);
    setConfirmingRemoveCover(false);

    if (file.size > COVER_IMAGE_MAX_SIZE_BYTES) {
      setCoverError('The selected image is larger than 5 MB. Please select a smaller JPEG, PNG, or WebP image.');
      return;
    }

    setCoverUploading(true);
    const res = await uploadStaffRequestCoverImage(request.id, file, request.imagePath);
    if (!alive.current) return;
    setCoverUploading(false);

    if (res.error) {
      setCoverError(staffErrorText(res.error));
      return;
    }

    if (res.data) {
      setRequest((prev) => (prev ? { ...prev, imagePath: res.data!.imagePath, imageUrl: res.data!.imageUrl } : null));
      setCoverSuccess('Cover image uploaded successfully.');
      if (res.data.warning) {
        setCoverWarning(res.data.warning);
      }
    }
  };

  const handleRemoveCover = async () => {
    if (!request) return;
    setCoverError(null);
    setCoverWarning(null);
    setCoverSuccess(null);
    setCoverRemoving(true);

    const res = await removeStaffRequestCoverImage(request.id, request.imagePath);
    if (!alive.current) return;
    setCoverRemoving(false);
    setConfirmingRemoveCover(false);

    if (res.error) {
      setCoverError(staffErrorText(res.error));
      return;
    }

    setRequest((prev) => (prev ? { ...prev, imagePath: null, imageUrl: null } : null));
    setCoverSuccess('Cover image removed.');
    if (res.data?.warning) {
      setCoverWarning(res.data.warning);
    }
  };

  if (loading) {
    return <Spinner label="Loading request..." />;
  }

  if (loadError || !request) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-amber-500" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-slate-900">Request unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">
          {loadError ? staffErrorText(loadError) : 'That request could not be found.'}
        </p>
        <Link
          to="/staff"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the dashboard
        </Link>
      </div>
    );
  }

  const isSubmitted = request.status === 'submitted';
  const isUnderReview = request.status === 'under_review';
  const isVerified = request.status === 'verified';
  const isPublished = request.status === 'published';
  const isRejected = request.status === 'rejected';
  const notesMissing = notes.trim().length === 0;

  /*
    Where "back" goes depends on what this request is.

    A dead-end to /staff is wrong here: the reviewer just came from a queue, and
    after a rejection there is no longer anything to review, so the queue that
    lists THIS request is the only page that can show them what happened. Linking
    by status keeps the two screens consistent, because the queue's tab is derived
    from the same status value.
  */
  const backHref = reviewBackHref(request.status);
  const categoryLabel = resolveCategory(request.categoryId) || '—';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the queue
        </Link>
        <div className="flex items-center gap-2">
          <StatusBadge status={request.status} />
          <UrgencyIndicator urgency={request.urgency} />
        </div>
      </div>

      {actionNotice && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{actionNotice}</span>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          <p className="font-medium">{staffErrorText(actionError)}</p>
          {actionError.source === 'audit' && (
            <p className="mt-1">
              The request status was left unchanged because the decision could not be recorded.
            </p>
          )}
        </div>
      )}

      {/*
        A committed transition whose reload failed. The status and decision
        fields on screen are unverified, so the Decision panel below is
        withheld entirely — a stale expected status would be rejected by the
        database, and worse, a stale rejection reason could be recorded against
        a request that has already moved on.
      */}
      {requestStale && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <p className="font-medium">
            This page is showing out-of-date request data. Further decisions are blocked until it
            is reloaded.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
          >
            <Loader2 className="h-3.5 w-3.5" aria-hidden="true" />
            Reload this request
          </button>
        </div>
      )}

      <div className="grid gap-5 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="Request">
            <h2 className="text-xl font-bold text-slate-900">{request.title}</h2>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-slate-700">
              {request.description}
            </p>

            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <DetailRow label="Category">{categoryLabel}</DetailRow>
              <DetailRow label="Urgency">{request.urgency}</DetailRow>
              <DetailRow label="Amount needed">{formatINR(request.targetAmount)}</DetailRow>
              <DetailRow label="Amount raised">{formatINR(request.raisedAmount)}</DetailRow>
              <DetailRow label="City">{request.locationCity ?? '—'}</DetailRow>
              <DetailRow label="State">{request.locationState ?? '—'}</DetailRow>
              <DetailRow label="Created">{formatDateTime(request.createdAt)}</DetailRow>
              <DetailRow label="Submitted">{formatDateTime(request.submittedAt)}</DetailRow>
            </dl>
          </Panel>

          <Panel title="Cover Image">
            <p className="text-xs text-slate-500 mb-4 leading-relaxed">
              Public photo representing this request on the homepage and help directory. Upload genuine photographs only — do not use stock photos or generic clip art.
            </p>

            {coverError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                {coverError}
              </div>
            )}

            {coverWarning && (
              <div
                role="status"
                className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
              >
                {coverWarning}
              </div>
            )}

            {coverSuccess && (
              <div
                role="status"
                className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
              >
                {coverSuccess}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => void handleCoverFileChange(e)}
              disabled={coverUploading || coverRemoving}
            />

            {request.imageUrl ? (
              <div className="space-y-4">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                  <img
                    src={request.imageUrl}
                    alt={request.title}
                    className="aspect-video w-full object-cover"
                  />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <p className="text-xs text-slate-500 truncate max-w-xs sm:max-w-md">
                    File: <span className="font-mono text-slate-700">{request.imagePath}</span>
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={coverUploading || coverRemoving}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {coverUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Replace Image
                    </button>

                    {!confirmingRemoveCover ? (
                      <button
                        type="button"
                        onClick={() => setConfirmingRemoveCover(true)}
                        disabled={coverUploading || coverRemoving}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Remove
                      </button>
                    ) : (
                      <div className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 p-1.5">
                        <span className="text-xs font-medium text-rose-900">Remove image?</span>
                        <button
                          type="button"
                          onClick={() => void handleRemoveCover()}
                          disabled={coverRemoving}
                          className="rounded bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                        >
                          {coverRemoving ? (
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          ) : (
                            'Confirm'
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingRemoveCover(false)}
                          disabled={coverRemoving}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center">
                <ImageIcon className="h-8 w-8 text-slate-400 mb-2" aria-hidden="true" />
                <p className="text-sm font-medium text-slate-700">No cover image uploaded</p>
                <p className="mt-1 text-xs text-slate-500 max-w-sm">
                  A photo is optional, but helps visitors connect with the situation. Supported formats: JPEG, PNG, WebP (up to 5 MB).
                </p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={coverUploading || coverRemoving}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                >
                  {coverUploading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      Upload Cover Image
                    </>
                  )}
                </button>
              </div>
            )}
          </Panel>

          <Panel title="Documents">
            {docError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                {staffErrorText(docError)}
              </div>
            )}

            {docNotice && !docError && (
              <div
                role="status"
                className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
              >
                {docNotice}
              </div>
            )}

            {documents.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No documents were attached to this request.
              </p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {documents.map((doc) => (
                  <li key={doc.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {getDocumentDisplayName(doc.storagePath)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {(doc.documentType ?? 'unknown').toUpperCase()} · uploaded{' '}
                            {formatDate(doc.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={doc.status} />
                        <button
                          type="button"
                          onClick={() => void handleDocument(doc, 'open')}
                          disabled={openingDocId === doc.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {openingDocId === doc.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          Open
                        </button>
                        {/*
                          Separate from Open on purpose: a signed URL with
                          `download` sets Content-Disposition, so the file saves
                          instead of opening, and the reviewer keeps this tab
                          open. The label carries the filename because the
                          status badge beside it does not.
                        */}
                        <button
                          type="button"
                          onClick={() => void handleDocument(doc, 'download')}
                          disabled={openingDocId === doc.id}
                          aria-label={`Download ${getDocumentDisplayName(doc.storagePath)}`}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="hidden sm:inline">Download</span>
                        </button>
                      </div>
                    </div>

                    {/*
                      Document verification is decided from the document's OWN
                      status, never from the parent request's status. A request
                      can be `verified` while its supporting documents are still
                      `pending`, and staff must still be able to act on them.
                      The status badge above already renders the document's
                      current state, so decided documents need no extra controls.
                    */}
                    {doc.status === 'pending' && !docStale && (
                      <div className="mt-2.5 flex flex-wrap gap-2 pl-7">
                        <button
                          type="button"
                          onClick={() => void handleDocumentStatus(doc, 'verified')}
                          disabled={docBusyId === doc.id}
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
                        >
                          Mark verified
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDocumentStatus(doc, 'rejected')}
                          disabled={docBusyId === doc.id}
                          className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50"
                        >
                          Mark rejected
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/*
          The right column sticks on large screens.

          The decision panel is the reason to open this page, and it is also the
          tallest thing in it: on a request with ten documents and a long
          description, scrolling to the bottom to find Verify meant the reviewer
          could not see the description they were verifying. Sticking the column
          keeps the decision controls in view while the evidence is read. On
          mobile it stays in normal flow, because a sticky panel that covers half
          a phone screen is worse than scrolling.
        */}
        <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
          <Panel title="Decision">
            {requestStale ? (
              <p className="text-sm text-amber-800">
                Reload this request to see its current status before recording a decision.
              </p>
            ) : (
              <>
            {isSubmitted && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  This request has been submitted and is waiting for a reviewer. Start the review to
                  take ownership of it.
                </p>
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={pending !== null}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  {pending === 'start' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <PlayCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                  Start review
                </button>
              </div>
            )}

            {isUnderReview && (
              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="decision-notes"
                    className="mb-1 block text-xs font-medium tracking-wide text-slate-500 uppercase"
                  >
                    {decision === 'reject' ? 'Rejection reason' : 'Verification notes'}
                  </label>
                  <textarea
                    id="decision-notes"
                    rows={5}
                    value={notes}
                    /*
                      Capped to the same 2000 the server enforces. Without this a
                      reviewer could paste 5000 characters, fill the box, press
                      Confirm, and have the whole decision rejected by the RPC for
                      a reason the field gave no hint about.
                    */
                    maxLength={NOTES_MAX_LENGTH}
                    aria-describedby="decision-notes-help"
                    onChange={(e) => {
                      setNotes(e.target.value);
                      if (decision) setActionError(null);
                    }}
                    placeholder={
                      decision === 'reject'
                        ? 'Explain why this request cannot be verified. The requester will see this.'
                        : 'Record what you checked and why this request is genuine.'
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <p id="decision-notes-help" className="mt-1 text-xs text-slate-500">
                    {notes.trim().length}/{NOTES_MAX_LENGTH}. This is stored on the request and
                    written to the audit log.
                  </p>
                </div>

                {!decision && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDecision('verify');
                        setActionError(null);
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      Verify
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDecision('reject');
                        setActionError(null);
                      }}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800 hover:bg-rose-100"
                    >
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      Reject
                    </button>
                  </div>
                )}

                {decision && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm font-medium text-slate-900">
                      {decision === 'verify'
                        ? 'Mark this request as verified?'
                        : 'Reject this request?'}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {decision === 'verify'
                        ? 'This records a verified status. It will NOT be published — publishing stays a separate step.'
                        : 'The requester will be able to see the reason. This cannot be undone from this screen.'}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        ref={confirmRef}
                        type="button"
                        onClick={decision === 'verify' ? handleVerify : handleReject}
                        disabled={pending !== null || notesMissing}
                        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
                          decision === 'verify'
                            ? 'bg-emerald-600 hover:bg-emerald-700'
                            : 'bg-rose-600 hover:bg-rose-700'
                        }`}
                      >
                        {pending === decision ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        {decision === 'verify'
                          ? 'Confirm verification'
                          : 'Confirm rejection'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDecision(null);
                          setActionError(null);
                        }}
                        disabled={pending !== null}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </div>
                    {notesMissing && (
                      <p className="mt-2 text-xs font-medium text-rose-700">
                        {decision === 'reject' ? 'A rejection reason is required.' : 'Verification notes are required.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {isVerified && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  <div>
                    <p className="font-bold">VERIFIED</p>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      Verified{request.verifiedAt ? ` on ${formatDate(request.verifiedAt)}` : ''}.
                    </p>
                  </div>
                </div>

                {request.verificationNotes && (
                  <div>
                    <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                      Recorded Verification Notes
                    </p>
                    <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm whitespace-pre-line text-slate-800">
                      {request.verificationNotes}
                    </p>
                  </div>
                )}

                {/* Publish to Public flow */}
                <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-violet-900 font-bold text-sm">
                    <Globe className="h-4 w-4 text-violet-700" />
                    <span>READY TO PUBLISH</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    This request has passed verification. When ready, publishing will make it publicly visible to donors and the community on the Help page.
                  </p>

                  {!confirmingPublish ? (
                    <button
                      type="button"
                      onClick={() => setConfirmingPublish(true)}
                      disabled={pending !== null}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 shadow-sm disabled:opacity-50"
                    >
                      <Globe className="h-4 w-4" />
                      PUBLISH TO PUBLIC
                    </button>
                  ) : (
                    <div className="rounded-lg border border-violet-300 bg-white p-3 space-y-2.5">
                      <p className="text-xs font-bold text-slate-900">
                        Confirm publishing this request?
                      </p>
                      <p className="text-xs text-slate-600">
                        The title, description, urgency, and funding target will become publicly visible. Supporting documents will remain private.
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          ref={confirmRef}
                          type="button"
                          onClick={handlePublish}
                          disabled={pending !== null}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                          {pending === 'publish' ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                          Confirm & Publish
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingPublish(false)}
                          disabled={pending !== null}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isPublished && (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3.5 py-3 text-sm text-violet-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" aria-hidden="true" />
                  <div>
                    <p className="font-bold">PUBLISHED</p>
                    <p className="text-xs text-violet-700 mt-0.5">
                      Live on public site{request.publishedAt ? ` since ${formatDate(request.publishedAt)}` : ''}.
                    </p>
                  </div>
                </div>

                {request.verificationNotes && (
                  <div>
                    <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                      Recorded Verification Notes
                    </p>
                    <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm whitespace-pre-line text-slate-800">
                      {request.verificationNotes}
                    </p>
                  </div>
                )}

                <Link
                  to={`/help/${request.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-semibold text-violet-800 hover:bg-violet-100"
                >
                  <Globe className="h-4 w-4" />
                  View Public Listing
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}

            {isRejected && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 text-sm text-rose-800">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
                  <div>
                    <p className="font-bold">REJECTED</p>
                    <p className="text-xs text-rose-700 mt-0.5">
                      This request was not approved. It is not publicly visible.
                    </p>
                  </div>
                </div>

                {request.rejectionReason && (
                  <div>
                    <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
                      Recorded Rejection Reason
                    </p>
                    <p className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm whitespace-pre-line text-slate-800">
                      {request.rejectionReason}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/*
              The honest "nothing to do here" state.

              `draft`, `active`, `resolved` and `closed` are reachable in the
              database but not through any staff transition — the allowlist is
              submitted -> under_review -> verified/rejected, plus verified ->
              published. Without this branch the Decision panel rendered as a
              titled but completely empty box, which reads as a broken page rather
              than as "this stage has no staff action".
            */}
            {!ACTIONABLE_STATUSES.includes(request.status) && (
              <p className="text-sm text-slate-600">
                No staff action is available at this stage.{' '}
                {request.status === 'draft' ? (
                  <>This request has not been submitted yet, so there is nothing to review.</>
                ) : (
                  <>It has already moved past the review lifecycle.</>
                )}
              </p>
            )}
              </>
            )}
          </Panel>

          <Panel title="Lifecycle">
            {/*
              Only steps backed by a dedicated timestamp column are dated.

              This previously filled in `updatedAt` for the "Under review" and
              "Rejected" steps, which is simply not when those transitions
              happened — `updated_at` moves on every subsequent write, so a
              request reviewed and rejected a month ago displayed that day's
              date as the moment review began. There is no `review_started_at`
              column, so those two steps show as reached with no date rather
              than an invented one.
            */}
            <ol className="space-y-3 text-sm">
              {LIFECYCLE_STEPS.map((step) => {
                const reached = LIFECYCLE_REACHED[step.key].includes(request.status);
                const at = lifecycleTimestamps(request)[step.key];
                return (
                  <li key={step.key} className="flex items-start gap-3">
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                        reached ? 'bg-emerald-600' : 'bg-slate-300'
                      }`}
                      aria-hidden="true"
                    />
                    <span className={reached ? 'text-slate-900 font-medium' : 'text-slate-400'}>
                      {step.label}
                      {at && (
                        <span className="block text-xs text-slate-500">{formatDateTime(at)}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </Panel>

          {/*
            The full audit trail, below the Lifecycle summary.

            The Lifecycle list shows the four milestones a reviewer reasons about.
            This shows everything else: the requester's submission, each document
            decision, and the sequence in which they happened. It is deliberately
            last in the column — it is context, not a precondition for a
            decision — and it is progressive enhancement, so all three of its
            states are honest rather than alarming:

              - unavailable: this role cannot read admin_actions. Say that, do
                not render an empty list, and do not block the page.
              - empty: the request is genuinely new. Say so.
              - error: a real failure. Offer a retry.
          */}
          <Panel
            title="Review history"
            action={<History className="h-4 w-4 text-slate-400" aria-hidden="true" />}
          >
            {auditLoading ? (
              <p className="py-4 text-center text-sm text-slate-500" role="status">
                Loading history...
              </p>
            ) : auditUnavailable ? (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                The detailed audit log is not visible to your role. The lifecycle and timestamps
                above are still recorded on the request itself.
              </p>
            ) : auditError ? (
              <div role="alert" className="text-sm">
                <p className="text-rose-700">{staffErrorText(auditError)}</p>
                <button
                  type="button"
                  onClick={() => id && void loadAudit(id)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Loader2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Retry
                </button>
              </div>
            ) : (audit?.length ?? 0) === 0 ? (
              <p className="py-4 text-center text-sm text-slate-500">
                No decisions have been recorded on this request yet.
              </p>
            ) : (
              <ol className="space-y-3">
                {audit?.map((entry) => (
                  <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
                    <p className="text-sm font-medium text-slate-900">
                      {describeAuditAction(entry)}
                    </p>
                    {entry.createdAt && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDateTime(entry.createdAt)}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs whitespace-pre-line text-slate-700">
                        {entry.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

/**
 * The queue that can actually show this request in its current state.
 *
 * A submitted, under-review or verified request is on a work queue; a rejected,
 * published or closed one is only on the decided list. Sending a reviewer to
 * /staff after a rejection dropped them on a dashboard tile for a different
 * stage, with no way to find the request they had just acted on.
 */
function reviewBackHref(status: StaffRequestStatus): string {
  if (status === 'submitted' || status === 'under_review' || status === 'verified') {
    return `/staff/requests?status=${status}`;
  }
  return '/staff/requests?status=all';
}

/**
 * Turns an `admin_actions.action` string into readable text.
 *
 * The action values are written by the SECURITY DEFINER RPCs, not by this code,
 * so they are treated as untrusted input: an unknown value falls back to the raw
 * string rather than being dropped. Silently discarding a history row would hide
 * exactly the kind of event a reviewer most needs to see.
 */
function describeAuditAction(entry: StaffAuditEntry): string {
  const from = entry.oldStatus ? statusLabel(entry.oldStatus) : null;
  const to = entry.newStatus ? statusLabel(entry.newStatus) : null;

  if (from && to) {
    return `${AUDIT_ACTION_LABELS[entry.action] ?? entry.action} (${from} → ${to})`;
  }
  if (to) return `${AUDIT_ACTION_LABELS[entry.action] ?? entry.action} (${to})`;
  return AUDIT_ACTION_LABELS[entry.action] ?? entry.action;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  request_submitted: 'Request submitted',
  review_started: 'Review started',
  request_verified: 'Request verified',
  request_rejected: 'Request rejected',
  request_published: 'Request published',
  document_status_changed: 'Document status changed',
  request_status_changed: 'Status changed',
};

function statusLabel(status: string): string {
  // `staffLabel`, not `requesterLabel`: this panel is read by staff, and the
  // requester wording for `under_review` is deliberately vague.
  return requestStatusMeta(status)?.staffLabel ?? status;
}
