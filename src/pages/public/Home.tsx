import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  FileCheck2,
  Heart,
  HeartHandshake,
  MapPin,
  ShieldCheck,
  Sprout,
  Users,
} from 'lucide-react';

import { LinkButton } from '../../components/ui/Button';
import { EmptyState, ErrorState } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { CategoryCoverPlaceholder } from '../../components/ui/CategoryPlaceholder';
import { formatINR, fundingPercent } from '../../lib/format';
import heroChildImg from '../../assets/hero-child.jpg';

import {
  getCategories,
  getPublicHelpRequestsPage,
  type Category,
  type PublicHelpRequest,
} from '../../services/helpRequests';

const PREVIEW_LIMIT = 6;

const IMPACT_STATS = [
  {
    value: '10,000+',
    label: 'People Helped',
    icon: Sprout,
    iconColor: 'bg-emerald-50 text-emerald-700 border-emerald-200/70',
  },
  {
    value: '2,500+',
    label: 'Requests Resolved',
    icon: FileCheck2,
    iconColor: 'bg-sky-50 text-sky-700 border-sky-200/70',
  },
  {
    value: '1,200+',
    label: 'Active Volunteers',
    icon: Users,
    iconColor: 'bg-amber-50 text-amber-700 border-amber-200/70',
  },
  {
    value: '50+',
    label: 'Partner Organizations',
    icon: HeartHandshake,
    iconColor: 'bg-indigo-50 text-indigo-700 border-indigo-200/70',
  },
];

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < breakpoint;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };
    update(mql);
    const listener = (e: MediaQueryListEvent) => update(e);
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [breakpoint]);

  return isMobile;
}

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Ask for help',
    description:
      'Describe your situation, attach supporting documents, and specify what assistance or funding is needed. Drafts remain private until submitted.',
  },
  {
    step: '02',
    title: 'Our team reviews the request',
    description:
      'Staff authenticate details and verify supporting records in secure storage. No request is published without human review.',
  },
  {
    step: '03',
    title: 'Verified requests are published',
    description:
      'Once confirmed genuine, the request appears on the community help directory with transparent funding goals and direct contribution paths.',
  },
  {
    step: '04',
    title: 'The community steps in',
    description:
      'Neighbors, donors, and volunteers contribute financial support, transport, or practical help directly to the verified recipient.',
  },
];

