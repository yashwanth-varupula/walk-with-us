import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  HeartHandshake,
} from 'lucide-react';
import {
  countPublicHelpRequests,
  getAllPublicHelpRequests,
  getCategories,
  type PublicHelpRequest,
} from '../../services/helpRequests';
import { formatINR, formatCount, pluralise } from '../../lib/format';
import { LinkButton } from '../../components/ui/Button';
import { ErrorState } from '../../components/ui/Card';

interface ImpactMetrics {
  liveRequests: number;
  citiesCovered: number;
  categoriesInUse: number;
  totalNeeded: number;
  criticalCount: number;
}

const EMPTY: ImpactMetrics = {
  liveRequests: 0,
  citiesCovered: 0,
  categoriesInUse: 0,
  totalNeeded: 0,
  criticalCount: 0,
};

const LIFECYCLE_STAGES = [
  {
    step: '01',
    title: 'Submission',
    desc: 'An individual or family describes what happened, specifies what assistance is needed, and attaches supporting documentation.',
  },
  {
    step: '02',
    title: 'Staff Review',
    desc: 'Our review team examines the request details, checks need authenticity, and clarifies any missing details.',
  },
  {
    step: '03',
    title: 'Document Authentication',
    desc: 'Medical reports, estimates, and identity records are verified in private secure storage and never exposed publicly.',
  },
  {
    step: '04',
    title: 'Publication',
    desc: 'The verified case is published on the community help directory with transparent goals and clear contribution pathways.',
  },
  {
    step: '05',
    title: 'Community Support',
    desc: 'Donors, neighbors, and volunteers contribute financial aid, transport, or practical assistance directly.',
  },
  {
    step: '06',
    title: 'Resolution',
    desc: 'The request concludes when its goal is met or practical support is delivered, updating the community on the outcome.',
  },
];

