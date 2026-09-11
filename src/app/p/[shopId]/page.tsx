import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CustomerFlow } from "@/components/CustomerFlow";
import { PrintQMark } from "@/components/SiteHeader";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { PaperSize } from "@/components/customer/PrintOptions";
import { anyAgentOnline } from "@/lib/agentStatus";

/**
 * The page a customer lands on after scanning the shop's QR code.
 *
 * Reads through the service-role client because the visitor is anonymous —
 * RLS scopes these tables to shop members, so a public client would see
 * nothing. Only the shop's public-facing details are selected and passed down.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type ShopWithRelations = {
  id: string;
  shop_name: string;
  city: string | null;
  status: string;
  pricing: { enabled_paper_sizes: string[] } | null;
  shop_settings: { heartbeat_timeout_seconds: number } | null;
  print_agents: { last_heartbeat_at: string | null }[] | null;
};

export default async function ShopPrintPage({
  params,
}: {
  params: Promise<{ shopId: string }>;
}) {
  const { shopId } = await params;
  const supabase = createServiceRoleClient();

  // One round trip, not two. The page previously looked the shop up, then
  // made a second call for pricing/agents/settings — ~160ms each against
  // Supabase, so ~330ms of TTFB spent waiting in sequence. PostgREST can
  // embed the related rows in the same request via their foreign keys.
  //
  // The QR encodes the slug, not the UUID.
  const { data } = await supabase
    .from("shops")
    .select(
      "id, shop_name, city, status, pricing(enabled_paper_sizes), shop_settings(heartbeat_timeout_seconds), print_agents(last_heartbeat_at)"
    )
    .eq("slug", shopId)
    .single();

  // The embedded select is beyond what the generated types can infer, so the
  // shape is declared once here rather than asserted at each use.
  const shop = data as unknown as ShopWithRelations | null;

  if (!shop || shop.status !== "active") {
    notFound();
  }

  // Embedded to-one rows arrive as an object; to-many as an array.
  const pricing = shop.pricing;
  const shopSettings = shop.shop_settings;
  const agents = shop.print_agents ?? [];

  const shopOnline = anyAgentOnline(
    agents,
    shopSettings?.heartbeat_timeout_seconds ?? undefined
  );

  // Only offer sizes the shop actually stocks; fall back to A4 so the form is
  // never empty if pricing hasn't been configured yet.
  const enabled = (pricing?.enabled_paper_sizes ?? ["A4"]) as string[];
  const enabledPaperSizes = (
    enabled.filter((s): s is PaperSize => s === "A4" || s === "A3")
  );
  const paperSizes = enabledPaperSizes.length > 0 ? enabledPaperSizes : (["A4"] as PaperSize[]);

  return (
    <main className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-md items-center gap-3 px-5 py-3">
          <PrintQMark size={26} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[16px] font-bold tracking-[-0.02em] text-ink">
              {shop.shop_name}
            </h1>
            <p className="truncate font-data text-[10.5px] text-ink-soft">
              {shop.city ? `${shop.city} · ` : ""}Powered by PrintQ
            </p>
          </div>
          <span
            className={`flex shrink-0 items-center gap-1.5 border px-2 py-1 font-data text-[10px] uppercase tracking-[0.1em] ${
              shopOnline
                ? "border-emerald-500/30 bg-emerald-50 text-emerald-700"
                : "border-line bg-paper-grey text-ink-soft"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${shopOnline ? "bg-emerald-500" : "bg-ink-soft/40"}`}
              aria-hidden="true"
            />
            {shopOnline ? "Open" : "Offline"}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-md px-5 py-6">
        <CustomerFlow
          shopId={shop.id}
          shopName={shop.shop_name}
          shopOnline={shopOnline}
          enabledPaperSizes={paperSizes}
        />
      </div>
    </main>
  );
}