export default function Home() {
  const [requests, setRequests] = useState<PublicHelpRequest[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const isMobile = useIsMobile();
  const displayedRequests = requests.slice(0, isMobile ? 4 : 6);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setLoadError(null);

    void (async () => {
      const [pageResult, categoryResult] = await Promise.all([
        getPublicHelpRequestsPage({ limit: PREVIEW_LIMIT }),
        getCategories(),
      ]);

      if (!active) return;

      setCategories(categoryResult.error ? [] : categoryResult.data);

      if (pageResult.error) {
        setRequests([]);
        setLoadError(pageResult.error.message);
      } else {
        setRequests(pageResult.rows);
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <div className="flex flex-col bg-canvas">
      {/* ============================================================
          SECTION 1 — HERO
          Matching user reference design:
          Left: Eyebrow, bold serif title, description, CTAs, 4 impact stats
          Right: Campaign child portrait holding "A BRIGHTER TOMORROW IS POSSIBLE" sign
          with organic shapes and "Real people. Real stories. Real change." script.
      ============================================================ */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-b from-[#FAF7F2] via-canvas to-canvas py-10 sm:py-16 lg:py-20">
        {/* Soft background pastel decorative shapes matching reference */}
        <div
          className="pointer-events-none absolute -top-24 right-0 h-96 w-96 rounded-full bg-emerald-100/35 blur-3xl"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute top-40 right-1/3 h-72 w-72 rounded-full bg-amber-100/35 blur-2xl"
          aria-hidden="true"
        />

        <div className="container-page relative">
          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
            {/* Left Column: Mission, Actions & Impact Metrics */}
            <div className="space-y-6 lg:col-span-7">
              <p className="text-xs font-bold uppercase tracking-widest text-[#0D5C3A]">
                Kindness creates change
              </p>

              <h1 className="font-serif text-3xl font-bold tracking-tight text-[#14261C] sm:text-4xl lg:text-5xl xl:text-6xl leading-[1.12]">
                No one should face a problem alone.
              </h1>

              <p className="text-base sm:text-lg leading-relaxed text-ink-muted max-w-xl">
                We connect people facing difficult situations with a caring community ready to walk
                with them.
              </p>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                <Link
                  to="/request-help"
                  className="inline-flex items-center justify-center gap-2 rounded-control bg-[#0D5C3A] hover:bg-[#09472C] text-white px-7 py-3.5 text-sm font-semibold shadow-xs transition-colors min-h-[46px]"
                >
                  <span>I Need Help</span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>

                <Link
                  to="/help"
                  className="inline-flex items-center justify-center gap-2 rounded-control bg-surface hover:bg-slate-50 text-[#0D5C3A] border border-line hover:border-[#0D5C3A]/50 px-7 py-3.5 text-sm font-semibold shadow-xs transition-colors min-h-[46px]"
                >
                  <Heart className="h-4 w-4 fill-rose-500 text-rose-500" aria-hidden="true" />
                  <span>I Want to Help</span>
                </Link>
              </div>

              {/* 4 Impact Stats matching reference */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-line/70">
                {IMPACT_STATS.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div key={stat.label} className="flex items-center gap-2.5">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${stat.iconColor}`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm sm:text-base font-bold text-ink leading-tight tabular-nums">
                          {stat.value}
                        </p>
                        <p className="text-[11px] sm:text-xs text-ink-muted font-medium truncate">
                          {stat.label}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Hero Visual Portrait */}
            <div className="lg:col-span-5">
              <div className="relative mx-auto max-w-md lg:max-w-none">
                {/* Organic backdrop accent blobs */}
                <div
                  className="absolute -top-6 -right-6 h-40 w-40 rounded-full bg-[#E5F3EC] -z-10"
                  aria-hidden="true"
                />
                <div
                  className="absolute -bottom-6 -left-6 h-44 w-44 rounded-full bg-[#FCEEE6] -z-10"
                  aria-hidden="true"
                />

                {/* Main Image Frame */}
                <div className="relative overflow-hidden rounded-3xl border border-line bg-surface shadow-md">
                  <div className="relative aspect-[4/3] sm:aspect-[4/3] w-full overflow-hidden bg-slate-100">
                    <img
                      src={heroChildImg}
                      alt="Smiling Indian child holding cardboard sign reading 'A BRIGHTER TOMORROW IS POSSIBLE'"
                      className="h-full w-full object-cover"
                      loading="eager"
                    />

                    {/* Script quote overlay on top right */}
                    <div className="absolute top-3.5 right-4 z-10 text-right drop-shadow-md">
                      <p className="font-serif italic text-xs sm:text-sm font-semibold text-white">
                        Real people.
                      </p>
                      <p className="font-serif italic text-xs sm:text-sm font-semibold text-white">
                        Real stories.
                      </p>
                      <p className="font-serif italic text-xs sm:text-sm font-bold text-white flex items-center justify-end gap-1">
                        Real change. <Heart className="h-3 w-3 fill-rose-500 text-rose-500 inline" />
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================
          SECTION 2 — VERIFIED REQUESTS PREVIEW
          Discovery grid matching visual reference:
          Desktop ≥ 1024px: 3 cols × 2 rows (6 cards)
          Mobile ≤ 767px: 1 col (4 cards)
          Followed by: Explore all community requests → (/help)
      ============================================================ */}
      <section className="py-12 sm:py-16 border-b border-line bg-canvas">
        <div className="container-page">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Verified Requests
            </p>
            <h2 className="mt-1 font-serif text-2xl sm:text-3xl font-bold tracking-tight text-ink">
              People who need our support
            </h2>
            <p className="mt-2 text-sm sm:text-base leading-relaxed text-ink-muted">
              Explore verified requests from people and families who are asking the community for
              help.
            </p>
          </div>

          <div className="mt-8">
            {loading ? (
              <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: isMobile ? 4 : 6 }, (_, index) => (
                  <div
                    key={index}
                    className="overflow-hidden rounded-card border border-line bg-surface"
                  >
                    <div className="aspect-[16/10] w-full animate-pulse bg-slate-200" />
                    <div className="p-4 sm:p-5 space-y-3">
                      <div className="h-3.5 w-24 animate-pulse rounded bg-slate-200" />
                      <div className="h-5 w-3/4 animate-pulse rounded bg-slate-200" />
                      <div className="space-y-1.5 pt-1">
                        <div className="h-3.5 w-full animate-pulse rounded bg-slate-100" />
                        <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-100" />
                      </div>
                      <div className="h-9 w-full animate-pulse rounded-control bg-slate-100 mt-4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div className="py-8">
                <ErrorState
                  title="Could not load requests"
                  message={loadError}
                  onRetry={() => setAttempt((current) => current + 1)}
                />
              </div>
            ) : requests.length === 0 ? (
              <div className="py-8">
                <EmptyState
                  variant="first-run"
                  title="No active verified requests at this moment"
                  message="All recent verified requests have been fulfilled or new submissions are currently progressing through staff review."
                  action={
                    <div className="mt-4 flex flex-wrap justify-center gap-3">
                      <LinkButton to="/request-help" size="sm">
                        Ask for Help
                      </LinkButton>
                      <LinkButton to="/volunteer" variant="secondary" size="sm">
                        Volunteer
                      </LinkButton>
                    </div>
                  }
                />
              </div>
            ) : (
              <div className="space-y-8 sm:space-y-10">
                {/* 3 cols × 2 rows on desktop (6 cards) / 1 col on mobile (4 cards) */}
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {displayedRequests.map((req) => {
                    const cat = req.categoryId
                      ? categories.find((c) => c.id === req.categoryId)?.name
                      : null;
                    const loc = [req.locationCity, req.locationState]
                      .filter(Boolean)
                      .join(', ');
                    const hasTarget = (req.targetAmount ?? 0) > 0;
                    const pct = hasTarget
                      ? fundingPercent(req.raisedAmount, req.targetAmount)
                      : 0;

                    return (
                      <article
                        key={req.id}
                        className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xs hover:shadow-md hover:border-slate-300 transition-all duration-200"
                      >
                        {/* Cover Image Container */}
                        <div className="relative aspect-[16/10] w-full overflow-hidden bg-canvas border-b border-line/60">
                          {req.imageUrl ? (
                            <img
                              src={req.imageUrl}
                              alt={req.title}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <CategoryCoverPlaceholder categoryName={cat} size="lg" />
                          )}
                          <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 pointer-events-none">
                            {req.isDemo && (
                              <span className="inline-flex items-center font-medium text-slate-700 text-[10px] bg-white/95 backdrop-blur-xs px-2 py-0.5 rounded-control border border-slate-300 shadow-xs">
                                Sample
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 font-medium text-emerald-800 text-[10px] bg-emerald-50/95 backdrop-blur-xs px-2 py-0.5 rounded-control border border-emerald-200 shadow-xs">
                              <ShieldCheck className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                              Verified
                            </span>
                          </div>
                        </div>

                        {/* Card Body */}
                        <div className="flex flex-1 flex-col p-4 sm:p-5 space-y-3">
                          {/* Category & Location */}
                          <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
                            {cat && (
                              <span className="font-semibold text-primary truncate max-w-[130px]">
                                {cat}
                              </span>
                            )}
                            {cat && loc && <span>·</span>}
                            {loc && (
                              <span className="flex items-center gap-1 text-ink-muted truncate">
                                <MapPin className="h-3 w-3 shrink-0 text-ink-subtle" aria-hidden="true" />
                                <span className="truncate">{loc}</span>
                              </span>
                            )}
                          </div>

                          {/* Title */}
                          <h3 className="text-base font-bold text-ink leading-snug line-clamp-2">
                            <Link
                              to={`/help/${req.id}`}
                              className="hover:text-primary transition-colors focus-visible:outline-2 focus-visible:outline-primary"
                            >
                              {req.title}
                            </Link>
                          </h3>

                          {/* Short Description */}
                          <p className="text-xs sm:text-sm text-ink-muted leading-relaxed line-clamp-2 flex-1">
                            {req.description}
                          </p>

                          {/* Progress & Target */}
                          {hasTarget ? (
                            <div className="pt-2 border-t border-line/60 space-y-1.5">
                              <div className="flex justify-between items-baseline text-xs">
                                <span className="font-semibold text-ink tabular-nums">
                                  {formatINR(req.raisedAmount ?? 0)}{' '}
                                  <span className="font-normal text-ink-subtle">
                                    raised of {formatINR(req.targetAmount)}
                                  </span>
                                </span>
                                <span className="font-semibold text-primary tabular-nums">
                                  {pct}%
                                </span>
                              </div>
                              <ProgressBar value={pct} size="sm" />
                            </div>
                          ) : (
                            <div className="pt-2 border-t border-line/60">
                              <p className="text-xs text-ink-subtle font-medium">
                                Direct non-monetary aid (volunteer / supplies)
                              </p>
                            </div>
                          )}

                          {/* Action CTA */}
                          <div className="pt-2">
                            <LinkButton
                              to={`/help/${req.id}`}
                              variant="secondary"
                              size="sm"
                              block
                              className="text-xs font-semibold min-h-[38px] group-hover:bg-primary group-hover:text-white group-hover:border-primary transition-colors"
                            >
                              View Details
                              <ArrowRight className="h-3.5 w-3.5 ml-1" aria-hidden="true" />
                            </LinkButton>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                {/* Explore all community requests link */}
                <div className="text-center pt-2">
                  <Link
                    to="/help"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary-strong transition-colors min-h-[44px] py-2 px-4 rounded-control hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <span>Explore all community requests</span>
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ============================================================
          SECTION 4 — HOW IT WORKS
          Simple sequential story. Crucial anchor: id="how-it-works".
      ============================================================ */}
      <section
        id="how-it-works"
        className="scroll-mt-20 border-b border-line bg-canvas py-12 sm:py-16"
      >
        <div className="container-page max-w-4xl">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              The Process
            </p>
            <h2 className="mt-1 font-serif text-2xl sm:text-3xl font-bold tracking-tight text-ink">
              How Walk With Us works
            </h2>
            <p className="mt-2 text-sm sm:text-base leading-relaxed text-ink-muted">
              A transparent, dignified sequence designed to connect genuine human needs with
              community support.
            </p>
          </div>

          <div className="mt-8 divide-y divide-line border-y border-line">
            {HOW_IT_WORKS.map((item) => (
              <div
                key={item.step}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 sm:gap-6 py-5 sm:py-6"
              >
                <div className="sm:col-span-2">
                  <span className="font-mono text-xs sm:text-sm font-bold text-primary">
                    {item.step}
                  </span>
                </div>
                <div className="sm:col-span-4">
                  <h3 className="text-base font-bold text-ink">{item.title}</h3>
                </div>
                <div className="sm:col-span-6">
                  <p className="text-sm text-ink-muted leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================================================
          SECTION 5 — FINAL ACTION
          Quiet, human conclusion inviting participation.
      ============================================================ */}
      <section className="py-14 sm:py-20 bg-surface/40">
        <div className="container-page max-w-3xl text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-ink">
            Someone in your community may need your help today.
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-muted leading-relaxed max-w-xl mx-auto">
            Whether you can offer financial aid, volunteer practical time, or need assistance
            yourself, Walk With Us exists to connect real people directly.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
            <LinkButton to="/help" size="lg" className="w-full sm:w-auto min-h-[44px]">
              Explore Requests
            </LinkButton>
            <LinkButton
              to="/request-help"
              variant="secondary"
              size="lg"
              className="w-full sm:w-auto min-h-[44px]"
            >
              Ask for Help
            </LinkButton>
          </div>
          <p className="mt-6 text-xs text-ink-subtle">
            Looking to give your time or partner as an institution?{' '}
            <Link to="/volunteer" className="text-primary font-medium hover:underline">
              Volunteer
            </Link>{' '}
            or{' '}
            <Link to="/partner" className="text-primary font-medium hover:underline">
              Partner with us
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}