-- =============================================================================
-- MIGRATION: 20261106_donations_user_index_and_staff_rls.sql
-- DESCRIPTION: Index optimizations for My Donations queries and Staff RLS visibility
-- STATUS: READY FOR REVIEW / SAFE ADDITIVE MIGRATION
-- =============================================================================
--
-- PURPOSE:
--   1. Add index on `public.donations(user_id, created_at DESC)` so that
--      authenticated donors querying their own donation history via RLS
--      (`user_id = auth.uid()`) have optimal O(log N) lookup and ordering.
--   2. Add index on `public.donations(user_id, status)` for fast filtering by
--      payment status (paid, pending, failed, refunded).
--   3. Add index on `public.donations(paid_at DESC)` for financial audit reporting.
--   4. Add RLS policy allowing verified staff/admin accounts to view donations,
--      resolving Section 6.E ("Donation visibility according to authorization").
--   5. PRESERVE all existing client boundaries: clients retain ZERO update/delete
--      grants on public.donations.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. PRE-FLIGHT ASSERTIONS
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.donations') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.donations table does not exist. Apply 20261103_donations_foundation.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_my_role'
       AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION 'ABORT: public.get_my_role() function not found. Required for staff authorization.';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. INDEX OPTIMIZATIONS FOR MY DONATIONS & AUDITING
-- -----------------------------------------------------------------------------

-- Compound index for user donation history sorted by date
CREATE INDEX IF NOT EXISTS donations_user_created_at_idx
  ON public.donations (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Compound index for user donation status filtering
CREATE INDEX IF NOT EXISTS donations_user_status_idx
  ON public.donations (user_id, status)
  WHERE user_id IS NOT NULL;

-- Index for paid_at time-based accounting (e.g. current calendar month)
CREATE INDEX IF NOT EXISTS donations_paid_at_idx
  ON public.donations (paid_at DESC)
  WHERE paid_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. STAFF DONATION VISIBILITY RLS
-- -----------------------------------------------------------------------------

-- Drop existing staff policy if previously created
DROP POLICY IF EXISTS donations_select_staff ON public.donations;

-- Allow verified staff or admin accounts to view all donation records
CREATE POLICY donations_select_staff
  ON public.donations
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(public.get_my_role() IN ('staff', 'admin'), false)
  );

COMMIT;

-- -----------------------------------------------------------------------------
-- POST-MIGRATION VERIFICATION
-- -----------------------------------------------------------------------------
SELECT 'donations_user_created_at_idx exists' AS check_1,
       to_regclass('public.donations_user_created_at_idx') IS NOT NULL AS passed;

SELECT 'donations_select_staff policy exists' AS check_2,
       EXISTS (
         SELECT 1 FROM pg_policies
          WHERE schemaname = 'public'
            AND tablename = 'donations'
            AND policyname = 'donations_select_staff'
       ) AS passed;
