import { describe, it, expect } from 'vitest';
import {
  parseAndValidateINR,
  paiseToRupees,
  rupeesToPaise,
  formatPaiseToINR,
  MIN_DONATION_RUPEES,
  MAX_DONATION_RUPEES,
  MIN_DONATION_PAISE,
  MAX_DONATION_PAISE,
} from '../money';

describe('money utilities', () => {
  describe('parseAndValidateINR', () => {
    it('parses valid integer rupee amounts correctly', () => {
      const result = parseAndValidateINR(500);
      expect(result.ok).toBe(true);
      expect(result.paise).toBe(50_000);
      expect(result.rupees).toBe(500);
      expect(result.error).toBeUndefined();
    });

    it('parses string representations with commas and decimals', () => {
      const result = parseAndValidateINR('1,500.50');
      expect(result.ok).toBe(true);
      expect(result.paise).toBe(150_050);
      expect(result.rupees).toBe(1500.5);
    });

    it('pads single-digit decimal strings to exact paise', () => {
      const result = parseAndValidateINR('100.5');
      expect(result.ok).toBe(true);
      expect(result.paise).toBe(10_050);
      expect(result.rupees).toBe(100.5);
    });

    it('rejects null, undefined, and empty strings', () => {
      expect(parseAndValidateINR(null)).toEqual({
        ok: false,
        paise: 0,
        rupees: 0,
        error: 'Please enter a donation amount.',
      });
      expect(parseAndValidateINR(undefined)).toEqual({
        ok: false,
        paise: 0,
        rupees: 0,
        error: 'Please enter a donation amount.',
      });
      expect(parseAndValidateINR('   ')).toEqual({
        ok: false,
        paise: 0,
        rupees: 0,
        error: 'Please enter a donation amount.',
      });
    });

    it('rejects negative numbers and strings with negative signs', () => {
      const numResult = parseAndValidateINR(-100);
      expect(numResult.ok).toBe(false);
      expect(numResult.error).toBe('Donation amount must be greater than zero.');

      const strResult = parseAndValidateINR('-500');
      expect(strResult.ok).toBe(false);
      expect(strResult.error).toBe('Donation amount must be greater than zero.');
    });

    it('rejects zero amount', () => {
      const result = parseAndValidateINR(0);
      expect(result.ok).toBe(false);
      expect(result.error).toBe('Please enter an amount greater than zero.');

      const strResult = parseAndValidateINR('0');
      expect(strResult.ok).toBe(false);
      expect(strResult.error).toBe('Please enter an amount greater than zero.');
    });

    it('rejects malformed inputs and more than two decimal places', () => {
      expect(parseAndValidateINR('abc').ok).toBe(false);
      expect(parseAndValidateINR('12.34.56').ok).toBe(false);
      expect(parseAndValidateINR('100.999').ok).toBe(false);
    });

    it('enforces minimum donation boundary (₹100)', () => {
      // Exactly at minimum: ₹100
      const exactMin = parseAndValidateINR(MIN_DONATION_RUPEES);
      expect(exactMin.ok).toBe(true);
      expect(exactMin.paise).toBe(MIN_DONATION_PAISE);

      // Just below minimum: ₹99.99
      const belowMin = parseAndValidateINR('99.99');
      expect(belowMin.ok).toBe(false);
      expect(belowMin.error).toBe('The minimum contribution is ₹100.');
    });

    it('enforces maximum donation boundary (₹10,000,000 / ₹1 Crore)', () => {
      // Exactly at maximum: ₹10,000,000
      const exactMax = parseAndValidateINR(MAX_DONATION_RUPEES);
      expect(exactMax.ok).toBe(true);
      expect(exactMax.paise).toBe(MAX_DONATION_PAISE);

      // Above maximum: ₹10,000,001
      const aboveMax = parseAndValidateINR(MAX_DONATION_RUPEES + 1);
      expect(aboveMax.ok).toBe(false);
      expect(aboveMax.error).toContain('For contributions exceeding');
    });
  });

  describe('paiseToRupees and rupeesToPaise conversions', () => {
    it('converts minor units (paise) to rupees safely', () => {
      expect(paiseToRupees(100_000)).toBe(1000);
      expect(paiseToRupees(150_050)).toBe(1500.5);
      expect(paiseToRupees(0)).toBe(0);
      expect(paiseToRupees(-100)).toBe(0);
    });

    it('converts rupees to minor units (paise) safely without floating point drift', () => {
      expect(rupeesToPaise(1000)).toBe(100_000);
      expect(rupeesToPaise(100.5)).toBe(10_050);
      expect(rupeesToPaise(0)).toBe(0);
      expect(rupeesToPaise(-50)).toBe(0);
    });
  });

  describe('formatPaiseToINR', () => {
    it('formats paise amounts as Indian Rupee strings', () => {
      expect(formatPaiseToINR(100_000)).toBe('₹1,000');
      expect(formatPaiseToINR(50_000)).toBe('₹500');
      expect(formatPaiseToINR(200_000)).toBe('₹2,000');
      expect(formatPaiseToINR(0)).toBe('₹0');
    });
  });
});
