import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Timing-safe string comparison to prevent side-channel timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Computes Razorpay payment signature using Web Crypto HMAC-SHA256.
 */
async function computeRazorpaySignature(
  orderId: string,
  paymentId: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${orderId}|${paymentId}`);
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
  // 1. CORS Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Validate environment secrets
    const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!razorpayKeySecret || !supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'server_configuration_missing',
          message: 'Server environment secrets are not configured.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 3. Parse and validate payload
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return new Response(
        JSON.stringify({ ok: false, error: 'invalid_json', message: 'Malformed JSON payload.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { donationId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;

    if (!donationId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'missing_parameters',
          message: 'All payment callback credentials are required for verification.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 4. Verify Razorpay Signature Cryptographically
    const expectedSignature = await computeRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpayKeySecret,
    );

    const isMatch = timingSafeEqual(expectedSignature, razorpay_signature);
    if (!isMatch) {
      console.warn('[verify-razorpay-payment] Signature mismatch for order:', razorpay_order_id);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'signature_verification_failed',
          message: 'Payment verification failed: cryptographic signature mismatch.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 5. Query and Idempotently Update Database
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Optional user authentication resolution from JWT
    let authenticatedUserId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token) {
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        if (userData?.user?.id) {
          authenticatedUserId = userData.user.id;
        }
      }
    }

    const { data: donation, error: fetchError } = await supabaseAdmin
      .from('donations')
      .select('id, user_id, status, provider_order_id, amount_paise, request_id')
      .eq('id', donationId)
      .maybeSingle();

    if (fetchError || !donation) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'donation_not_found',
          message: 'The matching donation record was not found.',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Idempotency check: if already marked paid, return success without duplicating
    if (donation.status === 'paid') {
      if (!donation.user_id && authenticatedUserId) {
        await supabaseAdmin
          .from('donations')
          .update({ user_id: authenticatedUserId, updated_at: new Date().toISOString() })
          .eq('id', donationId);
      }
      return new Response(
        JSON.stringify({
          ok: true,
          status: 'paid',
          donationId: donation.id,
          message: 'Donation has already been verified and recorded.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Confirm provider order matches
    if (donation.provider_order_id !== razorpay_order_id) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'order_id_mismatch',
          message: 'The returned order does not match the original donation intent.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 6. Mark donation paid (triggers atomic funding update via database trigger)
    const updatePayload: Record<string, unknown> = {
      status: 'paid',
      provider_payment_id: razorpay_payment_id,
      provider_signature: razorpay_signature,
      failure_reason: null,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (!donation.user_id && authenticatedUserId) {
      updatePayload.user_id = authenticatedUserId;
    }

    const { error: updateError } = await supabaseAdmin
      .from('donations')
      .update(updatePayload)
      .eq('id', donationId);

    if (updateError) {
      console.error('[verify-razorpay-payment] Failed to record paid status:', updateError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'database_update_failed',
          message: 'Failed to update donation status to paid in database.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        status: 'paid',
        donationId: donation.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[verify-razorpay-payment] Unexpected verification error:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'internal_error',
        message: 'An error occurred while verifying the payment signature.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
