import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Uses only the public anon key, which is safe to
 * ship to the client - Row Level Security in db/schema.sql is what
 * actually restricts what this client can read or write, not secrecy
 * of the key.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

/**
 * Whether the browser actually has usable Supabase credentials.
 *
 * `createClient()` throws outright when the URL or anon key is missing, which
 * on a form submit surfaces as a dead button rather than an error message.
 * Call this first so the UI can say what's wrong instead of hanging.
 *
 * Also rejects the placeholder host shipped in `.env.example`, so a copied but
 * unfilled `.env.local` is reported as unconfigured rather than failing later
 * with a DNS error.
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(
    url && key && url.trim() && key.trim() && !url.includes("your-project.supabase.co")
  );
}
