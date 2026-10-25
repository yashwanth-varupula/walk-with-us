import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from '../Home';
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
];

const mockRequests: helpRequestsService.PublicHelpRequest[] = [
  {
    id: 'req-home-1',
    title: 'Emergency Medical Support for Family',
    description: 'Post-accident medical and rehabilitation support.',
    status: 'published',
    urgency: 'critical',
    categoryId: 'cat-med',
    targetAmount: 180000,
    raisedAmount: 45000,
    locationCity: 'Bengaluru',
    locationState: 'Karnataka',
    imagePath: null,
    imageUrl: null,
    createdAt: '2026-10-12T09:00:00Z',
    publishedAt: '2026-10-12T10:00:00Z',
    isDemo: true,
  },
];

describe('Home Page Component (TEST A: Public Browse)', () => {
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

  it('renders hero section, impact statistics, and public request previews', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Home />
      </MemoryRouter>,
    );

    // Hero title and CTA buttons
    expect(
      screen.getByRole('heading', { name: /no one should face a problem alone/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /i need help/i })).toHaveAttribute(
      'href',
      '/request-help',
    );
    expect(screen.getByRole('link', { name: /i want to help/i })).toHaveAttribute(
      'href',
      '/help',
    );

    // Impact stats
    expect(screen.getByText('People Helped')).toBeInTheDocument();
    expect(screen.getByText('Requests Resolved')).toBeInTheDocument();

    // Live requests section
    await waitFor(() => {
      expect(screen.getByText('Emergency Medical Support for Family')).toBeInTheDocument();
      expect(screen.getByText('Bengaluru, Karnataka')).toBeInTheDocument();
      expect(screen.getByText('Sample')).toBeInTheDocument();
    });
  });

  it('handles load error gracefully with an error state', async () => {
    vi.mocked(helpRequestsService.getPublicHelpRequestsPage).mockResolvedValue({
      rows: [],
      hasMore: false,
      error: {
        code: 'PGRST116',
        message: 'Could not connect to the database.',
      },
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/could not connect to the database/i)).toBeInTheDocument();
    });
  });
});
