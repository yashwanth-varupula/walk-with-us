-- =============================================================================
-- Staff document verification: atomic status change + audit trail
-- =============================================================================
-- Closes the audit-integrity gap where a document's verification status could
-- change while the corresponding admin_actions row failed to write.
--
-- Design contract:
--   * SECURITY DEFINER  - the caller cannot satisfy help_request_documents /
--                         admin_actions RLS by itself, so the role check is
--                         done in SQL, not trusted from the client.
--   * Single transaction - the UPDATE and the INSERT are one statement-level
--                         unit. Any RAISE rolls back BOTH.
--   * admin_id          - always auth.uid(). The browser can never supply it.
--   * request_id        - always derived from the document row. If the client
--                         supplies one it is used ONLY as a cross-check.
--   * Row lock          - the document row is locked FOR UPDATE before its old
--                         status is read, so two concurrent staff decisions
--                         cannot both write from the same observed state.
--   * Only sanctioned path - table-level UPDATE is revoked from `authenticated`
--                         at the bottom of this file, so a raw PATCH can no
--                         longer change `status` without this audit row. The
--                         function keeps working because SECURITY DEFINER
--                         executes it as the owner.
--   * Transactional     - BEGIN/COMMIT wrap every MUTATING statement, so a
--                         failure anywhere in the change leaves nothing half-
--                         applied. COMMIT is issued before the verification
--                         SELECTs, so a read-only check can never roll the
--                         migration back.
--   * No new columns, no policy changes, no data changes.
--   * Signature unchanged - still (p_document_id, p_new_status, p_request_id),
--                         so the existing browser call keeps working. An
--                         expected-status precondition is DEFERRED; see the
--                         note on the FOR UPDATE lock below.
--
-- STATUS: NOT APPLIED.
--   The previous attempt raised
--     ERROR:  42P01  relation "authenticated" does not exist
--   from the read-only verification block, which at that time still sat INSIDE
--   the transaction. That error aborted the transaction, so nothing landed: the
--   live function is still the old RETURNS void version and the unaudited
--   bypass this file closes is still open. Root cause and fix: see the ARITY
--   NOTE in verification check 3 below. The COMMIT has also been moved above
--   every verification SELECT so a read-only query can never undo the migration.
--
--   20260101_requester_lifecycle_rls.sql is already applied, which is safe:
--   its only policy on help_request_documents is FOR DELETE, and a DELETE never
--   needs the UPDATE privilege revoked at the bottom of this file.
--
-- Apply manually. Not run by the assistant.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- TRANSACTION SAFETY
-- ------------------------------------------------------------------------------
-- Everything from the pre-flight assertion below to the privilege hardening at
-- the bottom of this file runs as ONE transaction. If any statement raises --
-- a failed assertion, a GRANT naming a missing column, a permission error --
-- the whole file is rolled back, leaving no half-applied function behind.
--
-- Every statement in this file is transaction-compatible: DO/RAISE,
-- CREATE OR REPLACE FUNCTION, COMMENT ON, GRANT and REVOKE are all
-- transactional in PostgreSQL. There is no CREATE INDEX CONCURRENTLY, no
-- ALTER TYPE ... ADD VALUE and no VACUUM here, none of which could be wrapped.
-- -----------------------------------------------------------------------------
begin;


-- -----------------------------------------------------------------------------
-- PRE-FLIGHT ASSERTIONS
-- Deliberately fail loudly rather than install a function that cannot work.
-- These encode assumptions that must hold for the function body below.
-- -----------------------------------------------------------------------------
do $$
declare
  v_not_null text;
  v_missing  text;
