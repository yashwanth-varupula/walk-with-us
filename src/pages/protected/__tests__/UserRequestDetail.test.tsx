import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import UserRequestDetail from '../UserRequestDetail';
import * as helpRequestsService from '../../../services/helpRequests';
import * as authHook from '../../../hooks/useAuth';

vi.mock('../../../services/helpRequests', async () => {
  const actual = await vi.importActual<typeof import('../../../services/helpRequests')>(
    '../../../services/helpRequests',
  );
  return {
    ...actual,
    getOwnedHelpRequestById: vi.fn(),
    getCategories: vi.fn(),
    listHelpRequestDocuments: vi.fn(),
    createRequesterDocumentUrl: vi.fn(),
  };
});

describe('UserRequestDetail Page Component', () => {
  const mockCategories = [
    {
      id: 'cat-medical',
      name: 'Medical',
      slug: 'medical',
      icon: 'heart-pulse',
      description: 'Medical support',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: { access_token: 'fake' } as any,
      user: { id: 'req-user-1', email: 'requester@example.com' } as any,
      loading: false,
      role: 'requester',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(helpRequestsService.getCategories).mockResolvedValue({
      data: mockCategories,
      error: null,
    });
    vi.mocked(helpRequestsService.listHelpRequestDocuments).mockResolvedValue({
      data: [],
      error: null,
    });
  });

  it('renders request details, lifecycle tracker, and action buttons for draft request', async () => {
    vi.mocked(helpRequestsService.getOwnedHelpRequestById).mockResolvedValue({
      data: {
        id: 'test-req-123',
        title: 'Need Financial Support for Medicine',
        description: 'Detailed medical condition story here.',
        status: 'draft',
        urgency: 'high',
        categoryId: 'cat-medical',
        targetAmount: 30000,
        raisedAmount: 0,
        locationCity: 'Guntur',
        locationState: 'Andhra Pradesh',
        submittedAt: null,
        verifiedAt: null,
        publishedAt: null,
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-01T10:00:00Z',
        rejectionReason: null,
        resolvedAt: null,
        documentCount: 0,
      },
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/my-requests/test-req-123']}>
        <Routes>
          <Route path="/my-requests/:id" element={<UserRequestDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/need financial support for medicine/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /private draft/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue editing draft/i })).toBeInTheDocument();
  });

  it('renders published request with link to public page', async () => {
    vi.mocked(helpRequestsService.getOwnedHelpRequestById).mockResolvedValue({
      data: {
        id: 'test-req-456',
        title: 'Emergency Dialysis Fund',
        description: 'Undergoing regular weekly dialysis.',
        status: 'published',
        urgency: 'critical',
        categoryId: 'cat-medical',
        targetAmount: 50000,
        raisedAmount: 20000,
        locationCity: 'Vijayawada',
        locationState: 'Andhra Pradesh',
        submittedAt: '2026-10-02T10:00:00Z',
        verifiedAt: '2026-10-03T10:00:00Z',
        publishedAt: '2026-10-04T10:00:00Z',
        createdAt: '2026-10-01T10:00:00Z',
        updatedAt: '2026-10-04T10:00:00Z',
        rejectionReason: null,
        resolvedAt: null,
        documentCount: 0,
      },
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/my-requests/test-req-456']}>
        <Routes>
          <Route path="/my-requests/:id" element={<UserRequestDetail />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/emergency dialysis fund/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /published & live/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view live on public site/i })).toBeInTheDocument();
  });
});
