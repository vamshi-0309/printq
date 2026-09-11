import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createSupabaseRegistrationStore } from "@/lib/supabaseRegistrationStore";
import { registerShop } from "@/lib/registration";

const schema = z.object({
  userId: z.string().uuid(),
  shopName: z.string().min(2),
  ownerName: z.string().min(2),
  phone: z.string().min(8),
  email: z.string().email(),
  city: z.string().min(2),
});

/**
 * Called right after a successful Supabase Auth sign-up. Not itself an
 * authentication step - the caller already has a valid session; this just
 * provisions the shop's rows. Uses the service role because shop_members
 * (which RLS depends on) doesn't exist for this user yet.
 *
 * If provisioning fails it now also removes the auth user that was just
 * created, so a failed registration doesn't strand an account with no shop
 * and the owner can retry with the same email. The rollback rules live in
 * lib/registration.ts and only ever apply to a brand-new, shop-less account.
 */
export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid registration details." }, { status: 400 });
  }

  const store = createSupabaseRegistrationStore(createServiceRoleClient());
  const result = await registerShop(store, parsed.data);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, rolledBack: result.rolledBack },
      { status: result.status }
    );
  }

  return NextResponse.json({ shopId: result.shopId, slug: result.slug });
}
