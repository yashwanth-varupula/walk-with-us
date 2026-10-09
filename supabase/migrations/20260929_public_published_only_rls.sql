-- =============================================================================
-- Walk With Us — public help_requests access is published-only
-- =============================================================================
-- STATUS: NOT APPLIED. This file is the reviewed, ready-to-apply change.
--        It has NOT been run against any database. Apply it manually in the
--        Supabase SQL Editor, one file at a time, in this order:
--        20260210, 20260101, 20260927, 20260928, 20260929 (this one), 20260930
--
-- WHAT THIS CHANGES
-- -----------------
-- The public SELECT policy currently reads:
--
--   "Public can view published requests"
--     FOR SELECT TO anon, authenticated
--     USING (status = ANY (ARRAY['published','active','resolved']::request_status[]))
--
-- It exposes three states to anonymous visitors, while its own name says one.
-- The public pages only ever query status = 'published'
-- (PUBLIC_REQUEST_STATUSES in src/services/helpRequests.ts, and
-- PUBLIC_REQUEST_STATUSES filters on both the list and the detail read), so the
-- extra two states are not used by the app: they only widen what an attacker
-- with the public anon key can SELECT.
--
-- This replaces the policy expression with status = 'published' and nothing
-- else. It does not touch the requester policies, the staff policies, the
-- INSERT policy, RLS enablement, or any column.
--
-- DELIBERATE TRADE-OFF — READ THIS BEFORE APPLYING
-- -----------------------------------------------
-- 'active' and 'resolved' requests will STOP being readable by the public.
-- Two consequences you must accept or reject consciously:
--
--   1. SECURITY (the reason for this change): a request that staff has
--      deliberately moved out of 'published' becomes invisible to anonymous
--      visitors. Today, a rejected-then-resolved or unpublished-but-active row
--      is still fully readable by anyone holding the anon key.
--
--   2. PRODUCT: if your lifecycle later marks a published request 'active' or
--      'resolved', it will DISAPPEAR from /help at that moment. If that is the
--      intended behaviour, apply as written. If you want published requests to
--      remain visible as they progress, add those two literals back to the USING
--      clause AND widen PUBLIC_REQUEST_STATUSES in the service to match —
--      otherwise the app and the policy disagree.
--
-- Nothing here is dropped, only the one policy expression is narrowed. ROLLBACK
-- is at the bottom and restores the previous three-state expression exactly.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- PRE-FLIGHT ASSERTIONS — abort rather than half-apply
-- -----------------------------------------------------------------------------
do $$
begin
  -- (1) RLS must be enabled on help_requests. This migration narrows a policy;
  --     if RLS were off, "narrowing" would be meaningless and the table would be
  --     world-readable regardless. Fail loudly instead.
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'help_requests'
       and c.relrowsecurity
  ) then
    raise exception
      'ABORT: row level security is NOT enabled on public.help_requests. This migration only narrows the public SELECT policy; it cannot be the fix for a table without RLS.';
  end if;

  -- (2) The policy this migration replaces must actually exist, or the drop
  --     below would silently do nothing and the intent would be unmet.
  if not exists (
    select 1
      from pg_policies
     where schemaname = 'public'
       and tablename   = 'help_requests'
       and policyname  = 'Public can view published requests'
       and cmd         = 'SELECT'
  ) then
    raise exception
      'ABORT: policy "Public can view published requests" (SELECT) not found on public.help_requests. Inspect pg_policies and adapt this migration by hand.';
  end if;

  -- (3) 'published' must exist in the enum, or the new USING clause is invalid.
  if not exists (
    select 1
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
     where t.typname      = 'request_status'
       and t.typnamespace = 'public'::regnamespace
       and e.enumlabel    = 'published'
  ) then
    raise exception
      'ABORT: public.request_status has no ''published'' value.';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- THE CHANGE
-- -----------------------------------------------------------------------------
-- Drop and recreate with the SAME name and the SAME roles. Because this runs
-- inside a single transaction, there is no window in which the table is left
-- without a public SELECT policy, and no window in which a wider policy is live.
--
-- Using DROP POLICY rather than ALTER POLICY ... RENAME is deliberate: the
-- replacement is a different predicate, not a renamed version of the old one,
-- and PostgreSQL has no "replace the USING expression" statement.
--
-- A PERMISSIVE policy (the default) is still OR'd with the requester and staff
-- SELECT policies, so authenticated owners and staff keep exactly the access
-- they had. Only the anon/authenticated *public* path narrows.

drop policy if exists "Public can view published requests"
  on public.help_requests;

create policy "Public can view published requests"
  on public.help_requests
  for select
  to anon, authenticated
  using (
    status = 'published'::request_status
  );

commit;


-- -----------------------------------------------------------------------------
-- POST-APPLY VERIFICATION
-- -----------------------------------------------------------------------------

-- 1. The policy must now name exactly one status. Expect 1 row.
select policyname, cmd, roles::text, qual as using_expr
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'help_requests'
   and policyname = 'Public can view published requests';

-- 2. Nothing else on help_requests may have changed. Expect exactly 7 policies:
--      1 INSERT, 3 SELECT, 2 UPDATE (+1 more UPDATE from 20260101 once applied).
select cmd, policyname, roles::text
  from pg_policies
 where schemaname = 'public'
   and tablename  = 'help_requests'
 order by cmd, policyname;

-- 3. RLS must still be enabled and forced-ness unchanged.
select c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = 'help_requests';


-- -----------------------------------------------------------------------------
-- LIVE BEHAVIOUR CHECKS (run after applying, using the anon key only)
-- -----------------------------------------------------------------------------
-- 1. A published request must be readable.
--    select id, status from help_requests where status = 'published' limit 1;
--
-- 2. An active/resolved request must now be invisible (expect 0 rows).
--    select id, status from help_requests where status in ('active','resolved') limit 1;
--
-- 3. Nothing private is exposed: drafts, submitted, rejected and under_review
--    must all be invisible to anon (expect 0 rows for each).
--    select id, status from help_requests
--     where status in ('draft','submitted','under_review','rejected') limit 1;
--
-- 4. As the OWNER, your own non-published request must still be readable.
--    Sign in as the requester and re-run the step 1 query.


-- -----------------------------------------------------------------------------
-- ROLLBACK — restores the exact previous three-state expression
-- -----------------------------------------------------------------------------
-- begin;
-- drop policy if exists "Public can view published requests"
--   on public.help_requests;
-- create policy "Public can view published requests"
--   on public.help_requests
--   for select
--   to anon, authenticated
--   using (
--     status = any (array['published','active','resolved']::request_status[])
--   );
-- commit;
