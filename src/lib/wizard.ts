/**
 * The request wizard's five steps, its per-field validation, and its error copy.
 *
 * WHY THIS EXISTS
 * ---------------
 * The wizard previously kept STEPS, the per-step `validateStep(target)` switch,
 * the length caps and the field limits inline in one 1,263-line page component.
 * That produced three concrete defects:
 *
 *   1. Validation ran only when the user pressed Next or Submit, and reported a
 *      SINGLE banner-level string. Nothing was attached to the offending field,
 *      so `aria-invalid` was never set and a screen reader user was told "the
 * screen reader user was told "the
 *      title must be at least 5 characters" with no way to know which title.
 *   2. The step ORDER did not match the product's own step names. The page
 *      collected location in step 1 and category in step 2, so the "Choose what
 *      kind of help you need" question — the one that determines which
 *      documents matter — was asked after the address.
 *   3. `validateStep` keyed off the TARGET step number, so `handleSubmit` had to
 *      re-run three of them by hand and step 4 (documents) and step 5 (review)
 *      were never validated at all.
 *
 * The step list, the validators and the messages now live here, keyed by STEP
 * ID rather than by array index, and every validator returns a map of
 * FIELD -> message. The page renders that map next to the fields it belongs to.
 */

import { URGENCY_LEVELS, isUrgencyLevel, type UrgencyLevel } from './status';

/**
 * The urgency vocabulary is owned by `lib/status`, which is where the shared
 * labels and tones already live. Importing the type from there rather than
 * re-declaring the four strings here means the wizard cannot drift out of step
 * with the status filters and the list page: there is one list, not two.
 *
 * `lib/status` imports nothing, so this does not drag the Supabase client into
 * these validators.
 */
export type WizardUrgency = UrgencyLevel;

/* ------------------------------------------------------------------ steps */

export interface WizardStepDef {
  id: StepId;
  /** 1-based position, for display only. Never used as an array index. */
  number: number;
  label: string;
  /** The <h2> for the step panel. */
  heading: string;
  lede: string;
}

export type StepId = 'category' | 'details' | 'location' | 'funding' | 'documents';

export const WIZARD_STEPS: readonly WizardStepDef[] = [
  {
    id: 'category',
    number: 1,
    label: 'Category',
    heading: 'What kind of help do you need?',
    lede: 'This decides which supporting documents our review team will expect, so please pick the closest match.',
  },
  {
    id: 'details',
    number: 2,
    label: 'Request details',
    heading: 'Tell us what is going through',
    lede: 'Be as specific as you can. The more concrete the ask, the easier it is for someone to help.',
  },
  {
    id: 'location',
    number: 3,
    label: 'Location',
    heading: 'Where is the help needed?',
    lede: 'We publish the city and state only, so helpers nearby can find you. Your address is never collected.',
  },
  {
    id: 'funding',
    number: 4,
    label: 'Funding',
    heading: 'How much do you need?',
    lede: 'Ask for the amount you actually need. A clear figure is far easier for someone to say yes to than a vague one.',
  },
  {
    id: 'documents',
    number: 5,
    label: 'Documents',
    heading: 'Add supporting documents',
    lede: 'Documents are stored privately and are only ever seen by you and the staff reviewing your request.',
  },
];

export const FIRST_STEP = WIZARD_STEPS[0];
export const LAST_STEP = WIZARD_STEPS[WIZARD_STEPS.length - 1];

