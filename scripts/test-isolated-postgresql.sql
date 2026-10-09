-- =============================================================================
-- TEST HARNESS: scripts/test-isolated-postgresql.sql
-- DESCRIPTION: Standalone PostgreSQL Integration Test Harness for Partial Refunds
-- PURPOSE: Run against an ISOLATED / DISPOSABLE PostgreSQL database (Local Docker,
--          Supabase local CLI container, or a disposable scratch project).
--
-- SAFETY NOTICE:
--   - DO NOT EXECUTE AGAINST THE PRODUCTION / CLIENT LIVE DATABASE.
--   - This harness executes inside a transaction that calls ROLLBACK at the end,
--     leaving zero persistent test artifacts in the target database.
-- =============================================================================

BEGIN;

\echo '=== STARTING ISOLATED POSTGRESQL INTEGRATION TEST HARNESS ==='

-- -----------------------------------------------------------------------------
-- SETUP: Create temporary isolated schema for testing
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS test_refund_harness;
SET search_path = test_refund_harness, public;

-- Mock tables matching Walk With Us production schema
CREATE TABLE test_refund_harness.help_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  target_amount numeric(12,2) NOT NULL DEFAULT 0,
  raised_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'published'
);

CREATE TABLE test_refund_harness.donations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES test_refund_harness.help_requests(id),
  user_id uuid,
  donor_name text,
  donor_email text,
  donor_phone text,
  is_anonymous boolean DEFAULT false,
  amount_paise bigint NOT NULL,
  amount_refunded_paise bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'INR',
  payment_provider text DEFAULT 'razorpay',
  provider_order_id text,
  provider_payment_id text UNIQUE,
  provider_signature text,
  idempotency_key text,
  status text NOT NULL DEFAULT 'created',
  paid_at timestamptz,
  refunded_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT donations_status_check
    CHECK (status IN ('created', 'pending', 'paid', 'partially_refunded', 'failed', 'cancelled', 'refunded')),
  CONSTRAINT donations_amount_refunded_bounds_check
    CHECK (amount_refunded_paise >= 0 AND amount_refunded_paise <= amount_paise),
  CONSTRAINT donations_lifecycle_check
    CHECK (
      (status = 'created' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
      (status = 'pending' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
      (status = 'failed' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
      (status = 'cancelled' AND paid_at IS NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
      (status = 'paid' AND paid_at IS NOT NULL AND refunded_at IS NULL AND amount_refunded_paise = 0) OR
      (status = 'partially_refunded' AND paid_at IS NOT NULL AND refunded_at IS NULL AND amount_refunded_paise > 0 AND amount_refunded_paise < amount_paise) OR
      (status = 'refunded' AND paid_at IS NOT NULL AND refunded_at IS NOT NULL AND amount_refunded_paise = amount_paise)
    )
);

CREATE TABLE test_refund_harness.donation_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  donation_id uuid NOT NULL REFERENCES test_refund_harness.donations(id),
  request_id uuid REFERENCES test_refund_harness.help_requests(id),
  provider_refund_id text NOT NULL UNIQUE CHECK (char_length(provider_refund_id) <= 255),
  provider_payment_id text NOT NULL CHECK (char_length(provider_payment_id) <= 255),
  amount_paise bigint NOT NULL CHECK (amount_paise > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Deploy the process_razorpay_refund RPC into the test schema
CREATE OR REPLACE FUNCTION test_refund_harness.process_razorpay_refund(
  p_provider_refund_id text,
  p_provider_payment_id text,
  p_amount_paise bigint,
  p_currency text DEFAULT 'INR',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = test_refund_harness, pg_temp
AS $$
DECLARE
  v_existing_refund test_refund_harness.donation_refunds%ROWTYPE;
  v_donation test_refund_harness.donations%ROWTYPE;
  v_new_refunded_paise bigint;
  v_new_status text;
  v_new_refunded_at timestamptz;
  v_refund_id uuid;
BEGIN
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

  SELECT * INTO v_existing_refund
    FROM test_refund_harness.donation_refunds
   WHERE provider_refund_id = p_provider_refund_id;

  IF FOUND THEN
    IF v_existing_refund.provider_payment_id = p_provider_payment_id
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
  END IF;

  SELECT * INTO v_donation
    FROM test_refund_harness.donations
   WHERE provider_payment_id = p_provider_payment_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No donation found matching provider_payment_id %', p_provider_payment_id;
  END IF;

  IF v_donation.status NOT IN ('paid', 'partially_refunded') THEN
    RAISE EXCEPTION 'Donation % is not in a refundable status (current status: %)', v_donation.id, v_donation.status;
  END IF;

  IF (v_donation.amount_refunded_paise + p_amount_paise) > v_donation.amount_paise THEN
    RAISE EXCEPTION 'Refund of % paise exceeds remaining refundable balance of % paise',
      p_amount_paise, (v_donation.amount_paise - v_donation.amount_refunded_paise);
  END IF;

  BEGIN
    INSERT INTO test_refund_harness.donation_refunds (
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
      SELECT * INTO v_existing_refund
        FROM test_refund_harness.donation_refunds
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

  v_new_refunded_paise := v_donation.amount_refunded_paise + p_amount_paise;
  IF v_new_refunded_paise = v_donation.amount_paise THEN
    v_new_status := 'refunded';
    v_new_refunded_at := now();
  ELSE
    v_new_status := 'partially_refunded';
    v_new_refunded_at := NULL;
  END IF;

  UPDATE test_refund_harness.donations
     SET amount_refunded_paise = v_new_refunded_paise,
         status = v_new_status,
         refunded_at = v_new_refunded_at,
         updated_at = now()
   WHERE id = v_donation.id;

  IF v_donation.request_id IS NOT NULL THEN
    UPDATE test_refund_harness.help_requests
       SET raised_amount = GREATEST(0, COALESCE(raised_amount, 0) - (p_amount_paise / 100.0))
     WHERE id = v_donation.request_id;
  END IF;

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

-- Sanitized view in test harness
CREATE OR REPLACE VIEW test_refund_harness.public_donations AS
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
FROM test_refund_harness.donations d
WHERE (
  (d.status = 'paid' AND d.amount_refunded_paise = 0)
  OR
  (d.status = 'partially_refunded' AND d.amount_refunded_paise > 0 AND d.amount_refunded_paise < d.amount_paise)
)
AND (d.amount_paise - d.amount_refunded_paise) > 0;

-- -----------------------------------------------------------------------------
-- EXECUTE 12 INTEGRATION TEST CASES
-- -----------------------------------------------------------------------------

-- SEED DATA: 1 Fundraiser and 3 Donations
INSERT INTO test_refund_harness.help_requests (id, title, target_amount, raised_amount)
VALUES ('00000000-0000-0000-0000-000000000001', 'Synthetic Test Fundraiser', 50000, 3000);

-- Donation 1: ₹1,000 paid
INSERT INTO test_refund_harness.donations (id, request_id, amount_paise, status, provider_payment_id, paid_at)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 100000, 'paid', 'pay_test_01', now());

-- Donation 2: ₹1,500 paid
INSERT INTO test_refund_harness.donations (id, request_id, amount_paise, status, provider_payment_id, paid_at)
VALUES ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001', 150000, 'paid', 'pay_test_02', now());

-- Donation 3: ₹500 paid (General fund, request_id NULL)
INSERT INTO test_refund_harness.donations (id, request_id, amount_paise, status, provider_payment_id, paid_at)
VALUES ('00000000-0000-0000-0000-000000000030', NULL, 50000, 'paid', 'pay_test_general', now());

-- TEST 1: Initial donation and fundraiser totals
DO $$
DECLARE
  v_raised numeric;
BEGIN
  SELECT raised_amount INTO v_raised FROM test_refund_harness.help_requests WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_raised != 3000 THEN RAISE EXCEPTION 'TEST 1 FAILED: Expected raised 3000, got %', v_raised; END IF;
  RAISE NOTICE '[PASS] TEST 1: Initial donation and fundraiser totals verified';
END $$;

-- TEST 2: Single partial refund
DO $$
DECLARE
  v_res jsonb;
  v_raised numeric;
BEGIN
  v_res := test_refund_harness.process_razorpay_refund('rfnd_test_01', 'pay_test_01', 30000);
  IF (v_res->>'status') != 'partially_refunded' THEN RAISE EXCEPTION 'TEST 2 FAILED: Expected partially_refunded, got %', v_res; END IF;
  SELECT raised_amount INTO v_raised FROM test_refund_harness.help_requests WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_raised != 2700 THEN RAISE EXCEPTION 'TEST 2 FAILED: Expected raised 2700, got %', v_raised; END IF;
  RAISE NOTICE '[PASS] TEST 2: Single partial refund verified';
END $$;

-- TEST 3: Multiple sequential partial refunds
DO $$
DECLARE
  v_res jsonb;
  v_raised numeric;
BEGIN
  v_res := test_refund_harness.process_razorpay_refund('rfnd_test_02a', 'pay_test_02', 50000);
  v_res := test_refund_harness.process_razorpay_refund('rfnd_test_02b', 'pay_test_02', 50000);
  SELECT raised_amount INTO v_raised FROM test_refund_harness.help_requests WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_raised != 1700 THEN RAISE EXCEPTION 'TEST 3 FAILED: Expected raised 1700, got %', v_raised; END IF;
  RAISE NOTICE '[PASS] TEST 3: Multiple sequential partial refunds verified';
END $$;

-- TEST 4: Final refund completing the balance
DO $$
DECLARE
  v_res jsonb;
  v_status text;
  v_refunded_at timestamptz;
BEGIN
  v_res := test_refund_harness.process_razorpay_refund('rfnd_test_01_final', 'pay_test_01', 70000);
  SELECT status, refunded_at INTO v_status, v_refunded_at FROM test_refund_harness.donations WHERE id = '00000000-0000-0000-0000-000000000010';
  IF v_status != 'refunded' OR v_refunded_at IS NULL THEN RAISE EXCEPTION 'TEST 4 FAILED: Expected status refunded and non-null refunded_at'; END IF;
  RAISE NOTICE '[PASS] TEST 4: Final refund completing balance verified';
END $$;

-- TEST 5: Duplicate delivery of same refund ID (idempotency)
DO $$
DECLARE
  v_res jsonb;
  v_raised_before numeric;
  v_raised_after numeric;
BEGIN
  SELECT raised_amount INTO v_raised_before FROM test_refund_harness.help_requests WHERE id = '00000000-0000-0000-0000-000000000001';
  v_res := test_refund_harness.process_razorpay_refund('rfnd_test_02a', 'pay_test_02', 50000);
  IF (v_res->>'already_processed')::boolean != true THEN RAISE EXCEPTION 'TEST 5 FAILED: Expected already_processed = true'; END IF;
  SELECT raised_amount INTO v_raised_after FROM test_refund_harness.help_requests WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_raised_before != v_raised_after THEN RAISE EXCEPTION 'TEST 5 FAILED: Raised amount changed on duplicate delivery!'; END IF;
  RAISE NOTICE '[PASS] TEST 5: Duplicate refund delivery idempotency verified';
END $$;

-- TEST 6: Reuse of refund ID with conflicting data rejected
DO $$
BEGIN
  PERFORM test_refund_harness.process_razorpay_refund('rfnd_test_02a', 'pay_test_02', 99999);
  RAISE EXCEPTION 'TEST 6 FAILED: Conflicting refund ID should have thrown error!';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Conflicting refund%' THEN RAISE; END IF;
    RAISE NOTICE '[PASS] TEST 6: Conflicting refund ID reuse rejected';
END $$;

-- TEST 7: Overflow refund exceeding original donation amount rejected
DO $$
BEGIN
  -- pay_test_02 already had 100,000 refunded out of 150,000 (remaining: 50,000). Trying to refund 60,000 must fail.
  PERFORM test_refund_harness.process_razorpay_refund('rfnd_test_02_overflow', 'pay_test_02', 60000);
  RAISE EXCEPTION 'TEST 7 FAILED: Overflow refund should have thrown error!';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%exceeds remaining refundable balance%' THEN RAISE; END IF;
    RAISE NOTICE '[PASS] TEST 7: Overflow refund exceeding donation amount rejected';
END $$;

-- TEST 8: Transaction rollback when a database operation fails
DO $$
DECLARE
  v_count_before int;
  v_count_after int;
BEGIN
  SELECT count(*) INTO v_count_before FROM test_refund_harness.donation_refunds;
  BEGIN
    -- Force failure inside nested block
    PERFORM test_refund_harness.process_razorpay_refund('rfnd_test_bad', 'pay_test_02', 9999999);
  EXCEPTION WHEN OTHERS THEN
    -- Expected error caught
  END;
  SELECT count(*) INTO v_count_after FROM test_refund_harness.donation_refunds;
  IF v_count_before != v_count_after THEN RAISE EXCEPTION 'TEST 8 FAILED: Partial mutation committed despite failure!'; END IF;
  RAISE NOTICE '[PASS] TEST 8: Transaction rollback verified';
END $$;

-- TEST 9: General-fund donation with request_id NULL works without error
DO $$
DECLARE
  v_res jsonb;
  v_d test_refund_harness.donations%ROWTYPE;
BEGIN
  v_res := test_refund_harness.process_razorpay_refund('rfnd_gen_01', 'pay_test_general', 20000);
  SELECT * INTO v_d FROM test_refund_harness.donations WHERE provider_payment_id = 'pay_test_general';
  IF v_d.amount_refunded_paise != 20000 OR v_d.status != 'partially_refunded' THEN
    RAISE EXCEPTION 'TEST 9 FAILED: General fund donation not updated properly';
  END IF;
  RAISE NOTICE '[PASS] TEST 9: General-fund donation (request_id NULL) refund verified';
END $$;

-- TEST 10: Old-webhook migration-gap guard (direct update rejected by constraint)
DO $$
BEGIN
  -- Simulate old webhook: UPDATE donations SET status = 'refunded' without setting amount_refunded_paise
  UPDATE test_refund_harness.donations
     SET status = 'refunded', refunded_at = now()
   WHERE provider_payment_id = 'pay_test_general';
  RAISE EXCEPTION 'TEST 10 FAILED: Direct legacy update should have failed constraint!';
EXCEPTION
  WHEN check_violation THEN
    RAISE NOTICE '[PASS] TEST 10: Old-webhook migration-gap guard rejected legacy update';
END $$;

-- TEST 11: Public donation view net amounts and access restrictions
DO $$
DECLARE
  v_count int;
  v_net_d2 bigint;
BEGIN
  -- Pay 1 is fully refunded -> MUST NOT APPEAR
  SELECT count(*) INTO v_count FROM test_refund_harness.public_donations WHERE id = '00000000-0000-0000-0000-000000000010';
  IF v_count != 0 THEN RAISE EXCEPTION 'TEST 11 FAILED: Fully refunded donation appeared in public view!'; END IF;

  -- Pay 2 had 150,000 originally with 100,000 refunded -> Net must be 50,000
  SELECT amount_paise INTO v_net_d2 FROM test_refund_harness.public_donations WHERE id = '00000000-0000-0000-0000-000000000020';
  IF v_net_d2 != 50000 THEN RAISE EXCEPTION 'TEST 11 FAILED: Expected net 50000, got %', v_net_d2; END IF;

  RAISE NOTICE '[PASS] TEST 11: Public view correctly displays net contributions';
END $$;

-- TEST 12: Exact raised_amount reconciliation
DO $$
DECLARE
  v_raised numeric;
  v_expected numeric;
BEGIN
  -- Initial: 3000. D1 refunded 1000 (300+700). D2 refunded 1000 (500+500). General fund: does not affect fundraiser.
  -- Expected raised = 3000 - 1000 - 1000 = 1000.
  SELECT raised_amount INTO v_raised FROM test_refund_harness.help_requests WHERE id = '00000000-0000-0000-0000-000000000001';
  IF v_raised != 1000.00 THEN RAISE EXCEPTION 'TEST 12 FAILED: Expected 1000.00, got %', v_raised; END IF;
  RAISE NOTICE '[PASS] TEST 12: Fundraiser raised_amount reconciled exactly';
END $$;

\echo '=== ALL 12 ISOLATED POSTGRESQL INTEGRATION TESTS PASSED ==='

-- CLEANUP: Roll back test transaction completely to leave zero traces
ROLLBACK;
\echo '=== TRANSACTION ROLLED BACK CLEANLY (ZERO DATABASE TRACES) ==='
