import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Help from '../Help';
import * as helpRequestsService from '../../../services/helpRequests';

vi.mock('../../../services/helpRequests', async () => {
  const actual = await vi.importActual<typeof import('../../../services/helpRequests')>(
    '../../../services/helpRequests',
  );
  return {
    ...actual,
    getPublicHelpRequestsPage: vi.fn(),
    getCategories: vi.fn(),
  };
});

const mockCategories: helpRequestsService.Category[] = [
  { id: 'cat-med', name: 'Medical', slug: 'medical', icon: null, description: null },
  { id: 'cat-edu', name: 'Education', slug: 'education', icon: null, description: null },
  { id: 'cat-food', name: 'Food & Groceries', slug: 'food', icon: null, description: null },
];

const mockRequests: helpRequestsService.PublicHelpRequest[] = [
  {
    id: 'req-1',
    title: 'Cardiac Surgery Support for Child',
    description: 'Urgent surgery required at Mumbai Children Hospital.',
    status: 'published',
    urgency: 'critical',
    categoryId: 'cat-med',
    targetAmount: 250000,
    raisedAmount: 50000,
    locationCity: 'Mumbai',
    locationState: 'Maharashtra',
    imagePath: null,
    imageUrl: null,
    createdAt: '2026-10-10T09:00:00Z',
    publishedAt: '2026-10-10T10:00:00Z',
    isDemo: true,
  },
  {
    id: 'req-2',
    title: 'College Tuition Fee Support',
    description: 'Engineering tuition fee support for final semester.',
    status: 'published',
    urgency: 'high',
    categoryId: 'cat-edu',
    targetAmount: 60000,
    raisedAmount: 0,
    locationCity: 'Hyderabad',
    locationState: 'Telangana',
    imagePath: null,
    imageUrl: null,
    createdAt: '2026-10-11T09:00:00Z',
    publishedAt: '2026-10-11T10:00:00Z',
    isDemo: false,
  },
];

describe('Help Page Component (TEST I: Search & Category Filters)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpRequestsService.getCategories).mockResolvedValue({
      data: mockCategories,
      error: null,
    });
    vi.mocked(helpRequestsService.getPublicHelpRequestsPage).mockResolvedValue({
      rows: mockRequests,
      hasMore: false,
      error: null,
    });
  });

  it('renders the public help requests directory and category filters', async () => {
    render(
      <MemoryRouter initialEntries={['/help']}>
        <Help />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /help someone in your community/i }),
      ).toBeInTheDocument();
      expect(screen.getByText('Cardiac Surgery Support for Child')).toBeInTheDocument();
      expect(screen.getByText('College Tuition Fee Support')).toBeInTheDocument();
      expect(screen.getAllByText('Medical').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Education').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Sample')).toBeInTheDocument(); // Demo badge for req-1
    });
  });

  it('filters requests when user types in the search box', async () => {
    render(
      <MemoryRouter initialEntries={['/help']}>
        <Help />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Cardiac Surgery Support for Child')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by keywords/i);
    fireEvent.change(searchInput, { target: { value: 'Tuition' } });

    await waitFor(() => {
      expect(screen.queryByText('Cardiac Surgery Support for Child')).not.toBeInTheDocument();
      expect(screen.getByText('College Tuition Fee Support')).toBeInTheDocument();
    });
  });

  it('filters requests by category selection', async () => {
    render(
      <MemoryRouter initialEntries={['/help']}>
        <Help />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Cardiac Surgery Support for Child')).toBeInTheDocument();
      expect(screen.getByText('College Tuition Fee Support')).toBeInTheDocument();
    });

    // Click 'Medical' category filter
    const medBtn = screen.getByRole('button', { name: /^medical$/i });
    fireEvent.click(medBtn);

    await waitFor(() => {
      expect(screen.getByText('Cardiac Surgery Support for Child')).toBeInTheDocument();
      expect(screen.queryByText('College Tuition Fee Support')).not.toBeInTheDocument();
    });
  });

  it('shows an empty state with clear filters option when no items match', async () => {
    render(
      <MemoryRouter initialEntries={['/help']}>
        <Help />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Cardiac Surgery Support for Child')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search by keywords/i);
    fireEvent.change(searchInput, { target: { value: 'nonexistentquery12345' } });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no requests match these filters/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /clear all filters/i })).toBeInTheDocument();
    });

    // Reset filters
    fireEvent.click(screen.getByRole('button', { name: /clear all filters/i }));
    await waitFor(() => {
      expect(screen.getByText('Cardiac Surgery Support for Child')).toBeInTheDocument();
      expect(screen.getByText('College Tuition Fee Support')).toBeInTheDocument();
    });
  });
});
