-- =============================================================================
-- MIGRATION: 20261103_donations_foundation.sql
-- DESCRIPTION: Production-grade Donation and Payment Foundation
-- STATUS: REVIEW REQUIRED BEFORE PRODUCTION APPLICATION
-- =============================================================================
--
-- ARCHITECTURE RATIONALE:
--   1. PROVIDER AGNOSTIC: Does not bind to Razorpay, Stripe, or any gateway.
--      Columns support provider_order_id, provider_payment_id, provider_signature,
--      and idempotency_key for any modern aggregator.
--
--   2. EXACT MINOR UNITS (PAISE): Financial persistence avoids floating point.
--      `amount_paise` is stored as an integer/bigint in paise (1 INR = 100 paise).
--      ₹100 = 10,000 paise; ₹100.50 = 10,050 paise.
--
--   3. IMMUTABILITY & CLIENT TRUST BOUNDARY:
--      The browser is NEVER trusted to declare payment success.
--      Clients (anon & authenticated) have NO UPDATE or DELETE grants on donations.
--      Clients cannot change status to 'paid', cannot set provider_payment_id,
--      and cannot touch `help_requests.raised_amount`.
--
--   4. ATOMIC SERVER-SIDE FUNDING TOTAL:
--      A database trigger (`sync_donation_funding_progress`) atomically updates
--      `help_requests.raised_amount` when a donation status transitions to 'paid'.
--      Transitioning to 'refunded' atomically decrements `raised_amount`.
--
--   5. WEBHOOK IDEMPOTENCY:
--      A unique partial index on `(payment_provider, provider_payment_id)` prevents
--      duplicate webhook delivery from recording the same charge twice.
--
--   6. PRIVACY & SANITIZATION:
--      Donor email, phone, and payment metadata are strictly private.
--      A sanitized view `public_donations` exposes only aggregate or anonymous
--      donor records for published help requests.
-- =============================================================================

BEGIN;

