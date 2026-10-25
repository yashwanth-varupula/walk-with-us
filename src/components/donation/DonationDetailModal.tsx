import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  ExternalLink,
  Receipt,
  RotateCcw,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  EyeOff,
  CreditCard,
  RefreshCw,
} from 'lucide-react';
import type { UserDonationRecord } from '../../types/donations';
import { formatPaiseToINR } from '../../lib/money';
import { formatDate } from '../../lib/format';
import Button from '../ui/Button';

interface DonationDetailModalProps {
  donation: UserDonationRecord | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenReceipt: (donation: UserDonationRecord) => void;
  onReconcile?: (donationId: string) => Promise<void> | void;
}

export function DonationDetailModal({
  donation,
  isOpen,
  onClose,
  onOpenReceipt,
  onReconcile,
}: DonationDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !donation) return null;

  const isSuccessful = donation.status === 'paid';
  const isRefunded = donation.status === 'refunded';

  const getStatusBadge = () => {
    switch (donation.status) {
      case 'paid':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Paid & Verified
          </span>
        );
      case 'refunded':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Fully Refunded
          </span>
        );
      case 'pending':
      case 'created':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-800">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            Pending Gateway
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-800">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Payment Failed
          </span>
        );
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Cancelled
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700">
            {donation.status}
          </span>
        );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="donation-detail-title"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-lg rounded-2xl border border-line bg-surface p-6 sm:p-7 shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line pb-4">
          <div>
            <h2 id="donation-detail-title" className="text-lg font-bold text-ink">
              Donation Details
            </h2>
            <p className="text-xs text-ink-muted">Transaction ID: {donation.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-slate-100 transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="py-5 space-y-5">
          {/* Status & Amount Highlight */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-line bg-canvas p-4">
            <div>
              <span className="text-xs text-ink-muted uppercase tracking-wider font-semibold block">
                Total Amount
              </span>
              <span className="text-2xl sm:text-3xl font-extrabold text-ink tracking-tight mt-0.5 block">
                {formatPaiseToINR(donation.amountPaise)}
              </span>
            </div>
            <div>{getStatusBadge()}</div>
          </div>

          {/* Refund Notice (if any) */}
          {isRefunded && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-xs text-amber-900 space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <RotateCcw className="h-4 w-4 text-amber-700" aria-hidden="true" />
                <span>Refund Information</span>
              </div>
              <p>
                Refund amount: <strong>{formatPaiseToINR(donation.amountPaise)}</strong> (Full Refund)
              </p>
              {donation.refundedAt && (
                <p className="text-[11px] text-amber-800">
                  Processed on {formatDate(donation.refundedAt)}
                </p>
              )}
            </div>
          )}

          {/* Campaign Info */}
          <div className="rounded-xl border border-line p-4 space-y-2">
            <span className="text-xs text-ink-muted uppercase tracking-wider font-semibold block">
              Supported Campaign
            </span>
            <div className="flex items-start gap-3">
              {donation.campaignCoverImageUrl ? (
                <img
                  src={donation.campaignCoverImageUrl}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-lg object-cover border border-line"
                />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <CreditCard className="h-6 w-6" aria-hidden="true" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-sm text-ink truncate">
                  {donation.campaignTitle || 'General Community Fund'}
                </h3>
                {donation.requestId && (
                  <Link
                    to={`/help/${donation.requestId}`}
                    className="inline-flex items-center gap-1 mt-1 text-xs font-medium text-primary hover:underline"
                  >
                    <span>View Campaign</span>
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Metadata Grid */}
          <dl className="grid grid-cols-2 gap-y-3.5 gap-x-4 text-xs border-y border-line py-4">
            <div>
              <dt className="text-ink-subtle font-medium">Payment Provider</dt>
              <dd className="mt-0.5 font-semibold text-ink uppercase">
                {donation.paymentProvider || 'Razorpay (Test)'}
              </dd>
            </div>

            <div>
              <dt className="text-ink-subtle font-medium">Payment Date</dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {formatDate(donation.paidAt || donation.createdAt)}
              </dd>
            </div>

            <div>
              <dt className="text-ink-subtle font-medium">Gateway Payment Reference</dt>
              <dd className="mt-0.5 font-mono text-ink truncate" title={donation.providerPaymentId || 'N/A'}>
                {donation.providerPaymentId || 'Awaiting completion'}
              </dd>
            </div>

            <div>
              <dt className="text-ink-subtle font-medium">Gateway Order ID</dt>
              <dd className="mt-0.5 font-mono text-ink truncate" title={donation.providerOrderId || 'N/A'}>
                {donation.providerOrderId || 'N/A'}
              </dd>
            </div>

            <div className="col-span-2">
              <dt className="text-ink-subtle font-medium">Supporter Display Preference</dt>
              <dd className="mt-0.5 text-ink flex items-center gap-1.5">
                {donation.isAnonymous ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
                    <span>Anonymous (Private to public supporter lists)</span>
                  </>
                ) : (
                  <span>Public ({donation.donorName || 'Community Supporter'})</span>
                )}
              </dd>
            </div>

            {donation.failureReason && (
              <div className="col-span-2 rounded-lg bg-rose-50 p-2 text-rose-800">
                <dt className="font-semibold">Failure Diagnostic:</dt>
                <dd className="mt-0.5">{donation.failureReason}</dd>
              </div>
            )}
          </dl>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="flex items-center gap-2">
            {isSuccessful && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  onClose();
                  onOpenReceipt(donation);
                }}
              >
                <Receipt className="h-4 w-4" aria-hidden="true" />
                View Receipt
              </Button>
            )}

            {(donation.status === 'pending' || donation.status === 'created') && onReconcile && (
              <Button
                size="sm"
                variant="secondary"
                loading={isReconciling}
                disabled={isReconciling}
                onClick={async () => {
                  setIsReconciling(true);
                  try {
                    await onReconcile(donation.id);
                  } finally {
                    setIsReconciling(false);
                  }
                }}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isReconciling ? 'animate-spin' : ''}`} aria-hidden="true" />
                Check Status with Gateway
              </Button>
            )}
          </div>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
