/**
 * Shown on the login / register screens when the browser has no usable
 * Supabase credentials.
 *
 * Auth cannot work at all in that state, so the useful thing is to say so
 * plainly and name the fix, rather than let the form fail with the raw
 * "Your project's URL and API key are required" throw from @supabase/ssr.
 *
 * With a properly filled `.env.local` this never renders.
 */
export function SupabaseNotConfigured() {
  return (
    <div className="mt-6 border-l-2 border-toner-yellow bg-toner-yellow/[0.08] px-4 py-3.5">
      <p className="font-data text-[11px] font-semibold uppercase tracking-[0.14em] text-ink">
        Sign-in is not configured
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        This app has no Supabase credentials, so accounts can&apos;t be created or
        signed in to yet.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
        Set{" "}
        <code className="font-data text-[12px] text-ink">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
        and{" "}
        <code className="font-data text-[12px] text-ink">
          NEXT_PUBLIC_SUPABASE_ANON_KEY
        </code>{" "}
        in <code className="font-data text-[12px] text-ink">.env.local</code> from your
        Supabase project&apos;s API settings, then restart the dev server.
      </p>
    </div>
  );
}
