import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import StaffRequestReview from '../StaffRequestReview';
import * as staffRequestsService from '../../../services/staffRequests';
import * as authHook from '../../../hooks/useAuth';

vi.mock('../../../services/staffRequests', async () => {
  const actual = await vi.importActual<typeof import('../../../services/staffRequests')>(
    '../../../services/staffRequests',
  );
  return {
    ...actual,
    getStaffRequestById: vi.fn(),
    listStaffRequestDocuments: vi.fn(),
    listRequestAuditTrail: vi.fn(),
    startRequestReview: vi.fn(),
    verifyRequest: vi.fn(),
    rejectRequest: vi.fn(),
    publishHelpRequest: vi.fn(),
    setStaffDocumentStatus: vi.fn(),
  };
});

describe('StaffRequestReview Page Component', () => {
  const mockStaffUser = {
    id: 'staff-user-1',
    email: 'staff@walkwithus.org',
  };

  const sampleSubmittedRequest = {
    id: 'req-review-1',
    requesterId: 'user-req-1',
    title: 'Urgent Chemotherapy Support',
    description: 'Requires assistance with recurring medications.',
    categoryId: 'cat-medical',
    urgency: 'high' as const,
    status: 'submitted' as const,
    targetAmount: 60000,
    raisedAmount: 0,
    locationCity: 'Guntur',
    locationState: 'Andhra Pradesh',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-01T10:00:00Z',
    submittedAt: '2026-10-02T10:00:00Z',
    publishedAt: null,
    verifiedAt: null,
    reviewedBy: null,
    verificationNotes: null,
    rejectionReason: null,
    imagePath: null,
    imageUrl: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: { access_token: 'fake' } as any,
      user: mockStaffUser as any,
      loading: false,
      role: 'staff',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.mocked(staffRequestsService.getStaffRequestById).mockResolvedValue({
      data: sampleSubmittedRequest,
      error: null,
    });
    vi.mocked(staffRequestsService.listStaffRequestDocuments).mockResolvedValue({
      data: [],
      error: null,
    });
    vi.mocked(staffRequestsService.listRequestAuditTrail).mockResolvedValue({
      data: [],
      error: null,
      unavailable: false,
    });
  });

  it('renders submitted request and allows staff to pick up and start review', async () => {
    vi.mocked(staffRequestsService.startRequestReview).mockResolvedValue({
      data: { id: 'req-review-1', status: 'under_review' },
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/staff/requests/req-review-1']}>
        <Routes>
          <Route path="/staff/requests/:id" element={<StaffRequestReview />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/urgent chemotherapy support/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^submitted$/i)[0]).toBeInTheDocument();

    const startBtn = screen.getByRole('button', { name: /start review/i });
    expect(startBtn).toBeInTheDocument();

    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(staffRequestsService.startRequestReview).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'staff-user-1' }),
        'req-review-1',
      );
    });
  });

  it('allows staff to verify an under_review request with required notes', async () => {
    vi.mocked(staffRequestsService.getStaffRequestById).mockResolvedValue({
      data: {
        ...sampleSubmittedRequest,
        status: 'under_review',
      },
      error: null,
    });

    vi.mocked(staffRequestsService.verifyRequest).mockResolvedValue({
      data: { id: 'req-review-1', status: 'verified' },
      error: null,
    });

    render(
      <MemoryRouter initialEntries={['/staff/requests/req-review-1']}>
        <Routes>
          <Route path="/staff/requests/:id" element={<StaffRequestReview />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/urgent chemotherapy support/i)).toBeInTheDocument();

    // Click "Verify" button to open modal
    const markVerifiedBtn = screen.getByRole('button', { name: /^verify$/i });
    fireEvent.click(markVerifiedBtn);

    // Enter verification notes
    const textarea = screen.getByPlaceholderText(/record what you checked/i);
    fireEvent.change(textarea, {
      target: { value: 'Verified with hospital Dr. Sharma and verified patient ID.' },
    });

    // Confirm decision
    const confirmBtn = screen.getByRole('button', { name: /confirm verification/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(staffRequestsService.verifyRequest).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'staff-user-1' }),
        'req-review-1',
        'Verified with hospital Dr. Sharma and verified patient ID.',
      );
    });
  });
});