export function stepIndex(id: StepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

/** The step that follows `id`, clamped to the last step. */
export function nextStepId(id: StepId): StepId {
  return WIZARD_STEPS[Math.min(stepIndex(id) + 1, WIZARD_STEPS.length - 1)].id;
}

/** The step before `id`, clamped to the first step. */
export function previousStepId(id: StepId): StepId {
  return WIZARD_STEPS[Math.max(stepIndex(id) - 1, 0)].id;
}

export function isLastStep(id: StepId): boolean {
  return stepIndex(id) === WIZARD_STEPS.length - 1;
}

/* ------------------------------------------------------------------ limits */

export const MAX_TITLE = 150;
export const MAX_DESCRIPTION = 5000;
export const MAX_CITY = 100;
export const MAX_STATE = 100;
export const MIN_TITLE = 5;
export const MIN_DESCRIPTION = 20;

/** Guards against a nonsensical target that no helper could act on. */
export const MIN_TARGET_AMOUNT = 1;
export const MAX_TARGET_AMOUNT = 100_000_000;

interface UrgencyOption {
  value: WizardUrgency;
  label: string;
  description: string;
}

/*
  `as const satisfies` is doing two jobs here. `satisfies` still rejects a typo
  in a `value`; `as const` keeps the array a four-element *tuple* of literal
  types, which is what makes the completeness check below possible.
*/
export const URGENCY_OPTIONS = [
  { value: 'low', label: 'Low', description: 'Not urgent — this can wait a few weeks.' },
  { value: 'medium', label: 'Medium', description: 'This matters within a week or two.' },
  { value: 'high', label: 'High', description: 'This needs attention within days.' },
  { value: 'critical', label: 'Critical', description: 'This is time-sensitive and cannot wait.' },
] as const satisfies readonly UrgencyOption[];

/*
  Compile-time proof that the options above are exactly the four urgency levels
  from `lib/status`, in the same order.

  The direction is the important part: the tuple type is INFERRED from the
  literal above, and the known-good list is then assigned into it. A level
  added to `URGENCY_LEVELS` and forgotten here makes the literal a shorter
  tuple, so the assignment fails on length. A reshuffled option fails on
  position. Either way the wizard could otherwise have shipped a radio group
  that cannot represent a valid value, with no error anywhere — a level added
  to the status filters would be unselectable in the wizard.

  This is a `const` rather than an exported type alias on purpose: a type alias
  that nothing references is never evaluated, so the identical-looking
  type-only version of this check was silently vacuous.
*/
/*
  `Exclude<..., keyof any[]>` drops the array members (`length`, `map`, `push`,
  ...) so the mapped type collapses back to a four-element tuple. Mapping over
  `keyof T` directly would fold those members in and the assignment below would
  then fail on `length` for a reason that has nothing to do with urgency.
*/
type _UrgencyOptionsInOrder = {
  [K in Exclude<keyof typeof URGENCY_OPTIONS, keyof any[]>]: (typeof URGENCY_OPTIONS)[K] extends {
    value: infer V;
  }
    ? V
    : never;
};
const _urgencyOptionsInOrder: _UrgencyOptionsInOrder = URGENCY_LEVELS;
void _urgencyOptionsInOrder;

/* ------------------------------------------------------------------- form */

export interface WizardFormState {
  categoryId: string;
  title: string;
  description: string;
  urgency: WizardUrgency;
  locationCity: string;
  locationState: string;
  targetAmount: string;
  acknowledged: boolean;
}

export const EMPTY_WIZARD_FORM: WizardFormState = {
  categoryId: '',
  title: '',
  description: '',
  urgency: 'medium',
  locationCity: '',
  locationState: '',
  targetAmount: '',
  acknowledged: false,
};

export type FieldErrors = Partial<Record<keyof WizardFormState, string>>;

/* -------------------------------------------------------------- validation */

function validateCategory(form: WizardFormState, categoryIds: readonly string[]): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.categoryId) {
    errors.categoryId = 'Please choose the category that fits your situation best.';
  } else if (categoryIds.length > 0 && !categoryIds.includes(form.categoryId)) {
    /*
      The chosen id is not among the active categories. This happens when a row
      is deactivated between the lookup and the submit, and it would otherwise
      surface as a raw foreign-key violation from the database. The check is
      skipped while the list is still empty (a resumed draft is validated before
      categories finish loading), because "not loaded yet" must not be reported
      to the user as "your answer is wrong".
    */
    errors.categoryId = 'That category is no longer available. Please choose another.';
  }
  if (!form.acknowledged) {
    errors.acknowledged =
      'Please confirm the information you are sharing is accurate before continuing.';
  }
  return errors;
}

function validateDetails(form: WizardFormState): FieldErrors {
  const errors: FieldErrors = {};
  const title = form.title.trim();
  const description = form.description.trim();

  if (!title) errors.title = 'Please enter a short title for your request.';
  else if (title.length < MIN_TITLE) errors.title = `The title must be at least ${MIN_TITLE} characters.`;
  else if (title.length > MAX_TITLE) errors.title = `The title must be ${MAX_TITLE} characters or fewer.`;

  if (!description) errors.description = 'Please describe what you are going through.';
  else if (description.length < MIN_DESCRIPTION)
    errors.description = `Please add a bit more detail — at least ${MIN_DESCRIPTION} characters.`;
  else if (description.length > MAX_DESCRIPTION)
    errors.description = `The description must be ${MAX_DESCRIPTION} characters or fewer.`;

  /*
    A draft is restored from JSON in local storage, so `urgency` can hold a
    string that was valid when the draft was written but is not recognised now.
    `as WizardUrgency` in the form type is a claim about freshly authored values,
    not about untrusted parsed JSON, so this check is what stops a stale value
    from being submitted to the database.
  */
  if (!isUrgencyLevel(form.urgency)) errors.urgency = 'Please choose how urgent this is.';
  return errors;
}

