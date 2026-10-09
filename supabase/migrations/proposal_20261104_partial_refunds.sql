-- =============================================================================
-- MIGRATION PROPOSAL: proposal_20261104_partial_refunds.sql
-- DESCRIPTION: Atomic Partial & Full Refund Accounting Architecture (RPC + Ledger)
-- STATUS: DRAFT PROPOSAL FOR PRODUCTION SAFETY REVIEW - DO NOT APPLY AUTOMATICALLY
-- =============================================================================
--
-- ARCHITECTURE RATIONALE:
--   1. AUDITABLE REFUND LEDGER: Creates public.donation_refunds to record every refund
--      event with its provider_refund_id (rfnd_...), payment ID, amount, and timestamp.
--   2. EXACT MULTI-REFUND IDEMPOTENCY: UNIQUE constraint on provider_refund_id
--      ensures multiple webhook deliveries for the same refund ID cannot decrement twice.
--   3. ATOMIC RPC TRANSACTION: Encapsulates row-level locking (FOR UPDATE), parameter validation,
--      idempotency verification, ledger insertion, status updating, and fundraiser
--      decrement into a single atomic SECURITY DEFINER procedure: process_razorpay_refund().
--   4. GAP-SAFE CONSTRAINT & TRIGGER GUARDS:
--      - donations_lifecycle_check enforces strict state invariants for all statuses.
--      - sync_donation_funding_progress rejects legacy direct updates to 'refunded'
--        if amount_refunded_paise does not equal amount_paise, returning HTTP 500
--        during any migration-to-deployment gap.
--   5. PRESERVES DONATION PAYMENT HISTORY: Original amount_paise is immutable.
--      Cumulative refunds are tracked in amount_refunded_paise.
--   6. GENERAL FUND SAFE: If request_id IS NULL, refunds process without attempting
--      to update a nonexistent help request.
--   7. SANITIZED PUBLIC VIEW: Excludes fully refunded donations and shows exact net
--      contributions (amount_paise - amount_refunded_paise) for active/partial donations.
--   8. RACE CONDITION RESILIENT: Caught unique_violation on concurrent insertions allows
--      immediate idempotent acknowledgment without transient HTTP 500 retries.
-- =============================================================================

BEGIN;

-- 1. Add amount_refunded_paise tracking column to public.donations
ALTER TABLE public.donations
  ADD COLUMN IF NOT EXISTS amount_refunded_paise bigint NOT NULL DEFAULT 0;

-- 2. Clean up legacy constraints on public.donations
ALTER TABLE public.donations
  DROP CONSTRAINT IF EXISTS donations_status_check,
  DROP CONSTRAINT IF EXISTS donations_check,
  DROP CONSTRAINT IF EXISTS donations_check1,
  DROP CONSTRAINT IF EXISTS donations_amount_refunded_check,
  DROP CONSTRAINT IF EXISTS donations_amount_refunded_bounds_check,
  DROP CONSTRAINT IF EXISTS donations_lifecycle_check;

-- 3. Add upgraded status check constraint
ALTER TABLE public.donations
  ADD CONSTRAINT donations_status_check
  CHECK (status IN ('created', 'pending', 'paid', 'partially_refunded', 'failed', 'cancelled', 'refunded'));

-- 4. Add amount_refunded_paise bounds constraint
ALTER TABLE public.donations
  ADD CONSTRAINT donations_amount_refunded_bounds_check
  CHECK (amount_refunded_paise >= 0 AND amount_refunded_paise <= amount_paise);

