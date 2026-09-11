import { createClient } from "@/lib/supabase/server";

export type Shop = {
  id: string;
  slug: string;
  owner_user_id: string;
  shop_name: string;
  owner_name: string;
  phone: string;
  email: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  logo_url: string | null;
  status: "active" | "suspended" | "expired";
  created_at: string;
  updated_at: string;
};

export type ShopPricing = {
  shop_id: string;
  a4_bw_per_page: number;
  a4_color_per_page: number;
  a3_bw_per_page: number;
  a3_color_per_page: number;
  duplex_discount_percent: number;
  minimum_order_amount: number;
  enabled_paper_sizes: string[];
  updated_at: string;
};

export type ShopSettings = {
  shop_id: string;
  upi_id: string | null;
  payment_gateway: string | null;
  payment_gateway_account_id: string | null;
  heartbeat_timeout_seconds: number;
  file_retention_hours: number;
  updated_at: string;
};

/**
 * Returns the shop the logged-in user belongs to (via shop_members).
 * Uses the cookie-bound client so RLS enforces access.
 */
export async function getShopForUser(): Promise<Shop | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("shops")
    .select("*")
    .limit(1)
    .single();

  return data as Shop | null;
}

export async function getShopPricing(shopId: string): Promise<ShopPricing | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("pricing")
    .select("*")
    .eq("shop_id", shopId)
    .single();
  return data as ShopPricing | null;
}

export async function getShopSettings(shopId: string): Promise<ShopSettings | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("shop_settings")
    .select("*")
    .eq("shop_id", shopId)
    .single();
  return data as ShopSettings | null;
}
