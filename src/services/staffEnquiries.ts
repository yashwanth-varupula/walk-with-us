import { supabase } from '../lib/supabase';
import { sanitizeSearchTerm } from './staffRequests';

export type EnquiryStatus = 'new' | 'reviewing' | 'accepted' | 'declined';

export const ENQUIRY_STATUSES: readonly EnquiryStatus[] = [
  'new',
  'reviewing',
  'accepted',
  'declined',
] as const;

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  new: 'New',
  reviewing: 'Under Review',
  accepted: 'Approved / Accepted',
  declined: 'Declined',
};

export function isEnquiryStatus(val: unknown): val is EnquiryStatus {
  return typeof val === 'string' && (ENQUIRY_STATUSES as readonly string[]).includes(val);
}

export interface VolunteerApplicationRow {
  id: string;
  userId: string | null;
  fullName: string;
  email: string;
  phone: string | null;
  city: string;
  availability: string;
  skills: string | null;
  message: string;
  status: EnquiryStatus;
  createdAt: string;
}

export interface PartnerEnquiryRow {
  id: string;
  userId: string | null;
  organisation: string;
  contactName: string;
  email: string;
  phone: string | null;
  partnershipType: string;
  message: string;
  status: EnquiryStatus;
  createdAt: string;
}

export interface EnquiryActionRow {
  id: string;
  adminId: string | null;
  enquiryType: 'volunteer' | 'partner';
  enquiryId: string;
  oldStatus: string;
  newStatus: string;
  notes: string | null;
  createdAt: string;
}

export interface StaffEnquiryError {
  source: string;
  code?: string;
  message: string;
  isPermissionError?: boolean;
}

export type StaffEnquiryResult<T> =
  | { data: T; error: null; count: number }
  | { data: null; error: StaffEnquiryError; count: 0 };

export interface ListEnquiriesOptions {
  search?: string;
  status?: EnquiryStatus | 'all';
  sortOrder?: 'desc' | 'asc';
  page?: number;
  pageSize?: number;
}

export const DEFAULT_PAGE_SIZE = 15;

function parseDbError(source: string, err: { code?: string; message: string }): StaffEnquiryError {
  const code = err.code ?? '';
  const isPermission =
    code === '42501' ||
    code === '28000' ||
    /permission denied|not authorized/i.test(err.message);

  const isMissing =
    code === '42P01' ||
    code === 'PGRST205' ||
    /relation .* does not exist/i.test(err.message);

  let message = err.message;
  if (isPermission) {
    message =
      'Database access restricted. Staff access policies must be applied in the database (migration 20261105_staff_enquiries_access.sql).';
  } else if (isMissing) {
    message =
      'Enquiry database tables are not available yet. Please apply migration 20261101_volunteer_partner_enquiries.sql.';
  }

  return {
    source,
    code,
    message,
    isPermissionError: isPermission,
  };
}

/**
 * List volunteer applications for staff review.
 * Server-side filtered and paginated.
 */
export async function listStaffVolunteerApplications(
  options: ListEnquiriesOptions = {},
): Promise<StaffEnquiryResult<VolunteerApplicationRow[]>> {
  const {
    search = '',
    status = 'all',
    sortOrder = 'desc',
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  } = options;

  const validPage = Math.max(1, Math.floor(page));
  const validSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const from = (validPage - 1) * validSize;
  const to = from + validSize - 1;

  let query = supabase
    .from('volunteer_applications')
    .select(
      'id, user_id, full_name, email, phone, city, availability, skills, message, status, created_at',
      { count: 'exact' },
    );

  if (status !== 'all' && isEnquiryStatus(status)) {
    query = query.eq('status', status);
  }

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    // PostgREST ilike on multiple fields
    query = query.or(
      `full_name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,city.ilike.%${cleanSearch}%,skills.ilike.%${cleanSearch}%,message.ilike.%${cleanSearch}%`,
    );
  }

  query = query.order('created_at', { ascending: sortOrder === 'asc' });
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error('[staffEnquiries] list volunteers error', error);
    return {
      data: null,
      error: parseDbError('volunteer-list', error),
      count: 0,
    };
  }

  const rows: VolunteerApplicationRow[] = ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    userId: row.user_id ?? null,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone ?? null,
    city: row.city,
    availability: row.availability,
    skills: row.skills ?? null,
    message: row.message,
    status: isEnquiryStatus(row.status) ? row.status : 'new',
    createdAt: row.created_at,
  }));

  return {
    data: rows,
    error: null,
    count: count ?? rows.length,
  };
}

/**
 * List partner enquiries for staff review.
 * Server-side filtered and paginated.
 */
