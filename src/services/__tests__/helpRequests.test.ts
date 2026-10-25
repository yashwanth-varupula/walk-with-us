import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateDocumentFile,
  resolveDocumentType,
  buildDocumentStoragePath,
  parseValidatedDocumentPath,
  getDocumentDisplayName,
  uploadHelpRequestDocument,
  removeHelpRequestDocument,
  createRequesterDocumentUrl,
  createHelpRequestDraft,
  updateHelpRequestDraft,
  submitHelpRequest,
  getPublicHelpRequestsPage,
  MAX_DOCUMENT_BYTES,
  type HelpRequestDraftInput,
} from '../helpRequests';
import { supabase } from '../../lib/supabase';

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
    SUPABASE_URL: '',
    SUPABASE_PUBLISHABLE_KEY: 'test-anon-key',
  };
});

describe('helpRequests service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Document Validation & Utilities', () => {
    it('validates accepted document types (PDF, JPG, PNG) and sizes', () => {
      const validPdf = new File(['%PDF-test'], 'doctor_letter.pdf', { type: 'application/pdf' });
      expect(validateDocumentFile(validPdf)).toBeNull();

      const validJpg = new File(['fake-jpg'], 'scan.jpg', { type: 'image/jpeg' });
      expect(validateDocumentFile(validJpg)).toBeNull();

      const validPng = new File(['fake-png'], 'bill.png', { type: 'image/png' });
      expect(validateDocumentFile(validPng)).toBeNull();
    });

    it('rejects unsupported file extensions, unrecognized MIME types, and extension/MIME spoofing', () => {
      const exeFile = new File(['binary'], 'malware.exe', { type: 'application/x-msdownload' });
      expect(validateDocumentFile(exeFile)).toBe('Only PDF, JPG, or PNG files are allowed.');

      const txtFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
      expect(validateDocumentFile(txtFile)).toBe('Only PDF, JPG, or PNG files are allowed.');

      // Spoofed extension with mismatched MIME type
      const spoofedPdfWithPngMime = new File(['fake'], 'invoice.pdf', { type: 'image/png' });
      expect(resolveDocumentType(spoofedPdfWithPngMime)).toBeNull();
      expect(validateDocumentFile(spoofedPdfWithPngMime)).toBe('Only PDF, JPG, or PNG files are allowed.');

      const htmlDisguisedAsPdf = new File(['<script>'], 'exploit.pdf', { type: 'text/html' });
      expect(resolveDocumentType(htmlDisguisedAsPdf)).toBeNull();
      expect(validateDocumentFile(htmlDisguisedAsPdf)).toBe('Only PDF, JPG, or PNG files are allowed.');
    });

    it('rejects empty files (0 bytes)', () => {
      const emptyFile = new File([], 'empty.pdf', { type: 'application/pdf' });
      expect(validateDocumentFile(emptyFile)).toBe('The selected file is empty. Please choose a different file.');
    });

    it('rejects files exceeding 5 MB limit', () => {
      const largeFile = new File(['a'], 'huge_scan.pdf', { type: 'application/pdf' });
      Object.defineProperty(largeFile, 'size', { value: MAX_DOCUMENT_BYTES + 1024 });

      expect(validateDocumentFile(largeFile)).toBe(
        'This file is larger than the 5 MB limit. Please choose a smaller file.',
      );
    });

    it('resolves correct document types', () => {
      expect(resolveDocumentType(new File([], 'doc.pdf', { type: 'application/pdf' }))).toBe('pdf');
      expect(resolveDocumentType(new File([], 'pic.jpg', { type: 'image/jpeg' }))).toBe('jpg');
      expect(resolveDocumentType(new File([], 'pic.jpeg', { type: 'image/jpeg' }))).toBe('jpg');
      expect(resolveDocumentType(new File([], 'chart.png', { type: 'image/png' }))).toBe('png');
      expect(resolveDocumentType(new File([], 'unknown.docx', { type: 'application/octet-stream' }))).toBeNull();
    });

    it('builds secure, collision-free storage paths with sanitized filenames and preserves extensions on long names', () => {
      const file = new File([], 'Medical Report & Invoice (1) #2.pdf', { type: 'application/pdf' });
      const path = buildDocumentStoragePath('user-123', 'req-456', file);

      expect(path).toMatch(/^user-123\/req-456\/[0-9a-f-]{36}-Medical_Report_Invoice_1_2\.pdf$/);

      const longNameFile = new File([], `${'a'.repeat(90)}.pdf`, { type: 'application/pdf' });
      const longPath = buildDocumentStoragePath('user-123', 'req-456', longNameFile);
      expect(longPath.endsWith('.pdf')).toBe(true);
      expect(parseValidatedDocumentPath(longPath)).not.toBeNull();
    });

    it('rejects path traversal or invalid segments in buildDocumentStoragePath and parseValidatedDocumentPath', () => {
      const file = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });
      expect(() => buildDocumentStoragePath('../victim-user', 'req-1', file)).toThrow();
      expect(() => buildDocumentStoragePath('user-1', 'req-1/../../victim', file)).toThrow();
      expect(() => buildDocumentStoragePath('', 'req-1', file)).toThrow();

      expect(parseValidatedDocumentPath('user-1/req-1/../secret.pdf')).toBeNull();
      expect(parseValidatedDocumentPath('user-1/req-1/sub/file.pdf')).toBeNull();
      expect(parseValidatedDocumentPath('user-1/file.pdf')).toBeNull();
      expect(parseValidatedDocumentPath('user-1\\req-1\\file.pdf')).toBeNull();
    });

    it('extracts display name correctly without UUID prefix', () => {
      const storagePath = 'user-1/req-1/41e60ece-0af9-4634-bebd-3997e0f36d59-hospital_estimate.pdf';
      expect(getDocumentDisplayName(storagePath)).toBe('hospital_estimate.pdf');
    });
  });

  describe('Document Upload, Access, and Deletion Security Workflows', () => {
    it('rejects unauthenticated document uploads before touching Storage', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: null },
        error: null,
      } as any);

      const validPdf = new File(['%PDF-1.4'], 'estimate.pdf', { type: 'application/pdf' });
      const result = await uploadHelpRequestDocument({
        requestId: 'req-123',
        file: validPdf,
      });

      expect(result.data).toBeNull();
      expect(result.error?.source).toBe('storage-upload');
      expect(result.error?.code).toBe('28000');
      expect(supabase.storage.from).not.toHaveBeenCalled();
    });

    it('rejects oversized (>5 MB), empty, and spoofed files in uploadHelpRequestDocument before touching Storage', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-123' } } },
        error: null,
      } as any);

      const oversizedPdf = new File(['%PDF'], 'large.pdf', { type: 'application/pdf' });
      Object.defineProperty(oversizedPdf, 'size', { value: MAX_DOCUMENT_BYTES + 10 });

      const oversizedResult = await uploadHelpRequestDocument({
        requestId: 'req-123',
        file: oversizedPdf,
      });
      expect(oversizedResult.data).toBeNull();
      expect(oversizedResult.error?.message).toContain('5 MB limit');
      expect(supabase.storage.from).not.toHaveBeenCalled();

      const spoofedFile = new File(['<svg>'], 'scan.png', { type: 'image/svg+xml' });
      const spoofedResult = await uploadHelpRequestDocument({
        requestId: 'req-123',
        file: spoofedFile,
      });
      expect(spoofedResult.data).toBeNull();
      expect(spoofedResult.error?.message).toBe('Only PDF, JPG, or PNG files are allowed.');
      expect(supabase.storage.from).not.toHaveBeenCalled();
    });

    it('cleans up uploaded storage object when help_request_documents metadata insert fails', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-123' } } },
        error: null,
      } as any);

      const mockUpload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null });
      const mockRemove = vi.fn().mockResolvedValue({ data: [], error: null });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        upload: mockUpload,
        remove: mockRemove,
      } as any);

      const mockInsert = vi.fn().mockResolvedValue({
        error: { code: '42501', message: 'new row violates row-level security policy' },
      });
      vi.spyOn(supabase, 'from').mockReturnValue({
        insert: mockInsert,
      } as any);

      const validPdf = new File(['%PDF-content'], 'rx.pdf', { type: 'application/pdf' });
      const result = await uploadHelpRequestDocument({
        requestId: 'req-123',
        file: validPdf,
      });

      expect(result.data).toBeNull();
      expect(result.error?.source).toBe('documents-insert');
      expect(mockUpload).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledTimes(1);
      const uploadedPath = mockUpload.mock.calls[0][0];
      expect(mockRemove).toHaveBeenCalledWith([uploadedPath]);
    });

    it('uploads valid document and records metadata with canonical status and document_type', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-123' } } },
        error: null,
      } as any);

      const mockUpload = vi.fn().mockResolvedValue({ data: { path: 'ok' }, error: null });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        upload: mockUpload,
      } as any);

      const mockInsert = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase, 'from').mockReturnValue({
        insert: mockInsert,
      } as any);

      const validJpg = new File(['jpeg-bytes'], 'hospital_bill.jpeg', { type: 'image/jpeg' });
      const result = await uploadHelpRequestDocument({
        requestId: 'req-456',
        file: validJpg,
      });

      expect(result.error).toBeNull();
      expect(result.data?.uploadedBy).toBe('user-123');
      expect(result.data?.requestId).toBe('req-456');
      expect(result.data?.documentType).toBe('jpg');
      expect(result.data?.status).toBe('pending');
      expect(result.data?.storagePath).toMatch(/^user-123\/req-456\/[0-9a-f-]{36}-hospital_bill\.jpeg$/);
      expect(mockInsert).toHaveBeenCalledWith({
        request_id: 'req-456',
        storage_path: result.data?.storagePath,
        uploaded_by: 'user-123',
        document_type: 'jpg',
      });
    });

    it('allows requester to mint signed URL for their own document and blocks cross-user or traversal paths', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-123' } } },
        error: null,
      } as any);

      const mockCreateSignedUrl = vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://test.supabase.co/storage/v1/object/sign/request-documents/signed-token' },
        error: null,
      });
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        createSignedUrl: mockCreateSignedUrl,
      } as any);

      // Own document succeeds
      const ownResult = await createRequesterDocumentUrl('user-123/req-456/doc-1.pdf');
      expect(ownResult.error).toBeNull();
      expect(ownResult.data?.signedUrl).toContain('signed-token');
      expect(mockCreateSignedUrl).toHaveBeenCalledWith('user-123/req-456/doc-1.pdf', 3600, { download: false });

      mockCreateSignedUrl.mockClear();

      // Another user's document is denied before reaching Storage
      const crossUserResult = await createRequesterDocumentUrl('other-user-999/req-456/doc-1.pdf');
      expect(crossUserResult.data).toBeNull();
      expect(crossUserResult.error?.code).toBe('42501');
      expect(mockCreateSignedUrl).not.toHaveBeenCalled();

      // Traversal path is denied before reaching Storage
      const traversalResult = await createRequesterDocumentUrl('user-123/../other-user-999/doc-1.pdf');
      expect(traversalResult.data).toBeNull();
      expect(traversalResult.error?.source).toBe('document-url');
      expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    });

    it('rejects unauthorized or mismatched document deletion attempts before touching Storage', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-123' } } },
        error: null,
      } as any);

      const mockRemove = vi.fn();
      vi.spyOn(supabase.storage, 'from').mockReturnValue({
        remove: mockRemove,
      } as any);

      // Attempt to delete another user's file
      const crossUserDelete = await removeHelpRequestDocument({
        requestId: 'req-456',
        storagePath: 'victim-user/req-456/file.pdf',
      });
      expect(crossUserDelete.ok).toBe(false);
      expect(crossUserDelete.error?.code).toBe('42501');
      expect(mockRemove).not.toHaveBeenCalled();

      // Attempt to delete a file from a different requestId than supplied
      const crossRequestDelete = await removeHelpRequestDocument({
        requestId: 'draft-req-1',
        storagePath: 'user-123/submitted-req-2/file.pdf',
      });
      expect(crossRequestDelete.ok).toBe(false);
      expect(crossRequestDelete.error?.code).toBe('42501');
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe('Draft Management', () => {
    const validDraftInput: HelpRequestDraftInput = {
      title: 'Urgent Chemotherapy Treatment Support',
      description: 'Family requires assistance covering ongoing hospital medication expenses.',
      categoryId: 'cat-medical-1',
      urgency: 'high',
      targetAmount: 75000,
      locationCity: 'Vijayawada',
      locationState: 'Andhra Pradesh',
    };

    it('creates draft sending only the 7 authorized content columns', async () => {
      vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'requester-abc' } } },
      } as any);

      const mockSingle = vi.fn().mockResolvedValue({
        data: { id: 'new-req-uuid-1', status: 'draft' },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ single: mockSingle });
      const mockInsert = vi.fn().mockReturnValue({ select: mockSelect });

      vi.spyOn(supabase, 'from').mockReturnValue({
        insert: mockInsert,
      } as any);

      const result = await createHelpRequestDraft(validDraftInput);

      expect(mockInsert).toHaveBeenCalledWith({
        requester_id: 'requester-abc',
        title: validDraftInput.title,
        description: validDraftInput.description,
        category_id: validDraftInput.categoryId,
        urgency: validDraftInput.urgency,
        target_amount: validDraftInput.targetAmount,
        location_city: validDraftInput.locationCity,
        location_state: validDraftInput.locationState,
      });

      expect(result.data).toEqual({ id: 'new-req-uuid-1', status: 'draft' });
      expect(result.error).toBeNull();
    });

    it('updates draft restricted to the 7 editable draft columns', async () => {
      const mockMaybeSingle = vi.fn().mockResolvedValue({
        data: { id: 'draft-req-1', status: 'draft' },
        error: null,
      });
      const mockSelect = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
      const mockEq2 = vi.fn().mockReturnValue({ select: mockSelect });
      const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq1 });

      vi.spyOn(supabase, 'from').mockReturnValue({
        update: mockUpdate,
      } as any);

      const result = await updateHelpRequestDraft('draft-req-1', validDraftInput);

      expect(mockUpdate).toHaveBeenCalledWith({
        title: validDraftInput.title,
        description: validDraftInput.description,
        category_id: validDraftInput.categoryId,
        urgency: validDraftInput.urgency,
        target_amount: validDraftInput.targetAmount,
        location_city: validDraftInput.locationCity,
        location_state: validDraftInput.locationState,
      });

      expect(result.data).toEqual({ id: 'draft-req-1', status: 'draft' });
      expect(result.error).toBeNull();
    });
  });

  describe('Help Request Lifecycle RPCs', () => {
    it('submits help request via submit_help_request RPC and echoes committed status', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: { id: 'req-123', status: 'submitted' },
        error: null,
      } as any);

      const result = await submitHelpRequest('req-123');

      expect(supabase.rpc).toHaveBeenCalledWith('submit_help_request', {
        p_request_id: 'req-123',
      });
      expect(result.data).toEqual({ id: 'req-123', status: 'submitted' });
      expect(result.error).toBeNull();
    });

    it('handles unauthorized/unauthenticated RPC errors cleanly', async () => {
      vi.spyOn(supabase, 'rpc').mockResolvedValue({
        data: null,
        error: { code: '28000', message: 'You must be signed in to submit a request.' },
      } as any);

      const result = await submitHelpRequest('req-123');

      expect(result.data).toBeNull();
      expect(result.error?.kind).toBe('unauthenticated');
      expect(result.error?.message).toContain('signed in');
    });
  });

  describe('Public Directory Queries', () => {
    it('queries published requests only with safe public column selection', async () => {
      const mockRows = [
        {
          id: 'pub-1',
          title: 'Flood Relief',
          description: 'Emergency provisions',
          status: 'published',
          urgency: 'high',
          category_id: 'cat-1',
          target_amount: 50000,
          raised_amount: 15000,
          location_city: 'Vijayawada',
          location_state: 'AP',
          published_at: '2026-10-01T00:00:00Z',
          created_at: '2026-09-28T00:00:00Z',
          image_path: null,
        },
      ];

      const mockRange = vi.fn().mockResolvedValue({
        data: mockRows,
        count: 1,
        error: null,
      });
      const mockOrder2 = vi.fn().mockReturnValue({ range: mockRange });
      const mockOrder1 = vi.fn().mockReturnValue({ order: mockOrder2 });
      const mockIn = vi.fn().mockReturnValue({ order: mockOrder1 });
      const mockSelect = vi.fn().mockReturnValue({ in: mockIn });

      vi.spyOn(supabase, 'from').mockReturnValue({
        select: mockSelect,
      } as any);

      const result = await getPublicHelpRequestsPage({ offset: 0, limit: 12 });

      expect(mockSelect).toHaveBeenCalledWith(
        expect.stringContaining('id, title, description, status, urgency, category_id, target_amount, raised_amount'),
      );
      expect(mockIn).toHaveBeenCalledWith('status', ['published']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('pub-1');
      expect(result.error).toBeNull();
    });
  });
});
