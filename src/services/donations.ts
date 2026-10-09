/**
 * Donation Integration Boundary & Payment Service (Razorpay Test Mode).
 *
 * PRODUCTION-GRADE ARCHITECTURE RULES:
 * 1. RAZORPAY TEST MODE:
 *    Razorpay is connected strictly in TEST MODE. Live payments are NOT enabled.
 * 2. NO SECRETS IN FRONTEND:
 *    The browser holds ZERO gateway secrets (`RAZORPAY_KEY_SECRET` or `SUPABASE_SERVICE_ROLE_KEY`).
 *    All order creation, HMAC-SHA256 signature verification, and webhook processing
 *    run inside isolated Supabase Edge Functions.
 * 3. NO CLIENT-SIDE SUCCESS FAKING:
 *    Payments are marked 'paid' ONLY after the server verifies the Razorpay cryptographic signature.
 * 4. INTEGER MINOR UNITS:
 *    All amounts are strictly calculated and persisted in integer paise (1 INR = 100 paise).
 * 5. ATOMIC FUNDING TOTAL:
 *    `help_requests.raised_amount` is updated automatically and atomically inside Postgres
 *    via trigger on verified transitions to 'paid' (and decremented on 'refunded').
 */

import { supabase } from '../lib/supabase';
import { PAYMENT_PROVIDER, RAZORPAY_TEST_MODE, RAZORPAY_PUBLIC_KEY_ID } from '../lib/siteConfig';
import {
  MIN_DONATION_RUPEES,
  MAX_DONATION_RUPEES,
  MIN_DONATION_PAISE,
  MAX_DONATION_PAISE,
  parseAndValidateINR,
  paiseToRupees,
  rupeesToPaise,
  formatPaiseToINR,
} from '../lib/money';
import type {
  PaymentStatus,
  PaymentProvider,
  DonationRecord,
  PublicDonationItem,
  DonationAmountPreset,
  DonorDetailsInput,
  CreateDonationIntentInput,
  DonationIntentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  RazorpayOrderData,
  RazorpayPaymentResponse,
} from '../types/donations';

export type {
  PaymentStatus,
  PaymentProvider,
  DonationRecord,
  PublicDonationItem,
  DonationAmountPreset,
  DonorDetailsInput,
  CreateDonationIntentInput,
  DonationIntentResult,
  VerifyPaymentInput,
  VerifyPaymentResult,
  RazorpayOrderData,
  RazorpayPaymentResponse,
};

export {
  PAYMENT_PROVIDER,
  RAZORPAY_TEST_MODE,
  RAZORPAY_PUBLIC_KEY_ID,
  MIN_DONATION_RUPEES,
  MAX_DONATION_RUPEES,
  MIN_DONATION_PAISE,
  MAX_DONATION_PAISE,
  parseAndValidateINR,
  paiseToRupees,
  rupeesToPaise,
  formatPaiseToINR,
};

/** Backwards-compatibility aliases */
export const MIN_DONATION_AMOUNT = MIN_DONATION_RUPEES;
export const MAX_DONATION_AMOUNT = MAX_DONATION_RUPEES;

export interface DonationAmount {
  amount: number;
  label: string;
  description: string;
}

export interface DonationIntent {
  amount: number;
  currency: 'INR';
  requestId: string | null;
  requestTitle: string | null;
  donorDetails?: DonorDetailsInput;
}

export type DonationResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'provider_not_configured' | 'invalid_amount' | 'invalid_donor_details' | 'provider_error'; message: string };

/** Fixed donation presets in INR, with both rupees and exact minor units (paise) */
export const DONATION_PRESETS: readonly DonationAmountPreset[] = [
  {
    rupees: 500,
    paise: 50_000,
    label: '₹500',
    description: 'Essential aid or transportation support.',
  },
  {
    rupees: 1000,
    paise: 100_000,
    label: '₹1,000',
    description: 'Vital supplies or urgent medication assistance.',
  },
  {
    rupees: 2000,
    paise: 200_000,
    label: '₹2,000',
    description: 'Direct family sustenance or specialized relief.',
  },
  {
    rupees: 5000,
    paise: 500_000,
    label: '₹5,000',
    description: 'Substantial help bringing a request closer to its goal.',
  },
];

/** Backwards-compatibility alias for existing views */
export const DONATION_TIERS: readonly DonationAmount[] = DONATION_PRESETS.map((p) => ({
  amount: p.rupees,
  label: p.label,
  description: p.description,
}));

/**
 * Returns true if an online payment provider is configured.
 */
export function isOnlineDonationEnabled(): boolean {
  return PAYMENT_PROVIDER !== null;
}

/**
 * True when a published request has an unmet funding goal.
 */
export function hasUnmetGoal(
  raised: number | null | undefined,
  target: number | null | undefined,
): boolean {
  const t = target ?? 0;
  const r = raised ?? 0;
  return t > 0 && r < t;
}

/**
 * Validates a raw donation amount input using exact integer minor units.
 */
export function validateDonationAmount(raw: string | number): DonationResult<number> {
  const parsed = parseAndValidateINR(raw);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: 'invalid_amount',
      message: parsed.error ?? 'Please enter a valid donation amount.',
    };
  }
  return { ok: true, data: parsed.rupees };
}

/**
 * Validates donor information fields according to minimum data principles.
 */