export async function listStaffPartnerEnquiries(
  options: ListEnquiriesOptions = {},
): Promise<StaffEnquiryResult<PartnerEnquiryRow[]>> {
  const {
    search = '',
    status = 'all',
    sortOrder = 'desc',
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
  } = options;

  const validPage = Math.max(1, Math.floor(page));
  const validSize = Math.max(1, Math.min(100, Math.floor(pageSize)));
  const from = (validPage - 1) * validSize;
  const to = from + validSize - 1;

  let query = supabase
    .from('partner_enquiries')
    .select(
      'id, user_id, organisation, contact_name, email, phone, partnership_type, message, status, created_at',
      { count: 'exact' },
    );

  if (status !== 'all' && isEnquiryStatus(status)) {
    query = query.eq('status', status);
  }

  const cleanSearch = sanitizeSearchTerm(search);
  if (cleanSearch) {
    query = query.or(
      `organisation.ilike.%${cleanSearch}%,contact_name.ilike.%${cleanSearch}%,email.ilike.%${cleanSearch}%,partnership_type.ilike.%${cleanSearch}%,message.ilike.%${cleanSearch}%`,
    );
  }

  query = query.order('created_at', { ascending: sortOrder === 'asc' });
  query = query.range(from, to);

  const { data, error, count } = await query;

  if (error) {
    console.error('[staffEnquiries] list partners error', error);
    return {
      data: null,
      error: parseDbError('partner-list', error),
      count: 0,
    };
  }

  const rows: PartnerEnquiryRow[] = ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    userId: row.user_id ?? null,
    organisation: row.organisation,
    contactName: row.contact_name,
    email: row.email,
    phone: row.phone ?? null,
    partnershipType: row.partnership_type,
    message: row.message,
    status: isEnquiryStatus(row.status) ? row.status : 'new',
    createdAt: row.created_at,
  }));

  return {
    data: rows,
    error: null,
    count: count ?? rows.length,
  };
}

/**
 * Authoritatively updates an enquiry status via SECURITY DEFINER RPC.
 */
export async function updateStaffEnquiryStatus(params: {
  enquiryType: 'volunteer' | 'partner';
  enquiryId: string;
  newStatus: EnquiryStatus;
  notes?: string;
}): Promise<{ ok: boolean; error: StaffEnquiryError | null }> {
  const { enquiryType, enquiryId, newStatus, notes } = params;

  if (!isEnquiryStatus(newStatus)) {
    return {
      ok: false,
      error: {
        source: 'validation',
        message: `Status "${newStatus}" is not supported. Allowed: ${ENQUIRY_STATUSES.join(', ')}.`,
      },
    };
  }

  const { error } = await supabase.rpc('update_enquiry_status', {
    p_enquiry_type: enquiryType,
    p_enquiry_id: enquiryId,
    p_new_status: newStatus,
    p_notes: notes?.trim() || null,
  });

  if (error) {
    console.error('[staffEnquiries] update status RPC failed', error);
    const code = (error as { code?: string }).code ?? '';
    let msg = error.message;

    if (code === '42883' || code === 'PGRST202') {
      msg =
        'The update_enquiry_status function is not installed in PostgreSQL. Please apply migration 20261105_staff_enquiries_access.sql.';
    } else if (code === '42501' || code === '28000') {
      msg = 'You are not authorized to update this enquiry status.';
    } else if (code === 'P0002') {
      msg = 'This enquiry was not found. It may have been deleted.';
    }

    return {
      ok: false,
      error: {
        source: 'update-status',
        code,
        message: msg,
      },
    };
  }

  return { ok: true, error: null };
}

/**
 * Reads audit history for an enquiry from enquiry_actions.
 */
export async function listEnquiryAuditTrail(
  enquiryId: string,
): Promise<{ data: EnquiryActionRow[]; error: StaffEnquiryError | null }> {
  const { data, error } = await supabase
    .from('enquiry_actions')
    .select('id, admin_id, enquiry_type, enquiry_id, old_status, new_status, notes, created_at')
    .eq('enquiry_id', enquiryId)
    .order('created_at', { ascending: false });

  if (error) {
    // If table doesn't exist yet, return empty list gracefully
    if (
      error.code === '42P01' ||
      error.code === 'PGRST205' ||
      error.code === '42501'
    ) {
      return { data: [], error: null };
    }
    return {
      data: [],
      error: parseDbError('audit-list', error),
    };
  }

  const rows: EnquiryActionRow[] = ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    adminId: row.admin_id ?? null,
    enquiryType: row.enquiry_type,
    enquiryId: row.enquiry_id,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  }));

  return { data: rows, error: null };
}
