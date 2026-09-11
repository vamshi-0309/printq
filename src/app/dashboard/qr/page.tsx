import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { QrPanel } from "@/components/dashboard/QrPanel";

/**
 * The card that goes on the counter.
 *
 * Rendered on the server so the slug is fetched once, with the page, instead
 * of the browser making a round trip and showing "Loading…" over an empty
 * frame. The slug is always the shop's real one — there is no placeholder
 * anywhere in this path, and a shop without one cannot reach this page.
 */

export const dynamic = "force-dynamic";

export default async function DashboardQrPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard/qr");

  const { data: membership } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) redirect("/register?no-shop=1");

  const { data: shop } = await createServiceRoleClient()
    .from("shops")
    .select("slug, shop_name")
    .eq("id", membership.shop_id)
    .maybeSingle();

  if (!shop?.slug) {
    return (
      <div className="max-w-md">
        <h1 className="font-display text-[26px] font-bold tracking-[-0.025em] text-ink">
          Your shop QR
        </h1>
        <p className="mt-2 text-[13px] text-ink-soft">
          This shop has no web address yet, so a QR code cannot be made. Contact PrintQ support.
        </p>
      </div>
    );
  }

  const configuredAppUrl = (process.env.NEXT_PUBLIC_APP_URL || "").trim().replace(/\/$/, "");

  return (
    <div className="max-w-lg space-y-5">
      <div className="border-b border-line pb-5">
        <h1 className="font-display text-[22px] font-bold tracking-[-0.025em] text-ink sm:text-[26px]">
          Your shop QR
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          Print this and put it on your counter. It always opens {shop.shop_name}&apos;s own print
          page — the code never changes, so one printed card lasts.
        </p>
      </div>

      <QrPanel slug={shop.slug} configuredAppUrl={configuredAppUrl} />
    </div>
  );
}
