/**
 * Development-mode gate.
 *
 * This is the single switch that unlocks the local-only test helpers (chiefly
 * `POST /api/dev/create-user`, which mints a pre-confirmed Supabase user so
 * you can make test shops without burning confirmation emails).
 *
 * The production kill-switch is deliberately first and unconditional:
 * `NODE_ENV === "production"` disables dev mode no matter what else is set.
 * Shipping with `PRINTQ_DEV_MODE=true` left in the environment therefore
 * cannot open the helper — the only way to enable it is a non-production
 * build AND an explicit opt-in.
 *
 * `PRINTQ_DEV_MODE` has no NEXT_PUBLIC_ prefix, so it is never inlined into
 * the browser bundle; `isDevModeClient()` reads a separate public mirror that
 * is only ever a *hint* for the UI. The server never trusts it.
 */

/** Server-side gate. The only one that actually authorises anything. */
export function isDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  // Unconditional production kill-switch — checked before anything else.
  if (env.NODE_ENV === "production") return false;
  return env.PRINTQ_DEV_MODE === "true";
}

/**
 * Client-side hint, used only to decide which registration path the form
 * attempts first. A wrong value here cannot grant access: the dev route
 * enforces `isDevMode()` server-side and 404s otherwise, and the register
 * form falls back to the normal email-verified sign-up when it does.
 */
export function isDevModeClient(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_PRINTQ_DEV_MODE === "true"
  );
}
