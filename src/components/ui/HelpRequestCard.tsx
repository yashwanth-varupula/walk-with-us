import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Heart,
  Home as HomeIcon,
  MapPin,
  ShieldCheck,
  Siren,
  Stethoscope,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import type { HelpRequestUrgency } from '../../services/helpRequests';
import { formatINR, fundingPercent } from '../../lib/format';
import { urgencyMeta, type Tone } from '../../lib/status';

interface HelpRequestCardProps {
  id: string | number;
  title: string;
  description: string;
  targetAmount?: number;
  raisedAmount?: number;
  categoryName?: string | null;
  location?: string | null;
  urgency?: HelpRequestUrgency;
  imageUrl?: string | null;
}

const URGENCY_TONE: Record<Tone, string> = {
  idle: 'bg-idle-soft text-idle-ink',
  info: 'bg-info-soft text-info-ink',
  warn: 'bg-amber-100 text-amber-900 border-amber-200',
  good: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  stop: 'bg-rose-100 text-rose-900 border-rose-200',
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  medical: Stethoscope,
  health: Stethoscope,
  education: BookOpen,
  food: Utensils,
  housing: HomeIcon,
  shelter: HomeIcon,
  community: Heart,
};

export default function HelpRequestCard({
  id,
  title,
  description,
  targetAmount,
  raisedAmount,
  categoryName,
  location,
  urgency,
  imageUrl,
}: HelpRequestCardProps) {
  const hasTarget = typeof targetAmount === 'number' && Number.isFinite(targetAmount) && targetAmount > 0;
  const percent = hasTarget ? fundingPercent(raisedAmount, targetAmount) : 0;
  const isUrgent = urgency === 'high' || urgency === 'critical';

  const categoryLower = (categoryName || '').toLowerCase();
  const matchedKey = Object.keys(CATEGORY_ICONS).find((k) => categoryLower.includes(k));
  const CategoryIcon = matchedKey ? CATEGORY_ICONS[matchedKey] : Heart;

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface transition-colors hover:border-primary-soft-strong">
      {/* Visual Banner Header */}
      <div className="relative aspect-16/9 w-full overflow-hidden bg-slate-100">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-102"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center bg-canvas">
            <div className="flex h-11 w-11 items-center justify-center rounded-control bg-primary-soft text-primary">
              <CategoryIcon className="h-5 w-5" aria-hidden="true" />
            </div>
            <span className="mt-2 text-xs font-medium uppercase tracking-wider text-ink-subtle">
              {categoryName || 'Community Need'}
            </span>
          </div>
        )}

        {/* Floating Top Badges */}
        <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between gap-2 pointer-events-none">
          <div className="flex flex-wrap items-center gap-1.5">
            {categoryName && (
              <span className="rounded-control bg-surface/95 px-2 py-0.5 text-xs font-medium text-ink shadow-xs backdrop-blur-xs border border-line">
                {categoryName}
              </span>
            )}
            {isUrgent && urgency && (
              <span
                className={`inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-xs font-semibold shadow-xs backdrop-blur-xs ${URGENCY_TONE[urgencyMeta(urgency).tone]}`}
              >
                <Siren className="h-3 w-3" aria-hidden="true" />
                {urgencyMeta(urgency).label}
              </span>
            )}
          </div>

          <span className="inline-flex items-center gap-1 rounded-control bg-surface/95 px-2 py-0.5 text-xs font-medium text-emerald-800 shadow-xs backdrop-blur-xs border border-line">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            Verified
          </span>
        </div>
      </div>

      {/* Card Content */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="line-clamp-2 text-base font-bold text-ink group-hover:text-primary transition-colors sm:text-lg">
          <Link to={`/help/${id}`} className="focus:outline-none focus-visible:underline">
            {title}
          </Link>
        </h3>

        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-muted sm:text-sm">
          {description}
        </p>

        {location && (
          <p className="mt-2.5 flex items-center gap-1 text-xs font-medium text-ink-subtle">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate">{location}</span>
          </p>
        )}

        {/* Progress & Funding Section */}
        <div className="mt-auto pt-4 border-t border-line/70">
          {hasTarget ? (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-semibold text-ink">
                  {formatINR(raisedAmount ?? 0)}{' '}
                  <span className="font-normal text-ink-subtle">of {formatINR(targetAmount)}</span>
                </span>
                <span className="font-semibold text-primary tabular-nums">{percent}%</span>
              </div>

              <div
                className="h-2 w-full overflow-hidden rounded-control bg-slate-200"
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuetext={`${formatINR(raisedAmount ?? 0)} raised of ${formatINR(targetAmount)}, ${percent} percent`}
              >
                <div
                  className="h-full rounded-control bg-primary transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-ink-subtle">Direct community assistance request</p>
          )}

          {/* Action CTA */}
          <div className="mt-4 flex items-center justify-between gap-2">
            <Link
              to={`/help/${id}`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary group-hover:text-primary-strong transition-colors focus:outline-none focus-visible:underline"
            >
              View Story
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>

            <Link
              to={`/donate/${id}`}
              className="inline-flex items-center justify-center rounded-control bg-surface border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-slate-50 hover:border-slate-300 transition-colors min-h-[34px]"
            >
              Donate
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
