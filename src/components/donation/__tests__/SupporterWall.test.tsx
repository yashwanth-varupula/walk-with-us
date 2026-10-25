import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SupporterWall } from '../SupporterWall';
import * as donationService from '../../../services/donations';
import type { PublicDonationItem } from '../../../types/donations';

vi.mock('../../../services/donations', () => ({
  getPublicDonationsForRequest: vi.fn(),
}));

const mockGetPublicDonations = vi.mocked(donationService.getPublicDonationsForRequest);

describe('SupporterWall component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading skeleton while fetching contributions', async () => {
    // Return an unresolved promise to observe loading state
    mockGetPublicDonations.mockReturnValue(new Promise(() => {}));

    render(<SupporterWall requestId="req-test-1" />);

    expect(screen.getByLabelText(/loading recent supporters/i)).toBeInTheDocument();
    expect(screen.getByText(/recent supporters/i)).toBeInTheDocument();
  });

  it('renders encouraging empty state when no public supporters exist', async () => {
    mockGetPublicDonations.mockResolvedValue({
      data: [],
      error: null,
    });

    render(<SupporterWall requestId="req-test-1" />);

    await waitFor(() => {
      expect(screen.getByText(/be the first supporter/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/no public contributions recorded yet/i),
    ).toBeInTheDocument();
  });

  it('renders named supporters with initials and formatted donation amount', async () => {
    const mockDonations: PublicDonationItem[] = [
      {
        id: 'don-1',
        requestId: 'req-test-1',
        amountPaise: 100_000, // ₹1,000
        currency: 'INR',
        createdAt: new Date().toISOString(),
        isAnonymous: false,
        donorDisplayName: 'Rohan Mehta',
      },
    ];

    mockGetPublicDonations.mockResolvedValue({
      data: mockDonations,
      error: null,
    });

    render(<SupporterWall requestId="req-test-1" />);

    await waitFor(() => {
      expect(screen.getByText('Rohan Mehta')).toBeInTheDocument();
    });

    // Check initials avatar
    expect(screen.getByText('RM')).toBeInTheDocument();
    // Check formatted amount
    expect(screen.getByText('₹1,000')).toBeInTheDocument();
    // Check count badge
    expect(screen.getByText('1 supporter')).toBeInTheDocument();
  });

  it('enforces anonymous supporter privacy when isAnonymous is true', async () => {
    const mockDonations: PublicDonationItem[] = [
      {
        id: 'don-2',
        requestId: 'req-test-1',
        amountPaise: 50_000, // ₹500
        currency: 'INR',
        createdAt: new Date().toISOString(),
        isAnonymous: true,
        donorDisplayName: 'Private Donor Name', // Even if an internal name existed
      },
    ];

    mockGetPublicDonations.mockResolvedValue({
      data: mockDonations,
      error: null,
    });

    render(<SupporterWall requestId="req-test-1" />);

    await waitFor(() => {
      expect(screen.getByText('Anonymous Supporter')).toBeInTheDocument();
    });

    // Confidential name must NEVER appear in the DOM
    expect(screen.queryByText('Private Donor Name')).toBeNull();
    // Formatted amount is rendered
    expect(screen.getByText('₹500')).toBeInTheDocument();
    // Heart avatar indicator is rendered for anonymous
    expect(screen.getByLabelText('Anonymous supporter')).toBeInTheDocument();
  });

  it('renders recoverable error state on query failure and allows retry', async () => {
    // Initial fetch fails
    mockGetPublicDonations.mockResolvedValueOnce({
      data: [],
      error: 'Network connection failed',
    });

    render(<SupporterWall requestId="req-test-1" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText(/unable to load recent supporters/i)).toBeInTheDocument();

    // Prepare successful response on retry
    mockGetPublicDonations.mockResolvedValueOnce({
      data: [
        {
          id: 'don-3',
          requestId: 'req-test-1',
          amountPaise: 200_000,
          currency: 'INR',
          createdAt: new Date().toISOString(),
          isAnonymous: false,
          donorDisplayName: 'Asha Verma',
        },
      ],
      error: null,
    });

    // Click retry
    const retryBtn = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Asha Verma')).toBeInTheDocument();
    });

    expect(screen.getByText('₹2,000')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('re-fetches correctly when campaign requestId prop changes', async () => {
    mockGetPublicDonations.mockResolvedValue({
      data: [],
      error: null,
    });

    const { rerender } = render(<SupporterWall requestId="req-campaign-1" />);

    expect(mockGetPublicDonations).toHaveBeenCalledWith('req-campaign-1');

    // Rerender with different campaign ID
    rerender(<SupporterWall requestId="req-campaign-2" />);

    expect(mockGetPublicDonations).toHaveBeenCalledWith('req-campaign-2');
  });
});
