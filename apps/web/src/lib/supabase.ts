import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.SUPABASE_URL;
const publishableKey = import.meta.env.SUPABASE_PUBLISHABLE_KEY;

export const supabase: SupabaseClient | null =
  url && publishableKey ? createClient(url, publishableKey) : null;

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function refreshAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.refreshSession();
  return data.session?.access_token ?? null;
}

export type { Session };