export default function Impact() {
  const [metrics, setMetrics] = useState<ImpactMetrics>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [requestAttempt, setRequestAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      setLoading(true);
      setError(false);

      const [all, categories, countResult] = await Promise.all([
        getAllPublicHelpRequests(),
        getCategories(),
        countPublicHelpRequests(),
      ]);

      if (!active) return;

      if (all.error || categories.error || (all.truncated && countResult.error)) {
        setError(true);
        setLoading(false);
        return;
      }

      const rows: PublicHelpRequest[] = all.rows;

      const cities = new Set(
        rows.map((r) => (r.locationCity ?? '').trim()).filter((c) => c.length > 0),
      );
      const categoryIds = new Set(
        rows.map((r) => r.categoryId).filter((c): c is string => Boolean(c)),
      );
      const knownCategoryIds = new Set((categories.data ?? []).map((c) => c.id));
      const resolvableCategories = new Set(
        [...categoryIds].filter((id) => knownCategoryIds.has(id)),
      );

      setMetrics({
        liveRequests: countResult.error ? rows.length : (countResult.count ?? rows.length),
        citiesCovered: cities.size,
        categoriesInUse: resolvableCategories.size,
        totalNeeded: rows.reduce((sum, r) => sum + (r.targetAmount ?? 0), 0),
        criticalCount: rows.filter((r) => r.urgency === 'critical').length,
      });
      setTruncated(all.truncated);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [requestAttempt]);

  return (
    <div className="min-h-screen bg-canvas py-8 sm:py-12">
      <div className="container-page max-w-4xl space-y-12 sm:space-y-16">
        {/* 1. Page Header */}
        <header className="space-y-3 border-b border-line pb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Platform Data &amp; Accountability
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
            Community Activity &amp; Verified Need
          </h1>
          <p className="text-base text-ink-muted leading-relaxed sm:text-lg max-w-2xl">
            Every figure on this page is derived directly from live verified requests on Walk With Us. We report real community demand without speculative outcome figures, simulated projections, or fabricated marketing statistics.
          </p>
        </header>

        {/* 2. Real Metrics Section */}
        {loading ? (
          <div className="border-y border-line py-8 animate-pulse">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-3 w-20 bg-slate-200 rounded-control" />
                  <div className="h-8 w-24 bg-slate-200 rounded-control" />
                  <div className="h-3 w-28 bg-slate-100 rounded-control" />
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <ErrorState
            title="Unable to load community metrics"
            message="The database is temporarily unavailable. You can still explore verified requests directly in the directory."
            onRetry={() => setRequestAttempt((n) => n + 1)}
          />
        ) : metrics.liveRequests === 0 ? (
          <div className="border border-line bg-surface p-8 text-center rounded-control max-w-xl mx-auto space-y-3">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-ink-subtle">
              <HeartHandshake className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-bold text-ink">
              No Active Requests in the Database Right Now
            </h2>
            <p className="text-sm text-ink-muted leading-relaxed">
              All previous requests have concluded, or new submissions are currently progressing through our team’s verification queue.
            </p>
            <div className="pt-2 flex flex-wrap justify-center gap-3">
              <LinkButton to="/request-help" size="sm" className="min-h-[44px]">
                Ask for Help
              </LinkButton>
              <LinkButton to="/help" variant="secondary" size="sm" className="min-h-[44px]">
                Browse Directory
              </LinkButton>
            </div>
          </div>
        ) : (
          <section aria-labelledby="metrics-heading" className="space-y-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Currently Visible
              </p>
              <h2 id="metrics-heading" className="sr-only">
                Platform Activity Summary
              </h2>
            </div>

            {/* Editorial Metric Strip */}
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8 border-y border-line py-8">
              <div className="space-y-1">
                <dt className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Live Requests
                </dt>
                <dd className="text-3xl sm:text-4xl font-bold text-ink tracking-tight tabular-nums">
                  {formatCount(metrics.liveRequests)}
                </dd>
                <p className="text-xs text-ink-muted">Published verified needs</p>
              </div>

              <div className="space-y-1">
                <dt className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Cities Covered
                </dt>
                <dd className="text-3xl sm:text-4xl font-bold text-ink tracking-tight tabular-nums">
                  {formatCount(metrics.citiesCovered)}
                </dd>
                <p className="text-xs text-ink-muted">Local geographic areas</p>
              </div>

              <div className="space-y-1">
                <dt className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Active Categories
                </dt>
                <dd className="text-3xl sm:text-4xl font-bold text-ink tracking-tight tabular-nums">
                  {formatCount(metrics.categoriesInUse)}
                </dd>
                <p className="text-xs text-ink-muted">Support focus areas</p>
              </div>

              <div className="space-y-1">
                <dt className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">
                  Combined Goal
                </dt>
                <dd className="text-2xl sm:text-3xl font-bold text-primary tracking-tight tabular-nums">
                  {formatINR(metrics.totalNeeded)}
                </dd>
                <p className="text-xs text-ink-muted">Verified applicant budgets</p>
              </div>
            </dl>

            {/* Safety Cap Truncated Notice */}
            {truncated && (
              <p className="text-xs text-ink-subtle leading-relaxed">
                Note: Category and city counts reflect recently queried active records, while the overall request count is exact.
              </p>
            )}

            {/* Critical Urgency Callout */}
            {metrics.criticalCount > 0 && (
              <div className="border-l-2 border-accent bg-canvas pl-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs sm:text-sm">
                <div className="flex items-center gap-2 text-ink">
                  <AlertCircle className="h-4 w-4 text-accent shrink-0" aria-hidden="true" />
                  <span>
                    <strong>{pluralise(metrics.criticalCount, 'request has', 'requests have')}</strong> immediate time-sensitive requirements.
                  </span>
                </div>
                <Link
                  to="/help"
                  className="font-semibold text-primary hover:text-primary-strong inline-flex items-center gap-1 min-h-[36px]"
                >
                  <span>View urgent requests</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            )}
          </section>
        )}

        {/* 3. How Impact Happens (The Lifecycle) */}
        <section aria-labelledby="lifecycle-heading" className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              The Lifecycle
            </p>
            <h2 id="lifecycle-heading" className="mt-1 text-xl font-bold text-ink sm:text-2xl">
              How community support unfolds
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              From the initial submission through human review, publication, and resolution.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 border-t border-line pt-6">
            {LIFECYCLE_STAGES.map((stage) => (
              <div key={stage.step} className="space-y-1.5">
                <span className="font-mono text-xs font-semibold text-ink-subtle">
                  {stage.step}
                </span>
                <h3 className="text-base font-semibold text-ink">{stage.title}</h3>
                <p className="text-sm leading-relaxed text-ink-muted">
                  {stage.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 4. Measurement Policy & Transparency */}
        <section aria-labelledby="policy-heading" className="border-t border-line pt-8 space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Transparency Standards
            </p>
            <h2 id="policy-heading" className="mt-1 text-xl font-bold text-ink sm:text-2xl">
              Our measurement policy &amp; data integrity
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              We uphold clear principles on what we share and what we deliberately refuse to fabricate.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-3 border-t border-line pt-6 text-xs sm:text-sm">
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>Live Calculations</span>
              </div>
              <p className="text-ink-muted leading-relaxed">
                Totals are computed directly from active database rows rather than fixed marketing copy or manual updates.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>Zero Inflated Numbers</span>
              </div>
              <p className="text-ink-muted leading-relaxed">
                We do not publish speculative metrics such as "lives touched", multiplier effects, or estimated social returns.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-ink">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>Authentic Budgeting</span>
              </div>
              <p className="text-ink-muted leading-relaxed">
                Requested funding goals reflect actual cost estimates reviewed and approved during staff verification.
              </p>
            </div>
          </div>
        </section>

        {/* 5. Final Action */}
        <section className="border-t border-line pt-8 space-y-4">
          <div className="max-w-2xl space-y-1.5">
            <h2 className="text-lg font-bold text-ink sm:text-xl">
              Support someone in need, or ask for help
            </h2>
            <p className="text-sm text-ink-muted leading-relaxed">
              Every number above represents an authentic family or individual verified by our team. Take part in supporting your community today.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <LinkButton to="/help" size="md" className="min-h-[44px]">
              Browse Current Requests
            </LinkButton>
            <LinkButton to="/request-help" variant="secondary" size="md" className="min-h-[44px]">
              Request Assistance
            </LinkButton>
            <LinkButton to="/volunteer" variant="secondary" size="md" className="min-h-[44px]">
              Volunteer With Us
            </LinkButton>
          </div>
        </section>
      </div>
    </div>
  );
}
