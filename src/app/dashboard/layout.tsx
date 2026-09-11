import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintQMark } from "@/components/SiteHeader";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { DashboardNav, type NavItem } from "@/components/dashboard/DashboardNav";
import {
  OverviewIcon,
  OrdersIcon,
  PrinterIcon,
  AgentIcon,
  PricingIcon,
  SettingsIcon,
  QrIcon,
} from "@/components/dashboard/icons";

/**
 * The dashboard shell, and the gate in front of it.
 *
 * There was no gate at all: no middleware, and every page did its own
 * client-side getUser() then quietly rendered an empty screen if there was no
 * session. A signed-out visitor got a working-looking dashboard full of
 * nothing, with no indication they needed to log in.
 *
 * The check belongs here because it is the one component every dashboard route
 * renders inside. It runs on the server, before any markup is sent, so an
 * unauthenticated request is redirected rather than answered.
 *
 * Note this is a defence-in-depth check, not the security boundary. The data
 * itself is protected by each API route re-proving membership and by RLS —
 * this layout only decides whether to draw the furniture.
 */

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: <OverviewIcon /> },
  { href: "/dashboard/orders", label: "Orders", icon: <OrdersIcon /> },
  { href: "/dashboard/printers", label: "Printers", icon: <PrinterIcon /> },
  { href: "/dashboard/agent", label: "Agent", icon: <AgentIcon /> },
  { href: "/dashboard/pricing", label: "Pricing", icon: <PricingIcon /> },
  { href: "/dashboard/qr", label: "QR code", icon: <QrIcon /> },
  { href: "/dashboard/settings", label: "Settings", icon: <SettingsIcon /> },
];

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  // Membership is read with the user's own client, so the shop_members policy
  // is what proves the claim.
  const { data: membership } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  if (!membership) {
    redirect("/register?no-shop=1");
  }

  // Name and status for the chrome. `shops` has a select policy, but this runs
  // as the platform for consistency with every other dashboard read.
  const { data: shop } = await createServiceRoleClient()
    .from("shops")
    .select("shop_name, city, status")
    .eq("id", membership.shop_id)
    .maybeSingle();

  return (
    <div className="flex min-h-screen bg-paper-grey">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-paper md:flex">
        <div className="border-b border-line px-5 py-4">
          <Link href="/" className="flex items-center gap-2">
            <PrintQMark size={22} />
            <span className="font-display text-[15px] font-bold tracking-[-0.02em] text-ink">
              PrintQ
            </span>
          </Link>
          <p className="mt-3 truncate text-[13px] font-medium text-ink" title={shop?.shop_name ?? ""}>
            {shop?.shop_name ?? "Your shop"}
          </p>
          <p className="truncate font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft">
            {shop?.city ? shop.city : "Shop dashboard"}
          </p>
        </div>

        <div className="flex flex-1 flex-col py-3">
          <DashboardNav
            variant="rail"
            items={navItems}
            footer={
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="font-data text-[10.5px] uppercase tracking-[0.1em] text-ink-soft transition-colors hover:text-magenta"
                >
                  Sign out
                </button>
              </form>
            }
          />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        {/* Mobile header: the brand and the shop, then the scrolling nav. */}
        <div className="px-5 md:hidden">
          <div className="flex items-center gap-2 py-3">
            <PrintQMark size={20} />
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
              {shop?.shop_name ?? "Your shop"}
            </span>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="font-data text-[10px] uppercase tracking-[0.1em] text-ink-soft"
              >
                Sign out
              </button>
            </form>
          </div>
          <DashboardNav variant="strip" items={navItems} />
        </div>

        <div className="px-5 py-6 sm:px-7 sm:py-8">{children}</div>
      </main>
    </div>
  );
}