function validateLocation(form: WizardFormState): FieldErrors {
  const errors: FieldErrors = {};
  const city = form.locationCity.trim();
  const state = form.locationState.trim();

  if (!city) errors.locationCity = 'Please enter the city where this help is needed.';
  else if (city.length < 2) errors.locationCity = 'Please enter a city name of at least 2 characters.';
  else if (city.length > MAX_CITY) errors.locationCity = `The city must be ${MAX_CITY} characters or fewer.`;

  if (!state) errors.locationState = 'Please enter the state where this help is needed.';
  else if (state.length < 2) errors.locationState = 'Please enter a state name of at least 2 characters.';
  else if (state.length > MAX_STATE)
    errors.locationState = `The state must be ${MAX_STATE} characters or fewer.`;

  return errors;
}

function validateFunding(form: WizardFormState): FieldErrors {
  const errors: FieldErrors = {};
  const raw = form.targetAmount.trim();

  if (!raw) {
    errors.targetAmount = 'Please enter the amount you need to raise.';
    return errors;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    errors.targetAmount = 'Please enter an amount using digits only, for example 25000 or 25000.50.';
    return errors;
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount)) {
    errors.targetAmount = 'Please enter a valid amount.';
    return errors;
  }
  if (amount < MIN_TARGET_AMOUNT) {
    errors.targetAmount = `Please enter an amount of at least ₹${MIN_TARGET_AMOUNT}.`;
    return errors;
  }
  if (amount > MAX_TARGET_AMOUNT) {
    errors.targetAmount = 'That amount looks too high. Please contact us directly and we will help.';
  }
  return errors;
}

/**
 * Validate one step. Returns a FIELD -> message map, which the page renders
 * beside the field it belongs to, or an empty object when the step is valid.
 *
 * `categoryIds` is the list of currently active category ids. It defaults to
 * empty so an omitted argument degrades to "cannot check category freshness"
 * rather than throwing — the only category check that is skipped is the one that
 * guards against a row being deactivated between load and submit.
 */
export function validateStep(
  id: StepId,
  form: WizardFormState,
  categoryIds: readonly string[] = [],
): FieldErrors {
  switch (id) {
    case 'category':
      return validateCategory(form, categoryIds);
    case 'details':
      return validateDetails(form);
    case 'location':
      return validateLocation(form);
    case 'funding':
      return validateFunding(form);
    case 'documents':
      // Documents are optional by design: a person asking for help often has no
      // paperwork. There is nothing to validate, so this returns {} rather than
      // pretending there is a rule.
      return {};
  }
}

/**
 * Validate every step, in order, and return the errors keyed by step.
 *
 * Used by the submit handler: it walks the whole flow rather than the three
 * steps it happened to remember before, so a request can no longer be submitted
 * with an invalid location or a malformed amount.
 */
export function validateAllSteps(
  form: WizardFormState,
  categoryIds: readonly string[] = [],
): Partial<Record<StepId, FieldErrors>> {
  const out: Partial<Record<StepId, FieldErrors>> = {};
  for (const step of WIZARD_STEPS) {
    const errors = validateStep(step.id, form, categoryIds);
    if (Object.values(errors).some(Boolean)) out[step.id] = errors;
  }
  return out;
}

/** First step that has at least one error, or null when the form is complete. */
export function firstInvalidStep(
  form: WizardFormState,
  categoryIds: readonly string[] = [],
): StepId | null {
  for (const step of WIZARD_STEPS) {
    if (Object.values(validateStep(step.id, form, categoryIds)).some(Boolean)) return step.id;
  }
  return null;
}

/** A human summary of the field errors, for the page-level live region. */
export function summariseErrors(errors: FieldErrors): string {
  const messages = Object.values(errors).filter((m): m is string => Boolean(m));
  if (messages.length === 0) return '';
  if (messages.length === 1) return messages[0];
  return `${messages.length} fields need attention before you can continue.`;
}

/**
 * The minimum needed before a draft is worth writing to the database.
 *
 * Used by "Save draft" and by the upload path, which both need a request id to
 * attach a file to. A draft that is missing its title, description, category,
 * amount or location would be unresumable — the wizard could not render it back
 * — so those five are required for persistence even though the form as a whole
 * is not valid until the acknowledgement is ticked.
 */
export function draftCompletenessProblem(
  form: WizardFormState,
  categoryIds: readonly string[] = [],
): string | null {
  const errors = {
    ...validateDetails(form),
    ...validateLocation(form),
    ...validateFunding(form),
  };
  if (!form.categoryId) {
    if (categoryIds.length === 0) {
      return 'Categories could not be loaded, so a draft cannot be saved yet. Please reload the page.';
    }
    errors.categoryId = 'Choose a category before saving a draft.';
  }
  const first = Object.values(errors).find((m): m is string => Boolean(m));
  return first ?? null;
}
