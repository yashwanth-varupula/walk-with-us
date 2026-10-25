-- ============================================================================
-- Migration: 20261107_harden_document_storage_and_rls.sql
-- Purpose:
--   Remediate security vulnerabilities and policy redundancies across the
--   private `request-documents` bucket (`storage.objects`) and the
--   `public.help_request_documents` metadata table without altering existing
--   production records or breaking legitimate requester/staff workflows.
--
-- Summary of Changes:
--   1. Assert bucket configuration invariants (`request-documents` is private,
--      5 MB limit, PDF/JPEG/PNG MIME allowlist).
--   2. Remove 8 redundant, misaligned, or overly permissive `storage.objects`
--      policies on `request-documents` (reducing 13 overlapping policies to 5
--      canonical, non-overlapping policies).
--   3. Harden `storage.objects` INSERT, UPDATE, and DELETE policies so
--      requesters can only write, replace, or delete objects inside their own
--      `{auth.uid()}/{requestId}/{filename}` namespace AND only while the
--      referenced `help_requests` row is owned by `auth.uid()` and in `draft`
--      status.
--   4. Harden `public.help_request_documents` INSERT privileges and RLS policy
--      so requesters can only attach documents to their own `draft` requests,
--      with a matching `{auth.uid()}/{request_id}/{filename}` `storage_path`,
--      and cannot forge `status = 'verified'` or staff review columns on insert.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Pre-flight safety assertions on `request-documents` bucket configuration
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_public boolean;
  v_size_limit bigint;
BEGIN
  SELECT b.public, b.file_size_limit
    INTO v_public, v_size_limit
    FROM storage.buckets b
   WHERE b.id = 'request-documents';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pre-flight check failed: storage bucket "request-documents" does not exist.';
  END IF;

  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Pre-flight check failed: "request-documents" bucket must be private (public = false).';
  END IF;

  IF v_size_limit IS DISTINCT FROM 5242880 THEN
    RAISE EXCEPTION 'Pre-flight check failed: "request-documents" file_size_limit expected 5242880, found %.', v_size_limit;
  END IF;
END
$$;

-- ----------------------------------------------------------------------------
-- 2. Drop redundant, segment-misaligned, and overly permissive storage policies
-- ----------------------------------------------------------------------------

-- 2a. Exact duplicates of canonical policies:
DROP POLICY IF EXISTS "request_documents_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "request_documents_select_own" ON storage.objects;
DROP POLICY IF EXISTS "Staff can view request documents" ON storage.objects;

-- 2b. Legacy segment-1 misaligned policies (`hr.id::text = (storage.foldername(name))[1]`):
--     In the canonical `{userId}/{requestId}/{uuid}-{filename}` layout, segment [1]
--     is `userId`, not `requestId`. Because `authenticated` can insert a draft
--     `help_requests` row with a chosen UUID `id`, these policies allowed a
--     cross-tenant IDOR read/delete if an attacker created a draft request whose
--     `id` matched another user's `userId`.
DROP POLICY IF EXISTS "Requesters can view own request documents" ON storage.objects;
DROP POLICY IF EXISTS "Requesters can delete own draft documents" ON storage.objects;

-- 2c. Overly broad delete policy without a `status = 'draft'` requirement:
--     Because permissive policies combine with OR, this policy bypassed
--     "Requesters can delete own draft request documents" and allowed deleting
--     evidence files after request submission/verification/publication.
DROP POLICY IF EXISTS "request_documents_delete_own" ON storage.objects;

-- 2d. Unaudited staff object mutation/deletion policies on `request-documents`:
--     Staff review documents via `public.set_document_verification_status()`
--     and read files via short-lived signed URLs; staff never overwrite or
--     delete requester files in Storage.
DROP POLICY IF EXISTS "Staff can delete request documents" ON storage.objects;
DROP POLICY IF EXISTS "Staff can update request documents" ON storage.objects;

-- ----------------------------------------------------------------------------
-- 3. Recreate canonical 5 `storage.objects` policies for `request-documents`
-- ----------------------------------------------------------------------------

-- 3a. Requester INSERT: only into `{auth.uid()}/{requestId}/{filename}` for an
--     owned `draft` help request.
DROP POLICY IF EXISTS "Requesters can upload own request documents" ON storage.objects;
CREATE POLICY "Requesters can upload own request documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'request-documents'::text
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND EXISTS (
      SELECT 1
        FROM public.help_requests hr
       WHERE (hr.id)::text = (storage.foldername(storage.objects.name))[2]
         AND hr.requester_id = auth.uid()
         AND hr.status = 'draft'::public.request_status
    )
  );

-- 3b. Requester SELECT: only objects inside `{auth.uid()}/{requestId}/{filename}`.
DROP POLICY IF EXISTS "Requesters can read own request documents" ON storage.objects;
CREATE POLICY "Requesters can read own request documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'request-documents'::text
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = (auth.uid())::text
  );

