/**
 * Real PostgreSQL Multi-Connection Integration Test Harness for Razorpay Partial Refunds.
 *
 * PURPOSE:
 * Executes the real migrations (20261103_donations_foundation.sql & proposal_20261104_partial_refunds.sql)
 * and tests the actual public.process_razorpay_refund RPC and public.donations triggers.
 * Includes genuine multi-client concurrency tests using separate database connections.
 *
 * STRICT SAFETY REQUIREMENTS:
 * - DO NOT RUN AGAINST THE PRODUCTION / CLIENT LIVE DATABASE.
 * - Requires a disposable PostgreSQL database (e.g. in GitHub Actions CI or local scratch DB).
 * - Fails cleanly if DATABASE_URL is not set or if pg driver is not installed.
 */

import assert from 'node:assert/strict';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.log('=== REAL POSTGRESQL INTEGRATION TEST HARNESS ===');
  console.log('NOTICE: DATABASE_URL environment variable is not set.');
  console.log('No isolated PostgreSQL instance detected in the local environment.');
  console.log('To run this test suite in an isolated staging or CI environment:');
  console.log('  1. Provision a disposable PostgreSQL 15/16 database (e.g. GitHub Actions).');
  console.log('  2. Apply scripts/ci/bootstrap-supabase-compat.sql');
  console.log('  3. Apply supabase/migrations/20261103_donations_foundation.sql');
  console.log('  4. Apply supabase/migrations/proposal_20261104_partial_refunds.sql');
  console.log('  5. Run: DATABASE_URL=<disposable_pg_url> node scripts/test-real-pg-integration.js\n');
  if (process.env.CI) {
    console.error('ERROR: CI environment requires DATABASE_URL to run integration tests.');
    process.exit(1);
  }
  process.exit(0);
}

let Client;
try {
  const pgModule = await import('pg');
  Client = pgModule.default?.Client || pgModule.Client;
} catch {
  console.log('=== REAL POSTGRESQL INTEGRATION TEST HARNESS ===');
  console.log('NOTICE: The "pg" driver is not installed in the local environment.');
  console.log('Install with: npm install --no-save pg');
  if (process.env.CI) {
    console.error('ERROR: CI environment requires pg package.');
    process.exit(1);
  }
  process.exit(0);
}

console.log('=== RUNNING REAL POSTGRESQL MULTI-CONNECTION INTEGRATION TESTS ===\n');

// Establish two genuinely separate database connections for concurrency testing
const client1 = new Client({ connectionString: databaseUrl });
const client2 = new Client({ connectionString: databaseUrl });

await client1.connect();
await client2.connect();

let passedTests = 0;

