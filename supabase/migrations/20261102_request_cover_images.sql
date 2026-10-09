-- =============================================================================
-- Walk With Us — Public Request Cover Images (Hardened)
-- =============================================================================
-- Migration: 20261102_request_cover_images.sql
--
-- PURPOSE:
-- 1. Pre-flight assertions to verify prerequisite functions and tables.
-- 2. Add canonical `image_path` text column to `public.help_requests`.
-- 3. Create public `request-images` storage bucket for cover images (5MB limit, JPEG/PNG/WebP).
-- 4. Install hardened RLS policies on `storage.objects` for `request-images`:
--    - SELECT: public (anon, authenticated) for request-images bucket only.
--    - INSERT / UPDATE / DELETE: staff and admin only (via public.get_my_role()),
--      restricted to canonical namespace {requestId}/cover-{uuid}.{ext} and existing requests.
-- 5. Create `public.set_request_cover_image` RPC (SECURITY DEFINER):
--    - Requires authenticated caller (auth.uid() is not null).
--    - Role check via public.get_my_role() (staff or admin only).
--    - Row-level lock (FOR UPDATE) to serialize updates.
--    - Strict namespace & path validation: ^<requestId>/cover-<uuid>.<ext>$
--    - Atomic update of help_requests + audit row in public.admin_actions.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. PRE-FLIGHT ASSERTIONS
-- -----------------------------------------------------------------------------
do $$
begin
  -- (1) The role oracle function must exist.
  if not exists (
    select 1
      from pg_proc p
     where p.proname      = 'get_my_role'
       and p.pronamespace = 'public'::regnamespace
       and p.pronargs     = 0
  ) then
    raise exception
      'ABORT: public.get_my_role() not found. The cover image RPC and storage policies depend on it.';
  end if;

  -- (2) help_requests table must exist.
  if not exists (
    select 1
      from information_schema.tables
     where table_schema = 'public'
       and table_name   = 'help_requests'
  ) then
    raise exception
      'ABORT: public.help_requests table does not exist.';
  end if;

  -- (3) admin_actions table must exist.
  if not exists (
    select 1
      from information_schema.tables
     where table_schema = 'public'
       and table_name   = 'admin_actions'
  ) then
    raise exception
      'ABORT: public.admin_actions table does not exist.';
  end if;

  -- (4) storage.objects must exist and have RLS enabled.
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage'
       and c.relname = 'objects'
       and c.relrowsecurity = true
  ) then
    raise exception
      'ABORT: storage.objects does not exist or does not have row-level security enabled.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. DATABASE SCHEMA: Add canonical image_path column to help_requests
-- -----------------------------------------------------------------------------
alter table public.help_requests
  add column if not exists image_path text null;

comment on column public.help_requests.image_path is
  'Canonical storage path for the public cover image in bucket request-images (format: {request_id}/cover-{uuid}.{ext}).';

-- -----------------------------------------------------------------------------
-- 2. STORAGE BUCKET: Create request-images bucket
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'request-images',
  'request-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- -----------------------------------------------------------------------------
-- 3. STORAGE POLICIES: request-images access control
-- -----------------------------------------------------------------------------

-- (A) SELECT: Anyone can view public request cover images from request-images bucket
drop policy if exists "Public can view request cover images" on storage.objects;
create policy "Public can view request cover images"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'request-images'
  );

-- (B) INSERT: Staff/admin only, strict namespace regex, parent request must exist
drop policy if exists "Staff can upload request cover images" on storage.objects;
create policy "Staff can upload request cover images"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'request-images'
    and public.get_my_role() = any (array['staff','admin']::user_role[])
    and name ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/cover-[a-f0-9\-]+\.(jpe?g|png|webp)$'
    and exists (
      select 1
        from public.help_requests hr
       where hr.id::text = (storage.foldername(name))[1]
    )
  );

-- (C) UPDATE: Staff/admin only, strict namespace regex, parent request must exist
drop policy if exists "Staff can update request cover images" on storage.objects;
create policy "Staff can update request cover images"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'request-images'
    and public.get_my_role() = any (array['staff','admin']::user_role[])
    and name ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/cover-[a-f0-9\-]+\.(jpe?g|png|webp)$'
  )
  with check (
    bucket_id = 'request-images'
    and public.get_my_role() = any (array['staff','admin']::user_role[])
    and name ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/cover-[a-f0-9\-]+\.(jpe?g|png|webp)$'
    and exists (
      select 1
        from public.help_requests hr
       where hr.id::text = (storage.foldername(name))[1]
    )
  );

