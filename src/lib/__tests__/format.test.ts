import { describe, it, expect } from 'vitest';
import {
  formatINR,
  formatINRCompact,
  formatDate,
  formatDateTime,
  formatRelative,
  fundingPercent,
  formatLocation,
  formatCount,
  pluralise,
} from '../format';

describe('format utilities', () => {
  describe('formatINR', () => {
    it('formats Indian rupee amounts with symbol and grouping', () => {
      expect(formatINR(1000)).toBe('₹1,000');
      expect(formatINR(50000)).toBe('₹50,000');
      expect(formatINR(100000)).toBe('₹1,00,000');
      expect(formatINR(0)).toBe('₹0');
    });

    it('returns an em dash for null, undefined, or empty values', () => {
      expect(formatINR(null)).toBe('—');
      expect(formatINR(undefined)).toBe('—');
      expect(formatINR('')).toBe('—');
    });
  });

  describe('formatINRCompact', () => {
    it('formats compact representations', () => {
      expect(formatINRCompact(100000)).toBe('₹1.0L');
      expect(formatINRCompact(null)).toBe('—');
    });
  });

  describe('fundingPercent', () => {
    it('calculates rounded percentage clamped between 0 and 100', () => {
      expect(fundingPercent(500, 1000)).toBe(50);
      expect(fundingPercent(250, 1000)).toBe(25);
      expect(fundingPercent(1200, 1000)).toBe(100); // clamped at 100
      expect(fundingPercent(-100, 1000)).toBe(0); // clamped at 0
      expect(fundingPercent(0, 1000)).toBe(0);
      expect(fundingPercent(500, 0)).toBe(0); // target <= 0
      expect(fundingPercent(null, 1000)).toBe(0);
    });
  });

  describe('formatLocation', () => {
    it('combines city and state gracefully', () => {
      expect(formatLocation('Bengaluru', 'Karnataka')).toBe('Bengaluru, Karnataka');
      expect(formatLocation('Bengaluru', null)).toBe('Bengaluru');
      expect(formatLocation(null, 'Karnataka')).toBe('Karnataka');
      expect(formatLocation(null, null)).toBe('');
    });
  });

  describe('formatDate and formatDateTime', () => {
    it('formats valid ISO dates in en-IN locale', () => {
      const formatted = formatDate('2026-03-05T12:00:00Z');
      expect(formatted).toContain('2026');
      expect(formatDate(null)).toBe('—');

      const formattedTime = formatDateTime('2026-03-05T12:00:00Z');
      expect(formattedTime).toContain('2026');
      expect(formatDateTime(null)).toBe('—');
    });
  });

  describe('formatRelative', () => {
    it('formats timestamps relative to now', () => {
      const now = Date.now();
      expect(formatRelative(new Date(now - 10 * 1000).toISOString())).toBe('just now');
      expect(formatRelative(new Date(now - 10 * 60 * 1000).toISOString())).toBe('10 min ago');
      expect(formatRelative(new Date(now - 2 * 3600 * 1000).toISOString())).toBe('2 hrs ago');
      expect(formatRelative(new Date(now - 24 * 3600 * 1000).toISOString())).toBe('1 day ago');
      expect(formatRelative(null)).toBe('—');
    });
  });

  describe('pluralise and formatCount', () => {
    it('pluralises nouns correctly based on count', () => {
      expect(pluralise(1, 'document')).toBe('1 document');
      expect(pluralise(3, 'document')).toBe('3 documents');
      expect(pluralise(0, 'supporter')).toBe('0 supporters');
    });

    it('formats plain counts with en-IN formatting', () => {
      expect(formatCount(1234)).toBe('1,234');
      expect(formatCount(null)).toBe('0');
    });
  });
});
