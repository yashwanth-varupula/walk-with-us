-- =============================================================================
-- Walk With Us — private request-documents storage policies
-- =============================================================================
-- STATUS: NOT APPLIED. This file is the reviewed, ready-to-apply change.
--        It has NOT been run against any database. Apply it manually in the
--        Supabase SQL Editor, after 20260929_public_published_only_rls.sql.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The document rules are currently only half-enforced:
--
--   * public.help_request_documents (the metadata table) HAS policies:
--     requester INSERT/SELECT/DELETE, staff SELECT/UPDATE, plus the two added
--     by 20260101_requester_lifecycle_rls.sql.
--   * storage.objects (the actual PDF/JPG/PNG bytes) has NO policies recorded
--     anywhere in this repository. A storage.objects table with RLS enabled and
--     no policy denies everything, which would break uploads entirely; with RLS
--     disabled it would be world-readable. Neither is acceptable, and the
--     repository cannot tell us which state the project is in, so this migration
--     states the intended state explicitly.
--
-- Because the six policies below are the ONLY access control for the document
-- bytes, pre-flight assertion (4) and (5) verify that storage.objects exists
-- and that it has RLS ENABLED, and the file ABORTS if it does not. Asserting
-- the prerequisite is deliberate: a policy on a table with RLS off is inert,
-- so installing these policies into that state would look like a success while
-- leaving the bucket world-readable. This migration asserts only. It never
-- enables RLS, never disables it, and never makes the bucket public.
--
-- The app only ever calls createSignedUrl() for these objects
-- (createRequesterDocumentUrl / createStaffDocumentUrl) and never
-- getPublicUrl(), so a bucket that is public would be a latent leak even though
-- no current code path would use it. The bucket is therefore forced private
-- below.
--
-- THE PATH CONTRACT THIS ENFORCES
-- -------------------------------
--   buildDocumentStoragePath() in src/services/helpRequests.ts produces:
--
--     {auth.uid()}/{requestId}/{uuid}-{sanitizedFilename}
--
-- The FIRST path segment is therefore the uploader's user id, and the SECOND is
-- the help request id. Every policy below keys off that, using
-- storage.foldername(name), which is the array of path segments:
--   foldername[1] = uploader  == auth.uid()
--   foldername[2] = request id
--
-- Because the first segment must equal auth.uid(), a requester cannot write,
-- read, replace or delete an object under another user's folder, even with a
-- correctly guessed request id.
--
-- DELETE is additionally restricted to requests still in 'draft', mirroring the
-- 20260101 requester DELETE policy on the metadata table, so evidence cannot be
-- removed after a request has been submitted for review.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- PRE-FLIGHT ASSERTIONS
-- -----------------------------------------------------------------------------
do $$
begin
  -- (1) The metadata table and its enum must exist, or the folder policies below
  --     cannot correlate a storage path back to a request.
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'help_request_documents'
  ) then
    raise exception
      'ABORT: public.help_request_documents does not exist.';
  end if;

  -- (2) 'draft' must exist in the enum, used by the DELETE guard.
  if not exists (
    select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typname      = 'request_status'
       and t.typnamespace = 'public'::regnamespace
       and e.enumlabel    = 'draft'
  ) then
    raise exception
      'ABORT: public.request_status has no ''draft'' value.';
  end if;

  -- (3) get_my_role() must exist, used by the staff policies.
  if not exists (
    select 1
      from pg_proc p
     where p.proname     = 'get_my_role'
       and p.pronamespace = 'public'::regnamespace
       and p.pronargs     = 0
  ) then
    raise exception
      'ABORT: public.get_my_role() not found. The staff storage policies depend on it.';
  end if;

  -- (4) storage.objects MUST exist. Every policy created below is a policy ON
  --     that table, so without it the file cannot install the access control
  --     these documents depend on, and it would fail later with a much less
  --     obvious error part-way through the transaction.
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage'
       and c.relname = 'objects'
  ) then
    raise exception
      'ABORT: storage.objects does not exist. This migration installs access control ON that table; it cannot create the policies without it. Supabase-managed storage schema is missing from this project.';
  end if;

  -- (5) storage.objects MUST have row level security ENABLED. This is the
  --     assertion the six policies below depend on for their entire effect.
  --
  --     A policy on a table whose RLS is OFF is inert: PostgreSQL does not
  --     consult pg_policy at all, so every role with the underlying privilege
  --     can read and write every row. In that state this file would appear to
  --     succeed, the policy list would read correctly, and the document bytes
  --     would still be reachable with the public anon key. Failing loudly here
  --     is the only way that mistake cannot be made silently.
  --
  --     Note the asymmetry this creates, and it is deliberate: 20260929 asserts
  --     the same prerequisite for public.help_requests. Both files ASSERT the
  --     state and refuse to run without it. Neither file enables RLS, disables
  --     RLS, makes a bucket public, or weakens any policy. If RLS turns out to
  --     be off, that is a separate, deliberate decision to be made in the
  --     Supabase dashboard and reviewed on its own -- not something a migration
  --     should quietly repair while it is installing access control.
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage'
       and c.relname = 'objects'
       and c.relrowsecurity
  ) then
    raise exception
      'ABORT: row level security is NOT enabled on storage.objects. The six policies below would be inert and the request-documents bucket would remain world-readable. Enable RLS on storage.objects in the Supabase dashboard, then re-run this file.';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- THE BUCKET — must exist, and must be PRIVATE
