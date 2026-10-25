import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RequestHelp from '../RequestHelp';
import * as authHook from '../../../hooks/useAuth';
import * as helpRequestsService from '../../../services/helpRequests';

vi.mock('../../../services/helpRequests', async () => {
  const actual = await vi.importActual<typeof import('../../../services/helpRequests')>(
    '../../../services/helpRequests',
  );
  return {
    ...actual,
    getCategories: vi.fn(),
    createHelpRequestDraft: vi.fn(),
    updateHelpRequestDraft: vi.fn(),
    getOwnedHelpRequestStatus: vi.fn(),
    getOwnedHelpRequestById: vi.fn(),
    listHelpRequestDocuments: vi.fn(),
    submitHelpRequest: vi.fn(),
  };
});

describe('RequestHelp Page Component', () => {
  const mockCategories = [
    {
      id: 'cat-medical',
      name: 'Medical',
      slug: 'medical',
      icon: 'heart-pulse',
      description: 'Medical support',
    },
    {
      id: 'cat-food',
      name: 'Food',
      slug: 'food',
      icon: 'utensils',
      description: 'Nutrition assistance',
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
    vi.mocked(helpRequestsService.getOwnedHelpRequestStatus).mockResolvedValue({
      data: { status: 'draft', id: 'draft-uuid-1' } as any,
      error: null,
    });
  });

  it('renders Step 1 (Category selection) and allows choosing a category', async () => {
    render(
      <MemoryRouter>
        <RequestHelp />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: /request assistance/i })).toBeInTheDocument();
    expect(screen.getAllByText(/step 1 of 5/i)[0]).toBeInTheDocument();

    const medicalRadio = await screen.findByRole('radio', { name: /medical/i });
    expect(medicalRadio).toBeInTheDocument();

    fireEvent.click(medicalRadio);
    expect(medicalRadio).toBeChecked();
  });

  it('progresses through wizard steps and submits request successfully', async () => {
    vi.mocked(helpRequestsService.createHelpRequestDraft).mockResolvedValue({
      data: { id: 'draft-uuid-1', status: 'draft' },
      error: null,
    });
    vi.mocked(helpRequestsService.submitHelpRequest).mockResolvedValue({
      data: { id: 'draft-uuid-1', status: 'submitted' },
      error: null,
    });

    render(
      <MemoryRouter>
        <RequestHelp />
      </MemoryRouter>,
    );

    // Step 1: Category & good faith acknowledgment
    const medicalRadio = await screen.findByRole('radio', { name: /medical/i });
    fireEvent.click(medicalRadio);

    const ackCheckbox = screen.getByLabelText(/i confirm that i am asking for help in good faith/i);
    fireEvent.click(ackCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: Story
    expect((await screen.findAllByText(/step 2 of 5/i))[0]).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/campaign title/i), {
      target: { value: 'Urgent Chemotherapy Treatment Needed' },
    });
    fireEvent.change(screen.getByLabelText(/what are you going through/i), {
      target: {
        value: 'My mother has been diagnosed with stage 3 cancer and needs critical treatment support at government hospital.',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 3: Logistics
    expect((await screen.findAllByText(/step 3 of 5/i))[0]).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/city/i), { target: { value: 'Vijayawada' } });
    fireEvent.change(screen.getByLabelText(/state/i), { target: { value: 'Andhra Pradesh' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 4: Funding Goal
    expect((await screen.findAllByText(/step 4 of 5/i))[0]).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/target fundraising goal/i), { target: { value: '65000' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 5: Documents & Final Submission
    expect((await screen.findAllByText(/step 5 of 5/i))[0]).toBeInTheDocument();
    const submitBtn = screen.getByRole('button', { name: /submit request for verification/i });
    expect(submitBtn).toBeInTheDocument();

    fireEvent.click(submitBtn);

    // Confirmation Screen
    await waitFor(() => {
      expect(helpRequestsService.submitHelpRequest).toHaveBeenCalledWith('draft-uuid-1');
      expect(screen.getByText(/your request has been safely received/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /track your request/i })).toBeInTheDocument();
    });
  });
});
