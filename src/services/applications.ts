import { supabase } from '../lib/supabase';
import { getCurrentUserId } from './helpRequests';

/**
 * Volunteer and partner enquiry integration boundary.
 *
 * Neither `volunteer_applications` nor `partner_enquiries` exists in the
 * database yet, and no migration in this repo creates them. Rather than leave
 * two dead forms or, far worse, fake a success message, this module:
 *
 *   1. Documents exactly what the schema needs to be (see REQUIRED_SCHEMA).
 *   2. Attempts a real INSERT into that table.
 *   3. Detects "table does not exist" and returns a typed, non-error result
 *      that the UI renders as an honest explanation plus a working mailto
 *      fallback.
 *
 * The matching SQL is in
 * supabase/migrations/20261101_volunteer_partner_enquiries.sql, which is
 * marked NOT APPLIED and must be applied and reviewed before these forms
 * persist anything. Until then they degrade visibly rather than silently.
 *
 * SECURITY: the anon key can only ever insert a row the RLS policy allows. The
 * tables these functions write to are not readable by anyone, including staff,
 * through the anon key — enquiries are handled out of band. A visitor is not
 * required to be signed in; a userId of null is stored as-is and is never
 * treated as an identity.
 */

export const VOLUNTEER_TABLE = 'volunteer_applications';
export const PARTNER_TABLE = 'partner_enquiries';

export interface VolunteerApplication {
  fullName: string;
  email: string;
  phone: string;
  city: string;
  availability: string;
  skills: string;
  message: string;
}

export interface PartnerEnquiry {
  organisation: string;
  contactName: string;
  email: string;
  phone: string;
  partnershipType: string;
  message: string;
}

export type ApplicationResult =
  | { ok: true; reference: string }
  | { ok: false; reason: 'schema_missing' | 'validation' | 'unknown'; message: string };

/**
 * What these forms require before they can store anything. Mirrored exactly by
 * the NOT APPLIED migration so the two can be checked against each other.
 */
export const REQUIRED_SCHEMA = {
  [VOLUNTEER_TABLE]: {
    id: 'uuid primary key default gen_random_uuid()',
    user_id: 'uuid null references auth.users(id) on delete set null',
    full_name: 'text not null check (char_length(full_name) between 2 and 120)',
    email: 'text not null check (position(chr(64) in email) > 1)',
    phone: 'text null',
    city: 'text not null',
    availability: 'text not null',
    skills: 'text null',
    message: 'text not null',
    status: "text not null default 'new'",
    created_at: 'timestamptz not null default now()',
  },
  [PARTNER_TABLE]: {
    id: 'uuid primary key default gen_random_uuid()',
    user_id: 'uuid null references auth.users(id) on delete set null',
    organisation: 'text not null',
    contact_name: 'text not null',
    email: 'text not null',
    phone: 'text null',
    partnership_type: 'text not null',
    message: 'text not null',
    status: "text not null default 'new'",
    created_at: 'timestamptz not null default now()',
  },
} as const;

/**
 * True when the INSERT failed because the table is not there yet, as opposed to
 * the write being genuinely refused.
 *
 * PostgREST reports a missing relation as 42P01 (relation does not exist) or
 * PGRST205. Both mean "this feature is not deployed yet", not "your submission
 * was rejected", and conflating the two would tell a genuine volunteer their
 * application failed for no reason.
 */
function isMissingRelation(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === '42P01' || err.code === 'PGRST205') return true;
  return /does not exist/i.test(err.message ?? '');
}

/**
 * A client-generated row id.
 *
 * WHY THIS EXISTS: these tables are granted INSERT only — the migration revokes
 * ALL from anon/authenticated and then grants INSERT. PostgREST's
 * `.insert(...).select('id')` needs SELECT on the table to build the RETURNING
 * representation, so asking for the generated id back would fail with a
 * permission error on a table we are explicitly allowed to write to. The two
 * errors are then indistinguishable to a visitor, and every genuine volunteer
 * would be told their application could not be saved.
 *
 * Generating the primary key in the browser is the standard fix: the server
 * still validates and stores whatever it is sent, the client never gets read
 * access, and the reference shown to the applicant is exactly the row's id.
 * `crypto.randomUUID` needs a secure context, which the production build
 * always has, and it is the same v4 shape `gen_random_uuid()` produces.
 */
