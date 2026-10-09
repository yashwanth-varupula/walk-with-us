-- =============================================================================
-- Walk With Us — secure help request transitions
-- =============================================================================
-- STATUS: NOT APPLIED. This file is the reviewed, ready-to-apply change.
--        It has NOT been run against any database. Nothing here was executed
--        by the assistant. Apply it yourself in the Supabase SQL Editor.
--
-- WHAT THIS CLOSES
-- ----------------
-- `authenticated` currently holds TABLE-level UPDATE on public.help_requests.
-- Column grants are the only thing stopping a requester from writing
--   status, requester_id, reviewed_by, verification_notes, verified_at,
--   rejection_reason, submitted_at, raised_amount, published_at
-- with a plain REST PATCH. RLS does not close this: the requester UPDATE policy
-- pins status = 'draft', which blocks a *status* write, but it does not block
-- writes to reviewed_by / verification_notes / verified_at / rejection_reason,
-- because those columns are not mentioned in either USING or WITH CHECK.
-- Staff could equally self-approve by writing verified + verification_notes in
-- one PATCH with no admin_actions row at all.
--
-- The fix has two halves that must land together:
--   1. Column-level privilege hardening, so the browser can only ever write the
--      seven requester-editable draft columns.
--   2. Two SECURITY DEFINER RPCs that own every lifecycle transition, so each
--      status change and its admin_actions audit row commit in ONE transaction.
--
-- Design contract:
--   * SECURITY DEFINER   - the caller cannot satisfy help_requests / admin_actions
--                          RLS by itself, so the role check is done in SQL and
--                          never trusted from the client.
--   * Single transaction - the UPDATE and the INSERT are one unit. Any RAISE
--                          rolls back BOTH. There is no EXCEPTION handler in
--                          either function, precisely so a partial success is
--                          not possible.
--   * admin_id           - always auth.uid(). The browser can never supply it.
--   * request_id         - always the id of the row actually locked. The
--                          client-supplied id is only a lookup key.
--   * No EXCEPTION blocks, no service_role, no new columns, no policy dropped or
--     weakened, no NOT NULL touched, no data changed.
--
-- Depends on: public.get_my_role(), the updated_at BEFORE UPDATE trigger, and
-- admin_actions.admin_id / action being NOT NULL with nullable old_status /
-- new_status typed as public.request_status. All asserted below.
-- =============================================================================


-- =============================================================================
-- TRANSACTION BOUNDARY
-- =============================================================================
-- The two halves of this change -- the column privilege hardening and the two
-- SECURITY DEFINER RPCs -- MUST land together. Wrapping the whole file in one
-- transaction makes that structural rather than a matter of remembering: if
-- the pre-flight assertion fails, if a CREATE OR REPLACE FUNCTION errors, or if
-- the column GRANT names a column that does not exist, the file rolls back
-- whole and the database is never left holding the new RPCs with the old
-- table-level UPDATE still in place (or the reverse).
--
-- Every statement in this file is transaction-compatible. DO/RAISE,
-- CREATE OR REPLACE FUNCTION, COMMENT ON, GRANT and REVOKE are all
-- transactional in PostgreSQL, and the whole file is plpgsql only. There is no
-- CREATE INDEX CONCURRENTLY, no ALTER TYPE ... ADD VALUE and no VACUUM here,
-- none of which could be wrapped in a transaction.
--
-- Execution order is unchanged: pre-flight assertions, submit_help_request(),
-- transition_help_request(), EXECUTE grants, then the privilege hardening
-- below. The post-apply verification queries, the functional checks and the
-- commented rollback all sit AFTER the COMMIT so they remain readable and
-- separately runnable.
--
-- NOTE: this transaction is about ATOMIC APPLICATION of the migration. It is
-- unrelated to the single-transaction guarantee inside each function body,
-- which comes from the deliberate absence of any EXCEPTION handler there.
-- =============================================================================
begin;


-- -----------------------------------------------------------------------------
-- PRE-FLIGHT ASSERTIONS
-- Deliberately fail loudly rather than install a function that cannot work, or
-- a GRANT that references a column that does not exist.
-- -----------------------------------------------------------------------------
do $$
declare
  v_missing_cols text;
