"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/config";

let cached: SupabaseClient | null = null;

/**
 * Returns a singleton browser Supabase client, or null when Supabase is not
 * configured (demo mode). Only the public anon key is ever used here — the
 * service-role key is never imported into client code.
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (cached) return cached;
  cached = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return cached;
}
