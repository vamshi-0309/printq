import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isDevMode } from "@/lib/devMode";

/**
 * DEVELOPMENT ONLY — creates a Supabase auth user that is already email
 * confirmed, so local testing doesn't send (or wait on) a confirmation mail.
 *
 * Why this exists: Supabase's built-in SMTP allows roughly two messages an
 * hour. Making a handful of test shops trips `over_email_send_rate_limit` and
 * blocks further sign-ups, which is exactly what happened here.
 *
 * What it deliberately does NOT do:
 *   - It does not provision the shop. Callers go on to POST the real
 *     /api/register-shop, so the tested provisioning path is production's.
 *   - It does not change the production sign-up flow. `supabase.auth.signUp`
 *     on /register is untouched and still requires email confirmation.
 *
 * Safety: `isDevMode()` returns false whenever NODE_ENV === "production",
 * regardless of PRINTQ_DEV_MODE, and this route answers 404 in that case — the
 * same response as a route that does not exist, so its presence isn't
 * detectable in a deployed build.
 */

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

/** 404, identical to a non-existent route — never confirm the route is here. */
function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  if (!isDevMode()) return notFound();

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "email and a password of at least 8 characters are required." },
      { status: 400 }
    );
  }
  const { email, password } = parsed.data;

  const supabase = createServiceRoleClient();

  // email_confirm: true marks the address verified without sending anything,
  // which is what keeps us under the SMTP rate limit.
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create the test user." },
      { status: 500 }
    );
  }

  return NextResponse.json({ userId: data.user.id, email: data.user.email });
}

/** Present so a stray GET in a browser gets 404 rather than 405. */
export async function GET() {
  return notFound();
}
