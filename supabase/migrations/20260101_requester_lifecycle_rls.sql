-- =============================================================================
-- Walk With Us — requester lifecycle RLS completion
-- =============================================================================
-- STATUS: NOT APPLIED. This file is the reviewed, ready-to-apply change.
--        It has NOT been run against any database, because the Supabase
--        project referenced by .env.local (ffpndfstdseefgfxrmgz) does not
--        resolve in public DNS. Do not mark Task 2 complete until this has
--        been applied and the authenticated flow has been re-tested.
--
-- BLOCKER 1 — draft -> submitted is blocked by RLS (42501)
-- BLOCKER 2 — help_request_documents has no DELETE policy at all
--
-- Everything below is additive. No policy is dropped, no policy is weakened,
-- no NOT NULL constraint is touched, no column is added or renamed.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- PRE-FLIGHT: run this first and confirm the output matches the "BEFORE" state
-- recorded in the task notes. If it does not match, STOP.
-- -----------------------------------------------------------------------------

-- Expected BEFORE state (4 policies, no DELETE on help_request_documents):
--
--  help_requests
--    INSERT  "Users can create draft help requests"
--    SELECT  "Public can view published requests"
--    SELECT  "Requesters can view own requests"
--    SELECT  "Staff can view all requests"
--    UPDATE  "Requesters can update own draft requests"
--    UPDATE  "Staff can update requests"
--
--  help_request_documents
--    INSERT  "Requesters can add own request documents"
--    SELECT  "Requesters can view own documents"
--    SELECT  "Staff can view request documents"
--    UPDATE  "Staff can update document verification"
--    (no DELETE)

select
  tablename,
  policyname,
  cmd,
  roles::text,
  coalesce(qual, '')      as using_expr,
  coalesce(with_check, '') as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in ('help_requests', 'help_request_documents')
order by tablename, cmd, policyname;


-- -----------------------------------------------------------------------------
-- BLOCKER 1 — allow the owner to move their own draft to 'submitted'
-- -----------------------------------------------------------------------------
-- WHY THE EXISTING POLICY BLOCKS IT
-- ---------------------------------
-- The only requester UPDATE policy is:
--
--   "Requesters can update own draft requests"
--     USING      (requester_id = auth.uid() AND status = 'draft')
--     WITH CHECK (requester_id = auth.uid() AND status = 'draft')
--
-- In PostgreSQL, USING is evaluated against the OLD row and WITH CHECK against
-- the NEW row. The submit statement changes status from 'draft' to 'submitted',
-- so the NEW row fails WITH CHECK (status is no longer 'draft'). The staff
-- policy does not apply to a requester. Permissive policies are OR'd, so every
-- WITH CHECK must pass for one of them, and none does -> 42501.
-- This exactly matches the observed failure, and it is a policy defect, not an
-- ownership defect: requester_id = auth.uid() and the old status IS 'draft'.
--
-- WHY THIS IS THE SMALLEST CORRECT FIX
-- -----------------------------------
-- Rather than loosening the existing policy (which would also let a requester
-- rewrite a request that is already under_review / verified / published), this
-- adds one narrowly-scoped policy that permits exactly one transition and
-- nothing else:
--
--   OLD row must be:  my own request, status = 'draft'
--   NEW row must be:  my own request, status = 'submitted'
--
-- Because WITH CHECK pins the new status to the single literal 'submitted', a
-- requester still CANNOT set verified, published, active, resolved or closed
-- (or under_review, or rejected) — each of those fails WITH CHECK and is
-- rejected with 42501. Because USING pins the old status to 'draft', a
-- requester cannot use this policy to reopen or edit an already-advanced
-- request. It is a strict subset of what the existing policy already permits,
-- plus the single 'submitted' transition.
--
-- NOTE ON requester_id
-- --------------------
-- requester_id is NOT changed by this policy; WITH CHECK requires it to still
-- equal auth.uid(). A requester therefore cannot reassign their request to
-- another account as a side effect of submitting it.

-- -----------------------------------------------------------------------------
-- TRANSACTION BOUNDARY
-- -----------------------------------------------------------------------------
-- The pre-flight SELECT above deliberately sits OUTSIDE the transaction. It is
-- a read-only inspection whose entire purpose is for a human to look at the
-- BEFORE state and STOP if it does not match, so it must remain runnable and
-- reviewable on its own.
--
-- The two CREATE POLICY statements below are the only mutating statements in
-- this file, and they now run as ONE transaction: if either fails, neither
-- lands and the database is never left with the submit policy without the
-- document DELETE policy. CREATE POLICY is fully transactional in PostgreSQL,
-- and there is no CREATE INDEX CONCURRENTLY, ALTER TYPE ... ADD VALUE or VACUUM
-- in this file, so the whole thing can be wrapped safely.
--
-- Execution order is unchanged: pre-flight, submit policy, document DELETE
-- policy, then the post-apply verification queries below.
-- -----------------------------------------------------------------------------
begin;

