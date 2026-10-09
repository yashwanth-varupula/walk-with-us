import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Missing Supabase environment variables. Please check your .env file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * The project URL and the PUBLISHABLE (anon) key, exported for the one code path
 * that needs them outside the SDK: the XMLHttpRequest uploader in
 * services/helpRequests.ts, which exists solely because supabase-js v2's
 * Storage upload has no progress callback.
 *
 * This is the same publishable key the SDK already sends, and the same key that
 * is public in the built bundle by design. It grants nothing on its own: every
 * Storage write is additionally authorised by the requester-scoped policy on
 * storage.objects, keyed to auth.uid(). A service_role key is never present in
 * this file, in the environment, or anywhere in the client.
 */
export const SUPABASE_URL = supabaseUrl;
export const SUPABASE_PUBLISHABLE_KEY = supabaseAnonKey;
