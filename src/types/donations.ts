/**
 * Production Donation & Payment Foundation Types.
 *
 * Designed to be payment-provider agnostic (supporting Razorpay, Stripe,
 * Cashfree, PayU, etc.) while enforcing strict integrity:
 * - Integer minor units (`amountPaise`) for financial math.
 * - Formal payment lifecycle states.
 * - Minimum personal information collection.
 * - Sanitized display types for public viewing.
 */

export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'paid'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export type PaymentProvider = 'razorpay' | 'stripe' | 'cashfree' | 'payu' | null;

export interface DonationRecord {
  id: string;
  requestId: string | null;
  userId: string | null;
  donorName: string | null;
  donorEmail: string | null;
  donorPhone: string | null;
  isAnonymous: boolean;
  /** Integer minor units: 100 paise = ₹1.00 */
  amountPaise: number;
  currency: 'INR';
  paymentProvider: PaymentProvider;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerSignature: string | null;
  idempotencyKey: string | null;
  status: PaymentStatus;
  paidAt: string | null;
  refundedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Public, sanitized donation record.
 * Never exposes donor email, phone, or gateway transaction secrets.
 */
export interface PublicDonationItem {
  id: string;
  requestId: string | null;
  amountPaise: number;
  currency: 'INR';
  createdAt: string;
  isAnonymous: boolean;
  donorDisplayName: string;
}

export interface DonationAmountPreset {
  /** Whole rupees for label rendering */
  rupees: number;
  /** Minor units (paise) for financial math */
  paise: number;
  label: string;
  description: string;
}

export interface DonorDetailsInput {
  fullName?: string;
  email?: string;
  phone?: string;
  isAnonymous?: boolean;
}

export interface CreateDonationIntentInput {
  requestId: string | null;
  requestTitle?: string | null;
  amountPaise: number;
  donorDetails: DonorDetailsInput;
}

export interface RazorpayOrderData {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  keyId: string;
  donationId: string;
}

export interface RazorpayPaymentResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface VerifyPaymentInput {
  donationId: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export type VerifyPaymentResult =
  | {
      ok: true;
      status: 'paid';
      donationId: string;
      message?: string;
    }
  | {
      ok: false;
      error: string;
      message: string;
    };

export type DonationIntentResult =
  | {
      ok: true;
      data: {
        donationId: string;
        amountPaise: number;
        currency: 'INR';
        provider: PaymentProvider;
        /** Reference issued for tracing */
        reference: string;
        orderId?: string;
        keyId?: string;
      };
    }
  | {
      ok: false;
      reason:
        | 'provider_not_configured'
        | 'invalid_amount'
        | 'invalid_donor_details'
        | 'request_not_found'
        | 'provider_error'
        | 'network_error';
      message: string;
    };

/**
 * Enhanced donation record with associated campaign summary information.
 */
export interface UserDonationRecord extends DonationRecord {
  campaignTitle: string | null;
  campaignCoverImageUrl: string | null;
  campaignStatus: string | null;
}

/**
 * Real database-derived statistics for the authenticated user.
 */
export interface DonationSummaryStats {
  /** Sum of net successfully donated amount in paise (100 paise = ₹1) */
  totalDonatedPaise: number;
  /** Total count of successful (paid / partially refunded) donations */
  successfulCount: number;
  /** Count of distinct campaigns supported */
  distinctCampaignsCount: number;
  /** Total donated in the current calendar month in paise */
  currentMonthDonatedPaise: number;
  /** Total refunded amount in paise */
  totalRefundedPaise: number;
  /** Whether any refunds exist for the donor */
  hasRefunds: boolean;
}

export type MyDonationsFilterStatus =
  | 'all'
  | 'paid'
  | 'pending'
  | 'failed'
  | 'cancelled'
  | 'refunded';

export interface GetMyDonationsParams {
  status?: MyDonationsFilterStatus;
  searchQuery?: string;
  startDate?: string | null;
  endDate?: string | null;
  page?: number;
  pageSize?: number;
}

export interface GetMyDonationsResponse {
  donations: UserDonationRecord[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: DonationSummaryStats;
  error: string | null;
}

export interface DonationReceiptData {
  receiptNumber: string;
  donationId: string;
  transactionReference: string;
  paymentProvider: string;
  amountPaise: number;
  currency: 'INR';
  status: PaymentStatus;
  donationDate: string;
  donorName: string;
  isAnonymous: boolean;
  campaignTitle: string;
  campaignId: string | null;
  isTaxDeductible: false;
}
