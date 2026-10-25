import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const razorpayKeyId = Deno.env.get('RAZORPAY_KEY_ID');
    const razorpayKeySecret = Deno.env.get('RAZORPAY_KEY_SECRET');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!razorpayKeyId || !razorpayKeySecret || !supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'server_configuration_missing',
          message: 'Server environment secrets are not configured.',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Optional user authentication resolution from JWT
    let authenticatedUserId: string | null = null;
    let isServiceRoleOrStaff = false;

    const authHeader = req.headers.get('Authorization');
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      if (token === supabaseServiceRoleKey) {
        isServiceRoleOrStaff = true;
      } else if (token) {
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        if (userData?.user?.id) {
          authenticatedUserId = userData.user.id;
          // Check staff / admin status
          const { data: roleRow } = await supabaseAdmin
            .from('user_profiles')
            .select('role')
            .eq('id', authenticatedUserId)
            .maybeSingle();

          if (roleRow?.role === 'staff' || roleRow?.role === 'admin') {
            isServiceRoleOrStaff = true;
          }
        }
      }
    }

    const body = await req.json().catch(() => ({}));
    const { donationId, orderId, reconcileAllPending, userAction } = body;

    // Build list of donation records to reconcile
    let query = supabaseAdmin
      .from('donations')
      .select('id, user_id, status, amount_paise, provider_order_id, provider_payment_id, paid_at, created_at');

    if (donationId) {
      query = query.eq('id', donationId);
    } else if (orderId) {
      query = query.eq('provider_order_id', orderId);
    } else if (reconcileAllPending) {
      query = query.eq('status', 'pending');
      if (!isServiceRoleOrStaff && authenticatedUserId) {
        query = query.eq('user_id', authenticatedUserId);
      }
    } else {
      return new Response(
        JSON.stringify({
          ok: false,
          error: 'missing_parameters',
          message: 'Specify donationId, orderId, or reconcileAllPending.',
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const { data: donationsToReconcile, error: fetchErr } = await query;
    if (fetchErr || !donationsToReconcile || donationsToReconcile.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          reconciled: [],
          message: 'No pending donations found matching criteria.',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const basicAuth = btoa(`${razorpayKeyId}:${razorpayKeySecret}`);
    const results = [];

    for (const donation of donationsToReconcile) {
      // Security check: non-staff can only reconcile their own donations
      if (!isServiceRoleOrStaff && donation.user_id && authenticatedUserId && donation.user_id !== authenticatedUserId) {
        continue;
      }

      // If already paid or refunded, keep as is (idempotent)
      if (donation.status === 'paid' || donation.status === 'refunded') {
        results.push({
          donationId: donation.id,
          providerOrderId: donation.provider_order_id,
          previousStatus: donation.status,
          currentStatus: donation.status,
          action: 'already_terminal',
        });
        continue;
      }

      if (!donation.provider_order_id) {
        results.push({
          donationId: donation.id,
          previousStatus: donation.status,
          currentStatus: donation.status,
          action: 'no_provider_order_id',
        });
        continue;
      }

      // 1. Fetch Razorpay Order Status
      let orderResp;
      try {
        orderResp = await fetch(
          `https://api.razorpay.com/v1/orders/${donation.provider_order_id}`,
          { headers: { Authorization: `Basic ${basicAuth}` } },
        );
      } catch (e) {
        console.error(`[reconcile-donation] Network error querying order ${donation.provider_order_id}:`, e);
        results.push({
          donationId: donation.id,
          previousStatus: donation.status,
          currentStatus: donation.status,
          action: 'gateway_unreachable',
        });
        continue;
      }

      if (!orderResp.ok) {
        console.warn(`[reconcile-donation] Razorpay returned ${orderResp.status} for order ${donation.provider_order_id}`);
        results.push({
          donationId: donation.id,
          previousStatus: donation.status,
          currentStatus: donation.status,
          action: 'order_not_found_on_gateway',
        });
        continue;
      }

      const orderData = await orderResp.json();

      // 2. Fetch Payments made for this order
      let paymentsResp;
      try {
        paymentsResp = await fetch(
          `https://api.razorpay.com/v1/orders/${donation.provider_order_id}/payments`,
          { headers: { Authorization: `Basic ${basicAuth}` } },
        );
      } catch (e) {
        console.error(`[reconcile-donation] Network error querying payments for ${donation.provider_order_id}:`, e);
        continue;
      }

      const paymentsData = paymentsResp.ok ? await paymentsResp.json() : { items: [] };
      const paymentItems: Array<{
        id: string;
        status: string;
        amount: number;
        created_at: number;
        error_code?: string;
        error_description?: string;
      }> = paymentsData.items || [];

      // Look for successful capture
      const capturedPayment = paymentItems.find((p) => p.status === 'captured');

      // Look for latest failed payment
      const failedPayments = paymentItems.filter((p) => p.status === 'failed');
      const latestFailedPayment = failedPayments[0];

      // Order age in minutes
      const createdAt = new Date(donation.created_at).getTime();
      const ageMinutes = (Date.now() - createdAt) / (1000 * 60);

      let targetStatus = donation.status;
      let failureReason: string | null = null;
      let paymentId = donation.provider_payment_id;
      let paidAt = donation.paid_at;

      if (capturedPayment || orderData.status === 'paid') {
        // CASE 1: VERIFIED PAYMENT SUCCESS
        targetStatus = 'paid';
        paymentId = capturedPayment?.id || donation.provider_payment_id;
        paidAt = capturedPayment?.created_at
          ? new Date(capturedPayment.created_at * 1000).toISOString()
          : donation.paid_at || new Date().toISOString();
        failureReason = null;
      } else if (paymentItems.length > 0 && failedPayments.length === paymentItems.length) {
        // CASE 2: ALL PAYMENT ATTEMPTS FAILED
        targetStatus = 'failed';
        failureReason =
          latestFailedPayment?.error_description ||
          latestFailedPayment?.error_code ||
          'Payment declined or failed at banking gateway';
      } else if (paymentItems.length === 0) {
        // CASE 3: NO PAYMENT ATTEMPTS MADE
        // If user explicitly cancelled via checkout ondismiss OR checkout is older than 15 minutes
        if (userAction === 'cancelled' || ageMinutes >= 15) {
          targetStatus = 'cancelled';
          failureReason =
            userAction === 'cancelled'
              ? 'Checkout was cancelled by user before completion'
              : 'Checkout session expired or was abandoned without payment';
        } else {
          // Recent attempt (< 15 min), still legitimately pending
          targetStatus = 'pending';
        }
      }

      // 3. Update database if status changed
      if (targetStatus !== donation.status) {
        const updatePayload: Record<string, unknown> = {
          status: targetStatus,
          updated_at: new Date().toISOString(),
        };

        if (targetStatus === 'paid') {
          updatePayload.paid_at = paidAt;
          updatePayload.failure_reason = null;
          if (paymentId) updatePayload.provider_payment_id = paymentId;
          // Associate user_id if previously unset
          if (!donation.user_id && authenticatedUserId) {
            updatePayload.user_id = authenticatedUserId;
          }
        } else if (targetStatus === 'failed') {
          updatePayload.failure_reason = failureReason;
        } else if (targetStatus === 'cancelled') {
          updatePayload.failure_reason = failureReason;
        }

        const { error: updateErr } = await supabaseAdmin
          .from('donations')
          .update(updatePayload)
          .eq('id', donation.id);

        if (updateErr) {
          console.error(`[reconcile-donation] Update failed for ${donation.id}:`, updateErr);
          results.push({
            donationId: donation.id,
            previousStatus: donation.status,
            error: updateErr.message,
          });
        } else {
          results.push({
            donationId: donation.id,
            providerOrderId: donation.provider_order_id,
            previousStatus: donation.status,
            currentStatus: targetStatus,
            paymentId: paymentId || null,
            failureReason: failureReason || null,
            action: 'updated',
          });
        }
      } else {
        results.push({
          donationId: donation.id,
          providerOrderId: donation.provider_order_id,
          previousStatus: donation.status,
          currentStatus: targetStatus,
          action: 'unchanged',
        });
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        reconciled: results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[reconcile-donation] Unexpected error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: 'internal_error', message: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
