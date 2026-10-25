-- =============================================================================
-- Walk With Us — Staff Enquiry Access & Review RPC (HARDENED)
-- =============================================================================
-- STATUS: NOT APPLIED.
--
-- This file is the hardened, reviewed, ready-to-apply migration for the Staff
-- Enquiry Inbox feature.
--
-- DO NOT APPLY AUTOMATICALLY.
-- Operators must review and apply this manually via the Supabase Dashboard SQL
-- Editor for project ffpndfstdseefgfxrmgz.
--
-- SECURITY CONTRACT:
-- 1. Table RLS: Authenticated staff/admin accounts can read enquiries. Non-staff
--    authenticated accounts and unauthenticated anon visitors receive 0 rows.
-- 2. Direct mutation revoked: Table-level UPDATE and DELETE privileges remain
--    strictly revoked for anon and authenticated on both enquiry tables.
-- 3. Public submissions preserved: anon and authenticated retain INSERT on both
--    enquiry tables governed by existing user_id ownership check policies.
-- 4. Audit durability: Audit logs live in public.enquiry_actions with admin_id
--    ON DELETE SET NULL, ensuring audit trails persist even if a staff account
--    is later removed.
-- 5. RPC authorization & 3VL defense: public.update_enquiry_status() explicitly
--    rejects NULL actor, NULL role (preventing 3VL NULL bypass), and non-staff
--    roles before touching data.
-- 6. Concurrency & integrity: The RPC serializes concurrent updates via
--    SELECT ... FOR UPDATE, rejects no-op status changes, rejects NULL inputs
--    with SQLSTATE 22023, and records audit logs atomically in one transaction.
-- 7. Search path pinned: SET search_path = public, pg_temp prevents hijacking.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- PRE-FLIGHT VERIFICATION
-- Ensure prerequisite tables, helper functions, types, and owner privileges exist.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- 1. Prerequisite tables and types
  IF to_regclass('public.volunteer_applications') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.volunteer_applications does not exist. Apply 20261101_volunteer_partner_enquiries.sql first.';
  END IF;

  IF to_regclass('public.partner_enquiries') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.partner_enquiries does not exist. Apply 20261101_volunteer_partner_enquiries.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'get_my_role'
       AND p.pronargs = 0
  ) THEN
    RAISE EXCEPTION 'ABORT: public.get_my_role() function not found. Required for role verification.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typname = 'user_role'
  ) THEN
    RAISE EXCEPTION 'ABORT: public.user_role enum type not found.';
  END IF;

  -- 2. Executing role privilege check
  -- SECURITY DEFINER executes as the function owner. The applying role must hold
  -- UPDATE privileges on both enquiry tables so the installed RPC can modify records.
  IF NOT has_table_privilege(current_user, 'public.volunteer_applications', 'UPDATE')
     OR NOT has_table_privilege(current_user, 'public.partner_enquiries', 'UPDATE') THEN
    RAISE EXCEPTION 'ABORT: Executing role (%, %) must hold UPDATE on volunteer_applications and partner_enquiries to own the SECURITY DEFINER function. Re-run as table owner or superuser (usually postgres).', current_user, session_user;
  END IF;

  -- 3. Unexpected SELECT policies check (permits reruns of this migration)
  -- Multiple SELECT policies combine with OR. Fail loudly if an unknown permissive
  -- policy exists on either enquiry table to prevent unintentional data exposure.
  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'volunteer_applications'
       AND cmd = 'SELECT'
       AND policyname <> 'volunteer_applications_staff_select'
  ) OR EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'partner_enquiries'
       AND cmd = 'SELECT'
       AND policyname <> 'partner_enquiries_staff_select'
  ) THEN
    RAISE EXCEPTION 'ABORT: Unexpected existing SELECT policy found on enquiry tables. A permissive policy could bypass access controls. Review pg_policies before applying.';
  END IF;

  -- 4. Schema, constraint, foreign key, RLS, and privilege validation if public.enquiry_actions already exists
  -- If enquiry_actions already exists from a previous run or test, verify that its
  -- schema, column types, nullability, constraints, foreign keys, RLS, and privileges
  -- are strictly compatible. Do not automatically repair or weaken an unknown existing table.
  IF to_regclass('public.enquiry_actions') IS NOT NULL THEN
    -- Check column existence and compatible data types
    IF EXISTS (
      SELECT 1
        FROM (VALUES
          ('id', 'uuid'),
          ('admin_id', 'uuid'),
          ('enquiry_type', 'text'),
          ('enquiry_id', 'uuid'),
          ('old_status', 'text'),
          ('new_status', 'text'),
          ('notes', 'text'),
          ('created_at', 'timestamp with time zone')
        ) AS expected(col_name, col_type)
        LEFT JOIN information_schema.columns c
          ON c.table_schema = 'public'
         AND c.table_name = 'enquiry_actions'
         AND c.column_name = expected.col_name
       WHERE c.column_name IS NULL
          OR (c.data_type <> expected.col_type AND c.udt_name <> expected.col_type)
    ) THEN
      RAISE EXCEPTION 'ABORT: public.enquiry_actions already exists with incompatible column definitions or types. Review schema before applying.';
    END IF;

    -- Verify exact column count (no unexpected extraneous columns)
    IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'enquiry_actions') <> 8 THEN
      RAISE EXCEPTION 'ABORT: public.enquiry_actions already exists with unexpected column count. Expected exactly 8 columns.';
    END IF;

    -- Verify admin_id is nullable (required for ON DELETE SET NULL durability)
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'enquiry_actions'
         AND column_name = 'admin_id'
         AND is_nullable = 'NO'
    ) THEN
      RAISE EXCEPTION 'ABORT: public.enquiry_actions.admin_id is NOT NULL. It must be nullable to support ON DELETE SET NULL audit durability.';
    END IF;

    -- Verify required NOT NULL columns
    IF EXISTS (
      SELECT 1
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'enquiry_actions'
         AND column_name IN ('id', 'enquiry_type', 'enquiry_id', 'old_status', 'new_status', 'created_at')
         AND is_nullable = 'YES'
    ) THEN
      RAISE EXCEPTION 'ABORT: public.enquiry_actions has nullable columns where NOT NULL is required.';
    END IF;

    -- Verify primary key constraint
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
       WHERE c.conrelid = to_regclass('public.enquiry_actions')
         AND c.contype = 'p'
    ) THEN
      RAISE EXCEPTION 'ABORT: Existing public.enquiry_actions table is missing a primary key constraint.';
    END IF;

    -- Verify foreign key constraint to auth.users(id) with ON DELETE SET NULL (confdeltype = 'n')
    IF to_regclass('auth.users') IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
       WHERE c.conrelid = to_regclass('public.enquiry_actions')
         AND c.contype = 'f'
         AND c.confrelid = to_regclass('auth.users')
         AND c.confdeltype = 'n'
    ) THEN
      RAISE EXCEPTION 'ABORT: Existing public.enquiry_actions table is missing foreign key to auth.users(id) ON DELETE SET NULL.';
    END IF;

    -- Verify check constraint on enquiry_type
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint c
       WHERE c.conrelid = to_regclass('public.enquiry_actions')
         AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) LIKE '%volunteer%'
         AND pg_get_constraintdef(c.oid) LIKE '%partner%'
    ) THEN
      RAISE EXCEPTION 'ABORT: Existing public.enquiry_actions table is missing check constraint on enquiry_type.';
    END IF;

    -- Verify Row Level Security is enabled
    IF NOT EXISTS (
      SELECT 1
        FROM pg_class c
       WHERE c.oid = to_regclass('public.enquiry_actions')
         AND c.relrowsecurity = true
    ) THEN
      RAISE EXCEPTION 'ABORT: Existing public.enquiry_actions table does not have Row Level Security (RLS) enabled.';
    END IF;

    -- Verify client roles do NOT hold direct mutation or anonymous read privileges
    IF has_table_privilege('anon', 'public.enquiry_actions', 'SELECT')
       OR has_table_privilege('anon', 'public.enquiry_actions', 'INSERT')
       OR has_table_privilege('anon', 'public.enquiry_actions', 'UPDATE')
       OR has_table_privilege('anon', 'public.enquiry_actions', 'DELETE')
       OR has_table_privilege('authenticated', 'public.enquiry_actions', 'INSERT')
       OR has_table_privilege('authenticated', 'public.enquiry_actions', 'UPDATE')
       OR has_table_privilege('authenticated', 'public.enquiry_actions', 'DELETE') THEN
      RAISE EXCEPTION 'ABORT: Existing public.enquiry_actions table has insecure client privileges. Direct mutation or anonymous read privileges detected.';
    END IF;

    -- Verify no unknown permissive policies exist on enquiry_actions
    IF EXISTS (
      SELECT 1
        FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'enquiry_actions'
         AND policyname <> 'enquiry_actions_staff_select'
    ) THEN
      RAISE EXCEPTION 'ABORT: Unexpected existing policy found on public.enquiry_actions. Review pg_policies before applying.';
    END IF;
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 1. TABLE PRIVILEGES & SELECT RLS POLICIES FOR STAFF
-- -----------------------------------------------------------------------------

