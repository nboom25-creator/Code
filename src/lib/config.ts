/**
 * Runtime configuration. The app is fully functional with zero configuration
 * (demo mode). Supabase is only used when both public env vars are present.
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when Supabase auth + sync are available. Safe to read on client. */
export const isSupabaseConfigured =
  supabaseUrl.length > 0 && supabaseAnonKey.length > 0;

/** In demo mode, all user data lives in localStorage under this prefix. */
export const STORAGE_PREFIX = "projectpath.v1";
