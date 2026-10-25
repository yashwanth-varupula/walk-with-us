import { useCallback, useEffect, useState } from 'react';
import {
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Clock,
  XCircle,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  X,
  ExternalLink,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  listStaffDonations,
  type UserDonationRecord,
  type PaymentStatus,
} from '../../services/donations';
import { formatPaiseToINR } from '../../lib/money';
import { formatDate } from '../../lib/format';
import Button from '../../components/ui/Button';

export default function StaffDonations() {
  const [donations, setDonations] = useState<UserDonationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Filters & Pagination
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 20;

  // Selected item modal
  const [selectedDonation, setSelectedDonation] = useState<UserDonationRecord | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const filterStatus = statusFilter === 'all' ? undefined : (statusFilter as PaymentStatus);
    const result = await listStaffDonations({
      status: filterStatus,
      page,
      pageSize,
    });

    if (result.error) {
      setError(result.error);
      setDonations([]);
      setTotalCount(0);
    } else {
      setDonations(result.donations);
      setTotalCount(result.totalCount);
    }
    setLoading(false);
  }, [statusFilter, page, pageSize]);

  useEffect(() => {
    void loadData();
  }, [loadData, attempt]);

  const totalPages = Math.ceil(totalCount / pageSize);

  const filteredDonations = donations.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (d.donorName && d.donorName.toLowerCase().includes(q)) ||
      (d.campaignTitle && d.campaignTitle.toLowerCase().includes(q)) ||
      (d.providerPaymentId && d.providerPaymentId.toLowerCase().includes(q)) ||
      (d.providerOrderId && d.providerOrderId.toLowerCase().includes(q)) ||
      d.id.toLowerCase().includes(q)
    );
  });

  const renderStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            Paid
          </span>
        );
      case 'refunded':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 border border-slate-200">
            <RotateCcw className="h-3 w-3" />
            Refunded
          </span>
        );
      case 'pending':
      case 'created':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
            <AlertCircle className="h-3 w-3" />
            Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 border border-slate-200">
            <XCircle className="h-3 w-3" />
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            Donations Visibility & Audit
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Staff-authorized financial transactions ledger and gateway reconciliation.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAttempt((a) => a + 1)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
          <span>Sync Transactions</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {['all', 'paid', 'pending', 'failed', 'refunded'].map((statusKey) => {
            const active = statusFilter === statusKey;
            return (
              <button
                key={statusKey}
                onClick={() => {
                  setStatusFilter(statusKey);
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {statusKey}
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search donor, campaign, ref…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800 space-y-2">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertCircle className="h-4 w-4 text-rose-600" />
            <span>Staff query error</span>
          </div>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setAttempt((a) => a + 1)}
            className="rounded border border-rose-300 bg-white px-2 py-1 font-semibold text-rose-700 hover:bg-rose-50"
          >
            Retry Query
          </button>
        </div>
      )}

      {/* Transactions Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden">
        {loading ? (
          <div className="divide-y divide-slate-100 p-4 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="animate-pulse flex items-center justify-between py-2">
                <div className="h-4 w-40 rounded bg-slate-200" />
                <div className="h-4 w-24 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        ) : filteredDonations.length === 0 ? (
          <div className="p-12 text-center text-sm text-slate-500">
            No donation transactions found for current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-3">Date</th>
                  <th scope="col" className="px-4 py-3">Campaign</th>
                  <th scope="col" className="px-4 py-3">Donor</th>
                  <th scope="col" className="px-4 py-3">Amount</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Reference</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDonations.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {formatDate(row.paidAt || row.createdAt)}
                    </td>
                    <td className="px-4 py-3 max-w-[200px] truncate font-medium text-slate-900">
                      {row.campaignTitle || 'General Community Fund'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row.isAnonymous ? (
                        <span className="inline-flex items-center gap-1 text-slate-500">
                          <EyeOff className="h-3 w-3" />
                          <span>Anonymous</span>
                        </span>
                      ) : (
                        <span className="font-medium text-slate-900">
                          {row.donorName || 'Community Supporter'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                      {formatPaiseToINR(row.amountPaise)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {renderStatusBadge(row.status)}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-500 max-w-[130px] truncate" title={row.providerPaymentId || row.id}>
                      {row.providerPaymentId || row.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedDonation(row)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                      >
                        <Eye className="h-3 w-3" />
                        <span>Inspect</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50/60 px-4 py-2.5 text-xs text-slate-600">
            <span>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({totalCount} total)
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-semibold disabled:opacity-40"
              >
                <ChevronLeft className="h-3 w-3" />
                <span>Prev</span>
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-semibold disabled:opacity-40"
              >
                <span>Next</span>
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Staff Transaction Inspection Modal */}
      {selectedDonation && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900">Staff Transaction Audit</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDonation(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
                <div>
                  <span className="text-slate-500 uppercase text-[10px] font-semibold block">Amount</span>
                  <span className="text-lg font-bold text-slate-900 block mt-0.5">
                    {formatPaiseToINR(selectedDonation.amountPaise)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 uppercase text-[10px] font-semibold block">Status</span>
                  <div className="mt-1">{renderStatusBadge(selectedDonation.status)}</div>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-y-3 gap-x-4 border-y border-slate-100 py-3">
                <div className="col-span-2">
                  <dt className="text-slate-500 font-medium">Campaign</dt>
                  <dd className="mt-0.5 font-semibold text-slate-900 flex items-center gap-2">
                    <span>{selectedDonation.campaignTitle}</span>
                    {selectedDonation.requestId && (
                      <Link
                        to={`/help/${selectedDonation.requestId}`}
                        target="_blank"
                        className="text-emerald-700 hover:underline inline-flex items-center gap-0.5"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500 font-medium">Donor Name</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {selectedDonation.donorName || 'Not supplied'}
                    {selectedDonation.isAnonymous && ' (Anonymous publicly)'}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500 font-medium">Donor Email</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {selectedDonation.donorEmail || 'Not supplied'}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500 font-medium">Provider Payment ID</dt>
                  <dd className="mt-0.5 font-mono text-slate-900 truncate">
                    {selectedDonation.providerPaymentId || 'N/A'}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500 font-medium">Provider Order ID</dt>
                  <dd className="mt-0.5 font-mono text-slate-900 truncate">
                    {selectedDonation.providerOrderId || 'N/A'}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500 font-medium">Created Timestamp</dt>
                  <dd className="mt-0.5 text-slate-700">
                    {selectedDonation.createdAt}
                  </dd>
                </div>

                <div>
                  <dt className="text-slate-500 font-medium">Paid Timestamp</dt>
                  <dd className="mt-0.5 text-slate-700">
                    {selectedDonation.paidAt || 'N/A'}
                  </dd>
                </div>

                {selectedDonation.failureReason && (
                  <div className="col-span-2 bg-rose-50 p-2 rounded text-rose-800">
                    <dt className="font-semibold">Failure diagnostic:</dt>
                    <dd>{selectedDonation.failureReason}</dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="flex justify-end pt-2">
              <Button size="sm" onClick={() => setSelectedDonation(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
