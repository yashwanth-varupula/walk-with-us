-- =============================================================================
-- STATUS: NOT APPLIED — REVIEW REQUIRED BEFORE APPLYING
-- =============================================================================
-- Volunteer applications and partner enquiries.
--
-- This file documents the schema the volunteer and partner forms need. It is
-- deliberately NOT applied, and the front end degrades visibly until it is:
-- src/services/applications.ts attempts a real INSERT and reports a typed
-- `schema_missing` result when this migration has not been run, so the pages
-- never show a false success.
--
-- SECURITY REVIEW NOTES (read before applying)
--   1. These tables hold personal data: names, emails, phone numbers, and free
--      text. That data is collected from people who are not necessarily signed
--      in, so it needs a real retention policy and a deletion route.
--   2. NO SELECT POLICY IS CREATED, and none should be until someone has decided
--      who is allowed to read enquiries. Staff currently CANNOT read these
--      tables with the anon key. Adding a staff SELECT policy is a separate,
--      deliberate change — not an oversight in this migration.
--   3. `anon` INSERT is required, because a visitor can volunteer without an
--      account. The check constraints below are the only validation standing
--      between a public endpoint and arbitrary text, so they are deliberately
--      strict about length and shape.
--   4. No UPDATE or DELETE is granted to any role. An enquiry is immutable
--      once received; changing one is an operational action done out of band.
--   5. user_id is nullable and set to NULL on user deletion. It is a
--      convenience link, not an identity — the email column is the real
--      contact route. It is nevertheless SERVER-ASSIGNED: the INSERT policies
--      below pin it to auth.uid(), so a signed-in user can only ever write
--      their own id and can never file an enquiry against somebody else's
--      account. An anonymous visitor may still submit, and must then send
--      user_id = NULL.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.volunteer_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name    text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 120),
  email        text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254
                                     AND position('@' IN email) > 1),
  phone        text CHECK (phone IS NULL OR char_length(phone) <= 32),
  city         text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 120),
  availability text NOT NULL CHECK (char_length(availability) BETWEEN 1 AND 80),
  skills       text CHECK (skills IS NULL OR char_length(skills) <= 1000),
  message      text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status       text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'reviewing', 'accepted', 'declined')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_enquiries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  organisation      text NOT NULL CHECK (char_length(organisation) BETWEEN 2 AND 160),
  contact_name      text NOT NULL CHECK (char_length(contact_name) BETWEEN 2 AND 120),
  email             text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254
                                        AND position('@' IN email) > 1),
  phone             text CHECK (phone IS NULL OR char_length(phone) <= 32),
  partnership_type  text NOT NULL CHECK (char_length(partnership_type) BETWEEN 1 AND 80),
  message           text NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),
  status            text NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'reviewing', 'accepted', 'declined')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Only supported by pinned schema versions; harmless if the index already
-- exists, and the oldest-first order matches how a queue would be read.
CREATE INDEX IF NOT EXISTS volunteer_applications_created_at_idx
  ON public.volunteer_applications (created_at);
CREATE INDEX IF NOT EXISTS partner_enquiries_created_at_idx
  ON public.partner_enquiries (created_at);

-- --------------------------------------------------------------------- RLS
ALTER TABLE public.volunteer_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_enquiries ENABLE ROW LEVEL SECURITY;

-- Write-only from the browser. The forms insert; nothing can read back.
--
-- `user_id IS NOT DISTINCT FROM auth.uid()` is the identity guard, and it is
-- NULL-safe on purpose:
--   * authenticated -> auth.uid() is the caller's own id, so user_id must
--     equal it. A signed-in user therefore cannot write a row attributed to
--     another account, even though the browser is free to put any uuid in the
--     payload.
--   * anon -> there is no JWT, so auth.uid() is NULL and user_id must be NULL.
--     Visitors without an account still submit; they simply carry no identity
--     link. This matches src/services/applications.ts, which takes user_id from
--     the live session and stores null when nobody is signed in.
--
-- `WITH CHECK (true)` accepted any user_id at all, which turned a write-only
-- inbox into a way to file an enquiry under an arbitrary account. The
-- constraint governs only this one column; the text CHECK constraints are
-- unchanged and `status` remains constrained to its own enum by the table.
CREATE POLICY volunteer_applications_insert_public
  ON public.volunteer_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NOT DISTINCT FROM auth.uid());

CREATE POLICY partner_enquiries_insert_public
  ON public.partner_enquiries
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NOT DISTINCT FROM auth.uid());

-- Intentionally absent: SELECT / UPDATE / DELETE policies. See note 2 and 4.

REVOKE ALL ON public.volunteer_applications FROM anon, authenticated;
REVOKE ALL ON public.partner_enquiries FROM anon, authenticated;
GRANT INSERT ON public.volunteer_applications TO anon, authenticated;
GRANT INSERT ON public.partner_enquiries TO anon, authenticated;

COMMIT;

-- =============================================================================
-- POST-COMMIT VERIFICATION
-- Run these AFTER COMMIT. They must confirm:
--   1. Both tables exist.
--   2. RLS is enabled on both (relrowsecurity = true).
--   3. anon has INSERT but NOT SELECT.
--   4. No policy grants SELECT to any role.
--   5. Both INSERT policies pin user_id to auth.uid() (check_6), i.e. the
--      identity guard is actually in place and not a permissive true.
-- =============================================================================
SELECT 'volunteer_applications exists' AS check_1,
       to_regclass('public.volunteer_applications') IS NOT NULL AS passed;

SELECT 'partner_enquiries exists' AS check_2,
       to_regclass('public.partner_enquiries') IS NOT NULL AS passed;

SELECT 'rls enabled on both' AS check_3,
       c.relrowsecurity AS passed
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('volunteer_applications', 'partner_enquiries');

SELECT 'anon can insert but not select' AS check_4,
       has_table_privilege('anon', 'public.volunteer_applications', 'INSERT') AS can_insert,
       NOT has_table_privilege('anon', 'public.volunteer_applications', 'SELECT') AS cannot_select;

SELECT 'no select policy exists' AS check_5,
       count(*) FILTER (WHERE cmd = 'SELECT') = 0 AS passed
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('volunteer_applications', 'partner_enquiries');

-- Must return passed = true with one row per table. `qual` stays NULL because
-- an INSERT policy has no USING clause; the guard lives in `with_check`.
SELECT tablename,
       'insert policy pins user_id to auth.uid()' AS check_6,
       with_check LIKE '%auth.uid()%' AS passed
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('volunteer_applications', 'partner_enquiries')
  AND cmd = 'INSERT';
