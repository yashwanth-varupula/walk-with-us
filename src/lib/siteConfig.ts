/**
 * Site-wide configuration that is NOT stored in the database.
 *
 * These values are the ones that must be edited by a human before launch, so
 * they live in exactly one place rather than being copy-pasted across pages.
 */

/*
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  UNVERIFIED — MUST BE CONFIRMED BEFORE LAUNCH                            │
  │                                                                          │
  │  This address was never confirmed with the organisation. It is a         │
  │  placeholder, and it is the address every "email us" link on the site     │
  │  opens. If it is wrong, a real message composed by a visitor about a      │
  │  real request in need is silently undeliverable.                          │
  │                                                                          │
  │  It was duplicated across five pages as a string literal, so changing it  │
  │  meant finding five places to change. It is here now, and below it is a   │
  │  deliberate reminder rather than a passing comment.                        │
  └──────────────────────────────────────────────────────────────────────────┘
*/
export const CONTACT_EMAIL = 'hello@walkwithus.org';

/** True when CONTACT_EMAIL is still the unconfirmed placeholder. */
export const CONTACT_EMAIL_IS_VERIFIED = false;

/**
 * The active payment aggregator.
 * Configured for Razorpay in TEST MODE ONLY.
 * Live payments are strictly disabled.
 */
export const PAYMENT_PROVIDER: 'razorpay' | 'stripe' | null = 'razorpay';

/** Explicit test mode flag */
export const RAZORPAY_TEST_MODE = true;

/**
 * Public Razorpay Key ID (test mode).
 * Can be optionally provided via VITE_RAZORPAY_KEY_ID, or retrieved directly
 * from the create-razorpay-order Edge Function.
 */
export const RAZORPAY_PUBLIC_KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID || '';