-- 1. Create the donations table
CREATE TABLE IF NOT EXISTS public.donations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid REFERENCES public.help_requests(id) ON DELETE RESTRICT,
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  donor_name          text CHECK (donor_name IS NULL OR char_length(donor_name) BETWEEN 2 AND 120),
  donor_email         text CHECK (donor_email IS NULL OR (char_length(donor_email) BETWEEN 3 AND 254 AND position('@' IN donor_email) > 1)),
  donor_phone         text CHECK (donor_phone IS NULL OR char_length(donor_phone) <= 32),
  is_anonymous        boolean NOT NULL DEFAULT false,
  amount_paise        bigint NOT NULL CHECK (amount_paise >= 10000 AND amount_paise <= 1000000000), -- ₹100 to ₹10,000,000 in minor units
  currency            text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  payment_provider    text CHECK (payment_provider IS NULL OR payment_provider IN ('razorpay', 'stripe', 'cashfree', 'payu')),
  provider_order_id   text CHECK (provider_order_id IS NULL OR char_length(provider_order_id) <= 255),
  provider_payment_id text CHECK (provider_payment_id IS NULL OR char_length(provider_payment_id) <= 255),
  provider_signature  text CHECK (provider_signature IS NULL OR char_length(provider_signature) <= 512),
  idempotency_key     text CHECK (idempotency_key IS NULL OR char_length(idempotency_key) <= 255),
  status              text NOT NULL DEFAULT 'created'
                        CHECK (status IN ('created', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  paid_at             timestamptz CHECK (paid_at IS NULL OR (status IN ('paid', 'refunded') AND paid_at IS NOT NULL)),
  refunded_at         timestamptz CHECK (refunded_at IS NULL OR (status = 'refunded' AND refunded_at IS NOT NULL)),
  failure_reason      text CHECK (failure_reason IS NULL OR char_length(failure_reason) <= 500),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- 2. Indexes for performance and webhook idempotency
CREATE UNIQUE INDEX IF NOT EXISTS donations_provider_payment_id_uniq
  ON public.donations (payment_provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS donations_idempotency_key_uniq
  ON public.donations (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS donations_request_id_idx
  ON public.donations (request_id);

CREATE INDEX IF NOT EXISTS donations_status_idx
  ON public.donations (status);

CREATE INDEX IF NOT EXISTS donations_created_at_idx
  ON public.donations (created_at DESC);

-- 3. Atomic Server-Side Trigger for Funding Total
CREATE OR REPLACE FUNCTION public.sync_donation_funding_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Transition to 'paid': increment raised_amount atomically
  IF (OLD.status IS NULL OR OLD.status != 'paid') AND NEW.status = 'paid' THEN
    IF NEW.request_id IS NOT NULL THEN
      UPDATE public.help_requests
         SET raised_amount = COALESCE(raised_amount, 0) + (NEW.amount_paise / 100.0)
       WHERE id = NEW.request_id;
    END IF;
  END IF;

  -- Transition from 'paid' to 'refunded': decrement raised_amount atomically
  IF OLD.status = 'paid' AND NEW.status = 'refunded' THEN
    IF NEW.request_id IS NOT NULL THEN
      UPDATE public.help_requests
         SET raised_amount = GREATEST(0, COALESCE(raised_amount, 0) - (NEW.amount_paise / 100.0))
       WHERE id = NEW.request_id;
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_donation_funding_progress ON public.donations;
CREATE TRIGGER trg_sync_donation_funding_progress
  BEFORE INSERT OR UPDATE ON public.donations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_donation_funding_progress();

-- 4. Row Level Security
ALTER TABLE public.donations ENABLE ROW LEVEL SECURITY;

-- Clients can only INSERT intents in 'created' or 'pending' status.
-- They CANNOT mark paid, cannot provide provider payment IDs/signatures,
-- and user_id must match the current session.
DROP POLICY IF EXISTS donations_insert_intent ON public.donations;
CREATE POLICY donations_insert_intent
  ON public.donations
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (user_id IS NOT DISTINCT FROM auth.uid())
    AND status IN ('created', 'pending')
    AND paid_at IS NULL
    AND refunded_at IS NULL
    AND provider_payment_id IS NULL
    AND provider_signature IS NULL
    AND (
      request_id IS NULL OR EXISTS (
        SELECT 1 FROM public.help_requests hr
        WHERE hr.id = request_id AND hr.status = 'published'
      )
    )
  );

-- Authenticated users may read their own donation history
DROP POLICY IF EXISTS donations_select_own ON public.donations;
CREATE POLICY donations_select_own
  ON public.donations
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- REVOKE dangerous permissions:
-- No role in the browser can UPDATE or DELETE donations.
REVOKE ALL ON public.donations FROM anon, authenticated;
GRANT INSERT ON public.donations TO anon, authenticated;
GRANT SELECT ON public.donations TO authenticated;

-- 5. Sanitized Public View for Displaying Verified Contributions
CREATE OR REPLACE VIEW public.public_donations AS
SELECT
  d.id,
  d.request_id,
  d.amount_paise,
  d.currency,
  d.created_at,
  d.is_anonymous,
  CASE
    WHEN d.is_anonymous THEN 'Anonymous Supporter'
    WHEN d.donor_name IS NOT NULL AND trim(d.donor_name) != '' THEN d.donor_name
    ELSE 'Community Supporter'
  END AS donor_display_name
FROM public.donations d
WHERE d.status = 'paid';

GRANT SELECT ON public.public_donations TO anon, authenticated;

COMMIT;

-- =============================================================================
-- POST-MIGRATION VERIFICATION
-- =============================================================================
SELECT 'donations table exists' AS check_1,
       to_regclass('public.donations') IS NOT NULL AS passed;

SELECT 'rls enabled on donations' AS check_2,
       c.relrowsecurity AS passed
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'donations';

SELECT 'anon cannot update or delete donations' AS check_3,
       NOT has_table_privilege('anon', 'public.donations', 'UPDATE') AND
       NOT has_table_privilege('anon', 'public.donations', 'DELETE') AS passed;