-- -----------------------------------------------------------------------------
-- public = false is enforced rather than assumed. If the bucket already exists
-- and is public, this is a tightening; if it is missing, it is created private.
-- No other bucket setting is touched.
insert into storage.buckets (id, name, public)
values ('request-documents', 'request-documents', false)
on conflict (id) do update
  set public = false;


-- -----------------------------------------------------------------------------
-- REQUESTER POLICIES — the uploader's own folder only
-- -----------------------------------------------------------------------------
-- Note: policies live on storage.objects, which is owned by supabase_storage.
-- Storage RLS is enabled by Supabase by default. This migration does not toggle
-- it in either direction, and it must not be disabled, because the policies
-- below are the access control. Pre-flight assertion (5) now REFUSES TO RUN if
-- storage.objects does not have RLS enabled, so the prerequisite is verified
-- rather than assumed: without it, all six policies would be inert and the
-- bucket would stay world-readable while the policy list still read correctly.

-- UPLOAD: the first path segment must be the caller's own uid.
drop policy if exists "Requesters can upload own request documents"
  on storage.objects;
create policy "Requesters can upload own request documents"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'request-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- READ: the uploader reads their own objects. Anonymous users get no policy at
-- all, so an anon key cannot read a single document.
drop policy if exists "Requesters can read own request documents"
  on storage.objects;
create policy "Requesters can read own request documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'request-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- REPLACE: an object may be re-uploaded to the same path by its owner. The
-- object name is unchanged by the check, so this cannot be used to move an
-- object between folders.
drop policy if exists "Requesters can replace own request documents"
  on storage.objects;
create policy "Requesters can replace own request documents"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'request-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'request-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: own folder AND the parent request is still a draft. The second
-- condition is what stops a requester from deleting evidence after submitting
-- for review, and it matches the metadata-table DELETE policy added in 20260101.
drop policy if exists "Requesters can delete own draft request documents"
  on storage.objects;
create policy "Requesters can delete own draft request documents"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'request-documents'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
        from public.help_requests hr
       where hr.id::text = (storage.foldername(name))[2]
         and hr.requester_id = auth.uid()
         and hr.status = 'draft'::request_status
    )
  );


-- -----------------------------------------------------------------------------
-- STAFF POLICIES — staff and admin only, resolved server-side
-- -----------------------------------------------------------------------------
-- The role is read from Postgres via public.get_my_role(), never from the
-- browser. The same three functions the console uses (createStaffDocumentUrl and
-- the verification RPCs) rely on this policy existing.

drop policy if exists "Staff can read request documents"
  on storage.objects;
create policy "Staff can read request documents"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'request-documents'
    and public.get_my_role() = any (array['staff','admin']::user_role[])
  );

drop policy if exists "Staff can update request documents"
  on storage.objects;
create policy "Staff can update request documents"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'request-documents'
    and public.get_my_role() = any (array['staff','admin']::user_role[])
  )
  with check (
    bucket_id = 'request-documents'
    and public.get_my_role() = any (array['staff','admin']::user_role[])
  );

-- Staff document DELETEs are deliberately NOT granted. Removing a document
-- during review is not an action the app offers, and a stricter rule is easier
-- to defend than a broader one. If you need it, add a policy here deliberately
-- rather than widening an existing one.

commit;


-- -----------------------------------------------------------------------------
-- POST-APPLY VERIFICATION
-- -----------------------------------------------------------------------------

-- 1. The bucket must exist and be private. Expect exactly 1 row, public = false.
select id, name, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'request-documents';

-- 2. Expect exactly 6 policies on storage.objects for this bucket:
--      1 insert, 2 select (requester + staff), 2 update, 1 delete.
select policyname, cmd, roles::text, qual as using_expr, with_check as check_expr
  from pg_policies
 where schemaname = 'storage'
   and tablename  = 'objects'
   and coalesce(qual, with_check, '') like '%request-documents%'
 order by cmd, policyname;

-- 3. storage RLS must still be enabled. This must read true.
select c.relrowsecurity as rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'storage'
   and c.relname = 'objects';


-- -----------------------------------------------------------------------------
-- LIVE BEHAVIOUR CHECKS
-- -----------------------------------------------------------------------------
-- As an anonymous client (anon key, no session):
--   1. Listing the bucket must return nothing.
--      select * from storage.objects where bucket_id = 'request-documents';
--   2. createSignedUrl on a known path must fail.
--
-- As the owning requester:
--   3. createSignedUrl on your own object must succeed.
--   4. createSignedUrl on another user's object must fail.
--
-- As staff (must be staff in Postgres, not just in the UI):
--   5. createSignedUrl on any object in the bucket must succeed.


-- -----------------------------------------------------------------------------
-- ROLLBACK
-- -----------------------------------------------------------------------------
-- begin;
-- drop policy if exists "Requesters can upload own request documents"   on storage.objects;
-- drop policy if exists "Requesters can read own request documents"     on storage.objects;
-- drop policy if exists "Requesters can replace own request documents"  on storage.objects;
-- drop policy if exists "Requesters can delete own draft request documents" on storage.objects;
-- drop policy if exists "Staff can read request documents"              on storage.objects;
-- drop policy if exists "Staff can update request documents"           on storage.objects;
-- commit;
--
-- The bucket row is intentionally NOT removed on rollback: deleting a bucket in
-- Supabase does not necessarily delete its objects, and an orphaned bucket is
-- safer than a cascade you did not intend.
