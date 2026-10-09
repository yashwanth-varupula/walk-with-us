import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { corsHeaders } from '../_shared/cors.ts';

const MIN_DONATION_PAISE = 10_000; // ₹100
const MAX_DONATION_PAISE = 1_000_000_000; // ₹10,000,000

serve(async (req: Request) => {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 2. Validate environment secrets
    const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
    const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!razorpayKeyId || !razorpayKeySecret) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'gateway_credentials_missing',
          message:
            'Razorpay test credentials (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) are not set in the server environment.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'database_credentials_missing',
          message:
            'Supabase server environment credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are missing.',
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
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

    const { requestId, amountPaise, donorDetails } = body;

    // Validate amount server-side strictly
    if (
      typeof amountPaise !== 'number' ||
      !Number.isSafeInteger(amountPaise) ||
      amountPaise < MIN_DONATION_PAISE ||
      amountPaise > MAX_DONATION_PAISE
    ) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'invalid_amount',
          message: `Amount must be an integer between ₹${MIN_DONATION_PAISE / 100} and ₹${
            MAX_DONATION_PAISE / 100
          }.`,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Initialize elevated server-side Supabase client
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

    // 4. Validate request exists and is published (if requestId provided)
    if (requestId) {
      const { data: requestRow, error: requestError } = await supabaseAdmin
        .from('help_requests')
        .select('id, status, title')
        .eq('id', requestId)
        .maybeSingle();

      if (requestError || !requestRow) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'request_not_found',
            message: 'The selected help request could not be found.',
          }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      if (requestRow.status !== 'published') {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'request_not_eligible',
            message: 'This help request is not currently accepting public contributions.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
    }

    // 5. Create Order via Razorpay Orders API
    const receiptId = `wwu_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const authCredentials = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);

    const razorpayResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authCredentials}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          requestId: requestId || '',
          isAnonymous: donorDetails?.isAnonymous ? 'true' : 'false',
        },
      }),
    });

    if (!razorpayResponse.ok) {
      const errorText = await razorpayResponse.text();
      console.error('[create-razorpay-order] Razorpay API failure:', errorText);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'gateway_order_failed',
          message: 'Unable to initialize order with Razorpay. Please verify test credentials.',
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const razorpayOrder = await razorpayResponse.json();

    // 6. Record pending donation in database
    const { data: donationRow, error: insertError } = await supabaseAdmin
      .from('donations')
      .insert({
        request_id: requestId || null,
        user_id: authenticatedUserId,
        donor_name: donorDetails?.fullName?.trim() || null,
        donor_email: donorDetails?.email?.trim() || null,
        donor_phone: donorDetails?.phone?.trim() || null,
        is_anonymous: Boolean(donorDetails?.isAnonymous),
        amount_paise: amountPaise,
        currency: 'INR',
        payment_provider: 'razorpay',
        provider_order_id: razorpayOrder.id,
        status: 'pending',
      })
      .select('id')
      .single();

    if (insertError || !donationRow) {
      console.error('[create-razorpay-order] Database insert error:', insertError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'database_insert_failed',
          message: 'Failed to record donation intent in the database.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // 7. Return safe checkout payload to frontend
    return new Response(
      JSON.stringify({
        ok: true,
        orderId: razorpayOrder.id,
        amountPaise: amountPaise,
        currency: 'INR',
        keyId: razorpayKeyId,
        donationId: donationRow.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[create-razorpay-order] Unhandled error:', err);
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'internal_error',
        message: 'An unexpected error occurred while creating the payment order.',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
