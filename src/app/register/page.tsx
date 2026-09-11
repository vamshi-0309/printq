"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { isDevModeClient } from "@/lib/devMode";
import { PrintQMark } from "@/components/SiteHeader";
import { Button } from "@/components/ui/Button";
import { SupabaseNotConfigured } from "@/components/SupabaseNotConfigured";

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    shopName: "",
    ownerName: "",
    phone: "",
    email: "",
    city: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const configured = isSupabaseConfigured();

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // createClient() throws when Supabase env vars are missing. Without this
      // try/catch the throw skipped setLoading(false) and the button spun
      // forever with no message shown.
      const supabase = createClient();

      // Create the auth user. In local dev this goes through the dev helper so
      // no confirmation email is sent (Supabase's built-in SMTP allows ~2/hour,
      // which a few test shops exhaust). In production — and whenever the
      // helper is unavailable — this is the normal, email-verified sign-up.
      let userId: string | null = null;

      if (isDevModeClient()) {
        const devRes = await fetch("/api/dev/create-user", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: form.email, password: form.password }),
        });

        if (devRes.ok) {
          userId = (await devRes.json()).userId;
          // The dev user is already confirmed, so we can establish a session
          // straight away and land on the dashboard like a real sign-up would.
          await supabase.auth.signInWithPassword({
            email: form.email,
            password: form.password,
          });
        } else if (devRes.status !== 404) {
          // 404 means the helper is switched off (e.g. a production build with
          // the public flag mis-set) — fall through to the real sign-up below.
          // Anything else is a genuine failure worth surfacing.
          const body = await devRes.json().catch(() => ({}) as { error?: string });
          setError(body.error ?? "Could not create the test account.");
          return;
        }
      }

      if (!userId) {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
        });

        if (authError || !authData.user) {
          setError(authError?.message ?? "Could not create your account.");
          return;
        }
        userId = authData.user.id;
      }

      const res = await fetch("/api/register-shop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          shopName: form.shopName,
          ownerName: form.ownerName,
          phone: form.phone,
          email: form.email,
          city: form.city,
        }),
      });

      // The shop endpoint may fail before returning JSON (500 HTML page, or a
      // dropped connection) — don't let res.json() throw over the real error.
      const data = await res
        .json()
        .catch(() => ({}) as { error?: string; rolledBack?: boolean });

      if (!res.ok) {
        if (data.rolledBack) {
          // The server removed the half-created account, so any session we
          // picked up now points at a user that no longer exists. Clear it,
          // or the form would sit behind a stale login.
          await supabase.auth.signOut().catch(() => {});
          setError(
            `${data.error ?? "Could not set up your shop."} Nothing was saved — please try again.`
          );
        } else {
          setError(data.error ?? "Could not set up your shop.");
        }
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not reach the sign-up service. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "mt-1.5 w-full border border-line bg-paper px-4 py-2.5 text-sm text-ink placeholder:text-ink-soft/50 transition-colors focus:border-cyan focus:outline-none";

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper-grey px-5 py-12">
      <div className="w-full max-w-md">
        <div className="border border-line bg-paper p-7 sm:p-8 shadow-sm">
          <Link href="/" className="inline-flex items-center gap-2.5">
            <PrintQMark size={24} />
            <span className="font-display text-lg font-bold tracking-tight text-ink">PrintQ</span>
          </Link>

          <h1 className="mt-8 font-display text-xl font-bold text-ink">Set up your shop</h1>
          <p className="mt-1 text-sm text-ink-soft">Create your account and shop profile.</p>

          {!configured && <SupabaseNotConfigured />}


          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="shopName" className="text-sm font-medium text-ink">
                  Shop name <span className="text-magenta">*</span>
                </label>
                <input
                  id="shopName"
                  required
                  value={form.shopName}
                  onChange={update("shopName")}
                  className={inputClass}
                  placeholder="e.g. Sharma Xerox"
                />
              </div>
              <div>
                <label htmlFor="ownerName" className="text-sm font-medium text-ink">
                  Owner name <span className="text-magenta">*</span>
                </label>
                <input
                  id="ownerName"
                  required
                  value={form.ownerName}
                  onChange={update("ownerName")}
                  className={inputClass}
                  placeholder="Your name"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="phone" className="text-sm font-medium text-ink">
                  Phone <span className="text-magenta">*</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={form.phone}
                  onChange={update("phone")}
                  className={inputClass}
                  placeholder="98765 43210"
                />
              </div>
              <div>
                <label htmlFor="city" className="text-sm font-medium text-ink">
                  City <span className="text-magenta">*</span>
                </label>
                <input
                  id="city"
                  required
                  value={form.city}
                  onChange={update("city")}
                  className={inputClass}
                  placeholder="e.g. Jaipur"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="text-sm font-medium text-ink">
                Email <span className="text-magenta">*</span>
              </label>
              <input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={update("email")}
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="text-sm font-medium text-ink">
                Password <span className="text-magenta">*</span>
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={update("password")}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-ink-soft">Minimum 6 characters</p>
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
              Create account
            </Button>
          </form>
        </div>

        <p className="mt-5 text-center text-sm text-ink-soft">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-cyan hover:underline">
            Sign in
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