begin
  -- (1) The role oracle both functions depend on.
  if not exists (
    select 1
      from pg_proc p
     where p.proname     = 'get_my_role'
       and p.pronamespace = 'public'::regnamespace
       and p.pronargs     = 0
  ) then
    raise exception
      'ABORT: public.get_my_role() not found (or takes arguments). Both functions below depend on it for the role check.';
  end if;

  -- (2) Every status literal this migration hard-codes must exist in the enum.
  if exists (
    select 1
      from unnest(array['draft','submitted','under_review','verified','rejected']::text[]) as want(label)
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
      'ABORT: public.request_status is missing one of draft, submitted, under_review, verified, rejected. The transition allowlist cannot be installed.';
  end if;

  -- (3) admin_actions must be able to carry these audit rows.
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'admin_actions'
       and column_name in ('admin_id', 'action')
       and is_nullable  = 'YES'
  ) then
    raise exception
      'ABORT: admin_actions.admin_id and admin_actions.action must both be NOT NULL. Review the audit contract before applying.';
  end if;

  if exists (
    select 1
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.table_name   = 'admin_actions'
       and c.column_name in ('old_status', 'new_status')
       and (c.udt_name <> 'request_status' or c.is_nullable = 'NO')
  ) then
    raise exception
      'ABORT: admin_actions.old_status / new_status must be NULLABLE and typed public.request_status. Both functions below write draft->submitted, submitted->under_review and under_review->verified / rejected into them.';
  end if;

  -- (4) The requester INSERT policy (untouched by this migration) requires
  --     status = 'draft'. The frontend now omits `status` from the INSERT
  --     payload and relies on the column default, so that default MUST exist
  --     or every draft insert would fail WITH CHECK.
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'help_requests'
       and column_name  = 'status'
       and column_default is not null
       and column_default ilike '%draft%'
  ) then
    raise exception
      'ABORT: help_requests.status has no DEFAULT of ''draft''. The requester INSERT payload no longer sends status, so inserts would fail the INSERT policy WITH CHECK.';
  end if;

  -- (5) Every column named in the column-scoped GRANT below must exist, or the
  --     GRANT itself errors with a far less obvious message.
  select string_agg(want.column_name, ', ' order by want.column_name)
    into v_missing_cols
    from unnest(array['title','description','category_id','urgency',
                      'target_amount','location_city','location_state']::text[]) as want(column_name)
   where not exists (
     select 1
       from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'help_requests'
        and column_name  = want.column_name
   );

  if v_missing_cols is not null then
    raise exception
      'ABORT: help_requests is missing column(s) % that this migration grants UPDATE on. Nothing was changed.', v_missing_cols;
  end if;

  -- (6) SECURITY DEFINER means these functions execute as their owner. If the
  --     role that runs this script cannot write both tables, every call will
  --     fail at runtime with an opaque permission error.
  if not has_table_privilege(current_user, 'public.help_requests', 'UPDATE')
     or not has_table_privilege(current_user, 'public.admin_actions', 'INSERT') then
    raise exception
      'ABORT: the role running this script (%, %) must hold UPDATE on help_requests and INSERT on admin_actions, because the SECURITY DEFINER functions execute as their owner. Re-run as the table owner (usually postgres).', current_user, session_user;
  end if;
end
$$;


