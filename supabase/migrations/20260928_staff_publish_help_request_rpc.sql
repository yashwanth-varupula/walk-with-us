-- =============================================================================
-- Walk With Us — staff publish help request RPC
-- =============================================================================
-- STATUS: NOT APPLIED. This file is the reviewed, ready-to-apply change.
--        It has NOT been run against any database. Nothing here was executed
--        by the assistant. Apply it manually in the Supabase SQL Editor.
--
-- WHAT THIS IMPLEMENTS
-- -------------------
-- A verified help request can be published to the public help page by staff/admin.
-- Allowed transition: verified -> published.
--
-- Design contract:
--   * SECURITY DEFINER   - the role check is done in SQL via public.get_my_role()
--                          and never trusted from the client.
--   * Single transaction - the UPDATE on help_requests and the INSERT into
--                          admin_actions commit together. Any failure rolls back both.
--   * admin_id           - always auth.uid(). The browser cannot supply it.
--   * request_id         - always the id of the row actually locked FOR UPDATE.
--   * Row lock           - SELECT ... FOR UPDATE serializes concurrent publish calls.
--   * published_at       - set to now(), server-side.
--   * updated_at         - set to now(), server-side.
--   * Closed allowlist   - only status = 'verified' can be transitioned to 'published'.
--   * Transactional      - BEGIN/COMMIT wrap the whole file, so a failure at any
--                         point leaves nothing half-applied.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TRANSACTION BOUNDARY
-- -----------------------------------------------------------------------------
-- The pre-flight assertion, the CREATE OR REPLACE FUNCTION, the EXECUTE grants
-- and the COMMENT ON all run as ONE transaction. If any of them raises, the
-- file rolls back whole and no orphaned publish_help_request() is left behind
-- for the frontend to call into a half-built state.
--
-- Every statement here is transaction-compatible: DO/RAISE, CREATE OR REPLACE
-- FUNCTION, COMMENT ON, GRANT and REVOKE are all transactional in PostgreSQL.
-- There is no CREATE INDEX CONCURRENTLY, no ALTER TYPE ... ADD VALUE and no
-- VACUUM in this file, none of which could be wrapped.
--
-- Execution order is unchanged. The commented rollback sits after the COMMIT so
-- it stays readable and separately runnable.
-- -----------------------------------------------------------------------------
begin;


-- -----------------------------------------------------------------------------
-- PRE-FLIGHT ASSERTIONS
-- -----------------------------------------------------------------------------
do $$
begin
  -- (1) The role oracle public.get_my_role() must exist.
  if not exists (
    select 1
      from pg_proc p
     where p.proname     = 'get_my_role'
       and p.pronamespace = 'public'::regnamespace
       and p.pronargs     = 0
  ) then
    raise exception
      'ABORT: public.get_my_role() not found (or takes arguments). publish_help_request depends on it for the role check.';
  end if;

  -- (2) 'published' and 'verified' must exist in public.request_status enum.
  if exists (
    select 1
      from unnest(array['verified', 'published']::text[]) as want(label)
     where not exists (
       select 1
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
        where t.typname      = 'request_status'
          and t.typnamespace = 'public'::regnamespace
          and e.enumlabel    = want.label
     )
  ) then
    raise exception
      'ABORT: public.request_status is missing verified or published.';
  end if;

  -- (3) admin_actions table must exist with required columns.
  if not exists (
    select 1
      from information_schema.tables
     where table_schema = 'public'
       and table_name   = 'admin_actions'
  ) then
    raise exception
      'ABORT: public.admin_actions table does not exist.';
  end if;

  -- (4) help_requests must have published_at column.
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'help_requests'
       and column_name  = 'published_at'
  ) then
    raise exception
      'ABORT: public.help_requests is missing published_at column.';
  end if;
end
$$;


-- =============================================================================
-- public.publish_help_request — staff verified -> published
-- =============================================================================
create or replace function public.publish_help_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor       uuid                    := auth.uid();
  v_role        public.user_role;
  v_locked_id   uuid;
  v_status      public.request_status;
begin
  -- (1) Authenticated caller. Fail closed on anonymous / null JWT.
  if v_actor is null then
    raise exception 'Authentication required.'
      using errcode = '28000';
  end if;

  if p_request_id is null then
    raise exception 'A request id is required.'
      using errcode = '22023';
  end if;

  -- (2) Authorisation: server-side role check via get_my_role().
  v_role := public.get_my_role();
  if v_role is null or v_role not in ('staff'::public.user_role, 'admin'::public.user_role) then
    raise exception 'Insufficient permissions: staff or admin role required.'
      using errcode = '42501';
  end if;

  -- (3) Lock the row FOR UPDATE to prevent race conditions.
  select hr.id, hr.status
    into v_locked_id, v_status
    from public.help_requests hr
   where hr.id = p_request_id
     for update;

  if not found then
    raise exception 'This request could not be found.'
      using errcode = 'P0002';
  end if;

  -- (4) Only verified requests can be published.
  if v_status is distinct from 'verified'::public.request_status then
    raise exception 'This request cannot be published because its current status is "%" (expected "verified").', v_status
      using errcode = '22023';
  end if;

  -- (5) The atomic state change.
  update public.help_requests
     set status       = 'published'::public.request_status,
         published_at = now(),
         updated_at   = now()
   where id = v_locked_id;

  if not found then
    raise exception 'This request disappeared before it could be published.'
      using errcode = 'P0002';
  end if;

  -- (6) The audit row in admin_actions inside the same transaction.
  insert into public.admin_actions
    (admin_id, action, request_id, notes, old_status, new_status)
  values
    (
      v_actor,
      'request_published',
      v_locked_id,
      'verified -> published (publish_help_request)',
      'verified'::public.request_status,
      'published'::public.request_status
    );

  -- (7) Return confirmation payload.
  return jsonb_build_object(
    'id',              v_locked_id,
    'status',          'published'::public.request_status,
    'previous_status', 'verified'::public.request_status
  );
end;
$$;

-- =============================================================================
-- EXECUTE GRANTS
-- =============================================================================
revoke all on function public.publish_help_request(uuid) from public;
grant execute on function public.publish_help_request(uuid) to authenticated;

comment on function public.publish_help_request(uuid) is
  'Atomically moves a verified help request to published and writes the matching admin_actions row. Enforces staff/admin role via get_my_role(). Serializes via SELECT ... FOR UPDATE. Raises 28000 when unauthenticated, 42501 when not staff/admin, P0002 when not found, and 22023 when not verified.';

commit;


-- =============================================================================
-- ROLLBACK
-- =============================================================================
-- revoke all on function public.publish_help_request(uuid) from authenticated;
-- drop function if exists public.publish_help_request(uuid);
