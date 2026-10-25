import { useEffect, useRef } from 'react';
import { X, Printer, ShieldCheck, HeartHandshake, CheckCircle2 } from 'lucide-react';
import type { DonationReceiptData } from '../../types/donations';
import { formatPaiseToINR } from '../../lib/money';
import { formatDate } from '../../lib/format';
import Button from '../ui/Button';

interface DonationReceiptModalProps {
  receipt: DonationReceiptData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DonationReceiptModal({ receipt, isOpen, onClose }: DonationReceiptModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !receipt) return null;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label="Donation Receipt"
    >
      <div
        ref={modalRef}
        className="relative w-full max-w-lg rounded-2xl border border-line bg-surface p-6 sm:p-8 shadow-2xl max-h-[90vh] overflow-y-auto print:m-0 print:max-w-none print:p-0 print:border-none print:shadow-none"
      >
        {/* Header Actions (hidden on print) */}
        <div className="flex items-center justify-between border-b border-line pb-4 print:hidden">
          <div className="flex items-center gap-2 text-primary">
            <HeartHandshake className="h-5 w-5" aria-hidden="true" />
            <span className="text-sm font-bold uppercase tracking-wider">Donation Receipt</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-3 py-1.5 text-xs font-semibold text-ink hover:bg-slate-100 transition-colors"
              title="Print Receipt"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Print</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-ink-muted hover:text-ink hover:bg-slate-100 transition-colors"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Printable Receipt Canvas */}
        <div className="pt-6 space-y-6">
          {/* Organization Title */}
          <div className="text-center space-y-1 border-b border-line pb-5">
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-primary-soft text-primary mb-2">
              <HeartHandshake className="h-7 w-7" aria-hidden="true" />
            </div>
            <h2 id="receipt-modal-title" className="text-2xl font-extrabold tracking-tight text-ink">
              Walk With Us
            </h2>
            <p className="text-xs text-ink-muted uppercase tracking-wider">
              Community Assistance & Verified Mutual Support
            </p>
          </div>

          {/* Verification Badge */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 flex items-center justify-between gap-3 text-emerald-900">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wide">Payment Confirmed</p>
                <p className="text-[11px] text-emerald-700">Verified via server-side payment reconciliation</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-mono font-bold">{receipt.receiptNumber}</span>
            </div>
          </div>

          {/* Key Amount Highlight */}
          <div className="rounded-xl border border-line bg-canvas p-4 text-center">
            <span className="text-xs text-ink-muted uppercase tracking-wider block font-medium">
              Donated Amount
            </span>
            <span className="text-3xl sm:text-4xl font-extrabold text-ink tracking-tight mt-1 block">
              {formatPaiseToINR(receipt.amountPaise)}
            </span>
            <span className="text-xs text-ink-subtle mt-0.5 block">
              Currency: {receipt.currency} (Indian Rupees)
            </span>
          </div>

          {/* Details Table */}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-6 text-xs border-y border-line py-5">
            <div>
              <dt className="text-ink-subtle font-medium uppercase tracking-wider text-[10px]">Donor</dt>
              <dd className="mt-1 font-semibold text-ink text-sm">
                {receipt.isAnonymous ? 'Anonymous Supporter' : receipt.donorName}
              </dd>
            </div>

            <div>
              <dt className="text-ink-subtle font-medium uppercase tracking-wider text-[10px]">Date & Time</dt>
              <dd className="mt-1 font-semibold text-ink text-sm">
                {formatDate(receipt.donationDate)}
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt className="text-ink-subtle font-medium uppercase tracking-wider text-[10px]">Purpose / Campaign</dt>
              <dd className="mt-1 font-semibold text-ink text-sm">
                {receipt.campaignTitle}
              </dd>
            </div>

            <div>
              <dt className="text-ink-subtle font-medium uppercase tracking-wider text-[10px]">Payment Provider</dt>
              <dd className="mt-1 font-mono text-ink">
                {receipt.paymentProvider} (Secure)
              </dd>
            </div>

            <div>
              <dt className="text-ink-subtle font-medium uppercase tracking-wider text-[10px]">Transaction Reference</dt>
              <dd className="mt-1 font-mono text-ink truncate" title={receipt.transactionReference}>
                {receipt.transactionReference}
              </dd>
            </div>
          </dl>

          {/* Legal / Transparency Disclaimer */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3.5 text-[11px] text-slate-600 space-y-1.5 leading-relaxed">
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <ShieldCheck className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
              <span>Official Platform Payment Confirmation</span>
            </div>
            <p>
              This electronic receipt verifies that the above contribution was successfully processed and allocated towards the designated community initiative.
            </p>
            <p className="text-[10px] text-slate-500">
              Notice: Walk With Us operates as a direct grassroots community assistance registry. Unless otherwise specified by verified NGO partners, contributions are non-deductible under Section 80G.
            </p>
          </div>
        </div>

        {/* Modal Footer (hidden on print) */}
        <div className="mt-6 flex justify-end gap-3 print:hidden">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            Print Receipt
          </Button>
        </div>
      </div>
    </div>
  );
}