-- 3c. Requester UPDATE (replace): only objects inside `{auth.uid()}/{requestId}/{filename}`
--     and only while the parent help request is owned by `auth.uid()` and in `draft` status.
DROP POLICY IF EXISTS "Requesters can replace own request documents" ON storage.objects;
CREATE POLICY "Requesters can replace own request documents"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'request-documents'::text
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND EXISTS (
      SELECT 1
        FROM public.help_requests hr
       WHERE (hr.id)::text = (storage.foldername(storage.objects.name))[2]
         AND hr.requester_id = auth.uid()
         AND hr.status = 'draft'::public.request_status
    )
  )
  WITH CHECK (
    bucket_id = 'request-documents'::text
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND EXISTS (
      SELECT 1
        FROM public.help_requests hr
       WHERE (hr.id)::text = (storage.foldername(storage.objects.name))[2]
         AND hr.requester_id = auth.uid()
         AND hr.status = 'draft'::public.request_status
    )
  );

-- 3d. Requester DELETE: only objects inside `{auth.uid()}/{requestId}/{filename}`
--     and only while the parent help request is owned by `auth.uid()` and in `draft` status.
DROP POLICY IF EXISTS "Requesters can delete own draft request documents" ON storage.objects;
CREATE POLICY "Requesters can delete own draft request documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'request-documents'::text
    AND array_length(storage.foldername(name), 1) = 2
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND EXISTS (
      SELECT 1
        FROM public.help_requests hr
       WHERE (hr.id)::text = (storage.foldername(storage.objects.name))[2]
         AND hr.requester_id = auth.uid()
         AND hr.status = 'draft'::public.request_status
    )
  );

-- 3e. Staff/Admin SELECT: read-only access for verification via short-lived signed URLs.
DROP POLICY IF EXISTS "Staff can read request documents" ON storage.objects;
CREATE POLICY "Staff can read request documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'request-documents'::text
    AND public.get_my_role() = ANY (ARRAY['staff'::public.user_role, 'admin'::public.user_role])
  );

-- ----------------------------------------------------------------------------
-- 4. Harden `public.help_request_documents` column privileges and INSERT RLS
-- ----------------------------------------------------------------------------

-- Restrict `authenticated` INSERT to the 4 client-supplied metadata columns so
-- callers cannot supply `status = 'verified'`, `reviewed_by`, `review_notes`,
-- or `reviewed_at` on insert. `id`, `status` ('pending'), and `created_at`
-- (now()) are populated by their column defaults.
REVOKE INSERT ON TABLE public.help_request_documents FROM authenticated;
GRANT INSERT (request_id, storage_path, uploaded_by, document_type)
  ON TABLE public.help_request_documents
  TO authenticated;

-- Tighten INSERT RLS policy to enforce:
--   1. `uploaded_by = auth.uid()`
--   2. `status = 'pending'` and review metadata columns are NULL
--   3. `document_type` is one of ('pdf', 'jpg', 'png')
--   4. `storage_path` is a 2-folder path `{auth.uid()}/{request_id}/{filename}`
--   5. Parent `help_requests` row is owned by `auth.uid()` AND in `draft` status
DROP POLICY IF EXISTS "Requesters can add own request documents" ON public.help_request_documents;
CREATE POLICY "Requesters can add own request documents"
  ON public.help_request_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND status = 'pending'::public.document_status
    AND reviewed_by IS NULL
    AND review_notes IS NULL
    AND reviewed_at IS NULL
    AND document_type = ANY (ARRAY['pdf'::text, 'jpg'::text, 'png'::text])
    AND array_length(storage.foldername(storage_path), 1) = 2
    AND (storage.foldername(storage_path))[1] = (auth.uid())::text
    AND (storage.foldername(storage_path))[2] = (request_id)::text
    AND EXISTS (
      SELECT 1
        FROM public.help_requests hr
       WHERE hr.id = help_request_documents.request_id
         AND hr.requester_id = auth.uid()
         AND hr.status = 'draft'::public.request_status
    )
  );

COMMIT;

-- ============================================================================
-- Post-Migration Verification Queries (Run manually after applying)
-- ============================================================================
-- 1. Confirm exactly 5 policies remain for `request-documents` on `storage.objects`:
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'storage'
--    AND tablename = 'objects'
--    AND (qual LIKE '%request-documents%' OR with_check LIKE '%request-documents%')
--  ORDER BY cmd, policyname;
--
-- 2. Confirm `help_request_documents` policies and column-level INSERT grants:
-- SELECT policyname, cmd, roles, qual, with_check
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename = 'help_request_documents'
--  ORDER BY cmd, policyname;
--
-- SELECT grantee, column_name, privilege_type
--   FROM information_schema.column_privileges
--  WHERE table_schema = 'public'
--    AND table_name = 'help_request_documents'
--    AND grantee = 'authenticated'
--    AND privilege_type = 'INSERT'
--  ORDER BY column_name;
