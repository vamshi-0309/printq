import { redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { evaluateLicence } from "@/lib/licence";

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const admin = createServiceRoleClient();
  const { data } = await admin.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  return Boolean(data);
}

export default async function AdminPage() {
  const allowed = await isAdmin();
  if (!allowed) redirect("/login");

  const service = createServiceRoleClient();

  const { data: shops } = await service
    .from("shops")
    .select("id, shop_name, city, owner_name, phone, is_active, created_at")
    .order("created_at", { ascending: false });

  const shopIds = (shops ?? []).map((s) => s.id);

  const { data: licences } = shopIds.length > 0
    ? await service
        .from("licences")
        .select("shop_id, status, expires_at, grace_period_days")
        .in("shop_id", shopIds)
        .order("created_at", { ascending: false })
    : { data: [] as { shop_id: string; status: string; expires_at: string; grace_period_days: number }[] };

  const { data: agents } = shopIds.length > 0
    ? await service
        .from("print_agents")
        .select("shop_id, status, last_heartbeat_at")
        .in("shop_id", shopIds)
    : { data: [] as { shop_id: string; status: string; last_heartbeat_at: string }[] };

  const licenceMap = new Map<string, { status: string; expiresAt: Date; gracePeriodDays: number }>();
  for (const l of licences ?? []) {
    if (!licenceMap.has(l.shop_id)) {
      licenceMap.set(l.shop_id, {
        status: l.status as "active" | "expired" | "suspended",
        expiresAt: new Date(l.expires_at),
        gracePeriodDays: l.grace_period_days ?? 7,
      });
    }
  }

  const agentMap = new Map<string, string>();
  for (const a of agents ?? []) {
    agentMap.set(a.shop_id, a.status);
  }

  return (
    <main className="min-h-screen bg-paper-grey px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-display text-2xl font-bold text-ink">Admin — All shops</h1>
        <p className="mt-2 text-sm text-ink-soft">{(shops ?? []).length} registered shops</p>

        {(!shops || shops.length === 0) ? (
          <div className="mt-10 border border-line bg-paper px-6 py-12 text-center">
            <p className="text-ink-soft">No shops registered yet.</p>
          </div>
        ) : (
          <div className="mt-6 divide-y divide-line border border-line bg-paper">
            {shops.map((shop) => {
              const licence = licenceMap.get(shop.id);
              const evaluation = licence
                ? evaluateLicence(licence as Parameters<typeof evaluateLicence>[0])
                : null;
              const agentStatus = agentMap.get(shop.id) ?? "none";

              return (
                <div key={shop.id} className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="font-medium text-ink">{shop.shop_name}</p>
                    <p className="text-sm text-ink-soft">
                      {shop.city}{shop.owner_name ? ` · ${shop.owner_name}` : ""}
                      {shop.phone ? ` · ${shop.phone}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-xs ${agentStatus === "online" ? "text-cyan" : "text-ink-soft"}`}>
                      {agentStatus === "online" ? "Agent online" : agentStatus === "none" ? "No agent" : "Agent offline"}
                    </span>
                    {evaluation ? (
                      <span
                        className={`text-sm font-medium ${
                          evaluation.effectiveStatus === "active"
                            ? "text-cyan"
                            : evaluation.effectiveStatus === "grace"
                            ? "text-toner-yellow"
                            : "text-magenta"
                        }`}
                      >
                        {evaluation.effectiveStatus}
                      </span>
                    ) : (
                      <span className="text-sm text-ink-soft">No licence</span>
                    )}
                    {!shop.is_active && (
                      <span className="text-xs text-magenta">Inactive</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
