"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { PrintQMark } from "@/components/SiteHeader";
import { Button } from "@/components/ui/Button";
import { SupabaseNotConfigured } from "@/components/SupabaseNotConfigured";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // createClient() throws when Supabase env vars are missing. Without this
      // try/catch the throw skipped setLoading(false) and the button span
      // forever with no message shown.
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        return;
      }
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not reach the sign-in service. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-grey px-5">
      <div className="w-full max-w-sm">
        <div className="border border-line bg-paper p-7 sm:p-8 shadow-sm">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <PrintQMark size={24} />
            <span className="font-display text-lg font-bold tracking-tight text-ink">PrintQ</span>
          </Link>

          <h1 className="mt-8 font-display text-xl font-bold text-ink">Shop owner login</h1>
          <p className="mt-1 text-sm text-ink-soft">Sign in to access your dashboard.</p>

          {!configured && <SupabaseNotConfigured />}

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="text-sm font-medium text-ink">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:border-cyan focus:outline-none"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm font-medium text-ink">Password</label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:border-cyan focus:outline-none"
              />
            </div>
            {error && (
              <div className="border border-magenta/20 bg-magenta/5 px-3 py-2">
                <p className="text-sm text-magenta">{error}</p>
              </div>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              loading={loading}
              disabled={!configured}
            >
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-ink-soft">
          New shop?{" "}
          <Link href="/register" className="font-medium text-cyan hover:underline">
            Create an account
          </Link>
        </p>
        <p className="mt-2 text-center">
          <Link href="/" className="text-sm text-ink-soft hover:text-ink">
            ← Back to PrintQ
          </Link>
        </p>
      </div>
    </main>
  );
}

/**
 * `useSearchParams()` opts the subtree into client-side rendering, and Next
 * requires an explicit Suspense boundary around that during prerender —
 * without one `next build` fails with "useSearchParams() should be wrapped in
 * a suspense boundary at page /login".
 *
 * The fallback mirrors the card's outer frame so there is no layout shift
 * between the fallback and the real form.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-grey px-5">
      <div className="w-full max-w-sm">
        <div className="border border-line bg-paper p-7 sm:p-8 shadow-sm">
          <div className="flex items-center gap-2.5">
            <PrintQMark size={24} />
            <span className="font-display text-lg font-bold tracking-tight text-ink">PrintQ</span>
          </div>
          <h1 className="mt-8 font-display text-xl font-bold text-ink">Shop owner login</h1>
          <p className="mt-1 text-sm text-ink-soft">Sign in to access your dashboard.</p>
        </div>
      </div>
    </main>
  );
}
