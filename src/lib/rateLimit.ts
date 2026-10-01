import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Per-shop, per-IP limits on the anonymous endpoints, counted in Postgres
 * (hit_rate_limit in db/migrations/005) so every serverless instance shares
 * one count. No new infrastructure.
 *
 * The IP is hashed before it is stored: the table only needs to tell callers
 * apart, not to know who they are.
 *
 * FAILING OPEN
 * If the counter itself can't be reached, the request is allowed and the
 * fault logged. A broken rate limiter must not stop every shop taking
 * orders; it is abuse protection, not authorisation.
 */

export interface RateLimitRule {
  name: string;
  windowSeconds: number;
  limit: number;
}

/** Generous for a real customer (a few files, a few retries), tight for a script. */
export const UPLOAD_RATE_LIMIT: RateLimitRule = { name: "upload", windowSeconds: 60, limit: 15 };
export const ORDER_RATE_LIMIT: RateLimitRule = { name: "order", windowSeconds: 60, limit: 10 };

export const RATE_LIMITED_MESSAGE = "Too many uploads, please wait a moment";

/** The caller's address as Vercel reports it: the first X-Forwarded-For hop. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitKey(rule: RateLimitRule, shopId: string, ip: string): string {
  const ipHash = crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
  return `${rule.name}:${shopId}:${ipHash}`;
}

/** True when the request may proceed. */
export async function allowRequest(
  db: SupabaseClient,
  rule: RateLimitRule,
  shopId: string,
  ip: string
): Promise<boolean> {
  const { data, error } = await db.rpc("hit_rate_limit", {
    p_key: rateLimitKey(rule, shopId, ip),
    p_window_seconds: rule.windowSeconds,
    p_limit: rule.limit,
  });
  if (error) {
    console.error(`[rate-limit] ${rule.name} counter unavailable, allowing: ${error.message}`);
    return true;
  }
  return data !== false;
}
