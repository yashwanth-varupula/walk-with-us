import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  getMyDonations,
  getDonationReceiptData,
  reconcileDonation,
  reconcileUserPendingDonations,
  type UserDonationRecord,
  type DonationSummaryStats,
  type MyDonationsFilterStatus,
  type DonationReceiptData,
} from '../../services/donations';
import { DonationStatsSummary } from '../../components/donation/DonationStatsSummary';
import { DonationHistoryTable } from '../../components/donation/DonationHistoryTable';
import { DonationDetailModal } from '../../components/donation/DonationDetailModal';
import { DonationReceiptModal } from '../../components/donation/DonationReceiptModal';
import { LinkButton } from '../../components/ui/Button';

export default function MyDonations() {
  const [donations, setDonations] = useState<UserDonationRecord[]>([]);
  const [stats, setStats] = useState<DonationSummaryStats>({
    totalDonatedPaise: 0,
    successfulCount: 0,
    distinctCampaignsCount: 0,
    currentMonthDonatedPaise: 0,
    totalRefundedPaise: 0,
    hasRefunds: false,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Filter & Search states
  const [statusFilter, setStatusFilter] = useState<MyDonationsFilterStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // UI state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Modals state
  const [selectedDonation, setSelectedDonation] = useState<UserDonationRecord | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<DonationReceiptData | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  const loadDonations = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await getMyDonations({
      status: statusFilter,
      searchQuery: searchQuery.trim() || undefined,
      startDate: startDate || null,
      endDate: endDate || null,
      page,
      pageSize,
    });

    if (result.error) {
      setError(result.error);
      setDonations([]);
      setTotalCount(0);
      setTotalPages(0);
    } else {
      setDonations(result.donations);
      setStats(result.stats);
      setTotalCount(result.totalCount);
      setTotalPages(result.totalPages);
    }

    setLoading(false);
  }, [statusFilter, searchQuery, startDate, endDate, page, pageSize]);

  useEffect(() => {
    void loadDonations();
  }, [loadDonations, attempt]);

  const hasAutoReconciledRef = useRef(false);

  useEffect(() => {
    if (
      !loading &&
      !hasAutoReconciledRef.current &&
      donations.some((d) => d.status === 'pending' || d.status === 'created')
    ) {
      hasAutoReconciledRef.current = true;
      reconcileUserPendingDonations()
        .then((res) => {
          if (res.ok && res.reconciled && res.reconciled.length > 0) {
            void loadDonations();
          }
        })
        .catch(() => {
          // Non-blocking background check
        });
    }
  }, [loading, donations, loadDonations]);

  const handleReconcileDonation = async (donationId: string) => {
    await reconcileDonation(donationId);
    void loadDonations();
  };

  const handleStatusChange = (newStatus: MyDonationsFilterStatus) => {
    setStatusFilter(newStatus);
    setPage(1);
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setPage(1);
  };

  const handleDateChange = (start: string, end: string) => {
    setStartDate(start);
    setEndDate(end);
    setPage(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleOpenDetail = (donation: UserDonationRecord) => {
    setSelectedDonation(donation);
    setIsDetailOpen(true);
  };

  const handleOpenReceipt = (donation: UserDonationRecord) => {
    const receiptData = getDonationReceiptData(donation);
    if (receiptData) {
      setSelectedReceipt(receiptData);
      setIsReceiptOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-canvas py-6 sm:py-10">
      <div className="container-page space-y-6 sm:space-y-8">
        {/* Page Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between border-b border-line pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              My Donations
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Track your verified financial contributions, download receipts, and follow supported causes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAttempt((a) => a + 1)}
              className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-50 transition-colors"
              title="Refresh Donations"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              <span>Refresh</span>
            </button>
            <LinkButton to="/help" size="sm">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Support a Cause
            </LinkButton>
          </div>
        </header>

        {/* 1. Summary Statistics */}
        <DonationStatsSummary stats={stats} loading={loading && attempt === 0} />

        {/* 2. Donation History Table */}
        <section aria-label="Donation History">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-ink">Donation History</h2>
            <div className="flex items-center gap-1.5 text-xs text-ink-muted">
              <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>Direct Postgres RLS Authorization</span>
            </div>
          </div>

          <DonationHistoryTable
            donations={donations}
            loading={loading}
            error={error}
            totalCount={totalCount}
            page={page}
            pageSize={pageSize}
            totalPages={totalPages}
            statusFilter={statusFilter}
            searchQuery={searchQuery}
            startDate={startDate}
            endDate={endDate}
            onStatusChange={handleStatusChange}
            onSearchChange={handleSearchChange}
            onDateChange={handleDateChange}
            onPageChange={handlePageChange}
            onRetry={() => setAttempt((a) => a + 1)}
            onSelectDonation={handleOpenDetail}
            onOpenReceipt={handleOpenReceipt}
            onReconcileDonation={handleReconcileDonation}
          />
        </section>

        {/* 3. Detail & Receipt Modals */}
        <DonationDetailModal
          donation={selectedDonation}
          isOpen={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          onOpenReceipt={handleOpenReceipt}
          onReconcile={async (donationId) => {
            await handleReconcileDonation(donationId);
            setIsDetailOpen(false);
          }}
        />

        <DonationReceiptModal
          receipt={selectedReceipt}
          isOpen={isReceiptOpen}
          onClose={() => setIsReceiptOpen(false)}
        />
      </div>
    </div>
  );
}
