import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import StaffEnquiryInbox from '../StaffEnquiryInbox';
import * as staffEnquiriesService from '../../../services/staffEnquiries';

vi.mock('../../../services/staffEnquiries', async () => {
  const actual = await vi.importActual<typeof import('../../../services/staffEnquiries')>(
    '../../../services/staffEnquiries',
  );
  return {
    ...actual,
    listStaffVolunteerApplications: vi.fn(),
    listStaffPartnerEnquiries: vi.fn(),
    updateStaffEnquiryStatus: vi.fn(),
    listEnquiryAuditTrail: vi.fn(),
  };
});

const mockListVolunteers = vi.mocked(staffEnquiriesService.listStaffVolunteerApplications);
const mockListPartners = vi.mocked(staffEnquiriesService.listStaffPartnerEnquiries);
const mockUpdateStatus = vi.mocked(staffEnquiriesService.updateStaffEnquiryStatus);
const mockListAudit = vi.mocked(staffEnquiriesService.listEnquiryAuditTrail);

describe('StaffEnquiryInbox component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAudit.mockResolvedValue({ data: [], error: null });
  });

  it('renders tabs and empty state when no applications exist', async () => {
    mockListVolunteers.mockResolvedValue({
      data: [],
      error: null,
      count: 0,
    });

    render(<StaffEnquiryInbox />);

    expect(screen.getByText(/enquiry inbox/i)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /volunteer applications/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /partner enquiries/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/no volunteer applications have been submitted yet/i)).toBeInTheDocument();
    });
  });

  it('renders error state with retry button when query fails', async () => {
    mockListVolunteers.mockResolvedValue({
      data: null,
      error: {
        source: 'volunteer-list',
        code: '42501',
        message: 'Permission denied. Staff access policies must be applied.',
        isPermissionError: true,
      },
      count: 0,
    });

    render(<StaffEnquiryInbox />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/unable to load enquiries/i)).toBeInTheDocument();
      expect(screen.getByText(/20261105_staff_enquiries_access.sql/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    // Now mock recovery
    mockListVolunteers.mockResolvedValue({
      data: [],
      error: null,
      count: 0,
    });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('renders volunteer application items and opens detail modal on click', async () => {
    const mockVolunteers: staffEnquiriesService.VolunteerApplicationRow[] = [
      {
        id: 'vol-test-1',
        userId: 'u-1',
        fullName: 'Deepak Sharma',
        email: 'deepak@example.org',
        phone: '9876543210',
        city: 'Bengaluru',
        availability: 'Weekends',
        skills: 'Driving, Transport',
        message: 'I have a car and can transport patients to hospital appointments.',
        status: 'new',
        createdAt: '2026-03-05T09:00:00Z',
      },
    ];

    mockListVolunteers.mockResolvedValue({
      data: mockVolunteers,
      error: null,
      count: 1,
    });

    render(<StaffEnquiryInbox />);

    await waitFor(() => {
      expect(screen.getByText('Deepak Sharma')).toBeInTheDocument();
      expect(screen.getByText('deepak@example.org')).toBeInTheDocument();
      expect(screen.getByText('Driving, Transport')).toBeInTheDocument();
    });

    // Click row View button
    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    fireEvent.click(viewButtons[0]);

    // Modal dialog should open
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deepak Sharma' })).toBeInTheDocument();
    expect(
      within(dialog).getByText('I have a car and can transport patients to hospital appointments.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Take Review Action')).toBeInTheDocument();
  });

  it('switches to Partner tab and loads partner enquiries', async () => {
    mockListVolunteers.mockResolvedValue({ data: [], error: null, count: 0 });
    mockListPartners.mockResolvedValue({
      data: [
        {
          id: 'prt-test-1',
          userId: null,
          organisation: 'Rotary Club South',
          contactName: 'Sunita Rao',
          email: 'sunita@rotarysouth.org',
          phone: null,
          partnershipType: 'Community group',
          message: 'We can sponsor wheelchairs and educational materials.',
          status: 'new',
          createdAt: '2026-03-04T10:00:00Z',
        },
      ],
      error: null,
      count: 1,
    });

    render(<StaffEnquiryInbox />);

    const partnerTab = screen.getByRole('tab', { name: /partner enquiries/i });
    fireEvent.click(partnerTab);

    await waitFor(() => {
      expect(screen.getByText('Rotary Club South')).toBeInTheDocument();
      expect(screen.getByText('Sunita Rao')).toBeInTheDocument();
      expect(screen.getByText('Community group')).toBeInTheDocument();
    });
  });

  it('prompts confirmation modal before consequential status update and updates state on confirm', async () => {
    const mockVolunteers: staffEnquiriesService.VolunteerApplicationRow[] = [
      {
        id: 'vol-test-2',
        userId: 'u-2',
        fullName: 'Meera Patel',
        email: 'meera@example.org',
        phone: null,
        city: 'Mumbai',
        availability: 'Weekday mornings',
        skills: 'Translation',
        message: 'Can help translate medical and official documents.',
        status: 'new',
        createdAt: '2026-03-05T09:00:00Z',
      },
    ];

    mockListVolunteers.mockResolvedValue({
      data: mockVolunteers,
      error: null,
      count: 1,
    });
    mockUpdateStatus.mockResolvedValue({ ok: true, error: null });

    render(<StaffEnquiryInbox />);

    await waitFor(() => {
      expect(screen.getByText('Meera Patel')).toBeInTheDocument();
    });

    // Open detail modal
    const viewButtons = screen.getAllByRole('button', { name: /view/i });
    fireEvent.click(viewButtons[0]);

    // Click "Approve / Accept" action button
    const acceptBtn = screen.getByRole('button', { name: /approve \/ accept/i });
    fireEvent.click(acceptBtn);

    // Confirmation dialog should be open
    expect(screen.getByText(/confirm status change/i)).toBeInTheDocument();
    expect(screen.getByText(/are you sure you want to change the status of/i)).toBeInTheDocument();

    // Type optional review note
    const notesInput = screen.getByPlaceholderText(/reason for acceptance/i);
    fireEvent.change(notesInput, { target: { value: 'Verified credentials and spoken languages.' } });

    // Confirm
    const confirmBtn = screen.getByRole('button', { name: /confirm status/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockUpdateStatus).toHaveBeenCalledWith({
        enquiryType: 'volunteer',
        enquiryId: 'vol-test-2',
        newStatus: 'accepted',
        notes: 'Verified credentials and spoken languages.',
      });
      expect(screen.getByText(/updated status of "meera patel"/i)).toBeInTheDocument();
    });
  });
});
