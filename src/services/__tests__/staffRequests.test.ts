import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  startRequestReview,
  verifyRequest,
  rejectRequest,
  publishHelpRequest,
  createStaffDocumentUrl,
  setStaffDocumentStatus,
  listRequestAuditTrail,
} from '../staffRequests';
import { supabase } from '../../lib/supabase';
import type { User } from '@supabase/supabase-js';

vi.mock('../../lib/supabase', () => {
  return {
    supabase: {
      auth: {
        getSession: vi.fn(),
      },
      from: vi.fn(),
      rpc: vi.fn(),
      storage: {
        from: vi.fn(),
      },
    },
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-anon-key',
  };
});

const mockStaffUser: User = {
  id: 'staff-user-1',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-01-01T00:00:00Z',
  email: 'staff@walkwithus.org',
};

describe('staffRequests service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
      data: { session: { user: mockStaffUser } },
    } as any);
  });

  describe('Staff Lifecycle Transitions', () => {
    it('startRequestReview moves submitted -> under_review via RPC', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-1', status: 'under_review', previous_status: 'submitted' },
        error: null,
      } as any);

      const result = await startRequestReview(mockStaffUser, 'req-1');

      expect(supabase.rpc).toHaveBeenCalledWith('transition_help_request', {
        p_request_id: 'req-1',
        p_new_status: 'under_review',
        p_expected_status: 'submitted',
        p_notes: 'Review started.',
      });
      expect(result.data).toEqual({ id: 'req-1', status: 'under_review' });
      expect(result.error).toBeNull();
    });

    it('verifyRequest validates notes requirement and applies transition', async () => {
      // Empty notes should fail client-side before touching DB
      const emptyResult = await verifyRequest(mockStaffUser, 'req-1', '   ');
      expect(emptyResult.data).toBeNull();
      expect(emptyResult.error?.message).toMatch(/add verification notes/i);
      expect(supabase.rpc).not.toHaveBeenCalled();

      // Valid notes proceeds to RPC
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-1', status: 'verified', previous_status: 'under_review' },
        error: null,
      } as any);

      const result = await verifyRequest(mockStaffUser, 'req-1', 'Verified hospital estimate and phone interview.');
      expect(supabase.rpc).toHaveBeenCalledWith('transition_help_request', {
        p_request_id: 'req-1',
        p_new_status: 'verified',
        p_expected_status: 'under_review',
        p_notes: 'Verified hospital estimate and phone interview.',
      });
      expect(result.data).toEqual({ id: 'req-1', status: 'verified' });
    });

    it('rejectRequest validates reason requirement and applies transition', async () => {
      const emptyResult = await rejectRequest(mockStaffUser, 'req-1', '');
      expect(emptyResult.data).toBeNull();
      expect(emptyResult.error?.message).toMatch(/add a rejection reason/i);
      expect(supabase.rpc).not.toHaveBeenCalled();

      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-1', status: 'rejected', previous_status: 'under_review' },
        error: null,
      } as any);

      const result = await rejectRequest(mockStaffUser, 'req-1', 'Incomplete medical records provided.');
      expect(supabase.rpc).toHaveBeenCalledWith('transition_help_request', {
        p_request_id: 'req-1',
        p_new_status: 'rejected',
        p_expected_status: 'under_review',
        p_notes: 'Incomplete medical records provided.',
      });
      expect(result.data).toEqual({ id: 'req-1', status: 'rejected' });
    });

    it('publishHelpRequest calls publish_help_request RPC atomically', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-1', status: 'published' },
        error: null,
      } as any);

      const result = await publishHelpRequest(mockStaffUser, 'req-1');

      expect(supabase.rpc).toHaveBeenCalledWith('publish_help_request', {
        p_request_id: 'req-1',
      });
      expect(result.data).toEqual({ id: 'req-1', status: 'published' });
      expect(result.error).toBeNull();
    });
  });

  describe('Document Verification & Audit Trail', () => {
    it('createStaffDocumentUrl mints short-lived signed URL for authorized staff and sanitizes download name', async () => {
      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://test.supabase.co/storage/v1/object/sign/request-documents/staff-token' },
        error: null,
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      } as any);

      const result = await createStaffDocumentUrl('user-123/req-456/doc.pdf', {
        download: 'hospital"\r\ninjected_estimate.pdf',
      });

      expect(result.error).toBeNull();
      expect(result.data?.signedUrl).toContain('staff-token');
      expect(mockCreateSignedUrl).toHaveBeenCalledWith('user-123/req-456/doc.pdf', 300, {
        download: 'hospital_injected_estimate.pdf',
      });
    });

    it('createStaffDocumentUrl rejects unauthenticated callers, invalid paths, and unauthorized non-staff RLS errors', async () => {
      const mockCreateSignedUrl = vi.fn();
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      } as any);

      // Invalid/traversal path rejected before touching Storage
      const badPathResult = await createStaffDocumentUrl('user-123/../req-456/doc.pdf');
      expect(badPathResult.data).toBeNull();
      expect(badPathResult.error?.source).toBe('document-url');
      expect(mockCreateSignedUrl).not.toHaveBeenCalled();

      // Unauthenticated session rejected before touching Storage
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
        data: { session: null },
        error: null,
      } as any);
      const unauthResult = await createStaffDocumentUrl('user-123/req-456/doc.pdf');
      expect(unauthResult.data).toBeNull();
      expect(unauthResult.error?.code).toBe('28000');
      expect(mockCreateSignedUrl).not.toHaveBeenCalled();

      // Non-staff caller rejected by Storage RLS (42501 / 403)
      mockCreateSignedUrl.mockResolvedValueOnce({
        data: null,
        error: { code: '42501', statusCode: '403', message: 'new row violates row-level security policy' },
      });
      const nonStaffResult = await createStaffDocumentUrl('user-123/req-456/doc.pdf');
      expect(nonStaffResult.data).toBeNull();
      expect(nonStaffResult.error?.code).toBe('42501');
    });

    it('setStaffDocumentStatus delegates to set_document_verification_status RPC and classifies unauthorized errors', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: { id: 'doc-1', status: 'verified' },
        error: null,
      } as any);

      const result = await setStaffDocumentStatus('doc-1', 'verified', 'req-1');

      expect(supabase.rpc).toHaveBeenCalledWith('set_document_verification_status', {
        p_document_id: 'doc-1',
        p_new_status: 'verified',
        p_request_id: 'req-1',
      });
      expect(result.data).toEqual({ id: 'doc-1', status: 'verified' });
      expect(result.error).toBeNull();

      // Unauthorized caller rejected by RPC
      vi.spyOn(supabase, 'rpc').mockResolvedValueOnce({
        data: null,
        error: { code: '42501', message: 'Access denied: staff or admin role required.' },
      } as any);

      const denied = await setStaffDocumentStatus('doc-1', 'verified', 'req-1');
      expect(denied.data).toBeNull();
      expect(denied.error?.kind).toBe('unauthorized');
    });

    it('listRequestAuditTrail selects audit entries from admin_actions', async () => {
      const mockAuditRows = [
        {
          id: 'act-1',
          admin_id: 'staff-1',
          action: 'review_started',
          notes: 'Review started.',
          old_status: 'submitted',
          new_status: 'under_review',
          created_at: '2026-10-10T12:00:00Z',
        },
      ];

      const mockLimit = vi.fn().mockResolvedValue({
        data: mockAuditRows,
        error: null,
      });
      const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockEq = vi.fn().mockReturnValue({ order: mockOrder });
      const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });

      vi.spyOn(supabase, 'from').mockReturnValue({
        select: mockSelect,
      } as any);

      const result = await listRequestAuditTrail('req-1');

      expect(supabase.from).toHaveBeenCalledWith('admin_actions');
      expect(mockEq).toHaveBeenCalledWith('request_id', 'req-1');
      expect(result.data).toHaveLength(1);
      expect(result.data![0].action).toBe('review_started');
      expect(result.error).toBeNull();
    });
  });
});