-- (D) DELETE: Staff/admin only, strict namespace regex
drop policy if exists "Staff can delete request cover images" on storage.objects;
create policy "Staff can delete request cover images"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'request-images'
    and public.get_my_role() = any (array['staff','admin']::user_role[])
    and name ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/cover-[a-f0-9\-]+\.(jpe?g|png|webp)$'
  );

-- -----------------------------------------------------------------------------
-- 4. RPC: Authoritative cover image mutation with row locking & audit trail
-- -----------------------------------------------------------------------------
create or replace function public.set_request_cover_image(
  p_request_id uuid,
  p_image_path text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor          uuid := auth.uid();
  v_role           public.user_role;
  v_locked_id      uuid;
  v_old_image_path text;
  v_sanitized_path text;
begin
  -- (1) Caller authentication. Fail closed on anonymous / null JWT.
  if v_actor is null then
    raise exception 'Authentication required.'
      using errcode = '28000';
  end if;

  if p_request_id is null then
    raise exception 'A request id is required.'
      using errcode = '22023';
  end if;

  -- (2) Authorisation: role check via public.get_my_role().
  v_role := public.get_my_role();
  if v_role is null or v_role not in ('staff'::public.user_role, 'admin'::public.user_role) then
    raise exception 'Insufficient permissions: staff or admin role required.'
      using errcode = '42501';
  end if;

  -- (3) Row lock FOR UPDATE to prevent concurrent races.
  select hr.id, hr.image_path
    into v_locked_id, v_old_image_path
    from public.help_requests hr
   where hr.id = p_request_id
     for update;

  if not found then
    raise exception 'This request could not be found.'
      using errcode = 'P0002';
  end if;

  -- (4) Path validation and namespace pinning.
  -- NULL or whitespace-only is valid and denotes removing the cover image.
  -- Non-empty paths MUST strictly follow: ^<request_id>/cover-[a-f0-9\-]+\.(jpe?g|png|webp)$
  if p_image_path is not null and trim(p_image_path) <> '' then
    v_sanitized_path := trim(p_image_path);
    if not (v_sanitized_path ~* ('^' || v_locked_id::text || '/cover-[a-f0-9\-]+\.(jpe?g|png|webp)$')) then
      raise exception 'Invalid cover image path format. Must follow %/cover-<uuid>.<ext> with extension jpg, jpeg, png, or webp.', v_locked_id
        using errcode = '22000';
    end if;
  else
    v_sanitized_path := null;
  end if;

  -- (5) Atomic update on the locked row.
  update public.help_requests
     set image_path = v_sanitized_path,
         updated_at = now()
   where id = v_locked_id;

  if not found then
    raise exception 'This request disappeared before the cover image could be updated.'
      using errcode = 'P0002';
  end if;

  -- (6) Audit row in admin_actions inside the same transaction.
  insert into public.admin_actions
    (admin_id, action, request_id, notes, old_status, new_status)
  values
    (
      v_actor,
      case when v_sanitized_path is null then 'cover_image_removed' else 'cover_image_updated' end,
      v_locked_id,
      case
        when v_sanitized_path is null then 'Removed cover image (previous: ' || coalesce(v_old_image_path, 'none') || ')'
        else 'Updated cover image: ' || coalesce(v_old_image_path, 'none') || ' -> ' || v_sanitized_path
      end,
      null,
      null
    );

  -- (7) Return confirmation payload.
  return jsonb_build_object(
    'id',         v_locked_id,
    'image_path', v_sanitized_path,
    'actor',      v_actor::text
  );
end;
$$;

comment on function public.set_request_cover_image(uuid, text) is
  'Authoritatively updates or clears a help request cover image path and records the admin_actions audit row in one transaction. Requires authenticated staff/admin. Enforces strict namespace isolation {requestId}/cover-{uuid}.{ext}.';

grant execute on function public.set_request_cover_image(uuid, text) to authenticated;

commit;

-- -----------------------------------------------------------------------------
-- POST-APPLY VERIFICATION QUERIES (Run manually after applying)
-- -----------------------------------------------------------------------------
-- 1. Check bucket configuration:
-- select id, name, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'request-images';
--
-- 2. Check column definition:
-- select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'help_requests' and column_name = 'image_path';
--
-- 3. Check storage policies:
-- select policyname, cmd, roles::text, qual as using_expr, with_check as check_expr from pg_policies where schemaname = 'storage' and policyname ilike '%cover images%';
--
-- 4. Check function registration:
-- select proname, prosecdef, provolatile, prosrc from pg_proc where proname = 'set_request_cover_image';
