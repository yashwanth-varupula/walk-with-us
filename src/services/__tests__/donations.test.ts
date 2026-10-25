import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateDonationStats,
  getDonationReceiptData,
  getMyDonations,
  getMyDonationById,
  listStaffDonations,
  createDonationIntent,
  verifyRazorpayPayment,
  reconcileDonation,
  reconcileUserPendingDonations,
} from '../donations';
import { supabase } from '../../lib/supabase';
import type { PaymentStatus, UserDonationRecord } from '../../types/donations';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
    storage: {
      from: vi.fn().mockReturnValue({
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://test/image.jpg' } }),
      }),
    },
  },
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-key',
}));

describe('Donations Service & Accounting Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateDonationStats accounting rules', () => {
    it('returns zeroes when records are empty', () => {
      const stats = calculateDonationStats([]);
      expect(stats.totalDonatedPaise).toBe(0);
      expect(stats.successfulCount).toBe(0);
      expect(stats.distinctCampaignsCount).toBe(0);
      expect(stats.currentMonthDonatedPaise).toBe(0);
      expect(stats.totalRefundedPaise).toBe(0);
      expect(stats.hasRefunds).toBe(false);
    });

    it('counts only paid donations as successful', () => {
      const now = new Date().toISOString();
      const records = [
        {
          status: 'paid' as PaymentStatus,
          amountPaise: 100_000, // ₹1,000
          requestId: 'req-1',
          createdAt: now,
          paidAt: now,
        },
        {
          status: 'pending' as PaymentStatus,
          amountPaise: 50_000, // ₹500 - pending should not count
          requestId: 'req-2',
          createdAt: now,
          paidAt: null,
        },
        {
          status: 'failed' as PaymentStatus,
          amountPaise: 200_000, // ₹2,000 - failed should not count
          requestId: 'req-3',
          createdAt: now,
          paidAt: null,
        },
        {
          status: 'cancelled' as PaymentStatus,
          amountPaise: 50_000, // ₹500 - cancelled should not count
          requestId: 'req-1',
          createdAt: now,
          paidAt: null,
        },
      ];

      const stats = calculateDonationStats(records);
      expect(stats.totalDonatedPaise).toBe(100_000);
      expect(stats.successfulCount).toBe(1);
      expect(stats.distinctCampaignsCount).toBe(1);
      expect(stats.totalRefundedPaise).toBe(0);
      expect(stats.hasRefunds).toBe(false);
    });

    it('accounts for full refunds accurately according to verified database schema', () => {
      const now = new Date().toISOString();
      const records = [
        {
          status: 'paid' as PaymentStatus,
          amountPaise: 100_000, // ₹1,000 paid
          requestId: 'req-1',
          createdAt: now,
          paidAt: now,
        },
        {
          status: 'refunded' as PaymentStatus,
          amountPaise: 50_000, // ₹500 fully refunded
          requestId: 'req-3',
          createdAt: now,
          paidAt: now,
        },
      ];

      const stats = calculateDonationStats(records);
      // Net donated: 100_000 (refunded donations are excluded from net donations)
      expect(stats.totalDonatedPaise).toBe(100_000);
      expect(stats.successfulCount).toBe(1);
      expect(stats.totalRefundedPaise).toBe(50_000);
      expect(stats.hasRefunds).toBe(true);
      expect(stats.distinctCampaignsCount).toBe(1);
    });

    it('counts distinct campaigns supported including general fund donations', () => {
      const now = new Date().toISOString();
      const records = [
        {
          status: 'paid' as PaymentStatus,
          amountPaise: 50_000,
          requestId: 'req-A',
          createdAt: now,
          paidAt: now,
        },
        {
          status: 'paid' as PaymentStatus,
          amountPaise: 50_000,
          requestId: 'req-A', // duplicate campaign
          createdAt: now,
          paidAt: now,
        },
        {
          status: 'paid' as PaymentStatus,
          amountPaise: 50_000,
          requestId: null, // general fund
          createdAt: now,
          paidAt: now,
        },
      ];

      const stats = calculateDonationStats(records);
      expect(stats.distinctCampaignsCount).toBe(2); // req-A + general_fund
      expect(stats.successfulCount).toBe(3);
      expect(stats.totalDonatedPaise).toBe(150_000);
    });

    it('separates donations from previous calendar months for current month metric', () => {
      const currentMonthDate = new Date().toISOString();
      // Date from 3 months ago
      const pastDate = new Date();
      pastDate.setMonth(pastDate.getMonth() - 3);
      const pastMonthDate = pastDate.toISOString();

      const records = [
        {
          status: 'paid' as PaymentStatus,
          amountPaise: 50_000,
          requestId: 'req-1',
          createdAt: currentMonthDate,
          paidAt: currentMonthDate,
        },
        {
          status: 'paid' as PaymentStatus,
          amountPaise: 100_000,
          requestId: 'req-2',
          createdAt: pastMonthDate,
          paidAt: pastMonthDate,
        },
      ];

      const stats = calculateDonationStats(records);
      expect(stats.totalDonatedPaise).toBe(150_000);
      expect(stats.currentMonthDonatedPaise).toBe(50_000); // only current month
    });
  });

  describe('getDonationReceiptData', () => {
    it('generates receipt for paid donations with non-80G disclaimer', () => {
      const sampleDonation: UserDonationRecord = {
        id: '12345678-abcd-ef01-2345-6789abcdef01',
        requestId: 'req-1',
        userId: 'user-1',
        donorName: 'Rahul Verma',
        donorEmail: 'rahul@example.com',
        donorPhone: null,
        isAnonymous: false,
        amountPaise: 100_000,
        currency: 'INR',
        paymentProvider: 'razorpay',
        providerOrderId: 'order_123',
        providerPaymentId: 'pay_abc123',
        providerSignature: null,
        idempotencyKey: null,
        status: 'paid',
        paidAt: '2026-10-09T10:00:00.000Z',
        refundedAt: null,
        failureReason: null,
        createdAt: '2026-10-09T09:55:00.000Z',
        updatedAt: '2026-10-09T10:00:00.000Z',
        campaignTitle: 'Emergency Medical Care for Aarav',
        campaignCoverImageUrl: null,
        campaignStatus: 'published',
      };

      const receipt = getDonationReceiptData(sampleDonation);
      expect(receipt).not.toBeNull();
      expect(receipt?.receiptNumber).toContain('WWU-20261009-12345678');
      expect(receipt?.amountPaise).toBe(100_000);
      expect(receipt?.currency).toBe('INR');
      expect(receipt?.donorName).toBe('Rahul Verma');
      expect(receipt?.isAnonymous).toBe(false);
      expect(receipt?.isTaxDeductible).toBe(false);
      expect(receipt?.campaignTitle).toBe('Emergency Medical Care for Aarav');
      expect(receipt?.transactionReference).toBe('pay_abc123');
    });

    it('generates receipt with Anonymous Supporter when donation is anonymous', () => {
      const anonDonation: UserDonationRecord = {
        id: '87654321-abcd-ef01-2345-6789abcdef01',
        requestId: null,
        userId: 'user-1',
        donorName: 'Secret Donor',
        donorEmail: 'secret@example.com',
        donorPhone: null,
        isAnonymous: true,
        amountPaise: 50_000,
        currency: 'INR',
        paymentProvider: 'razorpay',
        providerOrderId: 'order_456',
        providerPaymentId: 'pay_xyz789',
        providerSignature: null,
        idempotencyKey: null,
        status: 'paid',
        paidAt: '2026-10-10T12:00:00.000Z',
        refundedAt: null,
        failureReason: null,
        createdAt: '2026-10-10T12:00:00.000Z',
        updatedAt: '2026-10-10T12:00:00.000Z',
        campaignTitle: 'General Community Fund',
        campaignCoverImageUrl: null,
        campaignStatus: null,
      };

      const receipt = getDonationReceiptData(anonDonation);
      expect(receipt).not.toBeNull();
      expect(receipt?.donorName).toBe('Anonymous Supporter');
      expect(receipt?.isAnonymous).toBe(true);
    });

    it('rejects receipt generation for pending, failed, or cancelled donations', () => {
      const base: UserDonationRecord = {
        id: 'test-id',
        requestId: null,
        userId: 'user-1',
        donorName: 'Test',
        donorEmail: null,
        donorPhone: null,
        isAnonymous: false,
        amountPaise: 50_000,
        currency: 'INR',
        paymentProvider: 'razorpay',
        providerOrderId: null,
        providerPaymentId: null,
        providerSignature: null,
        idempotencyKey: null,
        status: 'pending',
        paidAt: null,
        refundedAt: null,
        failureReason: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        campaignTitle: null,
        campaignCoverImageUrl: null,
        campaignStatus: null,
      };

      expect(getDonationReceiptData({ ...base, status: 'pending' })).toBeNull();
      expect(getDonationReceiptData({ ...base, status: 'failed' })).toBeNull();
      expect(getDonationReceiptData({ ...base, status: 'cancelled' })).toBeNull();
      expect(getDonationReceiptData({ ...base, status: 'refunded' })).toBeNull();
    });
  });

  describe('getMyDonations query service', () => {
    it('returns error when user is not signed in', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const result = await getMyDonations();
      expect(result.error).toContain('You must be signed in');
      expect(result.donations).toHaveLength(0);
    });

    it('queries and maps user donations with joined campaign details', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            user: { id: 'test-user-id' },
          } as any,
        },
        error: null,
      });

      const mockStatsRecords = [
        {
          status: 'paid',
          amount_paise: 100_000,
          request_id: 'req-1',
          created_at: '2026-10-10T00:00:00.000Z',
          paid_at: '2026-10-10T00:00:00.000Z',
        },
      ];

      const mockQueryRows = [
        {
          id: 'don-1',
          request_id: 'req-1',
          user_id: 'test-user-id',
          donor_name: 'Priya Sharma',
          donor_email: 'priya@example.com',
          donor_phone: null,
          is_anonymous: false,
          amount_paise: 100_000,
          currency: 'INR',
          payment_provider: 'razorpay',
          provider_order_id: 'order_1',
          provider_payment_id: 'pay_1',
          status: 'paid',
          paid_at: '2026-10-10T00:00:00.000Z',
          created_at: '2026-10-10T00:00:00.000Z',
          updated_at: '2026-10-10T00:00:00.000Z',
          help_requests: {
            id: 'req-1',
            title: 'School Supplies for Flood Relief',
            image_path: 'req-1/cover.jpg',
            status: 'published',
          },
        },
      ];

      const queryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: mockQueryRows,
          count: 1,
          error: null,
        }),
      };

      const statsSelectMock = vi.fn().mockReturnThis();

      // Mock first call for stats select, second call for paginated select
      vi.mocked(supabase.from)
        .mockReturnValueOnce({
          select: statsSelectMock,
          eq: vi.fn().mockResolvedValue({ data: mockStatsRecords, error: null }),
        } as any)
        .mockReturnValueOnce(queryBuilder as any);

      const result = await getMyDonations({ status: 'all', page: 1, pageSize: 10 });
      expect(result.error).toBeNull();
      // Regression test: stats query MUST use only verified database columns and never request amount_refunded_paise
      expect(statsSelectMock).toHaveBeenCalledWith(
        'status, amount_paise, request_id, created_at, paid_at',
      );
      expect(result.donations).toHaveLength(1);
      expect(result.donations[0].campaignTitle).toBe('School Supplies for Flood Relief');
      expect(result.donations[0].amountPaise).toBe(100_000);
      expect(result.stats.totalDonatedPaise).toBe(100_000);
      expect(result.stats.successfulCount).toBe(1);
    });
  });

  describe('getMyDonationById query service', () => {
    it('returns error when not signed in', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const result = await getMyDonationById('any-id');
      expect(result.error).toContain('You must be signed in');
      expect(result.data).toBeNull();
    });

    it('returns donation record when found', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            user: { id: 'test-user-id' },
          } as any,
        },
        error: null,
      });

      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'don-1',
            request_id: 'req-1',
            user_id: 'test-user-id',
            amount_paise: 50_000,
            currency: 'INR',
            status: 'paid',
            created_at: '2026-10-10T00:00:00.000Z',
            paid_at: '2026-10-10T00:00:00.000Z',
            help_requests: {
              title: 'Community Food Drive',
            },
          },
          error: null,
        }),
      } as any);

      const result = await getMyDonationById('don-1');
      expect(result.error).toBeNull();
      expect(result.data?.id).toBe('don-1');
      expect(result.data?.campaignTitle).toBe('Community Food Drive');
      expect(result.data?.amountPaise).toBe(50_000);
    });
  });

  describe('listStaffDonations query service', () => {
    it('successfully queries donations for staff', async () => {
      const mockRows = [
        {
          id: 'staff-don-1',
          request_id: 'req-1',
          user_id: 'user-1',
          donor_name: 'Staff Test Donor',
          amount_paise: 200_000,
          currency: 'INR',
          status: 'paid',
          created_at: '2026-10-10T00:00:00.000Z',
          paid_at: '2026-10-10T00:00:00.000Z',
          help_requests: {
            title: 'Staff Monitored Campaign',
          },
        },
      ];

      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: mockRows,
          count: 1,
          error: null,
        }),
      } as any);

      const result = await listStaffDonations({ status: 'paid', page: 1, pageSize: 20 });
      expect(result.error).toBeNull();
      expect(result.donations).toHaveLength(1);
      expect(result.donations[0].campaignTitle).toBe('Staff Monitored Campaign');
      expect(result.totalCount).toBe(1);
    });

    it('handles query errors gracefully', async () => {
      vi.mocked(supabase.from).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: null,
          count: null,
          error: { message: 'Database query failed' },
        }),
      } as any);

      const result = await listStaffDonations();
      expect(result.error).toBe('Database query failed');
      expect(result.donations).toHaveLength(0);
    });
  });

  describe('Edge Functions authentication header forwarding', () => {
    it('createDonationIntent explicitly forwards user session token to create-razorpay-order', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'valid-user-jwt-token',
            user: { id: 'donor-123' },
          } as any,
        },
        error: null,
      });

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
        data: {
          ok: true,
          donationId: 'don-123',
          orderId: 'order_123',
          amountPaise: 100_000,
          keyId: 'rzp_test_key',
        },
        error: null,
      });

      const result = await createDonationIntent({
        requestId: 'req-1',
        amountPaise: 100_000,
        donorDetails: { fullName: 'Aarav Patel', isAnonymous: false },
      });

      expect(result.ok).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'create-razorpay-order',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer valid-user-jwt-token',
          },
        }),
      );
    });

    it('verifyRazorpayPayment explicitly forwards user session token to verify-razorpay-payment', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'valid-user-jwt-token',
            user: { id: 'donor-123' },
          } as any,
        },
        error: null,
      });

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
        data: {
          ok: true,
          status: 'paid',
          donationId: 'don-123',
          message: 'Payment verified successfully.',
        },
        error: null,
      });

      const result = await verifyRazorpayPayment({
        donationId: 'don-123',
        razorpay_order_id: 'order_123',
        razorpay_payment_id: 'pay_123',
        razorpay_signature: 'sig_123',
      });

      expect(result.ok).toBe(true);
      expect(supabase.functions.invoke).toHaveBeenCalledWith(
        'verify-razorpay-payment',
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer valid-user-jwt-token',
          },
        }),
      );
    });

    it('reconcileDonation invokes reconcile-donation Edge Function with auth and params', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'valid-user-jwt-token',
            user: { id: 'donor-123' },
          } as any,
        },
        error: null,
      });

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
        data: {
          ok: true,
          reconciled: [
            {
              donationId: 'don-123',
              previousStatus: 'pending',
              currentStatus: 'cancelled',
              action: 'marked_cancelled',
              failureReason: 'Customer cancelled payment checkout.',
            },
          ],
        },
        error: null,
      });

      const result = await reconcileDonation('don-123', { userAction: 'cancelled' });

      expect(result.ok).toBe(true);
      expect(result.reconciled).toHaveLength(1);
      expect(result.reconciled?.[0].currentStatus).toBe('cancelled');
      expect(supabase.functions.invoke).toHaveBeenCalledWith('reconcile-donation', {
        body: {
          donationId: 'don-123',
          userAction: 'cancelled',
        },
        headers: {
          Authorization: 'Bearer valid-user-jwt-token',
        },
      });
    });

    it('reconcileUserPendingDonations checks all pending donations for current user', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'valid-user-jwt-token',
            user: { id: 'donor-123' },
          } as any,
        },
        error: null,
      });

      vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({
        data: {
          ok: true,
          reconciled: [
            {
              donationId: 'don-stuck-1',
              previousStatus: 'pending',
              currentStatus: 'failed',
              action: 'marked_failed',
              failureReason: 'Payment failed at bank.',
            },
          ],
        },
        error: null,
      });

      const result = await reconcileUserPendingDonations();

      expect(result.ok).toBe(true);
      expect(result.reconciled).toHaveLength(1);
      expect(result.reconciled?.[0].currentStatus).toBe('failed');
      expect(supabase.functions.invoke).toHaveBeenCalledWith('reconcile-donation', {
        body: {
          reconcileAllPending: true,
        },
        headers: {
          Authorization: 'Bearer valid-user-jwt-token',
        },
      });
    });

    it('reconcileUserPendingDonations handles unauthenticated session gracefully', async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValueOnce({
        data: { session: null },
        error: null,
      });

      const result = await reconcileUserPendingDonations();
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/signed in/i);
    });
  });
});
