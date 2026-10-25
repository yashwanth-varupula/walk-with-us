-- =============================================================================
-- MIGRATION: 20261108_production_auth_and_rbac_hardening.sql
-- DESCRIPTION: Complete Production-Grade Auth, RBAC, Admin Bootstrap & Profile Security
-- =============================================================================
--
-- PURPOSE:
--   1. Harden public.get_my_role() so deactivated accounts (is_active = false)
--      fail closed (returning NULL) and are denied privileged operations.
--   2. Harden protect_profile_fields() trigger:
--      - Guards user ID and created_at immutability.
--      - Forbids ANY direct client modification of `role` and `is_active`.
--      - Only allows role/active status updates through controlled procedures
--        setting transaction-scoped config 'app.allow_role_change'.
--   3. Add public.bootstrap_initial_admin(p_user_id uuid) procedure:
--      - Safe, idempotent initial system administrator bootstrap.
--      - Callable only when no active administrator exists in the database.
--      - Validates target auth.users existence and writes to admin_actions.
--   4. Add public.set_user_role(p_target_user_id, p_new_role, p_notes) procedure:
--      - Administrator-only role modification with audit logging in admin_actions.
--      - Lockout protection: prevents deleting or demoting the last active admin.
--   5. Add public.set_user_active_status(p_target_user_id, p_new_is_active, p_notes):
--      - Administrator-only account deactivation/reactivation.
--      - Prevents deactivating the last active administrator.
--   6. Add staff donation visibility policy (donations_select_staff) and index
--      optimizations on public.donations.
--   7. Strictly configure EXECUTE permissions on security functions.
-- =============================================================================

BEGIN;

-- 1. Hardened get_my_role() to verify active status
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT role
  FROM public.profiles
  WHERE id = auth.uid()
    AND is_active = true;
$function$;

