import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  HelpCircle,
  Loader2,
  Lock,
  Pencil,
  RotateCcw,
} from 'lucide-react';
import {
  getOwnedHelpRequestById,
  getCategories,
  listHelpRequestDocuments,
  createRequesterDocumentUrl,
  getDocumentDisplayName,
  type UserHelpRequestDetail as RequestDetailType,
  type Category,
  type HelpRequestDocumentRecord,
} from '../../services/helpRequests';
import { LinkButton } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { TimelineTracker } from '../../components/ui/TimelineTracker';
import { formatDate, formatINR, formatLocation, fundingPercent } from '../../lib/format';
import {
  DOCUMENT_STATUS_META,
  requestStatusMeta,
  urgencyMeta,
  type Tone,
} from '../../lib/status';

interface StatusPresentation {
  label: string;
  tone: Tone;
  statusExplanation: string;
  nextStepExplanation: string;
}

const STATUS_DETAILS: Record<string, StatusPresentation> = {
  draft: {
    label: 'Private Draft',
    tone: 'idle',
    statusExplanation: 'Your request is currently saved as a private draft. Only you can view or edit it.',
    nextStepExplanation:
      'Complete the required fields and submit your request. Staff review and verification will begin as soon as you submit.',
  },
  submitted: {
    label: 'Submitted for Review',
    tone: 'info',
    statusExplanation:
      'We have received your request. It is safely in our queue and will be assigned to a reviewer shortly.',
    nextStepExplanation:
      'A dedicated staff member will review your situation and authenticate your supporting documents. You will see an update here once review begins.',
  },
  under_review: {
    label: 'Under Staff Review',
    tone: 'warn',
    statusExplanation:
      'A dedicated staff reviewer is actively checking your story and verifying your supporting documents.',
    nextStepExplanation:
      'Verification ensures safety and protects community trust. If any additional details are needed, our team will provide guidance here.',
  },
  verified: {
    label: 'Verified by Staff',
    tone: 'good',
    statusExplanation:
      'Your request and supporting documents have been reviewed, authenticated, and verified by our team.',
    nextStepExplanation:
      'Your request is approved and queued for publication on the public help directory, where community supporters can discover and contribute.',
  },
  published: {
    label: 'Published & Live',
    tone: 'good',
    statusExplanation:
      'Your request is live on the Walk With Us community directory and open for community support.',
    nextStepExplanation:
      'Share your request link with friends, family, and community members. Supporters can contribute donations or volunteer assistance directly.',
  },
  active: {
    label: 'Active Community Support',
    tone: 'good',
    statusExplanation:
      'Community members, donors, or volunteers are actively contributing assistance toward your request.',
    nextStepExplanation:
      'Track real-time contributions in the funding progress section below. Our staff coordinates support delivery directly with you.',
  },
  resolved: {
    label: 'Successfully Resolved',
    tone: 'good',
    statusExplanation:
      'This request has reached its goal or completed its assistance. Support has been delivered.',
    nextStepExplanation:
      'The need has been met. Thank you for walking with us and allowing the community to support you.',
  },
  closed: {
    label: 'Request Closed',
    tone: 'idle',
    statusExplanation:
      'This request has been closed and is no longer accepting public community contributions.',
    nextStepExplanation:
      'If your circumstances change or you need new assistance, you are welcome to submit a new request at any time.',
  },
  rejected: {
    label: 'Needs Revision',
    tone: 'stop',
    statusExplanation:
      'Our review team was unable to verify this request in its current format.',
    nextStepExplanation:
      'Please read the specific review notes below. You can submit a revised request addressing this feedback whenever you are ready.',
  },
};

