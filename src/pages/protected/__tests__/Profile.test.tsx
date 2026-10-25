import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Profile from '../Profile';
import { supabase } from '../../../lib/supabase';
import * as authHook from '../../../hooks/useAuth';

describe('Profile Page Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders user details, role badge, and contact fields', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: {} as any,
      user: { id: 'usr-123', email: 'beneficiary@walkwithus.org' } as any,
      loading: false,
      role: 'requester',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: {
            full_name: 'Anita Sharma',
            phone: '+91 98765 43210',
            role: 'requester',
            is_active: true,
            created_at: '2026-01-15T10:00:00Z',
          },
          error: null,
        }),
      }),
    });
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: mockSelect,
    } as any);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /my profile & account/i })).toBeInTheDocument();
    expect(screen.getAllByText('beneficiary@walkwithus.org').length).toBeGreaterThan(0);
    expect(screen.getByText(/REQUESTER/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByDisplayValue('Anita Sharma')).toBeInTheDocument();
      expect(screen.getByDisplayValue('+91 98765 43210')).toBeInTheDocument();
    });
  });

  it('updates profile information successfully', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: {} as any,
      user: { id: 'usr-123', email: 'beneficiary@walkwithus.org' } as any,
      loading: false,
      role: 'requester',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { full_name: 'Anita', phone: '', role: 'requester' },
            error: null,
          }),
        }),
      }),
      update: mockUpdate,
    } as any);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    const nameInput = await screen.findByLabelText(/full name/i);
    fireEvent.change(nameInput, { target: { value: 'Anita Sharma Updated' } });

    const saveButton = screen.getByRole('button', { name: /save profile/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(/profile details updated successfully/i)).toBeInTheDocument();
    });
  });

  it('validates password matching before updating credentials', async () => {
    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      session: {} as any,
      user: { id: 'usr-123', email: 'beneficiary@walkwithus.org' } as any,
      loading: false,
      role: 'requester',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(supabase, 'from').mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: {}, error: null }),
        }),
      }),
    } as any);

    render(
      <MemoryRouter>
        <Profile />
      </MemoryRouter>,
    );

    const newPass = screen.getByLabelText(/^new password/i);
    const confirmPass = screen.getByLabelText(/confirm new password/i);

    fireEvent.change(newPass, { target: { value: 'ValidPass123!' } });
    fireEvent.change(confirmPass, { target: { value: 'DifferentPass123!' } });

    const updateButton = screen.getByRole('button', { name: /update password/i });
    fireEvent.click(updateButton);

    expect(await screen.findByText(/passwords do not match/i)).toBeInTheDocument();
  });
});
