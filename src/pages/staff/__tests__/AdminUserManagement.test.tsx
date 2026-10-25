import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminUserManagement from '../AdminUserManagement';
import { supabase } from '../../../lib/supabase';
import * as authHook from '../../../hooks/useAuth';

describe('AdminUserManagement Component', () => {
  const mockAdminUser = {
    id: '0f35d667-c8ce-47f7-90a9-9fd12e6a25b6',
    email: 'varupulayashwanth@gmail.com',
  };

  const mockProfiles = [
    {
      id: '0f35d667-c8ce-47f7-90a9-9fd12e6a25b6',
      full_name: 'Walk With Us Admin',
      role: 'admin',
      is_active: true,
      created_at: '2026-09-27T04:56:21.000Z',
      updated_at: '2026-09-27T04:56:21.000Z',
    },
    {
      id: '370c0774-cdcc-4c48-b968-042ba3f32843',
      full_name: 'ram',
      role: 'requester',
      is_active: true,
      created_at: '2026-10-25T06:05:01.000Z',
      updated_at: '2026-10-25T06:05:01.000Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    vi.spyOn(authHook, 'useAuth').mockReturnValue({
      user: mockAdminUser as any,
      session: { user: mockAdminUser } as any,
      loading: false,
      role: 'admin',
      roleLoading: false,
      roleError: null,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    });

    vi.spyOn(supabase, 'from').mockImplementation((table: string) => {
      const resolvedData =
        table === 'profiles'
          ? mockProfiles
          : table === 'admin_actions'
          ? [
              {
                id: 'act-1',
                admin_id: '0f35d667-c8ce-47f7-90a9-9fd12e6a25b6',
                action: 'set_user_role',
                notes: 'Initial role bootstrap',
                created_at: '2026-10-24T17:36:25.000Z',
              },
            ]
          : [];

      const builder: any = {
        select: vi.fn(() => builder),
        order: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        single: vi.fn(() => Promise.resolve({ data: resolvedData[0] || null, error: null })),
        then: (resolve: any, reject?: any) =>
          Promise.resolve({ data: resolvedData, error: null }).then(resolve, reject),
      };

      return builder;
    });
  });

  it('renders target user promotion spotlight card and does not promote automatically', async () => {
    const mockRpc = vi.fn();
    vi.spyOn(supabase, 'rpc').mockImplementation(mockRpc as any);

    render(
      <MemoryRouter>
        <AdminUserManagement />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: /admin user management/i })).toBeInTheDocument();

    // Verify target user spotlight card renders correctly
    expect(await screen.findByText(/target user for promotion/i)).toBeInTheDocument();
    expect(screen.getAllByText(/370c0774-cdcc-4c48-b968-042ba3f32843/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/raguramg44aru@gmail\.com/i).length).toBeGreaterThanOrEqual(1);

    // Verify promote button is present
    expect(screen.getAllByRole('button', { name: /promote to admin/i }).length).toBeGreaterThanOrEqual(1);

    // Crucial requirement: No automatic promotion execution
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('opens confirmation modal and allows canceling without calling RPC', async () => {
    const mockRpc = vi.fn();
    vi.spyOn(supabase, 'rpc').mockImplementation(mockRpc as any);

    render(
      <MemoryRouter>
        <AdminUserManagement />
      </MemoryRouter>,
    );

    const promoteBtn = (await screen.findAllByRole('button', { name: /promote to admin/i }))[0];
    fireEvent.click(promoteBtn);

    // Modal is opened
    expect(screen.getByRole('heading', { name: /confirm administrator promotion/i })).toBeInTheDocument();
    expect(screen.getByText(/you are about to promote this user to the/i)).toBeInTheDocument();

    // Click Cancel
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    // Modal closes and no RPC was fired
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /confirm administrator promotion/i })).not.toBeInTheDocument();
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('executes set_user_role RPC with admin session when confirmed', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: {
        success: true,
        message: 'User role updated successfully.',
        user_id: '370c0774-cdcc-4c48-b968-042ba3f32843',
        old_role: 'requester',
        new_role: 'admin',
      },
      error: null,
    });
    vi.spyOn(supabase, 'rpc').mockImplementation(mockRpc as any);

    render(
      <MemoryRouter>
        <AdminUserManagement />
      </MemoryRouter>,
    );

    const promoteBtn = (await screen.findAllByRole('button', { name: /promote to admin/i }))[0];
    fireEvent.click(promoteBtn);

    const confirmBtn = screen.getByRole('button', { name: /yes, promote to admin/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_user_role', {
        p_target_user_id: '370c0774-cdcc-4c48-b968-042ba3f32843',
        p_new_role: 'admin',
        p_notes: expect.stringContaining('co-administrator'),
      });
    });

    expect(await screen.findByText(/successfully updated/i)).toBeInTheDocument();
  });

  it('handles RPC errors gracefully and displays error banner', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Forbidden: Only administrators can assign user roles.' },
    });
    vi.spyOn(supabase, 'rpc').mockImplementation(mockRpc as any);

    render(
      <MemoryRouter>
        <AdminUserManagement />
      </MemoryRouter>,
    );

    const promoteBtn = (await screen.findAllByRole('button', { name: /promote to admin/i }))[0];
    fireEvent.click(promoteBtn);

    const confirmBtn = screen.getByRole('button', { name: /yes, promote to admin/i });
    fireEvent.click(confirmBtn);

    expect(await screen.findByText(/forbidden: only administrators can assign user roles/i)).toBeInTheDocument();
  });
});