export default function UserRequestDetail() {
  const { id } = useParams<{ id: string }>();

  const [request, setRequest] = useState<RequestDetailType | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [documents, setDocuments] = useState<HelpRequestDocumentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [openingDocId, setOpeningDocId] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const [reqResult, catResult, docResult] = await Promise.all([
          getOwnedHelpRequestById(id),
          getCategories(),
          listHelpRequestDocuments(id),
        ]);

        if (!active) return;

        if (reqResult.error) {
          setError(reqResult.error.message);
          setLoading(false);
          return;
        }

        if (!reqResult.data) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        setRequest(reqResult.data);
        setCategories(catResult.error ? [] : catResult.data);

        if (docResult.error) {
          setDocError('Saved documents could not be loaded.');
          setDocuments([]);
        } else if (docResult.data) {
          setDocuments(docResult.data);
        }
      } catch (err: unknown) {
        if (!active) return;
        console.error('Request detail load error', err);
        setError('Unable to load this request. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [id]);

  const categoryName = useMemo(() => {
    if (!request?.categoryId) return null;
    return categories.find((c) => c.id === request.categoryId)?.name ?? null;
  }, [request, categories]);

  const handleOpenDocument = async (doc: HelpRequestDocumentRecord) => {
    setDocError(null);
    setOpeningDocId(doc.id || doc.storagePath);
    try {
      const res = await createRequesterDocumentUrl(doc.storagePath);
      if (res.error || !res.data) {
        setDocError(res.error?.message ?? 'Could not open document.');
        return;
      }
      window.open(res.data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setDocError('Could not open document.');
    } finally {
      setOpeningDocId(null);
    }
  };

  if (loading) {
    return (
      <section className="flex min-h-[65vh] items-center justify-center bg-canvas">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-primary" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-muted" role="status">
            Loading your request details…
          </p>
        </div>
      </section>
    );
  }

  if (notFound || !request) {
    return (
      <section className="flex min-h-[65vh] items-center justify-center bg-canvas">
        <div className="container-narrow text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-control bg-slate-100 text-ink-muted">
            <HelpCircle className="h-5 w-5" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Request Not Found
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            This request could not be found or belongs to a different account.
          </p>
          <div className="mt-6">
            <LinkButton to="/my-requests" variant="secondary" size="md">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to My Requests
            </LinkButton>
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="flex min-h-[65vh] items-center justify-center bg-canvas" role="alert">
        <div className="container-narrow text-center">
          <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Unable to Load Request
          </h1>
          <p className="mt-2 text-sm text-ink-muted">{error}</p>
          <div className="mt-6">
            <LinkButton to="/my-requests" variant="secondary" size="md">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to My Requests
            </LinkButton>
          </div>
        </div>
      </section>
    );
  }

  const statusMeta = requestStatusMeta(request.status);
  const urgency = urgencyMeta(request.urgency);
  const presentation = STATUS_DETAILS[request.status] ?? {
    label: statusMeta.requesterLabel,
    tone: statusMeta.tone,
    statusExplanation: statusMeta.requesterDescription,
    nextStepExplanation: 'Our team will keep this page updated as actions are taken.',
  };

  const hasTarget = (request.targetAmount ?? 0) > 0;
  const percent = hasTarget ? fundingPercent(request.raisedAmount, request.targetAmount) : 0;
  const isRejected = request.status === 'rejected';
  const isPublishedOrActive = request.status === 'published' || request.status === 'active';
  const location = formatLocation(request.locationCity, request.locationState);

  return (
    <div className="min-h-screen bg-canvas py-6 sm:py-10">
      <div className="container-narrow space-y-8">
        {/* Navigation Breadcrumb */}
        <div>
          <Link
            to="/my-requests"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to My Requests
          </Link>
        </div>

        {/* 1. Request Identity Header */}
        <header className="space-y-3 pb-6 border-b border-line">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            {categoryName && (
              <span className="font-medium text-ink">
                {categoryName}
              </span>
            )}
            {categoryName && location && <span>·</span>}
            {location && (
              <span>{location}</span>
            )}
            {urgency.rank >= 2 && (
              <>
                <span>·</span>
                <span className="font-medium text-accent">
                  {urgency.label} Urgency
                </span>
              </>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            {request.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
            <span>Created {formatDate(request.createdAt)}</span>
            {request.submittedAt && (
              <>
                <span>·</span>
                <span>Submitted {formatDate(request.submittedAt)}</span>
              </>
            )}
            {request.verifiedAt && (
              <>
                <span>·</span>
                <span>Verified {formatDate(request.verifiedAt)}</span>
              </>
            )}
            {request.publishedAt && (
              <>
                <span>·</span>
                <span>Published {formatDate(request.publishedAt)}</span>
              </>
            )}
          </div>
        </header>

        {/* 2. Current Status & What Happens Next */}
        <section aria-labelledby="status-heading">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Current Status
          </p>
          <div className="mt-1 flex items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                presentation.tone === 'good'
                  ? 'bg-emerald-600'
                  : presentation.tone === 'warn'
                    ? 'bg-amber-600'
                    : presentation.tone === 'stop'
                      ? 'bg-rose-600'
                      : presentation.tone === 'info'
                        ? 'bg-sky-600'
                        : 'bg-slate-500'
              }`}
              aria-hidden="true"
            />
            <h2 id="status-heading" className="text-xl font-bold text-ink sm:text-2xl">
              {presentation.label}
            </h2>
          </div>
          <p className="mt-2 text-sm text-ink-muted leading-relaxed sm:text-base">
            {presentation.statusExplanation}
          </p>

          {/* 3. What Happens Next */}
          <div className="mt-5 border-t border-line/60 pt-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              What happens next
            </p>
            <p className="mt-1 text-sm text-ink-muted leading-relaxed">
              {presentation.nextStepExplanation}
            </p>
          </div>

          {/* Reviewer Rejection / Feedback Note (when present) */}
          {isRejected && request.rejectionReason && (
            <div className="mt-5 rounded-control border border-rose-200 bg-rose-50/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-900">
                Feedback from Review Team
              </p>
              <p className="mt-1.5 whitespace-pre-line text-sm font-medium text-rose-950 leading-relaxed">
                {request.rejectionReason}
              </p>
              <p className="mt-2 text-xs text-rose-800">
                You can review the notes above and submit a revised request whenever you are ready.
              </p>
            </div>
          )}

          {/* 4. Action Buttons */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {statusMeta.editable && (
              <LinkButton
                to={`/request-help?draftId=${encodeURIComponent(request.id)}`}
                variant="primary"
                size="md"
                className="min-h-[44px]"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Continue Editing Draft
              </LinkButton>
            )}

            {isPublishedOrActive && (
              <LinkButton
                to={`/help/${encodeURIComponent(request.id)}`}
                variant="primary"
                size="md"
                className="min-h-[44px]"
              >
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                View Live on Public Site
              </LinkButton>
            )}

            {isRejected && (
              <LinkButton to="/request-help" variant="primary" size="md" className="min-h-[44px]">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Start Revised Request
              </LinkButton>
            )}

            <LinkButton to="/my-requests" variant="secondary" size="md" className="min-h-[44px]">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Back to All Requests
            </LinkButton>
          </div>
        </section>

        {/* 5. Request Journey (Timeline) */}
        <section className="border-t border-line pt-8" aria-labelledby="journey-heading">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Request Journey
            </p>
            <h2 id="journey-heading" className="mt-1 text-lg font-bold text-ink sm:text-xl">
              Verification &amp; Progress
            </h2>
            <p className="mt-1 text-xs text-ink-muted">
              Step-by-step progress from your initial submission to resolution.
            </p>
          </div>

          <TimelineTracker
            status={request.status}
            rejectionReason={request.rejectionReason}
            createdAt={request.createdAt}
            submittedAt={request.submittedAt}
            verifiedAt={request.verifiedAt}
            publishedAt={request.publishedAt}
            updatedAt={request.updatedAt}
          />
        </section>

        {/* 6. Funding Progress (if applicable) or Non-Monetary Summary */}
        <section className="border-t border-line pt-8" aria-labelledby="funding-heading">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            {hasTarget ? 'Community Contributions' : 'Assistance Type'}
          </p>
          {hasTarget ? (
            <div className="mt-2 space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="funding-heading" className="text-xl sm:text-2xl font-bold text-ink tabular-nums">
                  {formatINR(request.raisedAmount ?? 0)}
                  <span className="ml-2 text-xs sm:text-sm font-normal text-ink-muted">
                    raised of {formatINR(request.targetAmount)} goal
                  </span>
                </h2>
                <span className="text-sm font-semibold text-primary tabular-nums">
                  {percent}% funded
                </span>
              </div>
              <ProgressBar value={percent} size="sm" />
              <p className="text-xs text-ink-subtle">
                Contributions are verified and recorded directly through the platform.
              </p>
            </div>
          ) : (
            <div className="mt-1">
              <h2 id="funding-heading" className="text-base font-semibold text-ink">
                Non-Monetary Community Request
              </h2>
              <p className="mt-1 text-xs sm:text-sm text-ink-muted leading-relaxed">
                This request asks for direct volunteer assistance, transport, or physical supplies rather than financial donations.
              </p>
            </div>
          )}
        </section>

        {/* 7. Request Details / Submitted Story */}
        <section className="border-t border-line pt-8" aria-labelledby="story-heading">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Request Details
          </p>
          <h2 id="story-heading" className="mt-1 text-lg font-bold text-ink sm:text-xl">
            Your Submitted Story
          </h2>
          <div className="mt-3 text-sm leading-relaxed text-ink/80 whitespace-pre-line sm:text-base">
            {request.description}
          </div>
        </section>

        {/* 8. Supporting Documents */}
        <section className="border-t border-line pt-8" aria-labelledby="documents-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Verification Documents
              </p>
              <h2 id="documents-heading" className="mt-1 text-lg font-bold text-ink sm:text-xl">
                Supporting Documents ({documents.length})
              </h2>
            </div>
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <Lock className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
              Private &amp; Protected
            </span>
          </div>

          <p className="mt-2 text-xs text-ink-muted leading-relaxed">
            Uploaded identification and verification records are stored securely. They are never shown publicly and are only accessible by you and authenticated review staff.
          </p>

          {docError && (
            <div className="mt-4">
              <Alert tone="stop" title="Document Access Error">
                {docError}
              </Alert>
            </div>
          )}

          {documents.length === 0 ? (
            <div className="mt-4 border-t border-line/60 pt-4 text-xs text-ink-muted">
              <p>No supporting documents attached to this request.</p>
              {statusMeta.editable && (
                <p className="mt-1 text-ink-subtle">
                  You can add supporting documents by editing your draft before submitting.
                </p>
              )}
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-line/70 border-t border-line/70" aria-label="Attached documents">
              {documents.map((doc) => {
                const docStatusMeta = DOCUMENT_STATUS_META[doc.status];
                const isOpening = openingDocId === (doc.id || doc.storagePath);

                return (
                  <li
                    key={doc.id || doc.storagePath}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {getDocumentDisplayName(doc.storagePath)}
                      </p>
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            doc.status === 'verified'
                              ? 'bg-emerald-600'
                              : doc.status === 'rejected'
                                ? 'bg-rose-600'
                                : 'bg-amber-600'
                          }`}
                          aria-hidden="true"
                        />
                        <span className="text-ink-muted font-medium">
                          {docStatusMeta?.requesterLabel ?? doc.status}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleOpenDocument(doc)}
                      disabled={isOpening}
                      className="inline-flex items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-xs font-medium text-ink hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50 min-h-[44px] sm:min-h-[36px] self-start sm:self-center transition-colors"
                    >
                      {isOpening ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          <span>Opening…</span>
                        </>
                      ) : (
                        <>
                          <Eye className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
                          <span>View Document</span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
