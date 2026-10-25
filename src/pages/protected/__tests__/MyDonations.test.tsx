import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MyDonations from '../MyDonations';
import * as donationsService from '../../../services/donations';
import type { GetMyDonationsResponse, UserDonationRecord } from '../../../types/donations';

vi.mock('../../../services/donations', async () => {
  const actual = await vi.importActual<typeof import('../../../services/donations')>(
    '../../../services/donations',
  );
  return {
    ...actual,
    getMyDonations: vi.fn(),
    getDonationReceiptData: actual.getDonationReceiptData,
    reconcileDonation: vi.fn(),
    reconcileUserPendingDonations: vi.fn().mockResolvedValue({ ok: true, reconciled: [] }),
  };
});

const mockSampleDonations: UserDonationRecord[] = [
  {
    id: 'don-uuid-1',
    requestId: 'req-1',
    userId: 'user-1',
    donorName: 'Aarav Patel',
    donorEmail: 'aarav@example.com',
    donorPhone: null,
    isAnonymous: false,
    amountPaise: 100_000, // ₹1,000
    currency: 'INR',
    paymentProvider: 'razorpay',
    providerOrderId: 'order_1',
    providerPaymentId: 'pay_aarav123',
    providerSignature: null,
    idempotencyKey: null,
    status: 'paid',
    paidAt: '2026-10-10T10:00:00.000Z',
    refundedAt: null,
    failureReason: null,
    createdAt: '2026-10-10T10:00:00.000Z',
    updatedAt: '2026-10-10T10:00:00.000Z',
    campaignTitle: 'Support for Flood Impacted Families',
    campaignCoverImageUrl: null,
    campaignStatus: 'published',
  },
  {
    id: 'don-uuid-2',
    requestId: null,
    userId: 'user-1',
    donorName: 'Aarav Patel',
    donorEmail: 'aarav@example.com',
    donorPhone: null,
    isAnonymous: true,
    amountPaise: 50_000, // ₹500
    currency: 'INR',
    paymentProvider: 'razorpay',
    providerOrderId: 'order_2',
    providerPaymentId: 'pay_anon456',
    providerSignature: null,
    idempotencyKey: null,
    status: 'paid',
    paidAt: '2026-10-08T10:00:00.000Z',
    refundedAt: null,
    failureReason: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
    campaignTitle: 'General Community Fund',
    campaignCoverImageUrl: null,
    campaignStatus: null,
  },
];

const mockSuccessResponse: GetMyDonationsResponse = {
  donations: mockSampleDonations,
  totalCount: 2,
  page: 1,
  pageSize: 10,
  totalPages: 1,
  stats: {
    totalDonatedPaise: 150_000,
    successfulCount: 2,
    distinctCampaignsCount: 2,
    currentMonthDonatedPaise: 150_000,
    totalRefundedPaise: 0,
    hasRefunds: false,
  },
  error: null,
};

