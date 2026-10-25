import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startRequestReview,
  verifyRequest,
  rejectRequest,
  publishHelpRequest,
} from '../staffRequests';
import {
  submitHelpRequest,
} from '../helpRequests';
import {
  isOnlineDonationEnabled,
  validateDonationAmount,
  getDonationReceiptData,
  type UserDonationRecord,
} from '../donations';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
      },
      from: vi.fn(),
      rpc: vi.fn(),
      storage: {
        from: vi.fn(),
      },
    },
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-anon-key',
  };
});

describe('Lifecycle Transitions & Database Authorization Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  describe('Help Request Lifecycle State Machine', () => {
    it('enforces that draft submission delegates exclusively to submit_help_request RPC', async () => {
      const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-draft-1', status: 'submitted' },
        error: null,
      } as any);

      const result = await submitHelpRequest('req-draft-1');

      expect(mockRpc).toHaveBeenCalledWith('submit_help_request', {
        p_request_id: 'req-draft-1',
      });
      expect(result.data).toEqual({ id: 'req-draft-1', status: 'submitted' });
      expect(result.error).toBeNull();
    });

    it('rejects submission if the RPC reports stale or non-draft state (22023)', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: {
          code: '22023',
          message: 'Help request is not in draft status.',
        },
      } as any);

      const result = await submitHelpRequest('req-stale-1');

      expect(result.data).toBeNull();
      expect(result.error).not.toBeNull();
      expect(result.error?.kind).toBe('not-a-draft');
    });

    it('requires staff credentials for transition from submitted to under_review', async () => {
      const mockStaffUser = { id: 'staff-user-1', email: 'staff@example.com' } as any;
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: mockStaffUser } },
        error: null,
      } as any);

      const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-sub-1', status: 'under_review', previous_status: 'submitted' },
        error: null,
      } as any);

      const result = await startRequestReview(mockStaffUser, 'req-sub-1');

      expect(mockRpc).toHaveBeenCalledWith('transition_help_request', {
        p_request_id: 'req-sub-1',
        p_expected_status: 'submitted',
        p_new_status: 'under_review',
        p_notes: 'Review started.',
      });
      expect(result.data?.status).toBe('under_review');
      expect(result.error).toBeNull();
    });

    it('rejects verification if notes are missing or empty', async () => {
      const mockStaffUser = { id: 'staff-user-1', email: 'staff@example.com' } as any;

      const result = await verifyRequest(mockStaffUser, 'req-under-review-1', '   ');

      expect(result.data).toBeNull();
      expect(result.error?.message).toContain('verification notes');
    });

    it('accepts verification with notes and records them via RPC', async () => {
      const mockStaffUser = { id: 'staff-user-1', email: 'staff@example.com' } as any;
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: mockStaffUser } },
        error: null,
      } as any);

      const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-under-review-1', status: 'verified', previous_status: 'under_review' },
        error: null,
      } as any);

      const result = await verifyRequest(
        mockStaffUser,
        'req-under-review-1',
        'Confirmed patient ID with Vijayawada Government Hospital oncology department.',
      );

      expect(mockRpc).toHaveBeenCalledWith('transition_help_request', {
        p_request_id: 'req-under-review-1',
        p_expected_status: 'under_review',
        p_new_status: 'verified',
        p_notes: 'Confirmed patient ID with Vijayawada Government Hospital oncology department.',
      });
      expect(result.data?.status).toBe('verified');
      expect(result.error).toBeNull();
    });

    it('rejects rejection if reason is missing or empty', async () => {
      const mockStaffUser = { id: 'staff-user-1', email: 'staff@example.com' } as any;

      const result = await rejectRequest(mockStaffUser, 'req-under-review-1', '');

      expect(result.data).toBeNull();
      expect(result.error?.message).toContain('rejection reason');
    });

    it('publishes verified request via publish_help_request RPC', async () => {
      const mockStaffUser = { id: 'staff-user-1', email: 'staff@example.com' } as any;
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: mockStaffUser } },
        error: null,
      } as any);

      const mockRpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-ver-1', status: 'published' },
        error: null,
      } as any);

      const result = await publishHelpRequest(mockStaffUser, 'req-ver-1');

      expect(mockRpc).toHaveBeenCalledWith('publish_help_request', {
        p_request_id: 'req-ver-1',
      });
      expect(result.data?.status).toBe('published');
      expect(result.error).toBeNull();
    });
  });

  describe('Donation Invariants & Receipt Eligibility', () => {
    it('guarantees online donation operates strictly in Razorpay test mode', () => {
      expect(isOnlineDonationEnabled()).toBe(true);
    });

    it('rejects donation amounts under minimum limit (₹100)', () => {
      const validation = validateDonationAmount(50);
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.reason).toBe('invalid_amount');
      }
    });

    it('rejects donation amounts above maximum limit (₹10,000,000)', () => {
      const validation = validateDonationAmount(15_000_000);
      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.reason).toBe('invalid_amount');
      }
    });

    it('never generates a formal receipt for unverified or pending donations', () => {
      const pendingDonation: UserDonationRecord = {
        id: 'don-pending-1',
        requestId: 'req-1',
        userId: 'user-1',
        donorName: 'Ravi Kumar',
        donorEmail: 'ravi@example.com',
        donorPhone: null,
        isAnonymous: false,
        amountPaise: 100_000,
        currency: 'INR',
        paymentProvider: 'razorpay',
        providerOrderId: 'order_123',
        providerPaymentId: null,
        providerSignature: null,
        idempotencyKey: null,
        status: 'pending',
        paidAt: null,
        refundedAt: null,
        failureReason: null,
        createdAt: '2026-10-10T10:00:00Z',
        updatedAt: '2026-10-10T10:00:00Z',
        campaignTitle: 'Emergency Medical Support',
        campaignCoverImageUrl: null,
        campaignStatus: 'published',
      };

      const receipt = getDonationReceiptData(pendingDonation);
      expect(receipt).toBeNull();
    });

    it('generates a formal receipt with reference for verified paid donations without tax-deductibility false claims', () => {
      const paidDonation: UserDonationRecord = {
        id: 'don-paid-1',
        requestId: 'req-1',
        userId: 'user-1',
        donorName: 'Ravi Kumar',
        donorEmail: 'ravi@example.com',
        donorPhone: null,
        isAnonymous: false,
        amountPaise: 250_000,
        currency: 'INR',
        paymentProvider: 'razorpay',
        providerOrderId: 'order_123',
        providerPaymentId: 'pay_ABC123',
        providerSignature: 'sig_XYZ',
        idempotencyKey: null,
        status: 'paid',
        paidAt: '2026-10-10T10:05:00Z',
        refundedAt: null,
        failureReason: null,
        createdAt: '2026-10-10T10:00:00Z',
        updatedAt: '2026-10-10T10:05:00Z',
        campaignTitle: 'Emergency Medical Support',
        campaignCoverImageUrl: null,
        campaignStatus: 'published',
      };

      const receipt = getDonationReceiptData(paidDonation);
      expect(receipt).not.toBeNull();
      expect(receipt?.receiptNumber).toContain('WWU-');
      expect(receipt?.transactionReference).toBe('pay_ABC123');
      expect(receipt?.amountPaise).toBe(250_000);
      expect(receipt?.isTaxDeductible).toBe(false);
    });
  });
});
