import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  HelpCircle,
  MapPin,
  RefreshCw,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import {
  getCategories,
  getHelpRequestById,
  type Category,
  type PublicHelpRequestDetail,
} from '../../services/helpRequests';
import { LinkButton } from '../../components/ui/Button';
import { ShareModal } from '../../components/ui/ShareModal';
import { DonationPanel } from '../../components/donation/DonationPanel';
import { formatDate, formatINR, formatLocation, fundingPercent } from '../../lib/format';
import { urgencyMeta } from '../../lib/status';
import { CONTACT_EMAIL } from '../../lib/siteConfig';

export default function HelpDetails() {
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<PublicHelpRequestDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shareOpen, setShareOpen] = useState(false);

  /* ------------------------------------------------------------- data fetch */

  const load = useCallback(
    async (isActive: () => boolean) => {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      setNotFound(false);

      const [requestResult, categoryResult] = await Promise.all([
        getHelpRequestById(id),
        getCategories(),
      ]);

      if (!isActive()) return;

      if (requestResult.error) {
        setRequest(null);
        setError(requestResult.error.message);
        setLoading(false);
        return;
      }

      if (!requestResult.data) {
        setRequest(null);
        setNotFound(true);
        setLoading(false);
        return;
      }

      setRequest(requestResult.data);
      setCategories(categoryResult.error ? [] : categoryResult.data);
      setLoading(false);
    },
    [id],
  );

  useEffect(() => {
    let active = true;
    void load(() => active);
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const categoryName = useMemo(() => {
    if (!request?.categoryId) return null;
    return categories.find((c) => c.id === request.categoryId)?.name ?? null;
  }, [request, categories]);

  const handleShare = async () => {
    if (!request) return;
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: request.title,
          text: `Support this cause on Walk With Us: "${request.title}"`,
          url: window.location.href,
        });
        return;
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
      }
    }
    setShareOpen(true);
  };

  /* ---------------------------------------------------------- loading state */

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas py-8 sm:py-12">
        <div className="container-page max-w-5xl">
          <div className="h-4 w-32 bg-slate-200 rounded-control animate-pulse mb-6" />
          <div className="space-y-4 animate-pulse">
            <div className="h-4 w-40 bg-slate-200 rounded-control" />
            <div className="h-8 w-3/4 max-w-xl bg-slate-200 rounded-control" />
            <div className="h-4 w-48 bg-slate-100 rounded-control" />
            <div className="pt-8 space-y-3">
              <div className="h-4 w-full bg-slate-100 rounded-control" />
              <div className="h-4 w-5/6 bg-slate-100 rounded-control" />
              <div className="h-4 w-4/5 bg-slate-100 rounded-control" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------- not found state */

  if (notFound) {
    return (
      <section className="flex min-h-[65vh] items-center justify-center bg-canvas px-4 py-12">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-control bg-slate-100 text-ink-subtle">
            <HelpCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Request Not Found
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            This help request is currently unavailable. It may no longer be published, or the reference link may be incorrect.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <LinkButton to="/help" size="sm" className="min-h-[44px]">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Browse All Requests
            </LinkButton>
            <LinkButton to="/request-help" variant="secondary" size="sm" className="min-h-[44px]">
              Ask for Help
            </LinkButton>
          </div>
        </div>
      </section>
    );
  }

  /* ------------------------------------------------------------ error state */

  if (error || !request) {
    return (
      <section className="flex min-h-[65vh] items-center justify-center bg-canvas px-4 py-12">
        <div className="w-full max-w-md text-center" role="alert">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-control bg-rose-100 text-rose-700">
            <AlertCircle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-ink sm:text-2xl">
            Unable to Load Request
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {error ?? 'Something went wrong while retrieving this request from the database.'}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <LinkButton to="/help" variant="secondary" size="sm" className="min-h-[44px]">
              Back to Browse
            </LinkButton>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-control bg-primary px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-primary-strong transition-colors focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Try Again
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ---------------------------------------------------------- computations */

  const urgency = urgencyMeta(request.urgency);
  const location = formatLocation(request.locationCity, request.locationState);
  const hasTarget = typeof request.targetAmount === 'number' && Number.isFinite(request.targetAmount) && request.targetAmount > 0;
  const target = hasTarget ? request.targetAmount! : 0;
  const raised = request.raisedAmount ?? 0;
  const percent = hasTarget ? fundingPercent(raised, target) : 0;
  const isFullyFunded = hasTarget && raised >= target;
  const isUrgent = request.urgency === 'high' || request.urgency === 'critical';

  return (
    <div className="min-h-screen bg-canvas pb-24 pt-6 sm:py-10 lg:pb-12">
      <div className="container-page max-w-5xl">
        {/* Navigation Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <Link
            to="/help"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Back to All Requests</span>
          </Link>
        </nav>

        {/* 1. Page Header */}
        <header className="space-y-3 pb-6 border-b border-line">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
            {categoryName && (
              <span className="font-semibold text-primary">
                {categoryName}
              </span>
            )}
            {categoryName && location && <span>·</span>}
            {location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 text-ink-subtle" aria-hidden="true" />
                {location}
              </span>
            )}
            {isUrgent && (
              <>
                <span>·</span>
                <span className="font-semibold text-accent">
                  {urgency.label} Urgency
                </span>
              </>
            )}
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl leading-tight">
            {request.title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              Staff-reviewed request
            </span>
            {request.publishedAt && (
              <>
                <span>·</span>
                <span>Published on {formatDate(request.publishedAt)}</span>
              </>
            )}
          </div>
        </header>

        {/* 2-Column Responsive Layout: Story (Main) / Funding & Support (Sidebar) */}
        <div className="grid gap-10 lg:grid-cols-12 items-start pt-8">
          {/* Main Column: Story & Request Details (7 cols) */}
          <main className="space-y-8 lg:col-span-7">
            {/* The Story */}
            <article>
              {request.imageUrl && (
                <div className="mb-6 overflow-hidden rounded-card border border-line bg-canvas">
                  <img
                    src={request.imageUrl}
                    alt={request.title}
                    className="aspect-video w-full object-cover"
                  />
                </div>
              )}
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                About this Request
              </h2>
              <div className="prose prose-slate mt-3 max-w-none text-base leading-relaxed text-ink/85 whitespace-pre-line">
                {request.description}
              </div>
            </article>

            {/* Mobile In-Flow Funding & Donation Section */}
            <div className="border-t border-line pt-6 lg:hidden">
              {hasTarget ? (
                <div className="space-y-4">
                  <DonationPanel
                    requestId={request.id}
                    requestTitle={request.title}
                    targetAmount={request.targetAmount}
                    raisedAmount={request.raisedAmount}
                    isFullyFunded={isFullyFunded}
                    hasTarget={hasTarget}
                    onShareClick={() => void handleShare()}
                  />
                  <button
                    type="button"
                    onClick={() => void handleShare()}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
                  >
                    <Share2 className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
                    <span>Share this Story</span>
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                    Community Support
                  </p>
                  <div className="mt-2">
                    <p className="text-sm font-medium text-ink">Direct Non-Monetary Aid</p>
                    <p className="text-xs text-ink-muted mt-0.5">
                      This request asks for direct volunteer support, transport, or supplies rather than financial donations.
                    </p>
                  </div>
                  <div className="mt-4 flex flex-col gap-2.5">
                    <LinkButton to="/volunteer" variant="primary" block size="md" className="min-h-[44px]">
                      Volunteer to Support
                    </LinkButton>
                    <button
                      type="button"
                      onClick={() => void handleShare()}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary min-h-[44px]"
                    >
                      <Share2 className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
                      <span>Share this Story</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Request Details & Context */}
            <section className="border-t border-line pt-8">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Request Details
              </h2>
              <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-xs">
                {categoryName && (
                  <div>
                    <dt className="text-ink-subtle">Category</dt>
                    <dd className="mt-0.5 font-semibold text-ink text-sm">{categoryName}</dd>
                  </div>
                )}
                {location && (
                  <div>
                    <dt className="text-ink-subtle">Location</dt>
                    <dd className="mt-0.5 font-semibold text-ink text-sm">{location}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-ink-subtle">Assistance Type</dt>
                  <dd className="mt-0.5 font-semibold text-ink text-sm">
                    {hasTarget ? 'Financial Support' : 'Practical / Direct Aid'}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Urgency Level</dt>
                  <dd className="mt-0.5 font-semibold text-ink text-sm">{urgency.label}</dd>
                </div>
              </dl>
            </section>

            {/* Factual Trust & Transparency Reassurance */}
            <section className="border-t border-line pt-8 space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Verification &amp; Privacy
              </h2>
              <p className="text-xs sm:text-sm text-ink-muted leading-relaxed">
                This request was submitted to Walk With Us and reviewed by staff before publication. Supporting identity and medical documents are kept in private, protected storage to protect the family’s privacy and are never displayed publicly.
              </p>
              <div className="pt-2">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
                    `[Walk With Us] Inquiry regarding request: "${request.title}"`,
                  )}`}
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-strong transition-colors"
                >
                  Have questions about this request? Contact our team
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </a>
              </div>
            </section>
          </main>

          {/* Sidebar: Restrained Funding Panel (5 cols on desktop, sticky) */}
          <aside className="hidden lg:block lg:col-span-5 lg:sticky lg:top-24 space-y-4">
            {hasTarget ? (
              <DonationPanel
                requestId={request.id}
                requestTitle={request.title}
                targetAmount={request.targetAmount}
                raisedAmount={request.raisedAmount}
                isFullyFunded={isFullyFunded}
                hasTarget={hasTarget}
                onShareClick={() => void handleShare()}
              />
            ) : (
              <div className="border border-line bg-surface p-6 sm:p-7 rounded-control space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                  Assistance Type
                </p>
                <p className="text-lg font-bold text-ink">Direct Community Support</p>
                <p className="text-xs text-ink-muted leading-relaxed">
                  This request asks for direct volunteer assistance, transport, or physical supplies rather than financial donations.
                </p>
                <LinkButton to="/volunteer" variant="primary" size="md" block className="min-h-[44px]">
                  Volunteer to Support
                </LinkButton>
              </div>
            )}

            {/* Other Ways to Help & Verification */}
            <div className="border border-line bg-surface p-5 rounded-control space-y-4">
              <button
                type="button"
                onClick={() => void handleShare()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-control border border-line bg-surface px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-primary min-h-[40px]"
              >
                <Share2 className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
                <span>Share this Story</span>
              </button>

              <div className="border-t border-line/60 pt-3 space-y-1.5 text-xs">
                <p className="font-semibold text-ink">Other ways to stand with them</p>
                <Link
                  to="/volunteer"
                  className="inline-flex items-center gap-1 text-primary hover:text-primary-strong transition-colors font-medium"
                >
                  Can you offer practical help? Volunteer with us
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>

              <div className="border-t border-line/60 pt-3 text-xs text-ink-subtle space-y-1">
                <p className="flex items-center gap-1.5 font-medium text-ink">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  Staff-reviewed request
                </p>
                <p className="leading-relaxed">
                  Every request on Walk With Us is reviewed before publication. Documents and personal details remain confidential.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile Sticky Bottom Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="container-page flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {hasTarget ? (
              <div>
                <span className="block text-sm font-bold text-ink truncate tabular-nums">
                  {formatINR(raised)}{' '}
                  <span className="font-normal text-xs text-ink-subtle">of {formatINR(target)}</span>
                </span>
                <span className="text-[11px] font-semibold text-primary">{percent}% funded</span>
              </div>
            ) : (
              <span className="text-xs font-medium text-ink-muted">Direct community aid</span>
            )}
          </div>
          {isFullyFunded ? (
            <LinkButton to="/help" size="sm" className="shrink-0 min-h-[44px]">
              Browse Other
            </LinkButton>
          ) : hasTarget ? (
            <button
              type="button"
              onClick={() => {
                const el = document.getElementById('donation-section');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth' });
                }
              }}
              className="inline-flex items-center justify-center rounded-control bg-primary px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-primary-strong transition-colors min-h-[44px] shrink-0"
            >
              Donate
            </button>
          ) : (
            <LinkButton to="/volunteer" variant="primary" size="sm" className="shrink-0 min-h-[44px]">
              Volunteer
            </LinkButton>
          )}
        </div>
      </div>

      {/* Share Modal Dialog */}
      <ShareModal
        isOpen={shareOpen}
        onClose={() => setShareOpen(false)}
        title={request.title}
      />
    </div>
  );
}