begin
  -- admin_actions.old_status / new_status are typed request_status (an enum of
  -- REQUEST states). A document_status is NOT a request_status, so document
  -- transitions CANNOT be stored in those columns -- they would be rejected as
  -- invalid enum input. They are written to notes instead, and these two
  -- columns are left NULL. That is only possible if they are nullable.
  select string_agg(column_name, ', ' order by column_name)
    into v_not_null
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'admin_actions'
     and column_name in ('old_status', 'new_status')
     and is_nullable  = 'NO';

  if v_not_null is not null then
    raise exception
      'ABORT: admin_actions.% is NOT NULL. This migration writes document states to notes and leaves old_status/new_status NULL, which requires them to be nullable. Review before applying.',
      v_not_null;
  end if;

  -- document_status must be exactly the three expected labels.
  if exists (
    select 1
      from pg_type t
     where t.typname      = 'document_status'
       and t.typnamespace = 'public'::regnamespace
       and (select count(*) from pg_enum e where e.enumtypid = t.oid) <> 3
  ) then
    raise exception
      'ABORT: public.document_status does not have exactly 3 labels. Expected pending, verified, rejected.';
  end if;

  -- get_my_role() must exist in public and take no arguments.
  if not exists (
    select 1
      from pg_proc p
     where p.proname     = 'get_my_role'
       and p.pronamespace = 'public'::regnamespace
       and p.pronargs     = 0
  ) then
    raise exception
      'ABORT: public.get_my_role() not found (or takes arguments). This function depends on it for the role check.';
  end if;

  -- Every column the audit INSERT below names must actually exist. A missing
  -- one would install a function that can NEVER succeed, and the failure would
  -- only surface on the first staff click -- as an opaque 42703 that rolls the
  -- document UPDATE back every single time. The verification queries below would
  -- still read "correct", so this has to be caught before COMMIT.
  select string_agg(x.expected, ', ' order by x.expected)
    into v_missing
    from (values
            ('admin_id'), ('action'), ('request_id'), ('notes'),
            ('old_status'), ('new_status')
         ) as x(expected)
   where not exists (
           select 1
             from information_schema.columns c
            where c.table_schema = 'public'
              and c.table_name   = 'admin_actions'
              and c.column_name  = x.expected
         );

  if v_missing is not null then
    raise exception
      'ABORT: public.admin_actions is missing column(s) this function writes: %. Review before applying.', v_missing;
  end if;

  -- The role running this script must itself be able to do what the function
  -- body does. SECURITY DEFINER executes as the function OWNER, not as the
  -- caller, so if this file is applied by a non-owner the function still
  -- installs cleanly and then fails on the first real call. Same guard as
  -- 20260927 for the request-status functions.
  if not has_table_privilege(current_user, 'public.help_request_documents', 'UPDATE')
     or not has_table_privilege(current_user, 'public.admin_actions', 'INSERT') then
    raise exception
      'ABORT: the role running this script (%, %) must hold UPDATE on help_request_documents and INSERT on admin_actions, because the SECURITY DEFINER function executes as its owner. Re-run as the table owner (usually postgres).', current_user, session_user;
  end if;
end
$$;

-- =============================================================================
-- public.set_document_verification_status
-- =============================================================================

-- WHY THIS DROP IS HERE
-- ---------------------
-- The live database already carries this function with RETURNS void.
-- PostgreSQL cannot change a function's return type with CREATE OR REPLACE:
-- doing so raises
--
--   ERROR: cannot change return type of existing function
--   HINT: Use DROP FUNCTION first.
--   SQLSTATE 42P13
--
-- So the existing void-returning function must be removed before this file can
-- install the jsonb-returning one. IF EXISTS keeps this idempotent: if the
-- function is not present, this is a no-op and the CREATE below simply installs
-- it.
--
-- DELIBERATELY NO CASCADE. The bare form is used on purpose. If any view,
-- trigger, or another function were to depend on this one, the DROP would
-- refuse with error 2BP01 rather than silently destroying that dependent object.
-- An explicit cascade here could delete database objects this file has never
-- seen and cannot report on. Failing loudly is the safe outcome; if a genuine
-- dependency is ever found, it should be inspected and dropped deliberately.
--
-- The signature below is written out in full and matches the CREATE immediately
-- after it exactly, so the DROP can only ever target the intended function.
--
-- Consequence, accepted: dropping the function also drops its EXECUTE grants.
-- That is re-established below by the `revoke all ... from public` and
-- `grant execute ... to authenticated` pair, which run inside this same
-- transaction, so there is no window in which the function is missing from the
-- grant model. On a rollback the old void function does NOT come back -- see
-- the ROLLBACK block at the bottom of this file, which is documentation only.
drop function if exists public.set_document_verification_status(
  uuid,
  public.document_status,
  uuid
);

