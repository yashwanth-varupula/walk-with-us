import { describe, it, expect } from 'vitest';
import {
  validateStep,
  validateAllSteps,
  firstInvalidStep,
  summariseErrors,
  draftCompletenessProblem,
  nextStepId,
  previousStepId,
  isLastStep,
  EMPTY_WIZARD_FORM,
  MIN_TITLE,
  MAX_TITLE,
  MIN_DESCRIPTION,
  MAX_DESCRIPTION,
  MIN_TARGET_AMOUNT,
  MAX_TARGET_AMOUNT,
  type WizardFormState,
} from '../wizard';

const VALID_FORM: WizardFormState = {
  categoryId: 'cat-medical',
  title: 'Urgent medical assistance for chemotherapy treatment',
  description: 'Our family needs support to cover travel and medication expenses for ongoing treatment.',
  urgency: 'high',
  locationCity: 'Bengaluru',
  locationState: 'Karnataka',
  targetAmount: '50000',
  acknowledged: true,
};

describe('wizard utilities', () => {
  describe('navigation helpers', () => {
    it('computes next and previous steps correctly', () => {
      expect(nextStepId('category')).toBe('details');
      expect(nextStepId('funding')).toBe('documents');
      expect(nextStepId('documents')).toBe('documents'); // clamped to last

      expect(previousStepId('details')).toBe('category');
      expect(previousStepId('category')).toBe('category'); // clamped to first
    });

    it('identifies the last step accurately', () => {
      expect(isLastStep('documents')).toBe(true);
      expect(isLastStep('category')).toBe(false);
      expect(isLastStep('funding')).toBe(false);
    });
  });

  describe('validateStep: category', () => {
    it('returns errors when categoryId or acknowledgement is missing', () => {
      const errors = validateStep('category', { ...EMPTY_WIZARD_FORM });
      expect(errors.categoryId).toBe('Please choose the category that fits your situation best.');
      expect(errors.acknowledged).toBe('Please confirm the information you are sharing is accurate before continuing.');
    });

    it('reports unavailable category when categoryIds list is provided', () => {
      const errors = validateStep(
        'category',
        { ...VALID_FORM, categoryId: 'cat-archived' },
        ['cat-medical', 'cat-food', 'cat-education'],
      );
      expect(errors.categoryId).toBe('That category is no longer available. Please choose another.');
    });

    it('passes when valid category is selected and acknowledged', () => {
      const errors = validateStep(
        'category',
        VALID_FORM,
        ['cat-medical', 'cat-food'],
      );
      expect(Object.keys(errors)).toHaveLength(0);
    });
  });

  describe('validateStep: details', () => {
    it('validates title presence and boundaries', () => {
      // Empty title
      const emptyErrors = validateStep('details', { ...VALID_FORM, title: '   ' });
      expect(emptyErrors.title).toBe('Please enter a short title for your request.');

      // Too short (< 5 chars)
      const shortErrors = validateStep('details', { ...VALID_FORM, title: 'Help' });
      expect(shortErrors.title).toBe(`The title must be at least ${MIN_TITLE} characters.`);

      // Too long (> 150 chars)
      const longErrors = validateStep('details', { ...VALID_FORM, title: 'a'.repeat(MAX_TITLE + 1) });
      expect(longErrors.title).toBe(`The title must be ${MAX_TITLE} characters or fewer.`);

      // Valid title
      const validErrors = validateStep('details', { ...VALID_FORM, title: 'Need medical support' });
      expect(validErrors.title).toBeUndefined();
    });

    it('validates description presence and boundaries', () => {
      // Empty description
      const emptyErrors = validateStep('details', { ...VALID_FORM, description: '' });
      expect(emptyErrors.description).toBe('Please describe what you are going through.');

      // Too short (< 20 chars)
      const shortErrors = validateStep('details', { ...VALID_FORM, description: 'Short story' });
      expect(shortErrors.description).toBe(`Please add a bit more detail — at least ${MIN_DESCRIPTION} characters.`);

      // Too long (> 5000 chars)
      const longErrors = validateStep('details', { ...VALID_FORM, description: 'a'.repeat(MAX_DESCRIPTION + 1) });
      expect(longErrors.description).toBe(`The description must be ${MAX_DESCRIPTION} characters or fewer.`);

      // Valid description
      const validErrors = validateStep('details', {
        ...VALID_FORM,
        description: 'We need community assistance to support chemotherapy costs this month.',
      });
      expect(validErrors.description).toBeUndefined();
    });

    it('validates urgency level recognition', () => {
      // @ts-expect-error Testing invalid urgency runtime cast
      const invalidErrors = validateStep('details', { ...VALID_FORM, urgency: 'invalid-urgency' });
      expect(invalidErrors.urgency).toBe('Please choose how urgent this is.');

      const validErrors = validateStep('details', { ...VALID_FORM, urgency: 'critical' });
      expect(validErrors.urgency).toBeUndefined();
    });
  });

  describe('validateStep: location', () => {
    it('validates city and state requirements', () => {
      // Missing city and state
      const emptyErrors = validateStep('location', {
        ...VALID_FORM,
        locationCity: '',
        locationState: '',
      });
      expect(emptyErrors.locationCity).toBe('Please enter the city where this help is needed.');
      expect(emptyErrors.locationState).toBe('Please enter the state where this help is needed.');

      // Single-character names
      const shortErrors = validateStep('location', {
        ...VALID_FORM,
        locationCity: 'A',
        locationState: 'B',
      });
      expect(shortErrors.locationCity).toBe('Please enter a city name of at least 2 characters.');
      expect(shortErrors.locationState).toBe('Please enter a state name of at least 2 characters.');

      // Valid names
      const validErrors = validateStep('location', {
        ...VALID_FORM,
        locationCity: 'Mumbai',
        locationState: 'Maharashtra',
      });
      expect(Object.keys(validErrors)).toHaveLength(0);
    });
  });

  describe('validateStep: funding', () => {
    it('validates target amount parsing and range', () => {
      // Empty amount
      const emptyErrors = validateStep('funding', { ...VALID_FORM, targetAmount: '' });
      expect(emptyErrors.targetAmount).toBe('Please enter the amount you need to raise.');

      // Non-numeric or invalid format
      const nonNumErrors = validateStep('funding', { ...VALID_FORM, targetAmount: 'fifty-thousand' });
      expect(nonNumErrors.targetAmount).toBe('Please enter an amount using digits only, for example 25000 or 25000.50.');

      // Less than MIN_TARGET_AMOUNT (₹1)
      const zeroErrors = validateStep('funding', { ...VALID_FORM, targetAmount: '0' });
      expect(zeroErrors.targetAmount).toBe(`Please enter an amount of at least ₹${MIN_TARGET_AMOUNT}.`);

      // Above MAX_TARGET_AMOUNT (₹100,000,000)
      const excessErrors = validateStep('funding', {
        ...VALID_FORM,
        targetAmount: String(MAX_TARGET_AMOUNT + 1),
      });
      expect(excessErrors.targetAmount).toContain('That amount looks too high.');

      // Valid amount
      const validErrors = validateStep('funding', { ...VALID_FORM, targetAmount: '25000' });
      expect(Object.keys(validErrors)).toHaveLength(0);
    });
  });

  describe('validateStep: documents', () => {
    it('returns an empty error object because documents are optional', () => {
      const errors = validateStep('documents', VALID_FORM);
      expect(errors).toEqual({});
    });
  });

  describe('validateAllSteps and firstInvalidStep', () => {
    it('finds the first invalid step in the sequence', () => {
      // Category invalid
      expect(firstInvalidStep(EMPTY_WIZARD_FORM, ['cat-1'])).toBe('category');

      // Category valid, details invalid
      const categoryDone = { ...EMPTY_WIZARD_FORM, categoryId: 'cat-1', acknowledged: true };
      expect(firstInvalidStep(categoryDone, ['cat-1'])).toBe('details');

      // All valid
      expect(firstInvalidStep(VALID_FORM, ['cat-medical'])).toBeNull();
    });

    it('collects all errors across all steps', () => {
      const allErrors = validateAllSteps(EMPTY_WIZARD_FORM, ['cat-1']);
      expect(allErrors.category).toBeDefined();
      expect(allErrors.details).toBeDefined();
      expect(allErrors.location).toBeDefined();
      expect(allErrors.funding).toBeDefined();
      // documents step is optional, so it is omitted from allErrors
      expect(allErrors.documents).toBeUndefined();
    });
  });

  describe('summariseErrors', () => {
    it('formats human-readable error summaries for live accessibility regions', () => {
      expect(summariseErrors({})).toBe('');
      expect(summariseErrors({ title: 'Title too short' })).toBe('Title too short');
      expect(summariseErrors({ title: 'Title error', description: 'Desc error' })).toBe(
        '2 fields need attention before you can continue.',
      );
    });
  });

  describe('draftCompletenessProblem', () => {
    it('detects missing fields needed before saving a draft', () => {
      // Empty form cannot be saved as a draft
      expect(draftCompletenessProblem(EMPTY_WIZARD_FORM, ['cat-1'])).toBeDefined();

      // Form with all core story fields can be saved as a draft even without acknowledgement
      const draftReady = {
        ...VALID_FORM,
        acknowledged: false, // Acknowledgement not needed for draft saving
      };
      expect(draftCompletenessProblem(draftReady, ['cat-medical'])).toBeNull();
    });
  });
});
