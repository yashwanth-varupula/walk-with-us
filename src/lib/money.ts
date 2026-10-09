/**
 * High-precision monetary utilities for INR donations.
 *
 * CRITICAL FINANCIAL RULES:
 * 1. Financial math and database persistence MUST use integer minor units (paise).
 *    1 Rupee (INR) = 100 Paise.
 *    ₹100 = 10,000 paise; ₹100.50 = 10,050 paise.
 * 2. Floating-point arithmetic (e.g., `amount * 100`) must be avoided during
 *    string parsing to prevent IEEE-754 precision issues (e.g. 1.14 * 100 = 113.99999999999999).
 * 3. String splitting and integer arithmetic guarantee 100% exact minor units.
 */

import { formatINR } from './format';

export const MIN_DONATION_RUPEES = 100;
export const MAX_DONATION_RUPEES = 10_000_000; // ₹1 Crore

export const MIN_DONATION_PAISE = MIN_DONATION_RUPEES * 100; // 10,000 paise
export const MAX_DONATION_PAISE = MAX_DONATION_RUPEES * 100; // 1,000,000,000 paise

export interface MoneyValidationResult {
  ok: boolean;
  paise: number;
  rupees: number;
  error?: string;
}

/**
 * Safely parse a raw string or number monetary amount into integer paise (minor units).
 *
 * Rejects:
 * - Empty/whitespace
 * - Negative numbers
 * - NaN, Infinity, -Infinity
 * - Malformed decimals (e.g. "12.34.5", "abc", "12.999")
 * - Amounts outside [MIN_DONATION_RUPEES, MAX_DONATION_RUPEES]
 */
export function parseAndValidateINR(raw: string | number | null | undefined): MoneyValidationResult {
  if (raw === null || raw === undefined) {
    return { ok: false, paise: 0, rupees: 0, error: 'Please enter a donation amount.' };
  }

  const str = String(raw).trim();
  if (!str) {
    return { ok: false, paise: 0, rupees: 0, error: 'Please enter a donation amount.' };
  }

  // Reject negative signs explicitly
  if (str.startsWith('-') || str.includes('-')) {
    return { ok: false, paise: 0, rupees: 0, error: 'Donation amount must be greater than zero.' };
  }

  // Allow optional commas in rupee part (e.g. "1,000" or "1,000.50")
  const sanitized = str.replace(/,/g, '');

  // Must match valid whole number or up to 2 decimal places
  const pattern = /^\d+(\.\d{1,2})?$/;
  if (!pattern.test(sanitized)) {
    return {
      ok: false,
      paise: 0,
      rupees: 0,
      error: 'Please enter a valid monetary amount (e.g. 500 or 1000.50).',
    };
  }

  const parts = sanitized.split('.');
  const wholeStr = parts[0] || '0';
  const decimalStr = parts[1] || '';

  const wholeRupees = parseInt(wholeStr, 10);
  if (!Number.isFinite(wholeRupees)) {
    return { ok: false, paise: 0, rupees: 0, error: 'Invalid amount value.' };
  }

  // Pad decimal to 2 digits for exact paise representation (e.g. ".5" -> "50")
  const paisePart = decimalStr.padEnd(2, '0').slice(0, 2);
  const decimalPaise = paisePart ? parseInt(paisePart, 10) : 0;

  const totalPaise = wholeRupees * 100 + decimalPaise;

  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0) {
    return { ok: false, paise: 0, rupees: 0, error: 'Please enter an amount greater than zero.' };
  }

  if (totalPaise < MIN_DONATION_PAISE) {
    return {
      ok: false,
      paise: totalPaise,
      rupees: totalPaise / 100,
      error: `The minimum contribution is ${formatINR(MIN_DONATION_RUPEES)}.`,
    };
  }

  if (totalPaise > MAX_DONATION_PAISE) {
    return {
      ok: false,
      paise: totalPaise,
      rupees: totalPaise / 100,
      error: `For contributions exceeding ${formatINR(MAX_DONATION_RUPEES)}, please contact us directly.`,
    };
  }

  return {
    ok: true,
    paise: totalPaise,
    rupees: totalPaise / 100,
  };
}

/** Convert minor units (paise) back to whole/decimal rupees safely */
export function paiseToRupees(paise: number): number {
  if (!Number.isFinite(paise) || paise < 0) return 0;
  return paise / 100;
}

/** Convert rupees to integer paise without floating point issues */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees) || rupees <= 0) return 0;
  return Math.round(rupees * 100);
}

/** Format minor units (paise) to display INR string, e.g. "₹1,500" or "₹1,500.50" */
export function formatPaiseToINR(paise: number): string {
  return formatINR(paiseToRupees(paise));
}