async function runRealTest(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ${name}:`, err.message);
    await client1.end().catch(() => {});
    await client2.end().catch(() => {});
    process.exit(1);
  }
}

try {
  // Clean synthetic tables before running tests
  await client1.query('DELETE FROM public.donation_refunds;');
  await client1.query('DELETE FROM public.donations;');
  await client1.query('DELETE FROM public.help_requests;');

  // SEED SYNTHETIC TEST FIXTURES
  const helpRequestId = '11111111-1111-1111-1111-111111111111';
  await client1.query(`
    INSERT INTO public.help_requests (id, title, target_amount, raised_amount, status)
    VALUES ($1, 'Synthetic Test Cancer Relief', 50000.00, 3000.00, 'published');
  `, [helpRequestId]);

  // Seed 3 synthetic paid donations totalling ₹3,000 (300,000 paise)
  // Donation 1: ₹1,000 (100,000 paise)
  await client1.query(`
    INSERT INTO public.donations (id, request_id, amount_paise, status, payment_provider, provider_payment_id, paid_at)
    VALUES ('22222222-2222-2222-2222-222222222221', $1, 100000, 'paid', 'razorpay', 'pay_real_test_01', now());
  `, [helpRequestId]);

  // Donation 2: ₹1,500 (150,000 paise)
  await client1.query(`
    INSERT INTO public.donations (id, request_id, amount_paise, status, payment_provider, provider_payment_id, paid_at)
    VALUES ('22222222-2222-2222-2222-222222222222', $1, 150000, 'paid', 'razorpay', 'pay_real_test_02', now());
  `, [helpRequestId]);

  // Donation 3: ₹500 (50,000 paise) - General fund (request_id NULL)
  await client1.query(`
    INSERT INTO public.donations (id, request_id, amount_paise, status, payment_provider, provider_payment_id, paid_at)
    VALUES ('22222222-2222-2222-2222-222222222223', NULL, 50000, 'paid', 'razorpay', 'pay_real_test_general', now());
  `);

  // ---------------------------------------------------------------------------
  // TEST 1: Initial donation and fundraiser totals
  // ---------------------------------------------------------------------------
  await runRealTest('1. Donation begins paid with correct initial fundraiser total', async () => {
    const res = await client1.query('SELECT raised_amount FROM public.help_requests WHERE id = $1', [helpRequestId]);
    assert.equal(Number(res.rows[0].raised_amount), 3000.00);

    const dRes = await client1.query('SELECT status, amount_refunded_paise, paid_at, refunded_at FROM public.donations WHERE provider_payment_id = $1', ['pay_real_test_01']);
    assert.equal(dRes.rows[0].status, 'paid');
    assert.equal(Number(dRes.rows[0].amount_refunded_paise), 0);
    assert.notEqual(dRes.rows[0].paid_at, null);
    assert.equal(dRes.rows[0].refunded_at, null);
  });

  // ---------------------------------------------------------------------------
  // TEST 2: Single partial refund decreases raised_amount exactly once
  // ---------------------------------------------------------------------------
  await runRealTest('2. A single partial refund decreases raised_amount exactly once', async () => {
    // Refund ₹300 (30,000 paise) on pay_real_test_01
    const res = await client1.query(`
      SELECT public.process_razorpay_refund('rfnd_real_01', 'pay_real_test_01', 30000, 'INR', 'Partial test refund') AS result;
    `);
    const rpcResult = res.rows[0].result;
    assert.equal(rpcResult.success, true);
    assert.equal(rpcResult.status, 'partially_refunded');
    assert.equal(rpcResult.amount_refunded_paise, 30000);
    assert.equal(rpcResult.remaining_paise, 70000);

    const hrRes = await client1.query('SELECT raised_amount FROM public.help_requests WHERE id = $1', [helpRequestId]);
    assert.equal(Number(hrRes.rows[0].raised_amount), 2700.00); // Exactly ₹300 decremented

    const dRes = await client1.query('SELECT status, refunded_at FROM public.donations WHERE provider_payment_id = $1', ['pay_real_test_01']);
    assert.equal(dRes.rows[0].status, 'partially_refunded');
    assert.equal(dRes.rows[0].refunded_at, null); // refunded_at must remain NULL
  });

  // ---------------------------------------------------------------------------
  // TEST 3: Multiple sequential partial refunds accumulate correctly
  // ---------------------------------------------------------------------------
  await runRealTest('3. Multiple sequential partial refunds accumulate correctly', async () => {
    // Refund ₹500 (50,000 paise) on pay_real_test_02 (150,000 paise)
    await client1.query(`SELECT public.process_razorpay_refund('rfnd_real_02a', 'pay_real_test_02', 50000);`);
    // Refund another ₹500 (50,000 paise) on pay_real_test_02
    const res = await client1.query(`SELECT public.process_razorpay_refund('rfnd_real_02b', 'pay_real_test_02', 50000) AS result;`);
    const rpcResult = res.rows[0].result;

    assert.equal(rpcResult.amount_refunded_paise, 100000); // 50,000 + 50,000
    assert.equal(rpcResult.remaining_paise, 50000);

    const hrRes = await client1.query('SELECT raised_amount FROM public.help_requests WHERE id = $1', [helpRequestId]);
    assert.equal(Number(hrRes.rows[0].raised_amount), 1700.00); // 2700 - 1000
  });

  // ---------------------------------------------------------------------------
  // TEST 4: A final refund sets status = 'refunded' and refunded_at
  // ---------------------------------------------------------------------------
  await runRealTest('4. A final refund sets status = refunded and refunded_at', async () => {
    // Refund remaining ₹700 (70,000 paise) on pay_real_test_01
    const res = await client1.query(`SELECT public.process_razorpay_refund('rfnd_real_01_final', 'pay_real_test_01', 70000) AS result;`);
    const rpcResult = res.rows[0].result;

    assert.equal(rpcResult.status, 'refunded');
    assert.equal(rpcResult.remaining_paise, 0);

    const dRes = await client1.query('SELECT status, amount_refunded_paise, refunded_at FROM public.donations WHERE provider_payment_id = $1', ['pay_real_test_01']);
    assert.equal(dRes.rows[0].status, 'refunded');
    assert.equal(Number(dRes.rows[0].amount_refunded_paise), 100000);
    assert.notEqual(dRes.rows[0].refunded_at, null); // refunded_at must be populated on full refund

    const hrRes = await client1.query('SELECT raised_amount FROM public.help_requests WHERE id = $1', [helpRequestId]);
    assert.equal(Number(hrRes.rows[0].raised_amount), 1000.00); // 1700 - 700
  });

  // ---------------------------------------------------------------------------
  // TEST 5: Duplicate refund ID with identical details does not deduct twice
  // ---------------------------------------------------------------------------
  await runRealTest('5. A duplicate refund ID with identical details does not deduct twice', async () => {
    // Replay rfnd_real_01 with identical details
    const res = await client1.query(`SELECT public.process_razorpay_refund('rfnd_real_01', 'pay_real_test_01', 30000) AS result;`);
    const rpcResult = res.rows[0].result;

    assert.equal(rpcResult.already_processed, true);

    const hrRes = await client1.query('SELECT raised_amount FROM public.help_requests WHERE id = $1', [helpRequestId]);
    assert.equal(Number(hrRes.rows[0].raised_amount), 1000.00); // Zero additional decrement
  });

  // ---------------------------------------------------------------------------
  // TEST 6: Reusing refund ID with different details is rejected
  // ---------------------------------------------------------------------------
  await runRealTest('6. Reusing a refund ID with different details is rejected', async () => {
    let errorThrown = false;
    try {
      await client1.query(`SELECT public.process_razorpay_refund('rfnd_real_01', 'pay_real_test_01', 99999);`);
    } catch (err) {
      errorThrown = true;
      assert.ok(err.message.includes('Conflicting refund'));
    }
    assert.equal(errorThrown, true);

    const hrRes = await client1.query('SELECT raised_amount FROM public.help_requests WHERE id = $1', [helpRequestId]);
    assert.equal(Number(hrRes.rows[0].raised_amount), 1000.00);
  });

  // ---------------------------------------------------------------------------
  // TEST 7: Multi-connection concurrency: two concurrent refunds cannot exceed donation
  // ---------------------------------------------------------------------------
  await runRealTest('7. Two concurrent refunds cannot cumulatively exceed the original donation', async () => {
    // pay_real_test_02 has 50,000 paise remaining (₹500).
    // Client 1 attempts ₹400 (40,000 paise).
    // Client 2 simultaneously attempts ₹300 (30,000 paise).
    // Combined = ₹700 > ₹500 balance!
    const promise1 = client1.query(`SELECT public.process_razorpay_refund('rfnd_concurrent_a', 'pay_real_test_02', 40000) AS result;`);
    const promise2 = client2.query(`SELECT public.process_razorpay_refund('rfnd_concurrent_b', 'pay_real_test_02', 30000) AS result;`);

    const results = await Promise.allSettled([promise1, promise2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must fail bounds check
    assert.equal(fulfilled.length, 1, 'Expected exactly 1 concurrent refund to succeed');
    assert.equal(rejected.length, 1, 'Expected exactly 1 concurrent refund to be rejected');
    assert.ok(rejected[0].reason.message.includes('exceeds remaining refundable balance'));

    // Check final remaining balance
    const dRes = await client1.query('SELECT amount_refunded_paise, status FROM public.donations WHERE provider_payment_id = $1', ['pay_real_test_02']);
    assert.equal(Number(dRes.rows[0].amount_refunded_paise), 140000); // 100,000 + 40,000 = 140,000
    assert.equal(dRes.rows[0].status, 'partially_refunded');
  });

  // ---------------------------------------------------------------------------
  // TEST 8: A database exception rolls back all associated changes
  // ---------------------------------------------------------------------------
  await runRealTest('8. A database exception rolls back all associated changes', async () => {
    const refundsCountBefore = await client1.query('SELECT count(*) FROM public.donation_refunds;');

    let errCaught = false;
    try {
      // Attempt massive overflow refund
      await client1.query(`SELECT public.process_razorpay_refund('rfnd_bad_overflow', 'pay_real_test_02', 9999999);`);
    } catch {
      errCaught = true;
    }
    assert.equal(errCaught, true);

    const refundsCountAfter = await client1.query('SELECT count(*) FROM public.donation_refunds;');
    assert.equal(Number(refundsCountBefore.rows[0].count), Number(refundsCountAfter.rows[0].count));
  });

  // ---------------------------------------------------------------------------
  // TEST 9: A general-fund donation with request_id NULL is supported
  // ---------------------------------------------------------------------------
  await runRealTest('9. A general-fund donation with request_id NULL is supported', async () => {
    const res = await client1.query(`
      SELECT public.process_razorpay_refund('rfnd_real_gen', 'pay_real_test_general', 20000) AS result;
    `);
    const rpcResult = res.rows[0].result;
    assert.equal(rpcResult.success, true);
    assert.equal(rpcResult.status, 'partially_refunded');

    const dRes = await client1.query('SELECT amount_refunded_paise, request_id FROM public.donations WHERE provider_payment_id = $1', ['pay_real_test_general']);
    assert.equal(Number(dRes.rows[0].amount_refunded_paise), 20000);
    assert.equal(dRes.rows[0].request_id, null);
  });

  // ---------------------------------------------------------------------------
  // TEST 10: Direct legacy status update cannot bypass refund accounting
  // ---------------------------------------------------------------------------
  await runRealTest('10. A direct legacy status update cannot bypass refund accounting', async () => {
    let blockedByConstraint = false;
    try {
      // Direct update to refunded without setting amount_refunded_paise = amount_paise
      await client1.query(`
        UPDATE public.donations
           SET status = 'refunded', refunded_at = now()
         WHERE provider_payment_id = 'pay_real_test_general';
      `);
    } catch (err) {
      blockedByConstraint = true;
      assert.ok(
        err.message.includes('donations_lifecycle_check') ||
        err.message.includes('Direct update to refunded rejected')
      );
    }
    assert.equal(blockedByConstraint, true);
  });

  // ---------------------------------------------------------------------------
  // TEST 11: The public donations view shows net contributions
  // ---------------------------------------------------------------------------
  await runRealTest('11. The public donations view shows net contributions', async () => {
    // pay_real_test_02 originally 150,000 paise with 140,000 refunded -> Net must be 10,000 paise (₹100)
    const res = await client1.query(`
      SELECT amount_paise FROM public.public_donations
       WHERE id = '22222222-2222-2222-2222-222222222222';
    `);
    assert.equal(res.rows.length, 1);
    assert.equal(Number(res.rows[0].amount_paise), 10000);
  });

  // ---------------------------------------------------------------------------
  // TEST 12: Fully refunded donations do not appear as active contributions
  // ---------------------------------------------------------------------------
  await runRealTest('12. Fully refunded donations do not appear as active contributions', async () => {
    // pay_real_test_01 is fully refunded (100,000 out of 100,000) -> MUST NOT APPEAR
    const res = await client1.query(`
      SELECT count(*) FROM public.public_donations
       WHERE id = '22222222-2222-2222-2222-222222222221';
    `);
    assert.equal(Number(res.rows[0].count), 0);
  });

  // ---------------------------------------------------------------------------
  // TEST 13: Invalid currencies and invalid refund amounts are rejected
  // ---------------------------------------------------------------------------
  await runRealTest('13. Invalid currencies and invalid refund amounts are rejected', async () => {
    let currencyRejected = false;
    try {
      await client1.query(`SELECT public.process_razorpay_refund('rfnd_bad_cur', 'pay_real_test_02', 1000, 'USD');`);
    } catch (err) {
      currencyRejected = true;
      assert.ok(err.message.includes('Currency must be INR'));
    }
    assert.equal(currencyRejected, true);

    let negativeRejected = false;
    try {
      await client1.query(`SELECT public.process_razorpay_refund('rfnd_bad_amt', 'pay_real_test_02', -500);`);
    } catch (err) {
      negativeRejected = true;
      assert.ok(err.message.includes('Refund amount must be a positive integer in paise'));
    }
    assert.equal(negativeRejected, true);
  });

  // ---------------------------------------------------------------------------
  // TEST 14: Initial donation totals remain unchanged before any refund
  // ---------------------------------------------------------------------------
  await runRealTest('14. Initial donation totals remain unchanged before any refund', async () => {
    // Insert fresh unrefunded donation
    await client1.query(`
      INSERT INTO public.donations (id, request_id, amount_paise, status, payment_provider, provider_payment_id, paid_at)
      VALUES ('22222222-2222-2222-2222-222222222224', $1, 200000, 'paid', 'razorpay', 'pay_real_test_unrefunded', now());
    `, [helpRequestId]);

    const res = await client1.query('SELECT amount_refunded_paise, status, refunded_at FROM public.donations WHERE provider_payment_id = $1', ['pay_real_test_unrefunded']);
    assert.equal(Number(res.rows[0].amount_refunded_paise), 0);
    assert.equal(res.rows[0].status, 'paid');
    assert.equal(res.rows[0].refunded_at, null);
  });

  // ---------------------------------------------------------------------------
  // TEST 15: A refund cannot be applied to the wrong payment or donation
  // ---------------------------------------------------------------------------
  await runRealTest('15. A refund cannot be applied to the wrong payment or donation', async () => {
    let unassociatedRejected = false;
    try {
      await client1.query(`SELECT public.process_razorpay_refund('rfnd_nonexistent', 'pay_nonexistent_xyz', 10000);`);
    } catch (err) {
      unassociatedRejected = true;
      assert.ok(err.message.includes('No donation found matching provider_payment_id'));
    }
    assert.equal(unassociatedRejected, true);
  });

  console.log(`\n=== ALL ${passedTests}/15 REAL POSTGRESQL INTEGRATION TESTS PASSED ===\n`);
} finally {
  await client1.end().catch(() => {});
  await client2.end().catch(() => {});
}
