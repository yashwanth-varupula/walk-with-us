import { Heart, TrendingUp, Calendar, RotateCcw, FolderHeart } from 'lucide-react';
import type { DonationSummaryStats } from '../../types/donations';
import { formatPaiseToINR } from '../../lib/money';

interface DonationStatsSummaryProps {
  stats: DonationSummaryStats;
  loading?: boolean;
}

export function DonationStatsSummary({ stats, loading = false }: DonationStatsSummaryProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Loading donation summary">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="animate-pulse rounded-card border border-line bg-surface p-4 sm:p-5 shadow-2xs"
          >
            <div className="h-4 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-7 w-32 rounded bg-slate-200" />
            <div className="mt-2 h-3 w-40 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Successfully Donated',
      value: formatPaiseToINR(stats.totalDonatedPaise),
      subtext: `${stats.successfulCount} ${stats.successfulCount === 1 ? 'verified donation' : 'verified donations'}`,
      icon: Heart,
      color: 'text-primary bg-primary-soft',
    },
    {
      label: 'Campaigns Supported',
      value: stats.distinctCampaignsCount.toString(),
      subtext: stats.distinctCampaignsCount === 1 ? 'Community campaign aided' : 'Community campaigns aided',
      icon: FolderHeart,
      color: 'text-indigo-600 bg-indigo-50',
    },
    {
      label: 'This Month',
      value: formatPaiseToINR(stats.currentMonthDonatedPaise),
      subtext: 'Current calendar month contributions',
      icon: Calendar,
      color: 'text-emerald-600 bg-emerald-50',
    },
    ...(stats.hasRefunds
      ? [
          {
            label: 'Total Refunded',
            value: formatPaiseToINR(stats.totalRefundedPaise),
            subtext: 'Processed refunds (excluded from net totals)',
            icon: RotateCcw,
            color: 'text-amber-600 bg-amber-50',
          },
        ]
      : [
          {
            label: 'Successful Contributions',
            value: stats.successfulCount.toString(),
            subtext: '100% verified server-side',
            icon: TrendingUp,
            color: 'text-teal-600 bg-teal-50',
          },
        ]),
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" role="region" aria-label="Donation Summary Statistics">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="flex flex-col justify-between rounded-card border border-line bg-surface p-4 sm:p-5 shadow-2xs transition-shadow hover:shadow-xs"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                {card.label}
              </span>
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${card.color}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
            </div>
            <div className="mt-3">
              <div className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
                {card.value}
              </div>
              <p className="mt-1 text-xs text-ink-subtle">{card.subtext}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