export function validateDonorDetails(
  details?: DonorDetailsInput | null,
): { ok: true } | { ok: false; message: string } {
  if (!details) return { ok: true };

  if (details.fullName && details.fullName.trim().length > 0) {
    const trimmed = details.fullName.trim();
    if (trimmed.length < 2 || trimmed.length > 120) {
      return { ok: false, message: 'Donor name must be between 2 and 120 characters.' };
    }
  }

  if (details.email && details.email.trim().length > 0) {
    const trimmedEmail = details.email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (trimmedEmail.length < 3 || trimmedEmail.length > 254 || !emailRegex.test(trimmedEmail)) {
      return { ok: false, message: 'Please provide a valid email address for receipt delivery.' };
    }
  }

  if (details.phone && details.phone.trim().length > 0) {
    const trimmedPhone = details.phone.trim();
    if (trimmedPhone.length < 7 || trimmedPhone.length > 32) {
      return { ok: false, message: 'Please provide a valid phone number.' };
    }
  }

  return { ok: true };
}

/**
 * Creates a donation intent and initializes a Razorpay Order through the server-side Edge Function.
 */
export async function createDonationIntent(
  intent: CreateDonationIntentInput | DonationIntent,
): Promise<DonationIntentResult> {
  // 1. Check provider enablement
  if (!isOnlineDonationEnabled()) {
    return {
      ok: false,
      reason: 'provider_not_configured',
      message:
        'Online donation processing is not configured yet. No charge has been made.',
    };
  }

  // 2. Normalize and validate amount in minor units (paise)
  const amountPaise = 'amountPaise' in intent ? intent.amountPaise : rupeesToPaise(intent.amount);
  if (amountPaise < MIN_DONATION_PAISE || amountPaise > MAX_DONATION_PAISE) {
    return {
      ok: false,
      reason: 'invalid_amount',
      message: `Contribution must be between ₹${MIN_DONATION_RUPEES} and ₹${MAX_DONATION_RUPEES}.`,
    };
  }

  // 3. Validate donor details
  const donorDetails = 'donorDetails' in intent ? intent.donorDetails : undefined;
  const donorCheck = validateDonorDetails(donorDetails);
  if (!donorCheck.ok) {
    return {
      ok: false,
      reason: 'invalid_donor_details',
      message: donorCheck.message,
    };
  }

  // 4. Invoke secure server-side Edge Function
  try {
    const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
      body: {
        requestId: intent.requestId || null,
        amountPaise,
        donorDetails: donorDetails || {},
      },
    });

    if (error) {
      const errMsg = error.message || 'Payment server is currently unreachable.';
      const isMissingConfig =
        errMsg.includes('gateway_credentials_missing') ||
        errMsg.includes('credentials are not set') ||
        errMsg.includes('FunctionsFetchError') ||
        errMsg.includes('Failed to send');

      return {
        ok: false,
        reason: isMissingConfig ? 'provider_not_configured' : 'provider_error',
        message: isMissingConfig
          ? 'Razorpay Test Mode credentials need to be configured in the server environment.'
          : errMsg,
      };
    }

    if (!data || !data.ok) {
      const isMissingConfig = data?.error === 'gateway_credentials_missing';
      return {
        ok: false,
        reason: isMissingConfig ? 'provider_not_configured' : 'provider_error',
        message:
          data?.message ||
          'Failed to initialize Razorpay test order. Please check server configuration.',
      };
    }

    return {
      ok: true,
      data: {
        donationId: data.donationId,
        amountPaise: data.amountPaise,
        currency: 'INR',
        provider: 'razorpay',
        reference: data.orderId,
        orderId: data.orderId,
        keyId: data.keyId || RAZORPAY_PUBLIC_KEY_ID,
      },
    };
  } catch (err) {
    console.error('[createDonationIntent] Server invocation error:', err);
    return {
      ok: false,
      reason: 'network_error',
      message: 'Network error communicating with the payment server. Please try again.',
    };
  }
}

/**
 * Sends client checkout callback to the secure server-side verification endpoint.
 * ONLY the server verifies the HMAC-SHA256 signature with RAZORPAY_KEY_SECRET.
 */
export async function verifyRazorpayPayment(
  params: VerifyPaymentInput,
): Promise<VerifyPaymentResult> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
      body: params,
    });

    if (error) {
      return {
        ok: false,
        error: 'network_error',
        message: error.message || 'Unable to connect to verification server.',
      };
    }

    if (!data || !data.ok) {
      return {
        ok: false,
        error: data?.error || 'verification_failed',
        message: data?.message || 'Payment signature could not be verified by server.',
      };
    }

    return {
      ok: true,
      status: 'paid',
      donationId: data.donationId,
      message: data.message,
    };
  } catch (err) {
    return {
      ok: false,
      error: 'internal_error',
      message: (err as Error).message || 'Unexpected payment verification error.',
    };
  }
}

/**
 * Fetch verified public donations for a published help request.
 * Reads only from the sanitized `public_donations` view.
 * Never leaks private donor emails, phone numbers, or gateway secrets.
 */
export async function getPublicDonationsForRequest(
  requestId: string,
): Promise<{ data: PublicDonationItem[]; error: string | null }> {
  if (!requestId) return { data: [], error: null };

  try {
    const { data, error } = await supabase
      .from('public_donations')
      .select('id, request_id, amount_paise, currency, created_at, is_anonymous, donor_display_name')
      .eq('request_id', requestId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      return { data: [], error: error.message };
    }

    const items: PublicDonationItem[] = (data || []).map((row) => ({
      id: String(row.id),
      requestId: row.request_id ? String(row.request_id) : null,
      amountPaise: Number(row.amount_paise),
      currency: 'INR',
      createdAt: String(row.created_at),
      isAnonymous: Boolean(row.is_anonymous),
      donorDisplayName: String(row.donor_display_name || 'Supporter'),
    }));

    return { data: items, error: null };
  } catch (err) {
    return { data: [], error: (err as Error).message };
  }
}
