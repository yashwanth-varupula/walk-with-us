import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function computeWebhookSignature(rawBody: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(rawBody);
  const keyData = encoder.encode(secret);

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign('HMAC', cryptoKey, data);
  const hashArray = Array.from(new Uint8Array(signatureBytes));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req: Request) => {
  // Webhooks only accept POST
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const webhookSecret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!webhookSecret || !supabaseUrl || !supabaseServiceRoleKey) {
      console.error('[razorpay-webhook] Missing environment configuration.');
      return new Response('Webhook server configuration error', { status: 500 });
    }

    // 1. Read signature header and RAW request body
    const incomingSignature = req.headers.get('x-razorpay-signature');
    if (!incomingSignature) {
      return new Response('Missing x-razorpay-signature header', { status: 400 });
    }

    const rawBody = await req.text();

    // 2. Cryptographic signature verification over raw body
    const expectedSignature = await computeWebhookSignature(rawBody, webhookSecret);
    if (!timingSafeEqual(expectedSignature, incomingSignature)) {
      console.warn('[razorpay-webhook] Invalid signature received.');
      return new Response('Invalid webhook signature', { status: 401 });
    }

    // 3. Parse validated JSON payload
    const event = JSON.parse(rawBody);
    const eventName = event.event as string;
    console.log(`[razorpay-webhook] Processing verified event: ${eventName}`);

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 4. Handle supported payment events idempotently
    if (eventName === 'payment.captured' || eventName === 'order.paid') {
      const paymentEntity = event.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id || event.payload?.order?.entity?.id;
      const paymentId = paymentEntity?.id;

      if (!orderId) {
        console.warn('[razorpay-webhook] Event missing order_id:', eventName);
        return new Response(JSON.stringify({ ok: true, notice: 'no_order_id' }), { status: 200 });
      }

      // Find matching donation by provider_order_id
      const { data: donation, error: findError } = await supabaseAdmin
        .from('donations')
        .select('id, status, provider_payment_id')
        .eq('provider_order_id', orderId)
        .maybeSingle();

      if (findError || !donation) {
        console.warn('[razorpay-webhook] No donation matching order:', orderId);
        return new Response(JSON.stringify({ ok: true, notice: 'donation_not_found' }), {
          status: 200,
        });
      }

      // Idempotency: if already paid, acknowledge without re-applying
      if (donation.status === 'paid') {
        return new Response(JSON.stringify({ ok: true, notice: 'already_paid' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (donation.status === 'refunded') {
        return new Response(JSON.stringify({ ok: true, notice: 'already_refunded' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Mark donation paid (atomic trigger increments help_requests.raised_amount)
      // Supports late payment recovery from previously failed or cancelled status
      const { error: updateError } = await supabaseAdmin
        .from('donations')
        .update({
          status: 'paid',
          provider_payment_id: paymentId || donation.provider_payment_id,
          failure_reason: null,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', donation.id);

      if (updateError) {
        console.error('[razorpay-webhook] Failed to mark donation paid:', updateError);
        return new Response('Database update error', { status: 500 });
      }

      return new Response(JSON.stringify({ ok: true, updated: donation.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (eventName === 'payment.failed') {
      const paymentEntity = event.payload?.payment?.entity;
      const orderId = paymentEntity?.order_id;
      const failureReason = paymentEntity?.error_description || 'Payment declined by bank/network';

      if (orderId) {
        const { error: updateError } = await supabaseAdmin
          .from('donations')
          .update({
            status: 'failed',
            failure_reason: failureReason.slice(0, 500),
            updated_at: new Date().toISOString(),
          })
          .eq('provider_order_id', orderId)
          .in('status', ['pending', 'created']);

        if (updateError) {
          console.error('[razorpay-webhook] Failed to record payment failure:', updateError);
          return new Response('Database update error', { status: 500 });
        }
      }

      return new Response(JSON.stringify({ ok: true, recorded: 'payment_failed' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (eventName === 'refund.processed') {
      const refundEntity = event.payload?.refund?.entity;

      // 1. Validate refund entity presence
      if (!refundEntity || typeof refundEntity !== 'object') {
        console.warn('[razorpay-webhook] refund.processed event missing refund entity payload');
        return new Response(JSON.stringify({ ok: true, notice: 'missing_refund_entity' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 2. Do not assume payment entity exists; use documented refund entity fields
      const refundId = refundEntity.id;
      const paymentId = refundEntity.payment_id;
      const amountPaise = refundEntity.amount;
      const currency = refundEntity.currency;
      const refundStatus = refundEntity.status;

      // 3. Only successful/processed refunds change accounting
      if (refundStatus !== 'processed') {
        console.warn(`[razorpay-webhook] Ignoring refund ${refundId} with non-processed status: ${refundStatus}`);
        return new Response(JSON.stringify({ ok: true, notice: 'refund_not_processed', status: refundStatus }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 4. Strict field and type validations (Invalid payload -> HTTP 400)
      if (!refundId || typeof refundId !== 'string' || !refundId.trim()) {
        console.warn('[razorpay-webhook] refund.processed missing valid refund id');
        return new Response(JSON.stringify({ ok: false, error: 'invalid_refund_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!paymentId || typeof paymentId !== 'string' || !paymentId.trim()) {
        console.warn('[razorpay-webhook] refund.processed missing valid payment id');
        return new Response(JSON.stringify({ ok: false, error: 'invalid_payment_id' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!amountPaise || typeof amountPaise !== 'number' || !Number.isInteger(amountPaise) || amountPaise <= 0) {
        console.warn('[razorpay-webhook] refund.processed invalid amount:', amountPaise);
        return new Response(JSON.stringify({ ok: false, error: 'invalid_refund_amount' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (currency !== 'INR') {
        console.warn('[razorpay-webhook] refund.processed unsupported currency:', currency);
        return new Response(JSON.stringify({ ok: false, error: 'unsupported_currency' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 5. Invoke atomic SECURITY DEFINER RPC
      // Performs row-level locking, bounds check, idempotent deduplication,
      // ledger insertion, donation update, and funding decrement in a single transaction.
      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('process_razorpay_refund', {
        p_provider_refund_id: refundId,
        p_provider_payment_id: paymentId,
        p_amount_paise: amountPaise,
        p_currency: currency,
        p_reason: refundEntity.notes?.reason || null,
      });

      if (rpcError) {
        const errorMsg = rpcError.message || '';

        // Case A: Unknown payment ID or non-refundable status.
        // Return HTTP 500 so Razorpay retries (in case the payment record is in-flight)
        // and surfaces the delivery failure in the Razorpay Dashboard logs for operator awareness.
        // Zero funding totals are modified.
        if (errorMsg.includes('No donation found matching') || errorMsg.includes('not in a refundable status')) {
          console.error(`[razorpay-webhook] Unassociated/non-refundable refund: refund_id=${refundId}, payment_id=${paymentId}. Reason: ${errorMsg}. Returning 500 for retry/reconciliation.`);
          return new Response('Donation record for payment not found or not refundable; retryable', { status: 500 });
        }

        // Case B: Conflicting duplicate refund ID
        if (errorMsg.includes('Conflicting refund')) {
          console.error(`[razorpay-webhook] Conflicting refund ID reuse detected: refund_id=${refundId}, payment_id=${paymentId}. Returning 500.`);
          return new Response('Conflicting refund identifier', { status: 500 });
        }

        // Case C: Database system, lock timeout, connection, or bounds errors
        console.error(`[razorpay-webhook] Database refund processing error for ${refundId}:`, rpcError);
        return new Response('Database refund processing error', { status: 500 });
      }

      // 6. Case D: Idempotent duplicate delivery with matching data (HTTP 200)
      if (rpcResult?.already_processed) {
        console.log(`[razorpay-webhook] Refund ${refundId} already processed. Acknowledged idempotently.`);
        return new Response(JSON.stringify({ ok: true, notice: 'already_processed', refundId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 7. Case E: Newly processed refund accounted for atomically (HTTP 200)
      console.log(`[razorpay-webhook] Refund ${refundId} processed successfully: status ${rpcResult?.status}`);
      return new Response(JSON.stringify({
        ok: true,
        recorded: 'refund_processed',
        refundId,
        status: rpcResult?.status,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Acknowledge other non-handled events gracefully
    return new Response(JSON.stringify({ ok: true, ignored: eventName }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[razorpay-webhook] Webhook handling error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