-- NO DEFAULT ON p_request_id -- DELIBERATE
-- ---------------------------------------
-- `p_request_id uuid default null` would register a SECOND entry in pg_proc, for
-- the 2-argument form (uuid, document_status). PostgreSQL stores one catalog row
-- per trailing-argument-count whenever defaults are present, so that single
-- keyword creates a genuine overload: two rows named
-- set_document_verification_status, two PostgREST entries competing for one
-- /rpc path, and verification check 5 below returning 2 rows instead of the
-- single pronargs = 3 row it documents.
--
-- The default bought nothing. src/services/staffRequests.ts:591 sends all three
-- named parameters unconditionally -- the payload is a hard-coded three-key
-- object, no spread, no optional key -- so the 2-argument form had no caller.
-- Removing it changes nothing for the browser. The parameter remains nullable
-- (it is simply not declared NOT NULL), so passing NULL still means "skip the
-- cross-check", which is what the body below already implements.
create or replace function public.set_document_verification_status(
  p_document_id  uuid,
  p_new_status   public.document_status,
  p_request_id   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor          uuid := auth.uid();
  v_role           public.user_role;
  v_doc_request_id uuid;
  v_old_status     public.document_status;
begin
  -- (1) Authenticated caller. Fail closed, including anonymous / null JWT.
  if v_actor is null then
    raise exception 'Authentication required.'
      using errcode = '28000';
  end if;

  -- (2) Authorisation, from the server's own view of the caller's role.
  --     Never trust a role supplied by the browser.
  v_role := public.get_my_role();
  if v_role is null or v_role not in ('staff'::public.user_role, 'admin'::public.user_role) then
    raise exception 'Insufficient permissions: staff or admin role required.'
      using errcode = '42501';
  end if;

  -- (3) Validate p_new_status. The parameter type already rejects an unknown
  --     label at the cast (22P02), but it does NOT reject NULL: PostgREST fills
  --     an omitted named parameter with NULL, and this function is not STRICT.
  --     A NULL would sail past the no-op check below -- `v_old_status =
  --     p_new_status` evaluates to NULL, not TRUE, so the guard does not fire
  --     -- and would then be written straight into the column, nulling out the
  --     document's status and logging a "pending -> null" transition. Reject it
  --     here, and pin the label list the pre-flight already asserted, so a new
  --     document_status label cannot be applied without a matching audit string.
  if p_new_status is null then
    raise exception 'A new verification status is required.'
      using errcode = '22023';
  end if;

  if p_new_status not in (
       'pending'::public.document_status,
       'verified'::public.document_status,
       'rejected'::public.document_status
     ) then
    raise exception 'Unsupported verification status: %', p_new_status
      using errcode = '22023';
  end if;

  -- (4) The document must exist. SECURITY DEFINER bypasses RLS, so existence is
  --     checked explicitly here rather than inferred from an affected-row count.
  -- (5) request_id is taken from the document row, never from the client.
  --
  -- FOR UPDATE is the row lock. Without it two staff members acting on the same
  -- document at the same time both read the same v_old_status and both write, so
  -- the second audit row records a transition from a status that the first
  -- transaction had already replaced. The lock is taken BEFORE the old status is
  -- read into the variable, so the value that is compared and the value that is
  -- later written into the audit row are guaranteed to describe the same
  -- committed state. This matches the locking discipline of
  -- submit_help_request() and transition_help_request() in 20260927.
  --
  -- NOTE (deferred hardening): there is still no expected-status precondition
  -- here, so a stale tab can overwrite a newer decision rather than being
  -- refused with 22023. Adding p_expected_status to this signature is
  -- DEFERRED on purpose: the browser already calls this RPC as
  -- (p_document_id, p_new_status, p_request_id), and a new required argument
  -- would couple this migration to a frontend release. p_request_id is the
  -- server-verified cross-check, so a 4th parameter is not added here: it would
  -- change the registered identity signature that the existing browser call
  -- depends on, and PostgREST would then see two overloads of the same RPC name.
  -- The row lock is the safe half that can ship now.
  select d.request_id, d.status
    into v_doc_request_id, v_old_status
    from public.help_request_documents d
   where d.id = p_document_id
     for update;

  if not found then
    raise exception 'Document not found.'
      using errcode = 'P0002';
  end if;

  -- Optional caller-supplied cross-check: if a request_id is given it must
  -- match the document's real parent request. Guards against a mismatched
  -- pairing being mis-attributed in the audit trail.
  if p_request_id is not null and p_request_id is distinct from v_doc_request_id then
    raise exception 'Document does not belong to the supplied request.'
      using errcode = '22023';
  end if;

  -- (6) Reject a no-op so the audit log never records a change that did not
  --     actually change anything. Safe now that step (3) has ruled out NULL:
  --     with p_new_status non-null this is a plain equality test.
  if v_old_status = p_new_status then
    raise exception 'Document is already marked %.', p_new_status
      using errcode = '22023';
  end if;

  -- (7) The change.
  update public.help_request_documents
     set status = p_new_status
   where id = p_document_id;

  if not found then
    -- Defensive: the SELECT above succeeded inside this same transaction, so
    -- this cannot normally fire. Kept so a silent no-op is never audit-logged
    -- as a success.
    raise exception 'Document disappeared before update.'
      using errcode = 'P0002';
  end if;

  -- (8) The audit row. Any failure here raises, which aborts the whole
  --     transaction and rolls back the UPDATE above.
  --
  --     old_status / new_status are request_status enum columns and are left
  --     NULL on purpose; the document transition is recorded in notes.
  insert into public.admin_actions
    (admin_id, action, request_id, notes, old_status, new_status)
  values
    (
      v_actor,
      'document_status_changed',
      v_doc_request_id,
      'document ' || p_document_id::text
        || ' verification status: '
        || coalesce(v_old_status::text, 'null')
        || ' -> '
        || p_new_status::text
        || ' (set_document_verification_status)',
      null,
      null
    );

  -- (9) Both writes committed together by the implicit transaction.
  return jsonb_build_object(
    'id',         p_document_id,
    'request_id', v_doc_request_id,
    'status',     p_new_status::text,
    'actor',      v_actor::text
  );
end;
$$;

-- =============================================================================
-- EXECUTE grants
-- =============================================================================
-- PostgreSQL grants EXECUTE to PUBLIC on every new function. For a SECURITY
-- DEFINER function that would let anonymous callers reach the body. The internal
-- role check still denies them, but revoking keeps the surface minimal and is
-- the correct default.
revoke all on function public.set_document_verification_status(uuid, public.document_status, uuid) from public;

-- WHY THIS IS NOT REDUNDANT WITH THE REVOKE ABOVE
-- ------------------------------------------------
-- Observed in production: after this file was applied, `anon` still held EXECUTE
-- on this function and had to be revoked by hand. The cause is that a privilege
-- granted DIRECTLY to a named role is a separate ACL entry on the function from
-- the PUBLIC entry, and `revoke ... from public` only ever removes the PUBLIC
-- one. Privileges are additive: revoking the PUBLIC grant cannot withdraw a
-- grant that was made to `anon` on its own terms, so `anon` keeps its direct
-- EXECUTE and can still reach a SECURITY DEFINER body.
--
-- This statement is therefore explicit rather than inherited-from-PUBLIC, and it
-- is deliberately placed in the same transaction as the PUBLIC revoke so a fresh
-- apply needs no manual follow-up. It is a safe no-op when no direct `anon` grant
-- exists. `anon` is never granted anything here in return, so after this block
-- the only role that can execute the function is `authenticated` -- and inside
-- the function only staff/admin get past the role check.
revoke execute on function public.set_document_verification_status(uuid, public.document_status, uuid) from anon;

-- Only authenticated sessions may invoke it; staff/admin is enforced inside.
grant execute on function public.set_document_verification_status(uuid, public.document_status, uuid) to authenticated;

comment on function public.set_document_verification_status(uuid, public.document_status, uuid) is
  'Atomically updates a help_request_documents.status and writes the matching admin_actions row. admin_id is always auth.uid(); request_id is always derived from the document. Raises (rolling back both writes) if the caller is unauthenticated, is not staff/admin, the document does not exist, the supplied request_id does not match, or the audit insert fails.';


-- =============================================================================
-- PRIVILEGE HARDENING — close the direct document-status bypass
-- =============================================================================
-- THE BYPASS THIS REMOVES
-- -----------------------
-- "Staff can update document verification" is a role-only policy: both USING
-- and WITH CHECK test get_my_role() and nothing about the row or the column.
-- Because `authenticated` holds table-level UPDATE on public.help_request_documents
-- and no column privilege narrows it, a raw REST PATCH could change `status`
-- with no admin_actions row at all. Creating an audited function does not close
-- that: the browser is free to skip the function. Only removing the privilege
-- makes the function the ONLY way in.
--
-- WHY A FULL TABLE-LEVEL REVOKE, NOT A COLUMN SUBSET
-- ---------------------------------------------------
-- The decision required first: which columns, if any, does the browser need to
-- update directly on help_request_documents? The answer is NONE. Audited from
-- the service layer --
--
--   helpRequests.ts   SELECT (listHelpRequestDocuments, staff list)
--   helpRequests.ts   INSERT (uploadHelpRequestDocument -> request_id,
--                             storage_path, uploaded_by, document_type)
--   helpRequests.ts   DELETE (removeHelpRequestDocument)
--   staffRequests.ts  RPC    (set_document_verification_status -> status)
--
-- There is no .update() call against help_request_documents anywhere in src/,
-- and status is written exclusively through the RPC. A full table-level REVOKE
-- is therefore strictly stronger than any column grant and needs no re-grant.
-- It excludes status, uploaded_by, request_id, id and created_at by removing
-- every column, which is the same intent as listing them as excluded.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- * The policy "Staff can update document verification" is left exactly as it
--   is. It is not dropped, narrowed or weakened. It simply has no privilege
--   left to act on, so it is inert. Leaving it means a later, deliberate
--   column grant does not also require re-authorising a policy.
-- * INSERT, SELECT and DELETE on help_request_documents are untouched.
-- * "Requesters can add own request documents", "Requesters can view own
--   documents" and "Requesters can delete own request documents" (20260101)
--   are untouched and keep working.
-- * The RPC keeps working. It is SECURITY DEFINER and executes as its owner,
--   so the owner still holds UPDATE on the table; revoking it from
--   `authenticated` does not affect the function body at all. That is the
--   whole reason the function is created before this revoke is issued, in the
--   same transaction.
-- * storage.objects is a different table. The staff storage SELECT/UPDATE
--   policies added by 20260930 are unaffected by this revoke.
--
-- ORDERING NOTE
-- -------------
-- This file was originally written to be applied FIRST, ahead of
-- 20260101_requester_lifecycle_rls.sql, so that there would never be a moment
-- when staff could neither use the RPC nor update the column directly.
--
-- That is no longer the situation. 20260101 is ALREADY APPLIED, and this file is
-- the last one outstanding for the document-verification path. The inversion is
-- safe, and the reason is specific rather than general:
--
--   * 20260101's only policy on help_request_documents is FOR DELETE
--     ("Requesters can delete own request documents"). A DELETE never requires
--     the UPDATE privilege, so the revoke below removes nothing it depends on.
--   * 20260101 contains no GRANT or REVOKE statement at all, so it cannot be
--     relying on a privilege this file takes away.
--   * 20260101's other policy ("Requesters can submit own draft requests") is
--     FOR UPDATE on help_requests -- a different table, untouched here.
--
-- The revoke below is therefore the last mutating statement in the file, and it
-- sits in the same transaction as the CREATE. Applying the RPC first and the
-- revoke second is what keeps the two facts atomic: at no committed point does
-- the table have neither the RPC nor the privilege.
-- =============================================================================
revoke update on public.help_request_documents from authenticated;


-- -----------------------------------------------------------------------------
-- COMMIT -- THE MIGRATION ENDS HERE
-- -----------------------------------------------------------------------------
-- Everything above this line is the migration. Everything below it is
-- inspection.
--
-- The COMMIT is placed here, immediately after the last mutating statement, and
-- NOT at the end of the file. That is deliberate and it is the fix for a second
-- failure mode: while the read-only verification SELECTs sat inside the
-- transaction, any error in one of them aborted the whole apply and rolled the
-- real migration back with it. A verification query that can undo the change it
-- exists to verify is worse than no verification query at all -- it converts a
-- read-only mistake into a lost migration.
--
-- From this point forward:
--   * the verification SELECTs below are read-only and cannot roll anything back;
--   * the functional checks are comments, not statements;
--   * the rollback block is comments, not statements.
-- So the migration is durable from here regardless of what happens below.
-- -----------------------------------------------------------------------------
commit;


-- =============================================================================
-- POST-APPLY VERIFICATION -- runs AFTER the commit above, cannot roll it back
-- =============================================================================

-- 1. The privilege must be gone. Expect false. A true value here means a raw
--    PATCH can still change help_request_documents.status with no audit row.
select has_table_privilege('authenticated', 'public.help_request_documents', 'UPDATE') as can_update;

-- 2. The other three verbs must be untouched. Expect true, true, true.
select
  has_table_privilege('authenticated', 'public.help_request_documents', 'INSERT') as can_insert,
  has_table_privilege('authenticated', 'public.help_request_documents', 'SELECT') as can_select,
  has_table_privilege('authenticated', 'public.help_request_documents', 'DELETE') as can_delete;

-- 3. No column of the table may remain writable by authenticated. Expect no
--    rows at all, not even `status`.
--
--    ARITY NOTE -- this query previously raised 42P01 on apply and was the sole
--    reason the migration aborted. It called the THREE-argument form:
--
--      has_column_privilege('authenticated', 'public.help_request_documents.' || a.attname, 'UPDATE')
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
--    DOES have a 3-arg (user, table, privilege) form, which is why checks 1 and
--    2 below were always correct, while the identically shaped 3-arg call on
--    has_column_privilege was not. The two functions do not share an arity
--    convention.
--
--    Corrected below to the documented 4-argument form, passing the table name
--    and the column name as SEPARATE arguments instead of concatenating them
--    into one string. The intent and the result set are unchanged: still no
--    rows when the revoke worked. The cast to ::text is explicit so argument
--    resolution against the (text, text, text, text) overload is unambiguous.
--
--    The query now also sits AFTER the COMMIT. Both defects had to be fixed for
--    this apply to succeed: moving the COMMIT alone would still have aborted on
--    the arity error, and correcting the arity alone would have left the whole
--    migration one bad read-only query away from being rolled back.
--
select
  a.attname                                          as writable_column,
  has_column_privilege('authenticated', 'public.help_request_documents', a.attname::text, 'UPDATE') as can_update
from pg_attribute a
join pg_class c     on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'help_request_documents'
  and a.attnum > 0
  and not a.attisdropped
  and has_column_privilege('authenticated', 'public.help_request_documents', a.attname::text, 'UPDATE')
order by writable_column;

-- 4. The function must exist, be SECURITY DEFINER, pin search_path, and be
--    executable by authenticated but not by anon. Expect prosecuritydefiner =
--    true, anon_can_execute = false.
select
  p.proname,
  p.prosecdef                                        as security_definer,
  p.proconfig                                        as settings,
  p.proisstrict                                      as is_strict,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon',         p.oid, 'EXECUTE') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'set_document_verification_status';

-- 5. The signature and return type must be exactly what the browser expects:
--    ONE row, pronargs = 3, identity_arguments = "p_document_id uuid,
--    p_new_status public.document_status, p_request_id uuid", return_type =
--    jsonb. Anything else is a contract change.
--
--    Read the row COUNT first, not just the contents. A second row with
--    pronargs = 2 means a stray 2-argument overload is still in the database
--    (an older definition that carried `default null` on p_request_id). The
--    DROP above targets the 3-argument signature only, so it would not have
--    removed that one. Two overloads under one RPC name make the PostgREST
--    endpoint ambiguous; drop it deliberately, with no CASCADE, and re-check.
--    A single row with pronargs = 4 means a deferred expected-status parameter
--    was added and the frontend must ship in the same release.
select
  p.proname,
  p.pronargs                                          as argument_count,
  pg_get_function_identity_arguments(p.oid)          as identity_arguments,
  pg_get_function_result(p.oid)                       as return_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'set_document_verification_status';

-- 6. No policy was dropped or weakened. 20260101 is already applied, so expect
--    5 rows for help_request_documents: 4 baseline plus "Requesters can delete
--    own request documents". "Staff can update document verification" must still
--    be present -- it is left in place on purpose, merely inert now that
--    authenticated holds no UPDATE privilege on the table.
select policyname, cmd, roles::text, coalesce(qual, '') as using_expr, coalesce(with_check, '') as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename = 'help_request_documents'
order by cmd, policyname;


-- -----------------------------------------------------------------------------
-- FUNCTIONAL CHECKS
-- -----------------------------------------------------------------------------
-- Requester
--   1. Upload a document. It must still appear in the request's document list.
--   2. Delete a document on a draft. Both the storage object and the row must go.
--   3. Try a raw PATCH {"status":"verified"} on your own document. Expect 42501.
--      Before this migration the only thing stopping it was an audit gap.
--
-- Staff
--   4. List a request's documents and open one with a signed URL. Both must
--      still work: the revoke touched only UPDATE, not SELECT.
--   5. Verify a document through the UI. Expect status to change and exactly ONE
--      admin_actions row with action = 'document_status_changed'.
--   6. Try a raw PATCH {"status":"rejected"} directly. Expect 42501.
--   7. Call the RPC again with the same status it already has. Expect 22023 and
--      no second audit row.
--   9. Call the RPC omitting p_new_status entirely (PostgREST fills it with
--      NULL). Expect 22023 and no change -- it must NOT write a NULL status and
--      must NOT leave a "-> null" audit row behind.
--  10. Call the RPC with p_request_id set to a different request's id. Expect
--      22023 and no change, no audit row.
--
-- Race
--   8. Two staff tabs on the same document, both clicking Verify. Exactly one
--      succeeds; the other raises 22023. Neither audit row may claim a
--      transition from a status the other had already replaced. This is the
--      behaviour the FOR UPDATE row lock exists to guarantee.


-- -----------------------------------------------------------------------------
-- ROLLBACK  --  ALL COMMANDS BELOW ARE DELIBERATELY COMMENTED OUT
-- -----------------------------------------------------------------------------
-- Restores the pre-migration state. The column privilege is the only thing that
-- was removed, so it is the only thing that has to come back. Re-granting
-- table-level UPDATE re-opens the unaudited status bypass described above, so
-- only do this if the RPC above is also being withdrawn.
--
-- Note there is no CASCADE on the drop, for the same reason as in the migration:
-- a genuine dependency should be inspected and dropped deliberately, not
-- cascaded away silently.
--
-- revoke execute on function public.set_document_verification_status(uuid, public.document_status, uuid) from authenticated;
-- drop function if exists public.set_document_verification_status(uuid, public.document_status, uuid);
--
-- grant update on public.help_request_documents to authenticated;
