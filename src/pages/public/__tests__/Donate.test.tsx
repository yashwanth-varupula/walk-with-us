import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Donate from '../Donate';
import * as donationsService from '../../../services/donations';
import * as helpRequestsService from '../../../services/helpRequests';

vi.mock('../../../services/donations', async () => {
  const actual = await vi.importActual<typeof import('../../../services/donations')>(
    '../../../services/donations',
  );
  return {
    ...actual,
    createDonationIntent: vi.fn(),
    verifyRazorpayPayment: vi.fn(),
    reconcileDonation: vi.fn(),
  };
});

vi.mock('../../../services/helpRequests', async () => {
  const actual = await vi.importActual<typeof import('../../../services/helpRequests')>(
    '../../../services/helpRequests',
  );
  return {
    ...actual,
    getPublicHelpRequestsPage: vi.fn(),
    getPublicHelpRequestById: vi.fn(),
  };
});

vi.mock('../../../lib/razorpay', () => ({
  loadRazorpayCheckoutScript: vi.fn().mockResolvedValue(true),
}));

describe('Donate Page Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpRequestsService.getPublicHelpRequestsPage).mockResolvedValue({
      rows: [],
      hasMore: false,
      error: null,
    });
  });

  it('renders presets and donor form fields', () => {
    render(
      <MemoryRouter>
        <Donate />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /support a verified need/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^₹500/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^₹1,000/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^₹2,000/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^₹5,000/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^donate/i })).toBeInTheDocument();
  });

  it('initializes checkout order via createDonationIntent on proceed', async () => {
    vi.mocked(donationsService.createDonationIntent).mockResolvedValue({
      ok: true,
      data: {
        donationId: 'don-test-1',
        amountPaise: 100_000,
        currency: 'INR',
        provider: 'razorpay',
        reference: 'order_test_1',
        orderId: 'order_test_1',
        keyId: 'rzp_test_mock',
      },
    });

    // Mock window.Razorpay constructor
    const mockOpen = vi.fn();
    const mockOn = vi.fn();
    function MockRazorpay() {
      return {
        open: mockOpen,
        on: mockOn,
      };
    }
    window.Razorpay = MockRazorpay as any;

    render(
      <MemoryRouter>
        <Donate />
      </MemoryRouter>,
    );

    // Select ₹1,000 preset
    fireEvent.click(screen.getByRole('button', { name: /^₹1,000/i }));

    // Fill donor name
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Priya Sharma' },
    });
    fireEvent.change(screen.getByLabelText(/email address/i), {
      target: { value: 'priya@example.com' },
    });

    // Click proceed
    fireEvent.click(screen.getByRole('button', { name: /donate ₹1,000/i }));

    await waitFor(() => {
      expect(donationsService.createDonationIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000,
          currency: 'INR',
          donorDetails: expect.objectContaining({
            fullName: 'Priya Sharma',
            email: 'priya@example.com',
          }),
        }),
      );
      expect(mockOpen).toHaveBeenCalled();
    });
  });
});
