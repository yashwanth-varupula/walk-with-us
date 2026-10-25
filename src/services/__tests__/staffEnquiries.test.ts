import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isEnquiryStatus,
  listStaffVolunteerApplications,
  listStaffPartnerEnquiries,
  updateStaffEnquiryStatus,
  listEnquiryAuditTrail,
  ENQUIRY_STATUSES,
} from '../staffEnquiries';
import { supabase } from '../../lib/supabase';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

describe('staffEnquiries service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isEnquiryStatus type guard', () => {
    it('accepts valid statuses', () => {
      for (const status of ENQUIRY_STATUSES) {
        expect(isEnquiryStatus(status)).toBe(true);
      }
    });

    it('rejects unsupported statuses like contacted or pending', () => {
      expect(isEnquiryStatus('contacted')).toBe(false);
      expect(isEnquiryStatus('pending')).toBe(false);
      expect(isEnquiryStatus('approved')).toBe(false);
      expect(isEnquiryStatus('')).toBe(false);
      expect(isEnquiryStatus(null)).toBe(false);
      expect(isEnquiryStatus(123)).toBe(false);
    });
  });

  describe('listStaffVolunteerApplications', () => {
    it('successfully queries and maps volunteer applications', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'vol-1',
              user_id: 'user-1',
              full_name: 'Anita Desai',
              email: 'anita@example.com',
              phone: '9876543210',
              city: 'Bengaluru',
              availability: 'Weekends',
              skills: 'Translation',
              message: 'Happy to help community families.',
              status: 'new',
              created_at: '2026-03-01T10:00:00Z',
            },
          ],
          error: null,
          count: 1,
        }),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any);

      const res = await listStaffVolunteerApplications({ status: 'new', search: 'Anita' });

      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(1);
      expect(res.data![0]).toEqual({
        id: 'vol-1',
        userId: 'user-1',
        fullName: 'Anita Desai',
        email: 'anita@example.com',
        phone: '9876543210',
        city: 'Bengaluru',
        availability: 'Weekends',
        skills: 'Translation',
        message: 'Happy to help community families.',
        status: 'new',
        createdAt: '2026-03-01T10:00:00Z',
      });
      expect(res.count).toBe(1);
      expect(mockQueryBuilder.eq).toHaveBeenCalledWith('status', 'new');
      expect(mockQueryBuilder.or).toHaveBeenCalled();
    });

    it('handles permission denied error (42501) gracefully with migration diagnostic', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: '42501',
            message: 'permission denied for table volunteer_applications',
          },
          count: 0,
        }),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any);

      const res = await listStaffVolunteerApplications();

      expect(res.data).toBeNull();
      expect(res.error).not.toBeNull();
      expect(res.error?.isPermissionError).toBe(true);
      expect(res.error?.message).toContain('20261105_staff_enquiries_access.sql');
    });

    it('handles missing relation error (42P01 / PGRST205) gracefully', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: null,
          error: {
            code: 'PGRST205',
            message: 'relation "volunteer_applications" does not exist',
          },
          count: 0,
        }),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any);

      const res = await listStaffVolunteerApplications();

      expect(res.data).toBeNull();
      expect(res.error?.message).toContain('20261101_volunteer_partner_enquiries.sql');
    });
  });

  describe('listStaffPartnerEnquiries', () => {
    it('successfully queries and maps partner enquiries', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          data: [
            {
              id: 'prt-1',
              user_id: null,
              organisation: 'Hope Foundation',
              contact_name: 'Vikram Seth',
              email: 'vikram@hope.org',
              phone: null,
              partnership_type: 'NGO or nonprofit',
              message: 'We can provide food kits and supplies.',
              status: 'reviewing',
              created_at: '2026-03-02T12:00:00Z',
            },
          ],
          error: null,
          count: 1,
        }),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any);

      const res = await listStaffPartnerEnquiries();

      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(1);
      expect(res.data![0].organisation).toBe('Hope Foundation');
      expect(res.data![0].status).toBe('reviewing');
    });
  });

  describe('updateStaffEnquiryStatus', () => {
    it('rejects unsupported statuses before sending to network', async () => {
      const res = await updateStaffEnquiryStatus({
        enquiryType: 'volunteer',
        enquiryId: 'vol-123',
        newStatus: 'contacted' as any,
      });

      expect(res.ok).toBe(false);
      expect(res.error?.source).toBe('validation');
      expect(res.error?.message).toContain('not supported');
      expect(supabase.rpc).not.toHaveBeenCalled();
    });

    it('invokes update_enquiry_status RPC with trimmed parameters on valid status', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: { id: 'vol-123', new_status: 'accepted' },
        error: null,
      } as any);

      const res = await updateStaffEnquiryStatus({
        enquiryType: 'volunteer',
        enquiryId: 'vol-123',
        newStatus: 'accepted',
        notes: '   Verified identity and background.   ',
      });

      expect(res.ok).toBe(true);
      expect(res.error).toBeNull();
      expect(supabase.rpc).toHaveBeenCalledWith('update_enquiry_status', {
        p_enquiry_type: 'volunteer',
        p_enquiry_id: 'vol-123',
        p_new_status: 'accepted',
        p_notes: 'Verified identity and background.',
      });
    });

    it('reports missing RPC function with actionable explanation', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: {
          code: '42883',
          message: 'function update_enquiry_status does not exist',
        },
      } as any);

      const res = await updateStaffEnquiryStatus({
        enquiryType: 'partner',
        enquiryId: 'prt-123',
        newStatus: 'declined',
      });

      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('20261105_staff_enquiries_access.sql');
    });

    it('handles unauthorized error (42501)', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: null,
        error: {
          code: '42501',
          message: 'Only staff or admin accounts can update enquiry status.',
        },
      } as any);

      const res = await updateStaffEnquiryStatus({
        enquiryType: 'volunteer',
        enquiryId: 'vol-123',
        newStatus: 'reviewing',
      });

      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('not authorized');
    });
  });

  describe('listEnquiryAuditTrail', () => {
    it('returns empty list gracefully if enquiry_actions table is missing', async () => {
      const mockQueryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({
          data: null,
          error: { code: '42P01', message: 'relation enquiry_actions does not exist' },
        }),
      };

      vi.mocked(supabase.from).mockReturnValue(mockQueryBuilder as any);

      const res = await listEnquiryAuditTrail('any-id');
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    });
  });
});