function newRowId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new Error('A secure browser context is required to submit an application.');
}

export async function submitVolunteerApplication(
  input: VolunteerApplication,
): Promise<ApplicationResult> {
  const invalid = validateVolunteer(input);
  if (invalid) return { ok: false, reason: 'validation', message: invalid };

  const userId = await getCurrentUserId();

  let id: string;
  try {
    id = newRowId();
  } catch {
    return {
      ok: false,
      reason: 'unknown',
      message: 'Your browser could not generate a secure reference. Please email us instead.',
    };
  }

  const { error } = await supabase
    .from(VOLUNTEER_TABLE)
    .insert({
      id,
      user_id: userId,
      full_name: input.fullName.trim(),
      email: input.email.trim(),
      phone: input.phone.trim() || null,
      city: input.city.trim(),
      availability: input.availability.trim(),
      skills: input.skills.trim() || null,
      message: input.message.trim(),
    });

  if (error) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        reason: 'schema_missing',
        message: `Online volunteer applications are not switched on yet, so nothing was saved.`,
      };
    }
    console.error('[applications] volunteer insert failed', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {
      ok: false,
      reason: 'unknown',
      message: 'We could not save your application. Please email us instead.',
    };
  }

  return { ok: true, reference: id };
}

export async function submitPartnerEnquiry(input: PartnerEnquiry): Promise<ApplicationResult> {
  const invalid = validatePartner(input);
  if (invalid) return { ok: false, reason: 'validation', message: invalid };

  const userId = await getCurrentUserId();

  let id: string;
  try {
    id = newRowId();
  } catch {
    return {
      ok: false,
      reason: 'unknown',
      message: 'Your browser could not generate a secure reference. Please email us instead.',
    };
  }

  const { error } = await supabase
    .from(PARTNER_TABLE)
    .insert({
      id,
      user_id: userId,
      organisation: input.organisation.trim(),
      contact_name: input.contactName.trim(),
      email: input.email.trim(),
      phone: input.phone.trim() || null,
      partnership_type: input.partnershipType.trim(),
      message: input.message.trim(),
    });

  if (error) {
    if (isMissingRelation(error)) {
      return {
        ok: false,
        reason: 'schema_missing',
        message: `Online partner enquiries are not switched on yet, so nothing was saved.`,
      };
    }
    console.error('[applications] partner insert failed', {
      code: (error as { code?: string }).code ?? null,
      message: error.message,
    });
    return {
      ok: false,
      reason: 'unknown',
      message: 'We could not save your enquiry. Please email us instead.',
    };
  }

  return { ok: true, reference: id };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateVolunteer(v: VolunteerApplication): string | null {
  if (v.fullName.trim().length < 2) return 'Please tell us your name.';
  if (!EMAIL_SHAPE.test(v.email.trim())) return 'Please enter a valid email address.';
  if (v.city.trim().length < 2) return 'Please tell us which city you are in.';
  if (!v.availability.trim()) return 'Please choose when you are available.';
  if (v.message.trim().length < 10) return 'Please tell us a little about how you would like to help.';
  return null;
}

export function validatePartner(p: PartnerEnquiry): string | null {
  if (p.organisation.trim().length < 2) return 'Please tell us your organisation.';
  if (p.contactName.trim().length < 2) return 'Please tell us your name.';
  if (!EMAIL_SHAPE.test(p.email.trim())) return 'Please enter a valid email address.';
  if (!p.partnershipType.trim()) return 'Please choose a type of partnership.';
  if (p.message.trim().length < 10) return 'Please tell us a little about what you have in mind.';
  return null;
}

/** Builds the mailto fallback that the UI offers whenever a submit cannot persist. */
export function buildFallbackMailto(
  kind: 'volunteer' | 'partner',
  fields: Record<string, string>,
  recipient: string,
): string {
  const label = kind === 'volunteer' ? 'Volunteering' : 'Partnership';
  const body = Object.entries(fields)
    .filter(([, v]) => v.trim().length > 0)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}: ${v.trim()}`)
    .join('\n');

  return `mailto:${recipient}?subject=${encodeURIComponent(
    `[Walk With Us] ${label} enquiry`,
  )}&body=${encodeURIComponent(`${body}\n\n`)}`;
}
