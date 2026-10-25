import { useState } from 'react';
import {
  Search,
  Calendar,
  Eye,
  Receipt,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  CreditCard,
  EyeOff,
  Heart,
  X,
} from 'lucide-react';
import type {
  UserDonationRecord,
  MyDonationsFilterStatus,
} from '../../types/donations';
import { formatPaiseToINR } from '../../lib/money';
import { formatDate } from '../../lib/format';
import Button, { LinkButton } from '../ui/Button';

interface DonationHistoryTableProps {
  donations: UserDonationRecord[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  statusFilter: MyDonationsFilterStatus;
  searchQuery: string;
  startDate: string;
  endDate: string;
  onStatusChange: (status: MyDonationsFilterStatus) => void;
  onSearchChange: (query: string) => void;
  onDateChange: (start: string, end: string) => void;
  onPageChange: (page: number) => void;
  onRetry: () => void;
  onSelectDonation: (donation: UserDonationRecord) => void;
  onOpenReceipt: (donation: UserDonationRecord) => void;
  onReconcileDonation?: (donationId: string) => Promise<void> | void;
}

const FILTER_TABS: Array<{ key: MyDonationsFilterStatus; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Successful' },
  { key: 'pending', label: 'Pending' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'refunded', label: 'Refunded' },
];

export function DonationHistoryTable({
  donations,
  loading,
  error,
  totalCount,
  page,
  totalPages,
  statusFilter,
  searchQuery,
  startDate,
  endDate,
  onStatusChange,
  onSearchChange,
  onDateChange,
  onPageChange,
  onRetry,
  onSelectDonation,
  onOpenReceipt,
  onReconcileDonation,
}: DonationHistoryTableProps) {
  const [showDateFilter, setShowDateFilter] = useState(Boolean(startDate || endDate));

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
            Paid
          </span>
        );
      case 'refunded':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
            <RotateCcw className="h-3 w-3" aria-hidden="true" />
            Refunded
          </span>
        );
      case 'pending':
      case 'created':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
            <Clock className="h-3 w-3" aria-hidden="true" />
            Pending
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 border border-slate-200">
            <XCircle className="h-3 w-3" aria-hidden="true" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* 1. Filter Controls & Search */}
      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Donation status filter">
            {FILTER_TABS.map((tab) => {
              const active = statusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => onStatusChange(tab.key)}
                  className={`rounded-control px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-primary ${
                    active
                      ? 'bg-primary text-white shadow-xs'
                      : 'bg-canvas text-ink-muted hover:text-ink hover:bg-slate-200/60'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search & Date Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:w-64">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-ink-subtle" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search campaign or reference…"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="w-full rounded-control border border-line bg-canvas pl-9 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                aria-label="Search donations"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  className="absolute right-2.5 top-2 text-ink-subtle hover:text-ink"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowDateFilter(!showDateFilter)}
              className={`inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-xs font-semibold transition-colors ${
                startDate || endDate || showDateFilter
                  ? 'border-primary bg-primary-soft text-primary-strong'
                  : 'border-line bg-canvas text-ink-muted hover:text-ink'
              }`}
            >
              <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Dates</span>
            </button>
          </div>
        </div>

        {/* Expandable Date Range Filter */}
        {showDateFilter && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line/60 pt-3 text-xs text-ink-muted">
            <span className="font-semibold text-ink">Date range:</span>
            <div className="flex items-center gap-2">
              <label htmlFor="donations-start-date" className="sr-only">Start Date</label>
              <input
                id="donations-start-date"
                type="date"
                value={startDate}
                onChange={(e) => onDateChange(e.target.value, endDate)}
                className="rounded-control border border-line bg-canvas px-2.5 py-1 text-xs text-ink focus:border-primary focus:outline-none"
              />
              <span>to</span>
              <label htmlFor="donations-end-date" className="sr-only">End Date</label>
              <input
                id="donations-end-date"
                type="date"
                value={endDate}
                onChange={(e) => onDateChange(startDate, e.target.value)}
                className="rounded-control border border-line bg-canvas px-2.5 py-1 text-xs text-ink focus:border-primary focus:outline-none"
              />
            </div>
            {(startDate || endDate) && (
              <button
                type="button"
                onClick={() => onDateChange('', '')}
                className="text-xs font-semibold text-rose-600 hover:underline"
              >
                Clear Dates
              </button>
            )}
          </div>
        )}
      </div>

      {/* 2. Error State */}
      {error && (
        <div className="rounded-card border border-rose-200 bg-rose-50 p-5 text-center space-y-3" role="alert">
          <AlertCircle className="h-6 w-6 text-rose-600 mx-auto" aria-hidden="true" />
          <div>
            <h3 className="text-sm font-bold text-rose-900">Could not load donations</h3>
            <p className="text-xs text-rose-700 mt-0.5">{error}</p>
          </div>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-control border border-rose-300 bg-surface px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Try Again</span>
          </button>
        </div>
      )}

      {/* 3. Loading Skeletons */}
      {loading && !error && (
        <div className="rounded-card border border-line bg-surface divide-y divide-line overflow-hidden shadow-2xs">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="animate-pulse p-4 sm:p-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1">
                <div className="h-12 w-12 rounded-lg bg-slate-200 shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-48 rounded bg-slate-200" />
                  <div className="h-3 w-32 rounded bg-slate-100" />
                </div>
              </div>
              <div className="space-y-2 text-right">
                <div className="h-4 w-20 rounded bg-slate-200 ml-auto" />
                <div className="h-3 w-16 rounded bg-slate-100 ml-auto" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 4. Empty State */}
      {!loading && !error && donations.length === 0 && (
        <div className="rounded-card border border-line bg-surface p-8 sm:p-12 text-center space-y-4 shadow-2xs">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Heart className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-bold text-ink">No donations found</h3>
            <p className="mt-1 text-xs text-ink-muted max-w-sm mx-auto">
              {searchQuery || statusFilter !== 'all' || startDate || endDate
                ? 'No donation records matched your active filter or search query.'
                : 'You have not made any donations yet. Browse verified community causes to begin.'}
            </p>
          </div>
          <div className="pt-2 flex flex-wrap justify-center gap-2">
            {searchQuery || statusFilter !== 'all' || startDate || endDate ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  onStatusChange('all');
                  onSearchChange('');
                  onDateChange('', '');
                }}
              >
                Reset Filters
              </Button>
            ) : (
              <LinkButton to="/help" size="sm">
                Browse Community Causes
              </LinkButton>
            )}
          </div>
        </div>
      )}

      {/* 5. Donation Records List / Table */}
      {!loading && !error && donations.length > 0 && (
        <div className="rounded-card border border-line bg-surface divide-y divide-line overflow-hidden shadow-2xs">
          {donations.map((donation) => {
            const isReceiptEligible = donation.status === 'paid';

            return (
              <article
                key={donation.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 hover:bg-slate-50/70 transition-colors"
                aria-label={`Donation of ${formatPaiseToINR(donation.amountPaise)} for ${donation.campaignTitle}`}
              >
                {/* Left: Campaign & Metadata */}
                <div className="flex items-start gap-3.5 min-w-0 flex-1">
                  {donation.campaignCoverImageUrl ? (
                    <img
                      src={donation.campaignCoverImageUrl}
                      alt=""
                      className="h-12 w-12 rounded-lg object-cover border border-line shrink-0"
                    />
                  ) : (
                    <div className="flex h-12 w-12 rounded-lg items-center justify-center bg-primary-soft text-primary shrink-0">
                      <CreditCard className="h-6 w-6" aria-hidden="true" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink truncate">
                        {donation.campaignTitle || 'General Community Fund'}
                      </h3>
                      {renderStatusBadge(donation.status)}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                      <span>{formatDate(donation.paidAt || donation.createdAt)}</span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono text-[11px] truncate max-w-[150px]" title={donation.providerPaymentId || donation.id}>
                        Ref: {donation.providerPaymentId || donation.id.slice(0, 8)}
                      </span>
                      {donation.isAnonymous && (
                        <>
                          <span className="text-slate-300">·</span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
                            <EyeOff className="h-3 w-3" />
                            Anonymous
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Amount & Actions */}
                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-line/40">
                  <div className="text-left sm:text-right">
                    <span className="text-base sm:text-lg font-bold text-ink block">
                      {formatPaiseToINR(donation.amountPaise)}
                    </span>
                    <span className="text-[11px] text-ink-subtle uppercase">
                      {donation.currency}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {donation.status === 'pending' && onReconcileDonation && (
                      <button
                        type="button"
                        onClick={() => onReconcileDonation(donation.id)}
                        className="inline-flex items-center gap-1 rounded-control border border-blue-300 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 transition-colors"
                        title="Reconcile status with payment provider"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Check Status</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onSelectDonation(donation)}
                      className="inline-flex items-center gap-1 rounded-control border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-slate-200/70 transition-colors"
                      title="Inspect Donation Details"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Details</span>
                    </button>

                    {isReceiptEligible && (
                      <button
                        type="button"
                        onClick={() => onOpenReceipt(donation)}
                        className="inline-flex items-center gap-1 rounded-control border border-primary/30 bg-primary-soft px-2.5 py-1.5 text-xs font-semibold text-primary-strong hover:bg-primary-soft-strong transition-colors"
                        title="View Official Receipt"
                      >
                        <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Receipt</span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* 6. Pagination Controls */}
      {!loading && !error && totalPages > 1 && (
        <nav
          className="flex items-center justify-between border-t border-line pt-4 text-xs"
          aria-label="Donations pagination"
        >
          <span className="text-ink-muted">
            Showing Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalCount} total)
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-3 py-1.5 font-semibold text-ink hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="inline-flex items-center gap-1 rounded-control border border-line bg-surface px-3 py-1.5 font-semibold text-ink hover:bg-slate-100 disabled:opacity-40 disabled:pointer-events-none transition-colors"
            >
              <span>Next</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