-- Ensure RLS is active on both enquiry tables
ALTER TABLE public.volunteer_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_enquiries ENABLE ROW LEVEL SECURITY;

-- PostgREST needs SELECT privilege to read rows allowed by RLS
GRANT SELECT ON public.volunteer_applications TO authenticated;
GRANT SELECT ON public.partner_enquiries TO authenticated;

-- Explicitly ensure direct mutation is completely blocked
REVOKE SELECT, UPDATE, DELETE ON public.volunteer_applications FROM anon;
REVOKE SELECT, UPDATE, DELETE ON public.partner_enquiries FROM anon;
REVOKE UPDATE, DELETE ON public.volunteer_applications FROM authenticated;
REVOKE UPDATE, DELETE ON public.partner_enquiries FROM authenticated;

-- Staff SELECT policy on volunteer_applications
DROP POLICY IF EXISTS volunteer_applications_staff_select ON public.volunteer_applications;
CREATE POLICY volunteer_applications_staff_select
  ON public.volunteer_applications
  FOR SELECT
  TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['staff', 'admin']::public.user_role[]));

-- Staff SELECT policy on partner_enquiries
DROP POLICY IF EXISTS partner_enquiries_staff_select ON public.partner_enquiries;
CREATE POLICY partner_enquiries_staff_select
  ON public.partner_enquiries
  FOR SELECT
  TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['staff', 'admin']::public.user_role[]));

