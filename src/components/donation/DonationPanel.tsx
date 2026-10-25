import { useState, useId, useMemo } from 'react';
import {
  Heart,
  Lock,
  Mail,
  Info,
  AlertCircle,
  Clock,
  ShieldCheck,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import {
  DONATION_PRESETS,
  MIN_DONATION_RUPEES,
  MAX_DONATION_RUPEES,
  isOnlineDonationEnabled,
  createDonationIntent,
  verifyRazorpayPayment,
  reconcileDonation,
  validateDonorDetails,
  type DonorDetailsInput,
} from '../../services/donations';
import { parseAndValidateINR, formatPaiseToINR } from '../../lib/money';
import { formatINR, fundingPercent } from '../../lib/format';
import { ProgressBar } from '../ui/ProgressBar';
import { CONTACT_EMAIL, RAZORPAY_TEST_MODE } from '../../lib/siteConfig';
import { loadRazorpayCheckoutScript } from '../../lib/razorpay';

export interface DonationPanelProps {
  requestId: string;
  requestTitle: string;
  targetAmount: number | null;
  raisedAmount: number | null;
  isFullyFunded?: boolean;
  hasTarget?: boolean;
  className?: string;
  onShareClick?: () => void;
  onDonationSuccess?: () => void;
}

type PaymentFlowState =
  | 'idle'
  | 'submitting'
  | 'unconfigured'
  | 'pending_verification'
  | 'success'
  | 'cancelled'
  | 'failed';

export function DonationPanel({
  requestId,
  requestTitle,
  targetAmount,
  raisedAmount,
  isFullyFunded = false,
  hasTarget = true,
  className = '',
  onShareClick,
  onDonationSuccess,
}: DonationPanelProps) {
  const online = isOnlineDonationEnabled();

  // Amount selection state
  const [selectedPresetPaise, setSelectedPresetPaise] = useState<number | null>(100_000); // Default ₹1,000 preset
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customInput, setCustomInput] = useState('');

  // Donor information state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  // Status and feedback state
  const [flowState, setFlowState] = useState<PaymentFlowState>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [verifiedPaymentRef, setVerifiedPaymentRef] = useState<string | null>(null);
  const [lastDonatedPaise, setLastDonatedPaise] = useState<number | null>(null);

  // Unique element IDs for accessibility
  const id = useId();
  const customInputId = `${id}-custom-amount`;
  const nameInputId = `${id}-donor-name`;
  const emailInputId = `${id}-donor-email`;
  const phoneInputId = `${id}-donor-phone`;
  const anonCheckId = `${id}-donor-anon`;

  // Resolved financial amounts in minor units (paise)
  const resolvedAmount = useMemo(() => {
    if (isCustomMode) {
      if (!customInput.trim()) {
        return { ok: false, paise: 0, rupees: 0, error: 'Please enter a contribution amount.' };
      }
      return parseAndValidateINR(customInput);
    }
    if (selectedPresetPaise !== null) {
      return {
        ok: true,
        paise: selectedPresetPaise,
        rupees: selectedPresetPaise / 100,
      };
    }
    return { ok: false, paise: 0, rupees: 0, error: 'Please select or enter an amount.' };
  }, [isCustomMode, customInput, selectedPresetPaise]);

  const target = targetAmount ?? 0;
  const raised = raisedAmount ?? 0;
  const percent = hasTarget && target > 0 ? fundingPercent(raised, target) : 0;

  // Handle Preset Button Click
  const handleSelectPreset = (paise: number) => {
    setSelectedPresetPaise(paise);
    setIsCustomMode(false);
    setValidationError(null);
    if (flowState !== 'idle' && flowState !== 'submitting') {
      setFlowState('idle');
      setStatusMessage(null);
    }
  };

  // Handle Custom Amount Toggle
  const handleToggleCustom = () => {
    setIsCustomMode(true);
    setSelectedPresetPaise(null);
    setValidationError(null);
    if (flowState !== 'idle' && flowState !== 'submitting') {
      setFlowState('idle');
      setStatusMessage(null);
    }
  };

  // Submit Intent & Open Razorpay Checkout Handler
  const handleContinue = async () => {
    setValidationError(null);

    // 1. Validate amount
    if (!resolvedAmount.ok) {
      setValidationError(resolvedAmount.error ?? 'Please specify a valid contribution amount.');
      return;
    }

    // 2. Validate donor details
    const donorPayload: DonorDetailsInput = {
      fullName: fullName.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      isAnonymous,
    };

    const detailsValidation = validateDonorDetails(donorPayload);
    if (!detailsValidation.ok) {
      setValidationError(detailsValidation.message);
      setShowDetails(true);
      return;
    }

    setFlowState('submitting');
    setStatusMessage(null);

    // 3. Create Razorpay order via secure server-side Edge Function
    const result = await createDonationIntent({
      requestId,
      requestTitle,
      amountPaise: resolvedAmount.paise,
      donorDetails: donorPayload,
    });

    if (!result.ok) {
      if (result.reason === 'provider_not_configured') {
        setFlowState('unconfigured');
        setStatusMessage(result.message);
      } else {
        setFlowState('failed');
        setStatusMessage(result.message);
      }
      return;
    }

    const { orderId, keyId, donationId, amountPaise } = result.data;

    // 4. Load Razorpay Checkout SDK dynamically
    const scriptReady = await loadRazorpayCheckoutScript();
    if (!scriptReady || !window.Razorpay) {
      setFlowState('failed');
      setStatusMessage(
        'Unable to load the Razorpay Checkout SDK. Please check your network connection and try again.',
      );
      return;
    }

    // 5. Open Razorpay Checkout Modal (TEST MODE)
    try {
      const options = {
        key: keyId,
        amount: amountPaise,
        currency: 'INR',
        name: 'Walk With Us',
        description: `Test Donation for ${requestTitle}`,
        order_id: orderId,
        prefill: {
          name: isAnonymous ? '' : fullName.trim() || undefined,
          email: email.trim() || undefined,
          contact: phone.trim() || undefined,
        },
        notes: {
          donationId,
          requestId,
          mode: 'test',
        },
        theme: {
          color: '#0d7668',
        },
        modal: {
          ondismiss: () => {
            setFlowState('cancelled');
            setStatusMessage('Payment was cancelled before completion. No funds were charged.');
            // Reconcile with Razorpay server-side to confirm cancellation and update DB
            void reconcileDonation(donationId, { userAction: 'cancelled' });
          },
        },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_order_id: string;
          razorpay_signature: string;
        }) => {
          // 6. Signature verification callback
          setFlowState('pending_verification');
          setStatusMessage("Payment submitted. We're verifying your payment with the server…");

          const verifyResult = await verifyRazorpayPayment({
            donationId,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_signature: response.razorpay_signature,
          });

          if (verifyResult.ok) {
            setFlowState('success');
            setVerifiedPaymentRef(response.razorpay_payment_id);
            setLastDonatedPaise(amountPaise);
            setStatusMessage(null);
            onDonationSuccess?.();
          } else {
            setFlowState('failed');
            setStatusMessage(
              verifyResult.message ||
                'Server signature verification failed. Please contact our support team.',
            );
          }
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rzpInstance = new (window.Razorpay as any)(options);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rzpInstance.on('payment.failed', (failResp: any) => {
        setFlowState('failed');
        const description = failResp?.error?.description || 'Payment was declined or cancelled by the provider.';
        setStatusMessage(description);
        // Reconcile with Razorpay server-side to record verified failure
        void reconcileDonation(donationId);
      });
      rzpInstance.open();
    } catch (checkoutErr) {
      console.error('[DonationPanel] Razorpay checkout launch error:', checkoutErr);
      setFlowState('failed');
      setStatusMessage('Failed to initialize Razorpay Checkout. Please try again.');
    }
  };

  const handleResetFlow = () => {
    setFlowState('idle');
    setStatusMessage(null);
    setValidationError(null);
    setVerifiedPaymentRef(null);
  };

  const mailtoCoordinationUrl = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
    `[Walk With Us] Direct Donation Arrangement: "${requestTitle}"`,
  )}&body=${encodeURIComponent(
    `Hello Walk With Us Team,\n\nI would like to arrange a direct contribution of ${
      resolvedAmount.ok ? formatPaiseToINR(resolvedAmount.paise) : 'INR [Amount]'
    } for the verified request:\n"${requestTitle}" (ID: ${requestId}).\n\nDonor Details:\nName: ${
      isAnonymous ? 'Anonymous Supporter' : fullName || '[Your Name]'
    }\nEmail: ${email || '[Your Email]'}\nPhone: ${phone || '[Your Phone]'}\n\nPlease let me know how to coordinate this transfer securely.\n\nThank you!`,
  )}`;

  return (
    <div
      id="donation-section"
      className={`border border-line bg-surface p-5 sm:p-6 rounded-control shadow-xs space-y-5 ${className}`}
    >
      {/* 1. Header & Progress Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-subtle">
            Support This Request
          </p>
          <div className="flex items-center gap-1.5">
            {RAZORPAY_TEST_MODE && (
              <span className="inline-flex items-center text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-control">
                TEST MODE
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-control">
              <ShieldCheck className="h-3 w-3 text-emerald-700" aria-hidden="true" />
              100% Direct Aid
            </span>
          </div>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed">
          Every contribution helps this verified request move closer to its target. Zero platform deductions.
        </p>

        {/* Real funding metrics from database */}
        {hasTarget && (
          <div className="pt-1 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <span className="text-xl sm:text-2xl font-bold text-ink tabular-nums">
                  {formatINR(raised)}
                </span>
                <span className="ml-1 text-xs text-ink-subtle">
                  raised of {formatINR(target)} goal
                </span>
              </div>
              <span className="text-xs font-bold text-primary tabular-nums">
                {percent}% funded
              </span>
            </div>
            <ProgressBar value={percent} size="sm" />
          </div>
        )}
      </div>

      {/* 2. Success State: Verified Payment Confirmation */}
      {flowState === 'success' ? (
        <div
          role="status"
          className="rounded-control bg-emerald-50/80 border border-emerald-200 p-5 text-xs text-emerald-950 space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-base font-bold text-emerald-900">Thank you for your support.</h3>
              <p className="mt-1 leading-relaxed text-emerald-800">
                Your contribution of{' '}
                <strong className="text-emerald-950">
                  {lastDonatedPaise ? formatPaiseToINR(lastDonatedPaise) : 'INR'}
                </strong>{' '}
                has been received and verified.
              </p>
            </div>
          </div>

          <div className="rounded-control bg-white/80 p-3.5 space-y-1.5 border border-emerald-200/60 text-xs">
            <div className="flex justify-between">
              <span className="text-ink-muted">Request:</span>
              <span className="font-semibold text-ink text-right truncate max-w-[200px]">
                {requestTitle}
              </span>
            </div>
            {verifiedPaymentRef && (
              <div className="flex justify-between">
                <span className="text-ink-muted">Payment Reference:</span>
                <span className="font-mono text-ink text-[11px] font-medium">{verifiedPaymentRef}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-ink-muted">Mode:</span>
              <span className="font-semibold text-amber-800">Razorpay Test Mode (Simulated)</span>
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={handleResetFlow}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-control bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 transition-colors min-h-[44px]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Make Another Contribution
            </button>
            {onShareClick && (
              <button
                type="button"
                onClick={onShareClick}
                className="w-full text-center text-xs font-semibold text-emerald-800 hover:text-emerald-950 py-1"
              >
                Share this cause with others →
              </button>
            )}
          </div>
        </div>
      ) : isFullyFunded ? (
        /* Fully Funded Card */
        <div className="rounded-control bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-950 space-y-2">
          <p className="font-semibold text-sm text-emerald-900">
            This request has reached its funding goal!
          </p>
          <p className="leading-relaxed">
            Thank you to all who supported. You can still support other verified families and community members in need.
          </p>
          {onShareClick && (
            <button
              type="button"
              onClick={onShareClick}
              className="mt-2 text-xs font-bold text-emerald-800 underline hover:text-emerald-900"
            >
              Share this story with others →
            </button>
          )}
        </div>
      ) : (
        /* Active Donation Form */
        <div className="space-y-4 pt-1">
          {/* Preset Buttons Grid */}
          <div>
            <label className="sr-only">Select donation amount preset</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DONATION_PRESETS.map((preset) => {
                const isSelected = !isCustomMode && selectedPresetPaise === preset.paise;
                return (
                  <button
                    key={preset.paise}
                    type="button"
                    onClick={() => handleSelectPreset(preset.paise)}
                    aria-pressed={isSelected}
                    className={`min-h-[44px] px-3 py-2 text-center rounded-control border text-xs font-bold transition-all focus-visible:outline-2 focus-visible:outline-primary ${
                      isSelected
                        ? 'border-primary bg-primary text-white shadow-xs'
                        : 'border-line bg-surface text-ink hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span>{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Toggle or Enter Another Amount */}
          <div>
            {!isCustomMode ? (
              <button
                type="button"
                onClick={handleToggleCustom}
                className="text-xs font-semibold text-primary hover:text-primary-strong transition-colors min-h-[32px] inline-flex items-center"
              >
                + Enter another amount
              </button>
            ) : (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor={customInputId} className="text-xs font-semibold text-ink">
                    Custom Amount (in Rupees)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleSelectPreset(100_000)}
                    className="text-[11px] text-ink-subtle hover:text-ink underline"
                  >
                    Back to presets
                  </button>
                </div>
                <div className="relative">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-subtle"
                  >
                    ₹
                  </span>
                  <input
                    id={customInputId}
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 1500"
                    value={customInput}
                    onChange={(e) => {
                      setCustomInput(e.target.value);
                      setValidationError(null);
                    }}
                    className="field-control pl-7 py-2 text-sm"
                    autoFocus
                  />
                </div>
                <p className="text-[11px] text-ink-subtle">
                  Minimum {formatINR(MIN_DONATION_RUPEES)} · Maximum {formatINR(MAX_DONATION_RUPEES)}
                </p>
              </div>
            )}
          </div>

          {/* Amount Display Callout */}
          <div className="rounded-control bg-canvas-subtle p-3 flex items-center justify-between text-xs border border-line/60">
            <span className="text-ink-muted">Selected contribution:</span>
            <span className="font-bold text-ink text-sm tabular-nums">
              {resolvedAmount.ok ? formatPaiseToINR(resolvedAmount.paise) : '—'}
            </span>
          </div>

          {/* Donor Information Toggle */}
          <div className="border-t border-line/60 pt-3">
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className="w-full flex items-center justify-between text-xs font-semibold text-ink py-1 hover:text-primary transition-colors text-left"
            >
              <span>Donor details (optional)</span>
              <span className="text-ink-subtle text-[11px]">
                {showDetails ? 'Hide' : '+ Add details'}
              </span>
            </button>

            {showDetails && (
              <div className="mt-3 space-y-3 pt-1">
                <div>
                  <label htmlFor={nameInputId} className="block text-[11px] font-medium text-ink-muted mb-1">
                    Your Name
                  </label>
                  <input
                    id={nameInputId}
                    type="text"
                    disabled={isAnonymous}
                    placeholder={isAnonymous ? 'Anonymous Supporter' : 'e.g. Priya Sharma'}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="field-control text-xs py-2 disabled:bg-slate-100 disabled:text-ink-subtle"
                  />
                </div>

                <div>
                  <label htmlFor={emailInputId} className="block text-[11px] font-medium text-ink-muted mb-1">
                    Email Address <span className="text-ink-subtle font-normal">(for receipt verification)</span>
                  </label>
                  <input
                    id={emailInputId}
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="field-control text-xs py-2"
                  />
                </div>

                <div>
                  <label htmlFor={phoneInputId} className="block text-[11px] font-medium text-ink-muted mb-1">
                    Phone Number <span className="text-ink-subtle font-normal">(optional)</span>
                  </label>
                  <input
                    id={phoneInputId}
                    type="tel"
                    placeholder="+91 98765 43210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="field-control text-xs py-2"
                  />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    id={anonCheckId}
                    type="checkbox"
                    checked={isAnonymous}
                    onChange={(e) => setIsAnonymous(e.target.checked)}
                    className="h-4 w-4 rounded-control border-line text-primary focus:ring-primary/25 cursor-pointer"
                  />
                  <label htmlFor={anonCheckId} className="text-xs text-ink cursor-pointer select-none">
                    Donate anonymously (hide my name publicly)
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* Validation Error Banner */}
          {validationError && (
            <div
              role="alert"
              className="rounded-control bg-rose-50 border border-rose-200 p-3 text-xs text-rose-800 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{validationError}</span>
            </div>
          )}

          {/* Unconfigured / Missing Credentials Banner */}
          {flowState === 'unconfigured' && (
            <div
              role="status"
              className="rounded-control bg-amber-50/90 border border-amber-200 p-3.5 text-xs text-amber-950 space-y-2"
            >
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-900">
                    Razorpay Test Credentials Required
                  </p>
                  <p className="leading-relaxed text-amber-800">
                    {statusMessage ||
                      'Razorpay test mode credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) must be set in the Supabase Edge Function environment before test payments can initialize.'}
                  </p>
                </div>
              </div>

              <div className="border-t border-amber-200/80 pt-2 text-[11px] text-amber-900 flex items-center justify-between">
                <span>Direct coordination available:</span>
                <a
                  href={mailtoCoordinationUrl}
                  className="font-bold text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Mail className="h-3 w-3" aria-hidden="true" />
                  Email team to arrange
                </a>
              </div>
            </div>
          )}

          {/* Pending Verification Banner */}
          {flowState === 'pending_verification' && (
            <div
              role="status"
              className="rounded-control bg-blue-50 border border-blue-200 p-3.5 text-xs text-blue-900 flex items-start gap-2.5"
            >
              <Clock className="h-4 w-4 text-blue-600 shrink-0 mt-0.5 animate-spin" aria-hidden="true" />
              <div className="space-y-0.5">
                <p className="font-bold">Payment Submitted</p>
                <p>{statusMessage || "We're verifying your transaction with the server…"}</p>
              </div>
            </div>
          )}

          {/* Cancelled Banner */}
          {flowState === 'cancelled' && (
            <div
              role="status"
              className="rounded-control bg-slate-50 border border-slate-300 p-3 text-xs text-ink-muted flex items-start gap-2"
            >
              <Info className="h-4 w-4 text-ink-subtle shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-semibold text-ink">Payment cancelled</p>
                <p className="mt-0.5">{statusMessage || 'Checkout was dismissed. No funds were charged.'}</p>
              </div>
            </div>
          )}

          {/* Failure Alert */}
          {flowState === 'failed' && (
            <div
              role="alert"
              className="rounded-control bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-bold">Payment could not proceed</p>
                <p className="mt-0.5">{statusMessage || 'Payment failed or signature verification was rejected.'}</p>
              </div>
            </div>
          )}

          {/* Primary Action Button */}
          <div>
            <button
              type="button"
              disabled={flowState === 'submitting' || flowState === 'pending_verification' || !resolvedAmount.ok}
              onClick={() => void handleContinue()}
              className="w-full min-h-[48px] rounded-control bg-primary px-4 py-3 text-xs sm:text-sm font-bold text-white shadow-xs transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-primary inline-flex items-center justify-center gap-2"
            >
              {flowState === 'submitting' ? (
                <span>Initializing Razorpay Checkout…</span>
              ) : flowState === 'pending_verification' ? (
                <span>Verifying signature…</span>
              ) : online ? (
                <>
                  <Heart className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>
                    Proceed with {resolvedAmount.ok ? formatPaiseToINR(resolvedAmount.paise) : ''}
                  </span>
                </>
              ) : (
                <>
                  <Heart className="h-4 w-4" aria-hidden="true" />
                  <span>
                    Continue with {resolvedAmount.ok ? formatPaiseToINR(resolvedAmount.paise) : 'Donation'}
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Test Mode & Security Reassurance Footer */}
          <div className="pt-2 text-center border-t border-line/60 space-y-1">
            <p className="text-[11px] text-ink-subtle flex items-center justify-center gap-1.5 flex-wrap">
              <Lock className="h-3 w-3 text-ink-subtle" aria-hidden="true" />
              <span>Razorpay Test Gateway</span>
              <span>·</span>
              <span>HMAC Signature Verified</span>
              <span>·</span>
              <span>Zero Live Charges</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
export default DonationPanel;
