import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Server client bound to the request's cookies, so it acts as the
 * logged-in shop owner/admin - respects RLS the same way the browser
 * client does. Use this in Server Components and Route Handlers for
 * anything the current user should be allowed to see.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render - middleware
            // refreshes the session instead. Safe to ignore.
          }
        },
      },
    }
  );
}

/**
 * Service-role client. Bypasses RLS entirely - use ONLY in trusted
 * server-side code that does its own authorization check first
 * (agent endpoints, admin routes, webhook handlers). NEVER import
 * this from a Client Component; the service role key must never
 * reach the browser.
 */
export function createServiceRoleClient() {
  // Deliberately not using createServerClient/cookies here - this
  // client is not tied to a user session, it acts as the platform.
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
