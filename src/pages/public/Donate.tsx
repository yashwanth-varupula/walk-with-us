import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  HandHeart,
  Heart,
  Info,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  DONATION_TIERS,
  MAX_DONATION_AMOUNT,
  MIN_DONATION_AMOUNT,
  createDonationIntent,
  hasUnmetGoal,
  isOnlineDonationEnabled,
  validateDonationAmount,
  validateDonorDetails,
  verifyRazorpayPayment,
  reconcileDonation,
} from '../../services/donations';
import { getPublicHelpRequestsPage, type PublicHelpRequest } from '../../services/helpRequests';
import { formatINR, fundingPercent } from '../../lib/format';
import { LinkButton } from '../../components/ui/Button';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { CONTACT_EMAIL } from '../../lib/siteConfig';
import { loadRazorpayCheckoutScript } from '../../lib/razorpay';

export default function Donate() {
  const online = isOnlineDonationEnabled();
  const { requestId: paramRequestId } = useParams<{ requestId?: string }>();

  const [amount, setAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [requestId, setRequestId] = useState('');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorPhone, setDonorPhone] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [requests, setRequests] = useState<PublicHelpRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [requestsAttempt, setRequestsAttempt] = useState(0);
  const [deepLinkMissing, setDeepLinkMissing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [donationSuccess, setDonationSuccess] = useState<{
    reference: string;
    amount: number;
    requestTitle: string;
  } | null>(null);

  /* ------------------------------------------------------------- fetch data */

  useEffect(() => {
    let active = true;
    setLoadingRequests(true);
    setRequestsError(null);

    void (async () => {
      const page = await getPublicHelpRequestsPage({ limit: 60 });
      if (!active) return;

      if (page.error) {
        setRequests([]);
        setRequestsError(page.error.message);
        setDeepLinkMissing(false);
        setLoadingRequests(false);
        return;
      }

      const open = page.rows.filter((r) => hasUnmetGoal(r.raisedAmount, r.targetAmount));
      setRequests(open);

      if (paramRequestId) {
        const match = open.find((r) => r.id === paramRequestId);
        if (match) {
          setRequestId(match.id);
          setDeepLinkMissing(false);
        } else {
          setRequestId('');
          setDeepLinkMissing(true);
        }
      }
      setLoadingRequests(false);
    })();

    return () => {
      active = false;
    };
  }, [paramRequestId, requestsAttempt]);

  const chosen = requests.find((r) => r.id === requestId) ?? null;

  /* ----------------------------------------------------------- computations */

  const customIsBlank = customAmount.trim() === '';
  const customResult = customIsBlank ? null : validateDonationAmount(customAmount);
  const customError = customResult && !customResult.ok ? customResult.message : null;
  const customAmountValue = customResult?.ok ? customResult.data : null;
  const effectiveAmount = customAmountValue ?? amount;

  /* ---------------------------------------------------------------- handlers */

  const handleDonate = async () => {
    if (effectiveAmount === null) {
      setMessage('Please select or enter an amount first.');
      return;
    }

    const donorPayload = {
      fullName: donorName.trim() || undefined,
      email: donorEmail.trim() || undefined,
      phone: donorPhone.trim() || undefined,
      isAnonymous,
    };

    const check = validateDonorDetails(donorPayload);
    if (!check.ok) {
      setMessage(check.message);
      return;
    }

    setBusy(true);
    setMessage(null);

    const result = await createDonationIntent({
      amount: effectiveAmount,
      currency: 'INR',
      requestId: chosen?.id ?? null,
      requestTitle: chosen?.title ?? null,
      donorDetails: donorPayload,
    });

    if (!result.ok) {
      setBusy(false);
      setMessage(result.message);
      return;
    }

    const { orderId, keyId, donationId, amountPaise } = result.data;

    // Load Razorpay Checkout SDK dynamically
    const scriptLoaded = await loadRazorpayCheckoutScript();
    if (!scriptLoaded || !window.Razorpay) {
      setBusy(false);
      setMessage('Unable to load Razorpay Checkout SDK. Please check your internet connection.');
      return;
    }

    try {
      const options = {
        key: keyId,
        amount: amountPaise,
        currency: 'INR',
        name: 'Walk With Us',
        description: chosen ? `Contribution for ${chosen.title}` : 'General Contribution',
        order_id: orderId,
        prefill: {
          name: isAnonymous ? '' : donorName.trim() || undefined,
          email: donorEmail.trim() || undefined,
          contact: donorPhone.trim() || undefined,
        },
        theme: { color: '#0d7668' },
        modal: {
          ondismiss: () => {
            setBusy(false);
            setMessage('Payment was cancelled. No funds were charged.');
            // Reconcile with Razorpay server-side to confirm cancellation and update DB
            void reconcileDonation(donationId, { userAction: 'cancelled' });
          },
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          setMessage("Payment submitted. We're verifying your transaction with the server…");
          const verifyResult = await verifyRazorpayPayment({
            donationId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });

          setBusy(false);
          if (verifyResult.ok) {
            setDonationSuccess({
              reference: response.razorpay_payment_id,
              amount: effectiveAmount,
              requestTitle: chosen?.title || 'General Community Fund',
            });
            setMessage(null);
          } else {
            setMessage(verifyResult.message || 'Signature verification failed.');
          }
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rzpInstance = new (window.Razorpay as any)(options);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rzpInstance.on('payment.failed', (failResp: any) => {
        setBusy(false);
        const description = failResp?.error?.description || 'Payment was declined or cancelled.';
        setMessage(description);
        // Reconcile with Razorpay server-side to record verified failure
        void reconcileDonation(donationId);
      });
      rzpInstance.open();
    } catch {
      setBusy(false);
      setMessage('Failed to launch Razorpay Checkout.');
    }
  };

  const mailtoUrl = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    '[Walk With Us] Direct Donation Arrangement',
  )}&body=${encodeURIComponent(
    `Hello Walk With Us Team,\n\nI would like to arrange a direct contribution of ${
      effectiveAmount !== null ? formatINR(effectiveAmount) : '[Amount in INR]'
    }${chosen ? ` directed towards verified request: "${chosen.title}" (ID: ${chosen.id})` : ' towards the general fund'}.\n\nDonor Details:\nName: ${
      isAnonymous ? 'Anonymous Supporter' : donorName.trim() || '[Your Name]'
    }\nEmail: ${donorEmail.trim() || '[Your Email]'}\nPhone: ${donorPhone.trim() || '[Your Phone]'}\n\nPlease let me know how to safely coordinate this gift.\n\nThank you!`,
  )}`;

  return (
    <div className="min-h-screen bg-canvas py-8 sm:py-12">
      <div className="container-page">
        {/* Breadcrumb Navigation */}
        <nav aria-label="Breadcrumb" className="mb-6">
          <Link
            to={chosen ? `/help/${chosen.id}` : '/help'}
            className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:border-slate-300 hover:text-ink focus-visible:outline-2 focus-visible:outline-primary min-h-[36px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{chosen ? 'Back to Request Story' : 'Back to All Requests'}</span>
          </Link>
        </nav>

        {/* Page Header */}
        <header className="mb-8 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 rounded-control border border-primary-soft-strong bg-primary-soft/60 px-3 py-1 text-xs font-medium text-primary-strong">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>Zero Platform Fees · 100% Direct Support</span>
          </div>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-ink sm:text-3xl lg:text-4xl">
            Support a Verified Need
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted sm:text-base">
            Every contribution directly aids verified individuals and families in our community. Choose your contribution amount below.
          </p>
        </header>

        {/* 2-Column Donation Experience */}
        <div className="grid gap-8 lg:grid-cols-12 items-start">
          {/* Main Form Column (7 cols) */}
          <main className="space-y-6 lg:col-span-7">
            {/* Deep-link Missing Warning Banner */}
            {deepLinkMissing && (
              <div
                role="status"
                className="rounded-card border border-amber-200 bg-amber-50/70 p-4 sm:p-5 text-xs sm:text-sm text-amber-900"
              >
                <div className="flex items-start gap-2.5">
                  <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="font-bold">Requested cause is no longer accepting funding</p>
                    <p className="mt-1 leading-relaxed text-amber-800">
                      The request this link pointed at has either reached its funding goal, is no longer public, or does not exist. Your gift has defaulted to General Support, or you can choose an active cause below.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Verified Payment Success Confirmation Banner */}
            {donationSuccess && (
              <div
                role="status"
                className="rounded-card border border-emerald-200 bg-emerald-50/90 p-6 sm:p-7 text-xs sm:text-sm text-emerald-950 space-y-4"
              >
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="h-6 w-6 text-emerald-700" aria-hidden="true" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-emerald-900">Thank you for your support.</h2>
                    <p className="mt-1 leading-relaxed text-emerald-800">
                      Your contribution of{' '}
                      <strong className="text-emerald-950">{formatINR(donationSuccess.amount)}</strong>{' '}
                      has been received and verified.
                    </p>
                  </div>
                </div>

                <div className="rounded-control bg-white/90 p-4 space-y-2 border border-emerald-200/70 text-xs">
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Cause:</span>
                    <span className="font-semibold text-ink text-right">{donationSuccess.requestTitle}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Payment Reference:</span>
                    <span className="font-mono text-ink text-[11px] font-medium">{donationSuccess.reference}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Status:</span>
                    <span className="font-bold text-emerald-800">Verified & Recorded</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-ink-muted">Mode:</span>
                    <span className="font-semibold text-amber-800">Razorpay Test Mode (Simulated)</span>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDonationSuccess(null);
                      setAmount(null);
                      setCustomAmount('');
                    }}
                    className="inline-flex items-center gap-1.5 rounded-control bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition-colors min-h-[40px]"
                  >
                    Make Another Donation
                  </button>
                </div>
              </div>
            )}

            {/* Recipient Context Card */}
            <div className="rounded-card border border-line bg-surface p-6 shadow-xs sm:p-7">
              <h2 className="text-sm font-bold uppercase tracking-wider text-ink-subtle mb-3">
                1. Select Recipient
              </h2>

              {loadingRequests ? (
                <div className="rounded-control bg-canvas p-4 text-xs text-ink-muted animate-pulse">
                  Loading active verified causes…
                </div>
              ) : requestsError ? (
                <div
                  role="alert"
                  className="rounded-control border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900"
                >
                  <p className="font-semibold">Unable to load requests list</p>
                  <p className="mt-1">{requestsError}</p>
                  <button
                    type="button"
                    onClick={() => setRequestsAttempt((n) => n + 1)}
                    className="mt-2 inline-flex items-center gap-1 font-bold text-primary underline"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Try loading again
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label htmlFor="request-select" className="sr-only">
                    Choose which cause to support
                  </label>
                  <select
                    id="request-select"
                    value={requestId}
                    onChange={(e) => setRequestId(e.target.value)}
                    className="field-control text-sm py-2.5"
                  >
                    <option value="">Where it is needed most (General Support)</option>
                    {requests.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.title} — Goal: {formatINR(r.targetAmount)}
                      </option>
                    ))}
                  </select>

                  {/* Active Selection Snapshot */}
                  {chosen ? (
                    <div className="rounded-control border border-line/80 bg-canvas p-4 text-xs space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-ink text-sm truncate pr-2">
                          {chosen.title}
                        </span>
                        <Link
                          to={`/help/${chosen.id}`}
                          className="shrink-0 font-bold text-primary hover:underline"
                        >
                          View story →
                        </Link>
                      </div>
                      <div className="flex items-baseline justify-between text-ink-muted">
                        <span>
                          {formatINR(chosen.raisedAmount)} raised of {formatINR(chosen.targetAmount)} goal
                        </span>
                        <span className="font-bold text-primary">
                          {fundingPercent(chosen.raisedAmount, chosen.targetAmount)}%
                        </span>
                      </div>
                      <ProgressBar
                        value={fundingPercent(chosen.raisedAmount, chosen.targetAmount)}
                        size="sm"
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-ink-muted">
                      Your contribution will be applied wherever urgent funding is most required among verified needs.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Amount Selection Card */}
            <div className="rounded-card border border-line bg-surface p-6 shadow-xs sm:p-7">
              <h2 className="text-sm font-bold uppercase tracking-wider text-ink-subtle mb-3">
                2. Choose Amount (INR)
              </h2>

              {/* Preset Buttons Grid */}
              <fieldset>
                <legend className="sr-only">Preset donation amounts in Rupees</legend>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {DONATION_TIERS.map((tier) => {
                    const isSelected = !customAmountValue && amount === tier.amount;
                    return (
                      <button
                        key={tier.amount}
                        type="button"
                        onClick={() => {
                          setAmount(tier.amount);
                          setCustomAmount('');
                          setMessage(null);
                        }}
                        aria-pressed={isSelected}
                        className={`min-h-[56px] rounded-control border p-3 text-left transition-all focus-visible:outline-2 focus-visible:outline-primary ${
                          isSelected
                            ? 'border-primary bg-primary-soft text-primary-strong ring-2 ring-primary/20 shadow-xs'
                            : 'border-line bg-surface text-ink hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-base font-extrabold tabular-nums">{tier.label}</span>
                          {isSelected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
                        </div>
                        <span className="mt-1 block text-[11px] leading-tight text-ink-muted line-clamp-1">
                          {tier.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {/* Custom Amount Input */}
              <div className="mt-5 pt-4 border-t border-line/60">
                <label htmlFor="custom-amount-input" className="block text-xs font-bold text-ink mb-1.5">
                  Or enter another amount
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-bold text-ink-subtle">
                    ₹
                  </span>
                  <input
                    id="custom-amount-input"
                    type="text"
                    inputMode="numeric"
                    placeholder="Enter custom amount (e.g. 1500)"
                    value={customAmount}
                    onChange={(e) => {
                      setCustomAmount(e.target.value);
                      setMessage(null);
                    }}
                    onFocus={() => setAmount(null)}
                    aria-invalid={Boolean(customError)}
                    aria-describedby="custom-amount-hint"
                    className={`field-control pl-8 py-2.5 text-sm ${
                      customError ? 'border-rose-400 focus-visible:ring-rose-200' : ''
                    }`}
                  />
                </div>
                <div id="custom-amount-hint" className="mt-1.5 text-xs text-ink-subtle">
                  {customError ? (
                    <span className="text-rose-600 font-semibold">{customError}</span>
                  ) : (
                    <span>
                      Minimum {formatINR(MIN_DONATION_AMOUNT)} · Maximum {formatINR(MAX_DONATION_AMOUNT)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Donor Information Card */}
            <div className="rounded-card border border-line bg-surface p-6 shadow-xs sm:p-7">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold uppercase tracking-wider text-ink-subtle">
                  3. Donor Details (Optional)
                </h2>
                <span className="text-[11px] text-ink-subtle">For receipt & verification</span>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="donate-full-name" className="block text-xs font-semibold text-ink mb-1">
                    Your Name
                  </label>
                  <input
                    id="donate-full-name"
                    type="text"
                    disabled={isAnonymous}
                    placeholder={isAnonymous ? 'Anonymous Supporter' : 'Enter your full name'}
                    value={donorName}
                    onChange={(e) => setDonorName(e.target.value)}
                    className="field-control text-sm py-2 disabled:bg-slate-50 disabled:text-ink-subtle"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="donate-email" className="block text-xs font-semibold text-ink mb-1">
                      Email Address
                    </label>
                    <input
                      id="donate-email"
                      type="email"
                      placeholder="name@example.com"
                      value={donorEmail}
                      onChange={(e) => setDonorEmail(e.target.value)}
                      className="field-control text-sm py-2"
                    />
                  </div>
                  <div>
                    <label htmlFor="donate-phone" className="block text-xs font-semibold text-ink mb-1">
                      Phone Number <span className="font-normal text-ink-subtle">(optional)</span>
                    </label>
                    <input
                      id="donate-phone"
                      type="tel"
                      placeholder="+91 98765 43210"
                      value={donorPhone}
                      onChange={(e) => setDonorPhone(e.target.value)}
                      className="field-control text-sm py-2"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1 border-t border-line/60">
                  <input
                    id="donate-is-anonymous"
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="h-4 w-4 rounded-control border-line text-primary focus:ring-primary/25 cursor-pointer"
                  />
                  <label htmlFor="donate-is-anonymous" className="text-xs text-ink cursor-pointer select-none">
                    Donate anonymously (do not publish my name)
                  </label>
                </div>
              </div>
            </div>

            {/* Provider Notice & Primary Action Card */}
            <div className="rounded-card border border-line bg-surface p-6 shadow-xs sm:p-7">
              <h2 className="text-sm font-bold uppercase tracking-wider text-ink-subtle mb-3">
                4. Contribution Summary & Action
              </h2>

              {/* Summary Table */}
              <div className="rounded-control bg-canvas p-4 text-xs space-y-2 border border-line/60">
                <div className="flex justify-between">
                  <span className="text-ink-muted">Designated Cause:</span>
                  <span className="font-semibold text-ink text-right truncate max-w-[240px]">
                    {chosen ? chosen.title : 'General Support (Most urgent needs)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-muted">Contribution:</span>
                  <span className="font-bold text-ink text-sm tabular-nums">
                    {effectiveAmount !== null ? formatINR(effectiveAmount) : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-ink-subtle border-t border-line/50 pt-2">
                  <span>Platform Fee:</span>
                  <span className="text-emerald-700 font-semibold">₹0 (Zero deduction)</span>
                </div>
              </div>

              {/* Honest Payment Status Message */}
              {!online && (
                <div className="mt-4 rounded-control border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900">
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-bold">Online payment gateway not connected yet</p>
                      <p className="mt-0.5 leading-relaxed text-amber-800">
                        No credit card or bank details are collected on this site. Submitting records your donation intent, and our team will coordinate the transfer directly with you.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Service Feedback Alert */}
              {message && (
                <div
                  role="alert"
                  className="mt-4 rounded-control border border-slate-300 bg-slate-50 p-3.5 text-xs text-ink"
                >
                  <div className="flex items-start gap-2">
                    <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                    <div>
                      <p className="font-semibold">Notice</p>
                      <p className="mt-0.5 leading-relaxed text-ink-muted">{message}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Primary Action Button */}
              <div className="mt-6">
                <button
                  type="button"
                  disabled={busy || effectiveAmount === null}
                  onClick={() => void handleDonate()}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-control bg-primary px-6 py-3.5 text-sm font-bold text-white shadow-xs transition-all hover:bg-primary-strong disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-primary min-h-[48px]"
                >
                  {busy ? (
                    <span>Recording your intent…</span>
                  ) : online ? (
                    <>
                      <Heart className="h-4 w-4" aria-hidden="true" />
                      <span>Donate {effectiveAmount !== null ? formatINR(effectiveAmount) : ''}</span>
                    </>
                  ) : (
                    <>
                      <Heart className="h-4 w-4" aria-hidden="true" />
                      <span>
                        {effectiveAmount !== null
                          ? `Continue with ${formatINR(effectiveAmount)} Intent`
                          : 'Select an Amount to Continue'}
                      </span>
                    </>
                  )}
                </button>
              </div>

              {/* Direct Email Coordinator Alternative */}
              <div className="mt-5 text-center border-t border-line/60 pt-4">
                <p className="text-xs text-ink-muted">
                  Prefer to arrange your donation directly via email?{' '}
                  <a
                    href={mailtoUrl}
                    className="font-bold text-primary hover:underline inline-flex items-center gap-1"
                  >
                    <Mail className="h-3 w-3 inline" aria-hidden="true" />
                    Email our team to coordinate
                  </a>
                </p>
              </div>
            </div>
          </main>

          {/* Sidebar Column: Trust & Alternative Support (5 cols) */}
          <aside className="space-y-5 lg:col-span-5">
            {/* How Money is Handled */}
            <div className="rounded-card border border-line bg-surface p-6 shadow-xs sm:p-7">
              <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
                <Lock className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>How Contributions are Handled</span>
              </h2>
              <ul className="mt-4 space-y-3 text-xs leading-relaxed text-ink-muted">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong className="text-ink">100% Direct Giving:</strong> Zero platform deductions. All funds go directly to the verified need.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong className="text-ink">Privacy Protected:</strong> Requester financial details and identity documents are never displayed publicly.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong className="text-ink">Personal Confirmation:</strong> Contributions are coordinated with human verification before being marked received.
                  </span>
                </li>
              </ul>
            </div>

            {/* Other Ways to Help */}
            <div className="rounded-card border border-line bg-surface p-6 shadow-xs sm:p-7">
              <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
                <HandHeart className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>Other Ways to Support</span>
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                Financial aid is only one part of community care. You can also offer volunteer time, transport, skills, or supplies.
              </p>
              <div className="mt-4 flex flex-col gap-2.5">
                <LinkButton to="/volunteer" variant="secondary" size="sm" block>
                  Volunteer With Us
                </LinkButton>
                <LinkButton to="/help" variant="secondary" size="sm" block>
                  Browse All Community Requests
                </LinkButton>
              </div>
            </div>

            {/* Transparency Note */}
            <div className="rounded-card border border-dashed border-line bg-canvas p-5 text-xs text-ink-subtle">
              <p className="font-semibold text-ink-muted flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                Walk With Us Transparency Standard
              </p>
              <p className="mt-1.5 leading-relaxed">
                We believe in complete financial clarity. When online payments are configured with a certified payment aggregator in the future, charges will be processed with automated receipts.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