-- IDEMPOTENCY (both blockers below)
-- ----------------------------------
-- Both of these policies already exist in the live database, and PostgreSQL has
-- no CREATE OR REPLACE POLICY. A bare CREATE POLICY against an existing
-- name on the same table raises:
--
--   ERROR: policy "..." for table "..." already exists
--   SQLSTATE 42710
--
-- So this file could never have been applied twice, and rerunning it as written
-- would abort the whole transaction rather than converge. Each CREATE below is
-- therefore preceded by a DROP POLICY IF EXISTS for the identical name on the
-- identical table.
--
-- This is NOT a weakening and it opens no window:
--
--   * The DROP targets only the exact name the CREATE immediately after it
--     recreates, on the same table. No other policy is touched.
--   * DROP and CREATE are both inside the single BEGIN/COMMIT below. Between
--     them the policy does not exist, but no other session can observe that:
--     uncommitted DDL is invisible outside its transaction. The gap exists
--     only inside this transaction, and any error rolls both back together.
--   * The recreated policy is the SAME expression as the one removed. The
--     submit policy still pins USING to status = 'draft' and WITH CHECK to
--     status = 'submitted'; the document DELETE policy still pins
--     uploaded_by = auth.uid() and parent status = 'draft'.
--
-- The practical effect is convergence: the file now states the intended end
-- state rather than assuming it was absent.
drop policy if exists "Requesters can submit own draft requests"
  on public.help_requests;

create policy "Requesters can submit own draft requests"
on public.help_requests
for update
to authenticated
using (
  requester_id = auth.uid()
  and status = 'draft'
)
with check (
  requester_id = auth.uid()
  and status = 'submitted'
);


-- -----------------------------------------------------------------------------
-- BLOCKER 2 — help_request_documents has NO delete policy
-- -----------------------------------------------------------------------------
-- FOUND DURING INSPECTION (not in the original task list, but the required
-- lifecycle cannot complete without it: Task 7 steps 6-8 are "remove document,
-- confirm the storage object is gone, confirm the document row is gone").
--
-- The table's current policies are INSERT (requesters), SELECT (requesters),
-- SELECT (staff) and UPDATE (staff) only. RLS is enabled on the table, so with
-- no DELETE policy the row delete in removeHelpRequestDocument() is refused for
-- every role, including the owner. Symptom would be 42501 on the row delete
-- after the storage object had already been removed.
--
-- This policy mirrors the existing requester INSERT policy's ownership check
-- exactly (uploaded_by = auth.uid() AND the parent request is owned by
-- auth.uid()), so a requester can only ever delete their own document on their
-- own request. Staff/admin document handling is out of scope here and is left
-- to the policies added with the staff dashboard.
--
-- The extra `hr.status = 'draft'` guard means a requester cannot delete
-- evidence after submitting a request for review. The request-help UI only
-- offers removal before submission, so this cannot break the legitimate flow.
-- Drop that one line if review evidence must remain editable post-submit.

-- Same idempotency reasoning as the submit policy above. Both statements sit in
-- the one transaction, so the drop/create pair is atomic and invisible to other
-- sessions until commit.
drop policy if exists "Requesters can delete own request documents"
  on public.help_request_documents;

create policy "Requesters can delete own request documents"
on public.help_request_documents
for delete
to authenticated
using (
  uploaded_by = auth.uid()
  and exists (
    select 1
    from public.help_requests hr
    where hr.id = help_request_documents.request_id
      and hr.requester_id = auth.uid()
      and hr.status = 'draft'
  )
);

commit;


-- -----------------------------------------------------------------------------
-- POST-APPLY VERIFICATION
-- -----------------------------------------------------------------------------

-- 1. Confirm the two new policies exist and that nothing was dropped.
--    Expect 7 rows for help_requests and 5 for help_request_documents.
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public'
  and tablename in ('help_requests', 'help_request_documents')
order by tablename, cmd, policyname;

-- 2. Confirm help_request_documents.document_type is still NOT NULL with no
--    default, i.e. this migration did not touch the schema.
select column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'help_request_documents'
order by ordinal_position;

-- 3. Confirm no enum type was added or altered.
select t.typname, string_agg(e.enumlabel, ',' order by e.enumsortorder) as labels
from pg_type t
join pg_enum e on e.enumtypid = t.oid
where t.typnamespace = 'public'::regnamespace
group by t.typname
order by t.typname;


-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- Only ever needed if the new policies must be withdrawn. This removes ONLY the
-- two policies created above; it cannot affect the staff/admin policies or any
-- other table.

-- drop policy if exists "Requesters can submit own draft requests"
--   on public.help_requests;
-- drop policy if exists "Requesters can delete own request documents"
--   on public.help_request_documents;