-- =============================================================================
-- public.submit_help_request — requester draft -> submitted
-- =============================================================================
-- Replaces the direct `update({ status: 'submitted' })` REST PATCH. Two things
-- were wrong with that write:
--   * it produced NO admin_actions row, so the submission left no audit trail;
--   * it depended entirely on a permissive RLS policy, which is a much weaker
--     control than a function that can only ever perform one transition.
--
-- There is deliberately no EXCEPTION handler: if the audit insert fails, the
-- RAISE it produces aborts the enclosing transaction and takes the status
-- change with it. A submission is never recorded without its audit row.
-- =============================================================================
create or replace function public.submit_help_request(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor       uuid                    := auth.uid();
  v_locked_id   uuid;
  v_requester   uuid;
  v_status      public.request_status;
begin
  -- (1) Authenticated caller. Fail closed, including an anonymous / null JWT.
  if v_actor is null then
    raise exception 'You must be signed in to submit a request.'
      using errcode = '28000';
  end if;

  if p_request_id is null then
    raise exception 'A request id is required.'
      using errcode = '22023';
  end if;

  -- (2) Lock the row first, then decide. SELECT ... FOR UPDATE serialises
  --     concurrent submissions (two tabs, a double click, a retry): the second
  --     transaction blocks here, then re-reads the status the first one wrote
  --     and fails the draft check below instead of double-submitting.
  select hr.id, hr.requester_id, hr.status
    into v_locked_id, v_requester, v_status
    from public.help_requests hr
   where hr.id = p_request_id
     for update;

  -- (3) Existence is checked explicitly rather than inferred from an
  --     affected-row count, because SECURITY DEFINER bypasses RLS.
  if not found then
    raise exception 'This request could not be found.'
      using errcode = 'P0002';
  end if;

  -- (4) Ownership. Reported as "not authorised" rather than "not found" only
  --     because the id was resolved from the table; the requester cannot learn
  --     anything from this they could not already learn from their own row list.
  if v_requester is distinct from v_actor then
    raise exception 'You can only submit your own requests.'
      using errcode = '42501';
  end if;

  -- (5) The ONLY transition this function can perform.
  if v_status is distinct from 'draft'::public.request_status then
    raise exception 'This request is no longer a draft (current status: %).', v_status
      using errcode = '22023';
  end if;

  -- (6) The change. updated_at is set explicitly as well as by the existing
  --     BEFORE UPDATE trigger: the trigger is a database default, this is a
  --     property of this specific write, and a missing trigger must not
  --     silently produce a stale updated_at.
  update public.help_requests
     set status       = 'submitted'::public.request_status,
         submitted_at = now(),
         updated_at   = now()
   where id = v_locked_id;

  if not found then
    -- Defensive: the locked SELECT succeeded in this same transaction, so this
    -- cannot normally fire. Kept so a silent no-op is never audit-logged as a
    -- success.
    raise exception 'This request disappeared before it could be submitted.'
      using errcode = 'P0002';
  end if;

  -- (7) The audit row, written in the same transaction. admin_id is auth.uid();
  --     there is no parameter through which a client could supply an identity.
  --     old_status / new_status are the values observed under the row lock, not
  --     literals, so the trail cannot disagree with what was actually changed.
  insert into public.admin_actions
    (admin_id, action, request_id, notes, old_status, new_status)
  values
    (
      v_actor,
      'request_submitted',
      v_locked_id,
      'draft -> submitted (submit_help_request)',
      v_status,
      'submitted'::public.request_status
    );

  -- (8) Both writes commit together. The return value carries the id and the
  --     new status only: no requester id, no title, no contact detail. The
  --     caller already knows which request it asked about.
  return jsonb_build_object(
    'id',     v_locked_id,
    'status', 'submitted'::public.request_status
  );
end;
$$;

comment on function public.submit_help_request(uuid) is
  'Atomically moves an owned help request from draft to submitted and writes the matching admin_actions row. The actor is always auth.uid() and the audited request_id is always the locked row. Raises (rolling back the status change) with 28000 when unauthenticated, 42501 when the caller is not the owner, P0002 when the request does not exist, and 22023 when the request is not a draft. Returns only the request id and its new status.';


-- =============================================================================
-- public.transition_help_request — staff review lifecycle
-- =============================================================================
-- Replaces the client-side applyStaffTransition(), which could not be atomic:
-- it inserted the admin_actions row from the browser in one HTTP request and
-- updated help_requests in a second, so a failure between the two left an
-- audit row claiming a decision that never took effect (and, in the other
-- direction, a status change with no audit row at all if the update raced).
--
-- Three properties are enforced in SQL rather than in TypeScript:
--   * a closed allowlist of exactly three transitions, so there is no generic
--     "set this request to any status" path reachable from the browser;
--   * an expected-status precondition evaluated under a row lock, so a stale
--     tab or a second reviewer is rejected instead of overwriting a decision;
--   * exactly one audit row per successful transition, in the same transaction.
-- =============================================================================
create or replace function public.transition_help_request(
  p_request_id      uuid,
  p_new_status      public.request_status,
  p_expected_status public.request_status,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor     uuid                    := auth.uid();
  v_role      public.user_role;
  v_locked_id uuid;
  v_status    public.request_status;
  v_notes     text;
  v_action    text;
  v_max_notes constant integer        := 2000;
begin
  -- (1) Authenticated caller.
  if v_actor is null then
    raise exception 'You must be signed in to review requests.'
      using errcode = '28000';
  end if;

  -- (2) Authorisation, from the server's own view of the caller's role. A role
  --     supplied by the browser is never read.
  v_role := public.get_my_role();
  if v_role is null or v_role not in ('staff'::public.user_role, 'admin'::public.user_role) then
    raise exception 'Insufficient permissions: staff or admin role required.'
      using errcode = '42501';
  end if;

  if p_request_id is null or p_new_status is null or p_expected_status is null then
    raise exception 'A request id, a new status and an expected status are all required.'
      using errcode = '22023';
  end if;

  -- (3) THE ALLOWLIST. Closed, and checked on the (expected -> new) pair, not
  --     on the new status alone. A requester cannot reach published / active /
  --     resolved / closed / draft through this function, and a reviewer cannot
  --     skip review or undo a decision.
  if not (
       (p_expected_status = 'submitted'::public.request_status  and p_new_status = 'under_review'::public.request_status)
    or (p_expected_status = 'under_review'::public.request_status and p_new_status = 'verified'::public.request_status)
    or (p_expected_status = 'under_review'::public.request_status and p_new_status = 'rejected'::public.request_status)
  ) then
    raise exception 'Transition % -> % is not permitted.', p_expected_status, p_new_status
      using errcode = '22023';
  end if;

  -- (4) Notes validation, before the row is touched.
  if length(coalesce(p_notes, '')) > v_max_notes then
    raise exception 'Notes must be % characters or fewer.', v_max_notes
      using errcode = '22023';
  end if;

  -- Normalised once, and reused for both the request row and the audit row so
  -- the two can never disagree about what was recorded.
  v_notes := nullif(btrim(p_notes), '');

  -- A decision must be justified. Whitespace-only notes are treated as absent.
  if p_new_status in ('verified'::public.request_status, 'rejected'::public.request_status)
     and v_notes is null then
    raise exception 'Notes are required to record a verification or rejection decision.'
      using errcode = '22023';
  end if;

  -- (5) Lock, then verify the precondition against the locked row. This is the
  --     concurrency control: the comparison happens after FOR UPDATE, so it
  --     sees the committed state and not the state the browser last rendered.
  select hr.id, hr.status
    into v_locked_id, v_status
    from public.help_requests hr
   where hr.id = p_request_id
     for update;

  if not found then
    raise exception 'This request could not be found.'
      using errcode = 'P0002';
  end if;

  if v_status is distinct from p_expected_status then
    raise exception 'This request is no longer in the expected state (expected %, found %).', p_expected_status, v_status
      using errcode = '22023';
  end if;

  -- (6) The audit vocabulary, derived from the requested status. It cannot be
  --     supplied by the caller.
  v_action := case p_new_status
    when 'under_review'::public.request_status then 'review_started'
    when 'verified'::public.request_status     then 'request_verified'
    when 'rejected'::public.request_status     then 'request_rejected'
  end;

  -- (7) The change. Branch-per-column rather than a blanket COALESCE so that
  --     the fields that must stay untouched are provably not part of the write:
  --       verified -> verification_notes = notes, verified_at = now(),
  --                   rejection_reason untouched
  --       rejected -> rejection_reason   = notes,
  --                   verification_notes and verified_at untouched
  --       under_review -> no verification or rejection field is mentioned
  --     reviewed_by and updated_at are set for every transition. verified_at is
  --     now() here, never a client-supplied timestamp, so the recorded moment
  --     is the database's, not the browser's.
  update public.help_requests
     set status              = p_new_status,
         reviewed_by          = v_actor,
         verification_notes   = case when p_new_status = 'verified'::public.request_status then v_notes else verification_notes end,
         verified_at          = case when p_new_status = 'verified'::public.request_status then now()     else verified_at     end,
         rejection_reason     = case when p_new_status = 'rejected'::public.request_status then v_notes else rejection_reason end,
         updated_at           = now()
   where id = v_locked_id;

  if not found then
    raise exception 'This request disappeared before the transition could be applied.'
      using errcode = 'P0002';
  end if;

  -- (8) Exactly one audit row, in the same transaction as the update above.
  --     old_status is the status read under the lock, not the value the client
  --     claimed. Any failure here raises and rolls back the status change; there
  --     is no EXCEPTION handler that could let the update survive alone.
  insert into public.admin_actions
    (admin_id, action, request_id, notes, old_status, new_status)
  values
    (
      v_actor,
      v_action,
      v_locked_id,
      v_notes,
      v_status,
      p_new_status
    );

  -- (9) The committed state, for the caller to re-read. The review screen must
  --     refetch the row rather than trust this or patch its own state, because
  --     reviewed_by / verified_at are set here and not by the caller.
  return jsonb_build_object(
    'id',              v_locked_id,
    'status',          p_new_status,
    'previous_status', v_status
  );
end;
$$;

comment on function public.transition_help_request(uuid, public.request_status, public.request_status, text) is
  'Atomically applies one of exactly three staff transitions (submitted->under_review, under_review->verified, under_review->rejected) and writes the single matching admin_actions row. admin_id is always auth.uid(); the audited request_id and old_status come from the locked row. Raises, rolling back the status change, with 28000 when unauthenticated, 42501 when not staff/admin, P0002 when the request does not exist, and 22023 for a transition outside the allowlist, a stale expected status, missing notes for a decision, or notes over 2000 characters. Returns the request id, the new status and the previous status.';


-- =============================================================================
-- EXECUTE grants
-- =============================================================================
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. For a SECURITY
-- DEFINER function that would put the body within reach of anonymous callers.
-- The internal checks still deny them, but revoking keeps the surface minimal
-- and is the correct default. Note the argument list is the FULL list, with no
-- defaults: `p_notes text default null` still means (uuid, enum, enum, text).
revoke all on function public.submit_help_request(uuid) from public;

revoke all on function public.transition_help_request(uuid, public.request_status, public.request_status, text) from public;

-- authenticated sessions only. requester ownership (submit) and the staff/admin
-- role (transition) are enforced inside the function bodies.
grant execute on function public.submit_help_request(uuid) to authenticated;

grant execute on function public.transition_help_request(uuid, public.request_status, public.request_status, text) to authenticated;


-- =============================================================================
-- PRIVILEGE HARDENING
-- =============================================================================
-- WHY THE TABLE-LEVEL GRANT IS THE ACTUAL VULNERABILITY
-- ---------------------------------------------------
-- RLS decides WHICH ROWS a role may touch. It does not decide WHICH COLUMNS.
-- Because `authenticated` had table-level UPDATE, the existing requester policy
--
--   USING      (requester_id = auth.uid() AND status = 'draft')
--   WITH CHECK (requester_id = auth.uid() AND status = 'draft')
--
-- permitted a PATCH on your own draft that also set reviewed_by,
-- verification_notes, verified_at or rejection_reason: none of those columns
-- appear in USING or WITH CHECK, so the policy evaluated them as irrelevant.
-- The staff policy was worse — its WITH CHECK only tests the caller's role, so
-- a reviewer could write status = 'verified' with no admin_actions row. The
-- allowlist now lives in transition_help_request(), but column privilege is the
-- layer that makes a direct write impossible rather than merely discouraged.
--
-- WHAT IS REVOKED
-- ---------------
-- The whole-table UPDATE grant is removed, which withdraws UPDATE on every
-- column at once. Only these seven are then granted back, and they are exactly
-- the fields a requester may edit on their own draft:
--
--   title, description, category_id, urgency, target_amount,
--   location_city, location_state
--
-- These are explicitly NOT granted, so no direct PATCH can ever write them:
--   id, requester_id, status, submitted_at, reviewed_by, verification_notes,
--   verified_at, rejection_reason, raised_amount, published_at, created_at,
--   updated_at
--
-- updated_at needs no grant: the existing BEFORE UPDATE trigger maintains it.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- * RLS. No policy is dropped, recreated or weakened. "Requesters can update
--   own draft requests" still restricts the seven columns to your own draft.
-- * INSERT / SELECT / DELETE. Left exactly as they are.
-- * The lifecycle. draft -> submitted is now submit_help_request(); the
--   reviewer transitions are now transition_help_request(). Both are
--   SECURITY DEFINER, so they are unaffected by this column restriction.
--
-- A NOTE ON THE SUBMIT POLICY
-- ---------------------------
-- "Requesters can submit own draft requests" (added by 20260101) is LEFT IN
-- PLACE. After the column restriction above it is inert: a PATCH naming `status`
-- is refused by the column privilege check before RLS is ever consulted, so
-- the policy can no longer be used and weakening it is not necessary. Removing
-- it is optional tidying, not a security control, so it is left commented out
-- below rather than run here.
--
-- A NOTE ON THE STAFF POLICY
-- --------------------------
-- "Staff can update requests" remains, and with the column grant above a staff
-- member can still edit the seven content columns on any request they can see.
-- That is the cost of a per-role column grant: PostgreSQL cannot scope a column
-- privilege to one RLS policy. Flagged, not fixed, because narrowing it needs
-- either separate roles or a content-editing RPC, which is outside this change.
-- =============================================================================
revoke update on public.help_requests from authenticated;

grant update (
  title,
  description,
  category_id,
  urgency,
  target_amount,
  location_city,
  location_state
) on public.help_requests to authenticated;

commit;


-- Optional tidying, only if the policy from 20260101 is present. Not required
-- for the restriction above to hold.
-- drop policy if exists "Requesters can submit own draft requests"
--   on public.help_requests;


-- =============================================================================
-- POST-APPLY VERIFICATION
-- =============================================================================

-- 1. The column grant. Expect exactly the seven granted columns and nothing
--    else. Any extra row here is a direct-write path that should not exist.
--
--    ARITY NOTE -- this query previously raised 42P01 on apply. It called the
--    THREE-argument form:
--
--      has_column_privilege('authenticated', 'public.help_requests.' || a.attname, 'UPDATE')
--
--    PostgreSQL's has_column_privilege has NO three-argument overload that
--    accepts a user. The 3-arg form is (table, column, privilege); only the
--    4-arg form is (user, table, column, privilege). So the parser read
--    'authenticated' as a TABLE name, ran a relation lookup for "authenticated",
--    found nothing, and raised:
--
--      ERROR: relation "authenticated" does not exist
--      SQLSTATE 42P01
--
--    This is a trap specific to the *_privilege family: has_table_privilege
--    DOES have a 3-arg (user, table, privilege) form, which is why checks 2 and 3
--    below were always correct, while the identically shaped 3-arg call on
--    has_column_privilege was not. The two functions do not share an arity
--    convention.
--
--    Corrected below to the documented 4-argument form, passing the table name
--    and the column name as SEPARATE arguments instead of concatenating them
--    into one string. Intent and result set are unchanged: still one row per
--    column, still exactly seven of them with can_update = true. The cast to
--    ::text is explicit so argument resolution against the (text, text, text,
--    text) overload is unambiguous.
select
  a.attname                                        as writable_column,
  has_column_privilege('authenticated', 'public.help_requests', a.attname::text, 'UPDATE') as can_update
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'help_requests'
  and a.attnum > 0
  and not a.attisdropped
order by writable_column;

-- 2. Table-level UPDATE must be gone. A true value here means the revoke did
--    not take effect and every column is writable again.
select has_table_privilege('authenticated', 'public.help_requests', 'UPDATE') as table_level_update;

-- 3. INSERT / SELECT / DELETE must be untouched.
select
  has_table_privilege('authenticated', 'public.help_requests', 'INSERT') as can_insert,
  has_table_privilege('authenticated', 'public.help_requests', 'SELECT') as can_select,
  has_table_privilege('authenticated', 'public.help_requests', 'DELETE') as can_delete;

-- 4. No policy was dropped or weakened. Expect 6 rows, unchanged from before.
select tablename, policyname, cmd, roles::text, coalesce(qual, '') as using_expr, coalesce(with_check, '') as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename = 'help_requests'
order by cmd, policyname;

-- 5. Both functions exist, are SECURITY DEFINER, pin search_path, and are
--    executable by authenticated but not by anon.
select
  p.proname,
  p.prosecdef                                       as security_definer,
  p.proconfig                                       as settings,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon',         p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('submit_help_request', 'transition_help_request', 'set_document_verification_status')
order by p.proname;

-- 6. No schema change: the trigger, the defaults and the enum are all as they
--    were. Expect the status default to still be 'draft'::request_status and
--    request_status to still hold all nine labels.
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'help_requests'
order by ordinal_position;

select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typnamespace = 'public'::regnamespace
group by t.typname
order by t.typname;


-- -----------------------------------------------------------------------------
-- FUNCTIONAL CHECKS (run as a real requester and a real staff member)
-- -----------------------------------------------------------------------------
-- Requester
--   1. Save a draft. Confirm `status` is absent from the INSERT payload in the
--      network tab and the row comes back as 'draft' (column default).
--   2. Edit the draft, including the city. Confirm all seven columns still save.
--   3. Submit. Confirm the row is 'submitted', submitted_at is set, and there
--      is exactly ONE admin_actions row: action = 'request_submitted',
--      old_status = 'draft', new_status = 'submitted', admin_id = <your id>.
--   4. Try a raw PATCH  {"status":"verified"}  against your own submitted
--      request. Expect 42501 — permission denied for table help_requests. This
--      is the whole point of the migration.
--   5. Try a raw PATCH  {"verification_notes":"x"}  against your own draft.
--      Expect 42501.
--   6. Submit twice. The second call must fail 22023 and add no audit row.
--   7. Call submit_help_request on somebody else's draft. Expect 42501.
--
-- Staff
--   8. submitted -> under_review. One audit row: 'review_started',
--      draft-free old_status = 'submitted'. verification_notes, verified_at
--      and rejection_reason must all still be NULL.
--   9. under_review -> verified with notes. One audit row: 'request_verified'.
--      verification_notes = notes, verified_at ~= now(), rejection_reason
--      still NULL, reviewed_by = your id.
--  10. Attempt a second transition on the same request. Expect 22023 (stale
--      expected status) and no new audit row.
--  11. Call transition_help_request with p_expected_status = 'submitted' and
--      p_new_status = 'verified'. Expect 22023 — refused by the allowlist, not
--      by RLS, and no audit row written.
--  12. Call it as a non-staff authenticated user. Expect 42501.
--  13. Call transition_help_request on a draft. Expect 22023.
--  14. Call it with notes over 2000 characters. Expect 22023.
--
-- Race
--  15. Two staff tabs on the same under_review request, both clicking Reject.
--      Exactly one succeeds; the other gets 22023. Exactly two audit rows exist
--      for the pair (one 'review_started', one 'request_rejected') — never a
--      third, and never a 'transition_failed' row, because the client no longer
--      writes audit rows at all.


-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- Restores the previous state. The column grant is the only thing that was
-- removed, so it is the only thing that has to come back.
--
-- revoke all on function public.submit_help_request(uuid) from authenticated;
-- revoke all on function public.transition_help_request(uuid, public.request_status, public.request_status, text) from authenticated;
-- drop function if exists public.submit_help_request(uuid);
-- drop function if exists public.transition_help_request(uuid, public.request_status, public.request_status, text);
--
-- revoke update (title, description, category_id, urgency, target_amount, location_city, location_state)
--   on public.help_requests from authenticated;
-- grant update on public.help_requests to authenticated;
--
-- This restores the pre-migration frontend contract as well: the direct
-- `.update({ status: 'submitted' })` in submitHelpRequest and the client-side
-- admin_actions insert in applyStaffTransition become necessary again, so roll
-- the frontend back at the same time or submission will break.
