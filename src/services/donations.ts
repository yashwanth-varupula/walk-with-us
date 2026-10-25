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
import { getRequestCoverImageUrl } from './helpRequests';
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
  UserDonationRecord,
  DonationSummaryStats,
  MyDonationsFilterStatus,
  GetMyDonationsParams,
  GetMyDonationsResponse,
  DonationReceiptData,
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
  UserDonationRecord,
  DonationSummaryStats,
  MyDonationsFilterStatus,
  GetMyDonationsParams,
  GetMyDonationsResponse,
  DonationReceiptData,
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
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const authHeaders: Record<string, string> = {};
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }

    const { data, error } = await supabase.functions.invoke('create-razorpay-order', {
      body: {
        requestId: intent.requestId || null,
        amountPaise,
        donorDetails: donorDetails || {},
      },
      headers: Object.keys(authHeaders).length > 0 ? authHeaders : undefined,
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
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const authHeaders: Record<string, string> = {};
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }

    const { data, error } = await supabase.functions.invoke('verify-razorpay-payment', {
      body: params,
      headers: Object.keys(authHeaders).length > 0 ? authHeaders : undefined,
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

export interface ReconcileDonationResult {
  ok: boolean;
  reconciled?: Array<{
    donationId: string;
    providerOrderId?: string;
    previousStatus: string;
    currentStatus: string;
    action: string;
    failureReason?: string | null;
  }>;
  message?: string;
  error?: string;
}

/**
 * Reconciles a specific donation or abandoned intent with the Razorpay payment gateway.
 * Never marks a donation paid from client assertions alone; contacts the gateway via Edge Function.
 */
export async function reconcileDonation(
  donationId: string,
  options: { userAction?: 'cancelled' } = {},
): Promise<ReconcileDonationResult> {
  if (!donationId) return { ok: false, error: 'Donation ID is required.' };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const authHeaders: Record<string, string> = {};
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }

    const { data, error } = await supabase.functions.invoke('reconcile-donation', {
      body: {
        donationId,
        userAction: options.userAction,
      },
      headers: Object.keys(authHeaders).length > 0 ? authHeaders : undefined,
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return {
      ok: Boolean(data?.ok),
      reconciled: data?.reconciled || [],
      message: data?.message,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Reconciles all pending donations for the currently authenticated user against Razorpay.
 */
export async function reconcileUserPendingDonations(): Promise<ReconcileDonationResult> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      return { ok: false, error: 'User must be signed in to reconcile donations.' };
    }

    const { data, error } = await supabase.functions.invoke('reconcile-donation', {
      body: { reconcileAllPending: true },
      headers: { Authorization: `Bearer ${token}` },
    });

    if (error) {
      return { ok: false, error: error.message };
    }

    return {
      ok: Boolean(data?.ok),
      reconciled: data?.reconciled || [],
      message: data?.message,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
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

/**
 * Computes exact financial statistics derived strictly from real donation records.
 *
 * ACCOUNTING RULES:
 * - Successful donations: status is 'paid'.
 * - Non-successful donations: 'created', 'pending', 'failed', 'cancelled' NEVER count.
 * - Net contribution: For 'paid', amountPaise.
 * - Full refunds: For 'refunded', entire amount is counted as refunded; does NOT add to successful totals.
 * - Current calendar month: Filtered by paidAt (or createdAt) falling within the current calendar month.
 * - Distinct campaigns: Count of unique campaign IDs among successful contributions (plus general fund if applicable).
 */
export function calculateDonationStats(
  records: Array<{
    status: PaymentStatus;
    amountPaise: number;
    requestId: string | null;
    createdAt: string;
    paidAt: string | null;
  }>,
): DonationSummaryStats {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  let totalDonatedPaise = 0;
  let successfulCount = 0;
  let currentMonthDonatedPaise = 0;
  let totalRefundedPaise = 0;
  const distinctCampaignIds = new Set<string>();

  for (const record of records) {
    if (record.status === 'paid') {
      successfulCount += 1;
      totalDonatedPaise += record.amountPaise;

      // Track distinct campaign
      if (record.requestId) {
        distinctCampaignIds.add(record.requestId);
      } else {
        distinctCampaignIds.add('general_fund');
      }

      // Check current calendar month
      const donationDate = record.paidAt ? new Date(record.paidAt) : new Date(record.createdAt);
      if (
        !isNaN(donationDate.getTime()) &&
        donationDate.getFullYear() === currentYear &&
        donationDate.getMonth() === currentMonth
      ) {
        currentMonthDonatedPaise += record.amountPaise;
      }
    } else if (record.status === 'refunded') {
      totalRefundedPaise += record.amountPaise;
    }
  }

  return {
    totalDonatedPaise,
    successfulCount,
    distinctCampaignsCount: distinctCampaignIds.size,
    currentMonthDonatedPaise,
    totalRefundedPaise,
    hasRefunds: totalRefundedPaise > 0,
  };
}

/**
 * Fetch authenticated user's own donations from the database with pagination, filters, and statistics.
 * Ownership is verified by Supabase session and strictly enforced by Postgres RLS (user_id = auth.uid()).
 */
export async function getMyDonations(
  params: GetMyDonationsParams = {},
): Promise<GetMyDonationsResponse> {
  const {
    status = 'all',
    searchQuery = '',
    startDate = null,
    endDate = null,
    page = 1,
    pageSize = 10,
  } = params;

  const emptyResponse: GetMyDonationsResponse = {
    donations: [],
    totalCount: 0,
    page,
    pageSize,
    totalPages: 0,
    stats: {
      totalDonatedPaise: 0,
      successfulCount: 0,
      distinctCampaignsCount: 0,
      currentMonthDonatedPaise: 0,
      totalRefundedPaise: 0,
      hasRefunds: false,
    },
    error: null,
  };

  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      return {
        ...emptyResponse,
        error: 'You must be signed in to view your donation history.',
      };
    }

    const currentUserId = sessionData.session.user.id;

    // 1. Fetch all user records (lightweight) to compute overall lifetime stats
    // Postgres RLS automatically enforces user_id = auth.uid()
    const { data: allUserRecords, error: statsError } = await supabase
      .from('donations')
      .select('status, amount_paise, request_id, created_at, paid_at')
      .eq('user_id', currentUserId);

    if (statsError) {
      console.error('[getMyDonations] Error loading donation stats:', statsError);
      return {
        ...emptyResponse,
        error: statsError.message || 'Unable to retrieve donation statistics.',
      };
    }

    const mappedStatsRecords = (allUserRecords || []).map((r) => ({
      status: r.status as PaymentStatus,
      amountPaise: Number(r.amount_paise),
      requestId: r.request_id ? String(r.request_id) : null,
      createdAt: String(r.created_at),
      paidAt: r.paid_at ? String(r.paid_at) : null,
    }));

    const stats = calculateDonationStats(mappedStatsRecords);

    // 2. Build filtered and paginated query
    let query = supabase
      .from('donations')
      .select('*, help_requests:request_id(id, title, image_path, status)', { count: 'exact' })
      .eq('user_id', currentUserId);

    // Status filter
    if (status === 'paid') {
      query = query.eq('status', 'paid');
    } else if (status === 'pending') {
      query = query.in('status', ['pending', 'created']);
    } else if (status === 'failed') {
      query = query.eq('status', 'failed');
    } else if (status === 'cancelled') {
      query = query.eq('status', 'cancelled');
    } else if (status === 'refunded') {
      query = query.eq('status', 'refunded');
    }

    // Date range filter
    if (startDate) {
      query = query.gte('created_at', startDate);
    }
    if (endDate) {
      query = query.lte('created_at', endDate);
    }

    query = query.order('created_at', { ascending: false });

    // Range for pagination
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, count, error: fetchError } = await query;

    if (fetchError) {
      console.error('[getMyDonations] Error fetching donation history:', fetchError);
      return {
        ...emptyResponse,
        stats,
        error: fetchError.message || 'Failed to retrieve donation history.',
      };
    }

    const totalCount = count ?? 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    const donations: UserDonationRecord[] = (data || []).map((row) => {
      const amountPaise = Number(row.amount_paise);

      const helpReq = row.help_requests as {
        id?: string;
        title?: string;
        image_path?: string;
        status?: string;
      } | null;

      return {
        id: String(row.id),
        requestId: row.request_id ? String(row.request_id) : null,
        userId: row.user_id ? String(row.user_id) : null,
        donorName: row.donor_name ? String(row.donor_name) : null,
        donorEmail: row.donor_email ? String(row.donor_email) : null,
        donorPhone: row.donor_phone ? String(row.donor_phone) : null,
        isAnonymous: Boolean(row.is_anonymous),
        amountPaise,
        currency: 'INR',
        paymentProvider: row.payment_provider || null,
        providerOrderId: row.provider_order_id ? String(row.provider_order_id) : null,
        providerPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
        providerSignature: row.provider_signature ? String(row.provider_signature) : null,
        idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
        status: row.status as PaymentStatus,
        paidAt: row.paid_at ? String(row.paid_at) : null,
        refundedAt: row.refunded_at ? String(row.refunded_at) : null,
        failureReason: row.failure_reason ? String(row.failure_reason) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        campaignTitle:
          helpReq?.title || (row.request_id ? 'Community Campaign' : 'General Community Fund'),
        campaignCoverImageUrl: getRequestCoverImageUrl(helpReq?.image_path),
        campaignStatus: helpReq?.status || null,
      };
    });

    // In-memory search filter across campaign title, donation ID, and payment IDs
    let filteredDonations = donations;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filteredDonations = donations.filter(
        (d) =>
          (d.campaignTitle && d.campaignTitle.toLowerCase().includes(q)) ||
          (d.providerPaymentId && d.providerPaymentId.toLowerCase().includes(q)) ||
          (d.providerOrderId && d.providerOrderId.toLowerCase().includes(q)) ||
          d.id.toLowerCase().includes(q),
      );
    }

    return {
      donations: filteredDonations,
      totalCount,
      page,
      pageSize,
      totalPages,
      stats,
      error: null,
    };
  } catch (err) {
    console.error('[getMyDonations] Unexpected failure:', err);
    return {
      ...emptyResponse,
      error: (err as Error).message || 'Unexpected failure loading donations.',
    };
  }
}

/**
 * Fetch a single donation by ID, strictly verifying ownership through RLS.
 */
export async function getMyDonationById(
  id: string,
): Promise<{ data: UserDonationRecord | null; error: string | null }> {
  if (!id) return { data: null, error: 'Donation ID is required.' };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.user) {
      return { data: null, error: 'You must be signed in to view this donation.' };
    }

    const { data, error } = await supabase
      .from('donations')
      .select('*, help_requests:request_id(id, title, image_path, status)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }

    if (!data) {
      return { data: null, error: 'Donation record not found.' };
    }

    const amountPaise = Number(data.amount_paise);

    const helpReq = data.help_requests as {
      id?: string;
      title?: string;
      image_path?: string;
      status?: string;
    } | null;

    const record: UserDonationRecord = {
      id: String(data.id),
      requestId: data.request_id ? String(data.request_id) : null,
      userId: data.user_id ? String(data.user_id) : null,
      donorName: data.donor_name ? String(data.donor_name) : null,
      donorEmail: data.donor_email ? String(data.donor_email) : null,
      donorPhone: data.donor_phone ? String(data.donor_phone) : null,
      isAnonymous: Boolean(data.is_anonymous),
      amountPaise,
      currency: 'INR',
      paymentProvider: data.payment_provider || null,
      providerOrderId: data.provider_order_id ? String(data.provider_order_id) : null,
      providerPaymentId: data.provider_payment_id ? String(data.provider_payment_id) : null,
      providerSignature: data.provider_signature ? String(data.provider_signature) : null,
      idempotencyKey: data.idempotency_key ? String(data.idempotency_key) : null,
      status: data.status as PaymentStatus,
      paidAt: data.paid_at ? String(data.paid_at) : null,
      refundedAt: data.refunded_at ? String(data.refunded_at) : null,
      failureReason: data.failure_reason ? String(data.failure_reason) : null,
      createdAt: String(data.created_at),
      updatedAt: String(data.updated_at),
      campaignTitle:
        helpReq?.title || (data.request_id ? 'Community Campaign' : 'General Community Fund'),
      campaignCoverImageUrl: getRequestCoverImageUrl(helpReq?.image_path),
      campaignStatus: helpReq?.status || null,
    };

    return { data: record, error: null };
  } catch (err) {
    return { data: null, error: (err as Error).message };
  }
}

/**
 * Derives a formal donation receipt only when the underlying payment data supports it.
 * Never fabricates a successful payment receipt for pending or failed payments.
 * Does not make false claims of 80G tax deductibility.
 */
export function getDonationReceiptData(
  donation: UserDonationRecord,
): DonationReceiptData | null {
  if (donation.status !== 'paid') {
    return null;
  }

  const shortId = donation.id.replace(/-/g, '').slice(0, 8).toUpperCase();
  const dateStr = (donation.paidAt || donation.createdAt).slice(0, 10).replace(/-/g, '');

  return {
    receiptNumber: `WWU-${dateStr}-${shortId}`,
    donationId: donation.id,
    transactionReference: donation.providerPaymentId || donation.providerOrderId || donation.id,
    paymentProvider: donation.paymentProvider ? donation.paymentProvider.toUpperCase() : 'RAZORPAY',
    amountPaise: donation.amountPaise,
    currency: 'INR',
    status: donation.status,
    donationDate: donation.paidAt || donation.createdAt,
    donorName: donation.isAnonymous
      ? 'Anonymous Supporter'
      : donation.donorName || 'Community Supporter',
    isAnonymous: donation.isAnonymous,
    campaignTitle: donation.campaignTitle || 'General Community Fund',
    campaignId: donation.requestId,
    isTaxDeductible: false,
  };
}

/**
 * Fetch staff-authorized donation records for monitoring and audit.
 */
export async function listStaffDonations(params: {
  status?: PaymentStatus;
  page?: number;
  pageSize?: number;
} = {}): Promise<{
  donations: UserDonationRecord[];
  totalCount: number;
  error: string | null;
}> {
  const { status, page = 1, pageSize = 20 } = params;

  try {
    let query = supabase
      .from('donations')
      .select('*, help_requests:request_id(id, title, image_path, status)', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }

    query = query.order('created_at', { ascending: false });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) {
      return { donations: [], totalCount: 0, error: error.message };
    }

    const donations: UserDonationRecord[] = (data || []).map((row) => {
      const amountPaise = Number(row.amount_paise);

      const helpReq = row.help_requests as {
        id?: string;
        title?: string;
        image_path?: string;
        status?: string;
      } | null;

      return {
        id: String(row.id),
        requestId: row.request_id ? String(row.request_id) : null,
        userId: row.user_id ? String(row.user_id) : null,
        donorName: row.donor_name ? String(row.donor_name) : null,
        donorEmail: row.donor_email ? String(row.donor_email) : null,
        donorPhone: row.donor_phone ? String(row.donor_phone) : null,
        isAnonymous: Boolean(row.is_anonymous),
        amountPaise,
        currency: 'INR',
        paymentProvider: row.payment_provider || null,
        providerOrderId: row.provider_order_id ? String(row.provider_order_id) : null,
        providerPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
        providerSignature: row.provider_signature ? String(row.provider_signature) : null,
        idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
        status: row.status as PaymentStatus,
        paidAt: row.paid_at ? String(row.paid_at) : null,
        refundedAt: row.refunded_at ? String(row.refunded_at) : null,
        failureReason: row.failure_reason ? String(row.failure_reason) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        campaignTitle:
          helpReq?.title || (row.request_id ? 'Community Campaign' : 'General Community Fund'),
        campaignCoverImageUrl: getRequestCoverImageUrl(helpReq?.image_path),
        campaignStatus: helpReq?.status || null,
      };
    });

    return { donations, totalCount: count ?? 0, error: null };
  } catch (err) {
    return { donations: [], totalCount: 0, error: (err as Error).message };
  }
}
