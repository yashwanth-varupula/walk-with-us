-- =============================================================================
-- BOOTSTRAP: scripts/ci/bootstrap-supabase-compat.sql
-- DESCRIPTION: Minimal Supabase Compatibility Layer for Isolated PostgreSQL Testing
-- PURPOSE: Simulates only the external objects expected by the migrations
--          (auth schema, auth.uid(), roles, and base public.help_requests table)
--          without installing any heavyweight or proprietary Supabase containers.
--
-- STRICT SAFETY:
--   - For use ONLY on a disposable test database in CI (e.g. GitHub Actions)
--     or a local scratch database.
--   - DO NOT run against the live linked project.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Create auth schema and minimal users table
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz DEFAULT now()
);

-- Mock auth.uid() function used by Supabase RLS policies
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULL::uuid;
$$;

-- 2. Create standard Supabase roles if they do not exist
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Grant schema usage to standard roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- 4. Base application table referenced by donations foundation
CREATE TABLE IF NOT EXISTS public.help_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_amount numeric(12,2) NOT NULL DEFAULT 0,
  raised_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