-- -----------------------------------------------------------------------------
-- 2. AUDIT LOGGING TABLE: public.enquiry_actions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.enquiry_actions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enquiry_type text NOT NULL CHECK (enquiry_type IN ('volunteer', 'partner')),
  enquiry_id   uuid NOT NULL,
  old_status   text NOT NULL,
  new_status   text NOT NULL,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS enquiry_actions_enquiry_id_idx
  ON public.enquiry_actions (enquiry_id);
CREATE INDEX IF NOT EXISTS enquiry_actions_created_at_idx
  ON public.enquiry_actions (created_at DESC);

ALTER TABLE public.enquiry_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS enquiry_actions_staff_select ON public.enquiry_actions;
CREATE POLICY enquiry_actions_staff_select
  ON public.enquiry_actions
  FOR SELECT
  TO authenticated
  USING (public.get_my_role() = ANY (ARRAY['staff', 'admin']::public.user_role[]));

REVOKE ALL ON public.enquiry_actions FROM anon, authenticated;
GRANT SELECT ON public.enquiry_actions TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. STATUS TRANSITION RPC: public.update_enquiry_status
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.update_enquiry_status(text, uuid, text, text);

CREATE OR REPLACE FUNCTION public.update_enquiry_status(
  p_enquiry_type text,
  p_enquiry_id   uuid,
  p_new_status   text,
  p_notes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor      uuid := auth.uid();
  v_role       public.user_role;
  v_old_status text;
BEGIN
  -- (1) Authenticated check
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication required.'
      USING errcode = '28000';
  END IF;

  -- (2) Authorisation check via get_my_role() with NULL safety (3VL defense)
  v_role := public.get_my_role();
  IF v_role IS NULL OR v_role NOT IN ('staff'::public.user_role, 'admin'::public.user_role) THEN
    RAISE EXCEPTION 'Only staff or admin accounts can update enquiry status.'
      USING errcode = '42501';
  END IF;

  -- (3) Strict parameter presence checks (SQLSTATE 22023)
  IF p_enquiry_id IS NULL THEN
    RAISE EXCEPTION 'Enquiry ID is required.'
      USING errcode = '22023';
  END IF;

  IF p_enquiry_type IS NULL THEN
    RAISE EXCEPTION 'Enquiry type is required.'
      USING errcode = '22023';
  END IF;

  IF p_new_status IS NULL THEN
    RAISE EXCEPTION 'New status is required.'
      USING errcode = '22023';
  END IF;

  -- (4) Validate allowed values
  IF p_enquiry_type NOT IN ('volunteer', 'partner') THEN
    RAISE EXCEPTION 'Invalid enquiry type: %. Expected volunteer or partner.', p_enquiry_type
      USING errcode = '22023';
  END IF;

  IF p_new_status NOT IN ('new', 'reviewing', 'accepted', 'declined') THEN
    RAISE EXCEPTION 'Invalid status: %. Allowed statuses: new, reviewing, accepted, declined.', p_new_status
      USING errcode = '22023';
  END IF;

  IF p_notes IS NOT NULL AND char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'Review notes cannot exceed 2000 characters.'
      USING errcode = '22023';
  END IF;

  -- (5) Atomically lock target row, verify existence, reject no-op, and update
  IF p_enquiry_type = 'volunteer' THEN
    SELECT status INTO v_old_status
      FROM public.volunteer_applications
     WHERE id = p_enquiry_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Volunteer application % not found.', p_enquiry_id
        USING errcode = 'P0002';
    END IF;

    -- Reject no-op to prevent spurious audit entries
    IF v_old_status = p_new_status THEN
      RAISE EXCEPTION 'Volunteer application is already marked as %.', p_new_status
        USING errcode = '22023';
    END IF;

    UPDATE public.volunteer_applications
       SET status = p_new_status
     WHERE id = p_enquiry_id;

  ELSIF p_enquiry_type = 'partner' THEN
    SELECT status INTO v_old_status
      FROM public.partner_enquiries
     WHERE id = p_enquiry_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Partner enquiry % not found.', p_enquiry_id
        USING errcode = 'P0002';
    END IF;

    -- Reject no-op to prevent spurious audit entries
    IF v_old_status = p_new_status THEN
      RAISE EXCEPTION 'Partner enquiry is already marked as %.', p_new_status
        USING errcode = '22023';
    END IF;

    UPDATE public.partner_enquiries
       SET status = p_new_status
     WHERE id = p_enquiry_id;
  END IF;

  -- (6) Audit trail insertion inside the same transaction
  INSERT INTO public.enquiry_actions (
    admin_id,
    enquiry_type,
    enquiry_id,
    old_status,
    new_status,
    notes
  ) VALUES (
    v_actor,
    p_enquiry_type,
    p_enquiry_id,
    v_old_status,
    p_new_status,
    p_notes
  );

  RETURN jsonb_build_object(
    'id', p_enquiry_id,
    'enquiry_type', p_enquiry_type,
    'old_status', v_old_status,
    'new_status', p_new_status
  );
END;
$$;

-- Secure execute grants
REVOKE ALL ON FUNCTION public.update_enquiry_status(text, uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_enquiry_status(text, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_enquiry_status(text, uuid, text, text) TO authenticated;

COMMIT;

-- =============================================================================
-- POST-APPLY VERIFICATION QUERIES
-- =============================================================================
-- 1. Verify RPC definition and security configuration
-- SELECT proname, prosecdef, proconfig, proisstrict FROM pg_proc WHERE proname = 'update_enquiry_status';
--
-- 2. Verify execute grants on the RPC
-- SELECT has_function_privilege('anon', 'public.update_enquiry_status(text, uuid, text, text)', 'EXECUTE') AS anon_can_execute,
--        has_function_privilege('authenticated', 'public.update_enquiry_status(text, uuid, text, text)', 'EXECUTE') AS authenticated_can_execute;
--
-- 3. Verify active RLS policies
-- SELECT tablename, policyname, roles, cmd FROM pg_policies WHERE tablename IN ('volunteer_applications', 'partner_enquiries', 'enquiry_actions') ORDER BY tablename, cmd;
--
-- 4. Verify table-level permissions
-- SELECT has_table_privilege('anon', 'public.volunteer_applications', 'SELECT') AS anon_can_select,
--        has_table_privilege('anon', 'public.volunteer_applications', 'INSERT') AS anon_can_insert,
--        has_table_privilege('authenticated', 'public.volunteer_applications', 'UPDATE') AS auth_can_update,
--        has_table_privilege('authenticated', 'public.enquiry_actions', 'INSERT') AS auth_can_insert_audit;