-- 5. Add strict donation lifecycle state machine constraint
-- Enforces:
-- - created/pending/failed/cancelled: paid_at IS NULL, refunded_at IS NULL, amount_refunded_paise = 0
-- - paid: paid_at IS NOT NULL, refunded_at IS NULL, amount_refunded_paise = 0
-- - partially_refunded: paid_at IS NOT NULL, refunded_at IS NULL, 0 < amount_refunded_paise < amount_paise
-- - refunded: paid_at IS NOT NULL, refunded_at IS NOT NULL, amount_refunded_paise = amount_paise
ALTER TABLE public.donations
  ADD CONSTRAINT donations_lifecycle_check
  CHECK (
    (status = 'created' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
    (status = 'pending' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
    (status = 'failed' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
    (status = 'cancelled' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
    (status = 'paid' AND paid_at IS NOT NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
    (status = 'partially_refunded' AND paid_at IS NOT NULL AND refunded_at IS NULL AND amount_refunded_paise > 0 AND amount_refunded_paise < amount_paise) OR
    (status = 'refunded' AND paid_at IS NOT NULL AND refunded_at IS NOT NULL AND amount_refunded_paise = amount_paise)
  );

-- 6. Create dedicated donation_refunds audit ledger
CREATE TABLE IF NOT EXISTS public.donation_refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id           uuid NOT NULL REFERENCES public.donations(id) ON DELETE RESTRICT,
  request_id            uuid REFERENCES public.help_requests(id) ON DELETE RESTRICT,
  provider_refund_id    text NOT NULL UNIQUE CHECK (char_length(provider_refund_id) <= 255),
  provider_payment_id   text NOT NULL CHECK (char_length(provider_payment_id) <= 255),
  amount_paise          bigint NOT NULL CHECK (amount_paise > 0),
  currency              text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  reason                text CHECK (reason IS NULL OR char_length(reason) <= 500),
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS donation_refunds_donation_id_idx
  ON public.donation_refunds (donation_id);

CREATE INDEX IF NOT EXISTS donation_refunds_provider_payment_id_idx
  ON public.donation_refunds (provider_payment_id);

-- Restrict direct access to donation_refunds
ALTER TABLE public.donation_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.donation_refunds FROM anon, authenticated;
GRANT SELECT ON public.donation_refunds TO authenticated;

-- 7. Atomic SECURITY DEFINER RPC for processing refunds
CREATE OR REPLACE FUNCTION public.process_razorpay_refund(
  p_provider_refund_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_currency text DEFAULT 'INR',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_refund public.donation_refunds%ROWTYPE;
  v_donation public.donations%ROWTYPE;
  v_new_refunded_paise bigint;
  v_new_status public.donations.status%TYPE;
  v_new_refunded_at timestamptz;
  v_refund_id uuid;
BEGIN
  -- 1. Input parameter validations
  IF p_provider_refund_id IS NULL OR trim(p_provider_refund_id) = '' THEN
    RAISE EXCEPTION 'p_provider_refund_id is required';
  END IF;

  IF p_provider_payment_id IS NULL OR trim(p_provider_payment_id) = '' THEN
    RAISE EXCEPTION 'p_provider_payment_id is required';
  END IF;

  IF p_currency IS NULL OR p_currency != 'INR' THEN
    RAISE EXCEPTION 'Currency must be INR';
  END IF;

  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be a positive integer in paise';
  END IF;

  -- 2. Idempotency Check on provider_refund_id
  SELECT * INTO v_existing_refund
    FROM public.donation_refunds
   WHERE provider_refund_id = p_provider_refund_id;

  IF FOUND THEN
    -- Identical duplicate delivery check
    IF v_existing_refund.provider_payment_id = p_provider_payment_id
       AND v_existing_refund.amount_paise = p_amount_paise THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_processed', true,
        'refund_id', p_provider_refund_id,
        'donation_id', v_existing_refund.donation_id
      );
    ELSE
      -- Conflicting duplicate: same refund ID with mismatched details
      RAISE EXCEPTION 'Conflicting refund: refund ID % already exists with different payment ID or amount', p_provider_refund_id;
    END IF;
  END IF;

  -- 3. Lock donation row FOR UPDATE
  SELECT * INTO v_donation
    FROM public.donations
   WHERE provider_payment_id = p_provider_payment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No donation found matching provider_payment_id %', p_provider_payment_id;
  END IF;

  -- 4. Status validation
  IF v_donation.status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Donation % is not in a refundable status (current status: %)', v_donation.id, v_donation.status;
  END IF;

  -- 5. Cumulative bounds check
  IF (v_donation.amount_refunded_paise + p_amount_paise) > v_donation.amount_paise THEN
    RAISE EXCEPTION 'Refund of % paise exceeds remaining refundable balance of % paise',
      p_amount_paise, (v_donation.amount_paise - v_donation.amount_refunded_paise);
  END IF;

  -- 6. Insert audit ledger row with race-condition exception handling
  BEGIN
    INSERT INTO public.donation_refunds (
      donation_id,
      request_id,
      provider_refund_id,
      provider_payment_id,
      amount_paise,
      currency,
      reason
    ) VALUES (
      v_donation.id,
      v_donation.request_id,
      p_provider_refund_id,
      p_provider_payment_id,
      p_amount_paise,
      p_currency,
      p_reason
    ) RETURNING id INTO v_refund_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- In case of concurrent race condition on provider_refund_id:
      SELECT * INTO v_existing_refund
        FROM public.donation_refunds
       WHERE provider_refund_id = p_provider_refund_id;

      IF FOUND AND v_existing_refund.provider_payment_id = p_provider_payment_id
               AND v_existing_refund.amount_paise = p_amount_paise THEN
        RETURN jsonb_build_object(
          'success', true,
          'already_processed', true,
          'refund_id', p_provider_refund_id,
          'donation_id', v_existing_refund.donation_id
        );
      ELSE
        RAISE EXCEPTION 'Conflicting refund: refund ID % already exists with different payment ID or amount', p_provider_refund_id;
      END IF;
  END;

  -- 7. Compute updated state
  v_new_refunded_paise := v_donation.amount_refunded_paise + p_amount_paise;
  IF v_new_refunded_paise = v_donation.amount_paise THEN
    v_new_status := 'refunded';
    v_new_refunded_at := now();
  ELSE
    v_new_status := 'partially_refunded';
    v_new_refunded_at := NULL;
  END IF;

  -- 8. Update donation row
  UPDATE public.donations
     SET amount_refunded_paise = v_new_refunded_paise,
         status = v_new_status,
         refunded_at = v_new_refunded_at,
         updated_at = now()
   WHERE id = v_donation.id;

  -- 9. Decrement fundraiser raised_amount ONLY if request_id IS NOT NULL
  IF v_donation.request_id IS NOT NULL THEN
    UPDATE public.help_requests
       SET raised_amount = GREATEST(0, COALESCE(raised_amount, 0) - (p_amount_paise / 100.0))
     WHERE id = v_donation.request_id;
  END IF;

  -- 10. Return structured result
  RETURN jsonb_build_object(
    'success', true,
    'already_processed', false,
    'donation_id', v_donation.id,
    'refund_id', p_provider_refund_id,
    'status', v_new_status,
    'amount_paise', p_amount_paise,
    'amount_refunded_paise', v_new_refunded_paise,
    'remaining_paise', (v_donation.amount_paise - v_new_refunded_paise)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_razorpay_refund(text, text, bigint, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.process_razorpay_refund(text, text, bigint, text, text) TO authenticated, service_role;

-- 8. Update sync_donation_funding_progress on public.donations
-- Prevents legacy direct status updates during deployment gap
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

  -- Guard against legacy direct status updates to 'refunded' that bypass RPC
  IF OLD.status IN ('paid', 'partially_refunded') AND NEW.status = 'refunded' AND NEW.amount_refunded_paise != NEW.amount_paise THEN
    RAISE EXCEPTION 'Direct update to refunded rejected: refunds must be processed through process_razorpay_refund RPC';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 9. Recreate sanitized public_donations view
CREATE OR REPLACE VIEW public.public_donations AS
SELECT
  d.id,
  d.request_id,
  (d.amount_paise - d.amount_refunded_paise) AS amount_paise,
  d.currency,
  d.created_at,
  d.is_anonymous,
  CASE
    WHEN d.is_anonymous THEN 'Anonymous Supporter'
    WHEN d.donor_name IS NOT NULL AND trim(d.donor_name) != '' THEN d.donor_name
    ELSE 'Community Supporter'
  END AS donor_display_name
FROM public.donations d
WHERE (
  (d.status = 'paid' AND d.amount_refunded_paise = 0)
  OR
  (d.status = 'partially_refunded' AND d.amount_refunded_paise > 0 AND d.amount_refunded_paise < d.amount_paise)
)
AND (d.amount_paise - d.amount_refunded_paise) > 0;

GRANT SELECT ON public.public_donations TO anon, authenticated;

COMMIT;