describe('MyDonations Page Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary statistics and donation history successfully', async () => {
    vi.mocked(donationsService.getMyDonations).mockResolvedValueOnce(mockSuccessResponse);

    render(
      <MemoryRouter>
        <MyDonations />
      </MemoryRouter>,
    );

    // Initial page title
    expect(screen.getByRole('heading', { name: /My Donations/i })).toBeInTheDocument();

    // Await data load
    await waitFor(() => {
      // Statistics checks
      expect(screen.getAllByText('₹1,500')[0]).toBeInTheDocument();
      expect(screen.getByText('Support for Flood Impacted Families')).toBeInTheDocument();
      expect(screen.getByText('General Community Fund')).toBeInTheDocument();
    });

    // Anonymous tag indicator
    expect(screen.getByText(/Anonymous/i)).toBeInTheDocument();
  });

  it('allows filtering by status tabs and triggers refetch', async () => {
    vi.mocked(donationsService.getMyDonations).mockResolvedValue(mockSuccessResponse);

    render(
      <MemoryRouter>
        <MyDonations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Support for Flood Impacted Families')).toBeInTheDocument();
    });

    // Click on 'Pending' filter tab
    const pendingTab = screen.getByRole('tab', { name: 'Pending' });
    fireEvent.click(pendingTab);

    await waitFor(() => {
      expect(donationsService.getMyDonations).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
        }),
      );
    });
  });

  it('opens details modal when clicking Details button', async () => {
    vi.mocked(donationsService.getMyDonations).mockResolvedValueOnce(mockSuccessResponse);

    render(
      <MemoryRouter>
        <MyDonations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Support for Flood Impacted Families')).toBeInTheDocument();
    });

    const detailsButtons = screen.getAllByRole('button', { name: /Details/i });
    fireEvent.click(detailsButtons[0]);

    // Modal appears
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Donation Details/i })).toBeInTheDocument();
      expect(screen.getByText(/Transaction ID: don-uuid-1/i)).toBeInTheDocument();
    });
  });

  it('opens receipt modal when clicking Receipt button', async () => {
    vi.mocked(donationsService.getMyDonations).mockResolvedValueOnce(mockSuccessResponse);

    render(
      <MemoryRouter>
        <MyDonations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Support for Flood Impacted Families')).toBeInTheDocument();
    });

    const receiptButtons = screen.getAllByRole('button', { name: /Receipt/i });
    fireEvent.click(receiptButtons[0]);

    // Receipt modal appears
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /Donation Receipt/i })).toBeInTheDocument();
      expect(screen.getByText(/Official Platform Payment Confirmation/i)).toBeInTheDocument();
      expect(screen.getByText(/Payment Confirmed/i)).toBeInTheDocument();
    });
  });

  it('displays empty state when user has no donations', async () => {
    vi.mocked(donationsService.getMyDonations).mockResolvedValueOnce({
      donations: [],
      totalCount: 0,
      page: 1,
      pageSize: 10,
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
    });

    render(
      <MemoryRouter>
        <MyDonations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No donations found/i)).toBeInTheDocument();
      expect(screen.getByText(/Browse Community Causes/i)).toBeInTheDocument();
    });
  });

  it('displays error state and allows retry', async () => {
    vi.mocked(donationsService.getMyDonations)
      .mockResolvedValueOnce({
        donations: [],
        totalCount: 0,
        page: 1,
        pageSize: 10,
        totalPages: 0,
        stats: {
          totalDonatedPaise: 0,
          successfulCount: 0,
          distinctCampaignsCount: 0,
          currentMonthDonatedPaise: 0,
          totalRefundedPaise: 0,
          hasRefunds: false,
        },
        error: 'Failed to connect to database',
      })
      .mockResolvedValueOnce(mockSuccessResponse);

    render(
      <MemoryRouter>
        <MyDonations />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Could not load donations/i)).toBeInTheDocument();
      expect(screen.getByText(/Failed to connect to database/i)).toBeInTheDocument();
    });

    const tryAgainBtn = screen.getByRole('button', { name: /Try Again/i });
    fireEvent.click(tryAgainBtn);

    await waitFor(() => {
      expect(screen.getByText('Support for Flood Impacted Families')).toBeInTheDocument();
    });
  });

  it('renders pending donation with Check Status button and auto-reconciles pending donations', async () => {
    const pendingDonation: UserDonationRecord = {
      id: 'don-pending-123',
      requestId: 'req-1',
      userId: 'user-1',
      donorName: 'Aarav Patel',
      donorEmail: 'aarav@example.com',
      donorPhone: null,
      isAnonymous: false,
      amountPaise: 100_000,
      currency: 'INR',
      paymentProvider: 'razorpay',
      providerOrderId: 'order_pending_1',
      providerPaymentId: null,
      providerSignature: null,
      idempotencyKey: null,
      status: 'pending',
      paidAt: null,
      refundedAt: null,
      failureReason: null,
      createdAt: '2026-10-10T10:00:00.000Z',
      updatedAt: '2026-10-10T10:00:00.000Z',
      campaignTitle: 'Support for Flood Impacted Families',
      campaignCoverImageUrl: null,
      campaignStatus: 'published',
    };

    vi.mocked(donationsService.getMyDonations).mockResolvedValue({
      donations: [pendingDonation],
      totalCount: 1,
      page: 1,
      pageSize: 10,
      totalPages: 1,
      stats: {
        totalDonatedPaise: 0,
        successfulCount: 0,
        distinctCampaignsCount: 0,
        currentMonthDonatedPaise: 0,
        totalRefundedPaise: 0,
        hasRefunds: false,
      },
      error: null,
    });

    vi.mocked(donationsService.reconcileDonation).mockResolvedValueOnce({
      ok: true,
      reconciled: [
        {
          donationId: 'don-pending-123',
          previousStatus: 'pending',
          currentStatus: 'failed',
          action: 'marked_failed',
          failureReason: 'Checkout cancelled by customer.',
        },
      ],
    });

    render(
      <MemoryRouter>
        <MyDonations />
      </MemoryRouter>,
    );

    // Should render pending badge and Check Status button in table
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Check Status/i })).toBeInTheDocument();
      expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(2);
    });

    // Auto-reconcile should have been called
    expect(donationsService.reconcileUserPendingDonations).toHaveBeenCalled();

    // Click Check Status button
    const checkStatusBtn = screen.getByRole('button', { name: /Check Status/i });
    fireEvent.click(checkStatusBtn);

    await waitFor(() => {
      expect(donationsService.reconcileDonation).toHaveBeenCalledWith('don-pending-123');
    });
  });
});
