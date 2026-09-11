import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "./supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is calling, and which shop do they belong to?
 *
 * Every dashboard route needs the same two-step dance, and it was being
 * copy-pasted into each one:
 *
 *   1. the cookie-bound client establishes WHO is calling — RLS on
 *      shop_members is what proves the membership claim;
 *   2. the service-role client then does the actual reading and writing.
 *
 * The split is required, not a shortcut. Most of the tables a shop owner
 * needs (shop_settings, printers, order_files, payments, print_jobs,
 * queue_entries, licences) have RLS enabled with no policy attached, so a
 * user-scoped query silently matches zero rows: reads come back empty and
 * writes report success while changing nothing. Fixing that by loosening RLS
 * would open those tables to every authenticated user; doing the read as the
 * platform, after proving membership, keeps the isolation intact.
 */

export interface ShopContext {
  userId: string;
  shopId: string;
  role: string;
  /** Service-role client. Only ever used AFTER membership is established. */
  db: SupabaseClient;
}

export type ShopAuthResult =
  | { ok: true; ctx: ShopContext }
  | { ok: false; response: NextResponse };

export async function requireShop(): Promise<ShopAuthResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not authenticated." }, { status: 401 }),
    };
  }

  // Read through the user's own client: the shop_members policy is what makes
  // this claim trustworthy. Reading it as the service role would let any
  // logged-in user name any shop.
  const { data: membership } = await supabase
    .from("shop_members")
    .select("shop_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No shop found." }, { status: 404 }),
    };
  }

  return {
    ok: true,
    ctx: {
      userId: user.id,
      shopId: membership.shop_id,
      role: membership.role ?? "owner",
      db: createServiceRoleClient(),
    },
  };
}