-- 2. Hardened protect_profile_fields() trigger
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Prevent modifying primary key
  IF new.id IS DISTINCT FROM old.id THEN
    RAISE EXCEPTION 'Profile ID cannot be modified.';
  END IF;

  -- Maintain immutable created_at
  IF new.created_at IS DISTINCT FROM old.created_at THEN
    new.created_at := old.created_at;
  END IF;

  -- Guard role changes
  IF new.role IS DISTINCT FROM old.role THEN
    IF current_setting('app.allow_role_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Direct modification of user role is forbidden. Use public.set_user_role().';
    END IF;
  END IF;

  -- Guard is_active changes
  IF new.is_active IS DISTINCT FROM old.is_active THEN
    IF current_setting('app.allow_role_change', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'Direct modification of account active status is forbidden.';
    END IF;
  END IF;

  RETURN new;
END;
$function$;

-- Ensure trigger is attached
DROP TRIGGER IF EXISTS protect_profile_fields_trigger ON public.profiles;
CREATE TRIGGER protect_profile_fields_trigger
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_fields();

-- 3. Initial Admin Bootstrap procedure
CREATE OR REPLACE FUNCTION public.bootstrap_initial_admin(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_admin_count integer;
  v_target_profile public.profiles%ROWTYPE;
BEGIN
  -- Count existing active admins
  SELECT count(*) INTO v_admin_count
  FROM public.profiles
  WHERE role = 'admin'::user_role AND is_active = true;

  IF v_admin_count > 0 THEN
    -- Check if target user is already one of the active admins (idempotent)
    SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_user_id;
    IF FOUND AND v_target_profile.role = 'admin'::user_role AND v_target_profile.is_active = true THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'User is already an active administrator.',
        'user_id', p_user_id
      );
    END IF;

    RAISE EXCEPTION 'Bootstrap denied: System already has an active administrator. Existing administrators must use set_user_role().';
  END IF;

  -- Verify target user exists in auth.users
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Target user UUID % does not exist in auth.users.', p_user_id;
  END IF;

  -- Find or insert profile
  SELECT * INTO v_target_profile FROM public.profiles WHERE id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, full_name, role, is_active)
    SELECT
      id,
      coalesce(raw_user_meta_data->>'full_name', 'Walk With Us Administrator'),
      'admin'::user_role,
      true
    FROM auth.users
    WHERE id = p_user_id
    RETURNING * INTO v_target_profile;
  ELSE
    PERFORM set_config('app.allow_role_change', 'true', true);
    UPDATE public.profiles
    SET role = 'admin'::user_role, is_active = true, updated_at = now()
    WHERE id = p_user_id;
  END IF;

  -- Record in audit log
  INSERT INTO public.admin_actions (
    admin_id,
    action,
    notes
  ) VALUES (
    p_user_id,
    'bootstrap_initial_admin',
    format('Initial system administrator bootstrapped for user UUID: %s', p_user_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Initial administrator successfully bootstrapped.',
    'user_id', p_user_id,
    'role', 'admin'
  );
END;
$function$;

-- 4. Secure role assignment RPC for admins
CREATE OR REPLACE FUNCTION public.set_user_role(
  p_target_user_id uuid,
  p_new_role user_role,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_caller_role user_role;
  v_old_role user_role;
  v_admin_count integer;
  v_target_profile public.profiles%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_caller_role := public.get_my_role();
  IF v_caller_role IS DISTINCT FROM 'admin'::user_role THEN
    RAISE EXCEPTION 'Forbidden: Only administrators can assign user roles.';
  END IF;

  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found: %', p_target_user_id;
  END IF;

  v_old_role := v_target_profile.role;

  -- Idempotent check
  IF v_old_role = p_new_role THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'User already holds the requested role.',
      'user_id', p_target_user_id,
      'role', p_new_role
    );
  END IF;

  -- Lockout guard: cannot remove the last active admin
  IF v_old_role = 'admin'::user_role AND p_new_role != 'admin'::user_role THEN
    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role = 'admin'::user_role AND is_active = true AND id != p_target_user_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Operation aborted: Cannot remove or demote the last remaining active administrator.';
    END IF;
  END IF;

  -- Execute update
  PERFORM set_config('app.allow_role_change', 'true', true);
  UPDATE public.profiles
  SET role = p_new_role, updated_at = now()
  WHERE id = p_target_user_id;

  -- Record audit log
  INSERT INTO public.admin_actions (
    admin_id,
    action,
    notes
  ) VALUES (
    v_caller_id,
    'set_user_role',
    format('Role changed for user %s from %s to %s. Reason: %s',
      p_target_user_id, v_old_role, p_new_role, coalesce(p_notes, 'None provided'))
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'User role updated successfully.',
    'user_id', p_target_user_id,
    'old_role', v_old_role,
    'new_role', p_new_role
  );
END;
$function$;

-- 5. Secure active status modification RPC for admins
CREATE OR REPLACE FUNCTION public.set_user_active_status(
  p_target_user_id uuid,
  p_new_is_active boolean,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id uuid;
  v_caller_role user_role;
  v_old_is_active boolean;
  v_admin_count integer;
  v_target_profile public.profiles%ROWTYPE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  v_caller_role := public.get_my_role();
  IF v_caller_role IS DISTINCT FROM 'admin'::user_role THEN
    RAISE EXCEPTION 'Forbidden: Only administrators can modify account active status.';
  END IF;

  SELECT * INTO v_target_profile
  FROM public.profiles
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found: %', p_target_user_id;
  END IF;

  v_old_is_active := v_target_profile.is_active;

  -- Idempotent check
  IF v_old_is_active = p_new_is_active THEN
    RETURN jsonb_build_object(
      'success', true,
      'message', 'User active status is already set to the requested value.',
      'user_id', p_target_user_id,
      'is_active', p_new_is_active
    );
  END IF;

  -- Lockout guard
  IF NOT p_new_is_active AND v_target_profile.role = 'admin'::user_role THEN
    SELECT count(*) INTO v_admin_count
    FROM public.profiles
    WHERE role = 'admin'::user_role AND is_active = true AND id != p_target_user_id;

    IF v_admin_count = 0 THEN
      RAISE EXCEPTION 'Operation aborted: Cannot deactivate the last remaining active administrator.';
    END IF;
  END IF;

  -- Execute update
  PERFORM set_config('app.allow_role_change', 'true', true);
  UPDATE public.profiles
  SET is_active = p_new_is_active, updated_at = now()
  WHERE id = p_target_user_id;

  -- Record audit log
  INSERT INTO public.admin_actions (
    admin_id,
    action,
    notes
  ) VALUES (
    v_caller_id,
    'set_user_active_status',
    format('Active status changed for user %s from %s to %s. Reason: %s',
      p_target_user_id, v_old_is_active, p_new_is_active, coalesce(p_notes, 'None provided'))
  );

  RETURN jsonb_build_object(
    'success', true,
    'message', 'User active status updated.',
    'user_id', p_target_user_id,
    'is_active', p_new_is_active
  );
END;
$function$;

-- 6. Apply staff donations visibility & performance indices
CREATE INDEX IF NOT EXISTS donations_user_created_at_idx
  ON public.donations (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS donations_user_status_idx
  ON public.donations (user_id, status)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS donations_paid_at_idx
  ON public.donations (paid_at DESC)
  WHERE paid_at IS NOT NULL;

DROP POLICY IF EXISTS donations_select_staff ON public.donations;
CREATE POLICY donations_select_staff
  ON public.donations
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(public.get_my_role() IN ('staff', 'admin'), false)
  );

-- 7. Secure execution grants
REVOKE EXECUTE ON FUNCTION public.bootstrap_initial_admin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_initial_admin(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_user_role(uuid, user_role, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, user_role, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_user_active_status(uuid, boolean, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_user_active_status(uuid, boolean, text) TO authenticated;

COMMIT;
